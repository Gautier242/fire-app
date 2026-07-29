"""Telling a refinery apart from a wildfire.

FIRMS detects heat, not wildfire. Refineries, steelworks and gas flares burn at
the same coordinates every day. Two sources found this independently: the
Duisburg steelworks (104 detections, frp_max only 17.7 MW, burning continuously
across both days) and the Fos-sur-Mer flares that account for most of
Bouches-du-Rhone's detections.

Unmasked, the map shows permanent fires that never move. Once a reader learns to
ignore two fixed dots, they ignore the real one beside them — so this is a
credibility problem, not a tidiness one.

The signature is PERSISTENCE, not a hand-maintained blocklist. Something burning
at the same spot on most days is infrastructure. A blocklist would need a human
to notice every new flare and would never cover a country nobody thought about.

The bias is deliberate: when unsure, do not mask. Showing a refinery is a smaller
failure than hiding a fire.
"""

# How far apart two detections can be and still be the same site. The detected
# centre of a fixed flare wanders between overpasses as different parts of it
# trip the sensor, so an exact match would never accumulate a record.
SAME_SITE_KM = 1.0

# Days of history to keep. Long enough to separate infrastructure from a fire,
# short enough that a decommissioned flare or a harvest season ages out.
WINDOW_DAYS = 14

# Days within the window a site must appear on before it is called industrial.
# A serious wildfire burns for days; nothing legitimate burns on most days of a
# fortnight at one spot.
MIN_DAYS = 6

# Below this many days of record we cannot judge anything, so we mask nothing.
MIN_HISTORY_DAYS = 3

_KM_PER_DEG = 111.0


def _shift_days(day, delta):
    """Shift an ISO date string. Returns it unchanged if it is not a date."""
    from datetime import date, timedelta
    try:
        return (date.fromisoformat(day) + timedelta(days=delta)).isoformat()
    except (TypeError, ValueError):
        return day


def _near(lat_a, lon_a, lat_b, lon_b):
    """Cheap equirectangular distance. Exact enough at these separations."""
    import math
    mean_lat = math.radians((lat_a + lat_b) / 2)
    dx = (lon_a - lon_b) * math.cos(mean_lat) * _KM_PER_DEG
    dy = (lat_a - lat_b) * _KM_PER_DEG
    return math.hypot(dx, dy) <= SAME_SITE_KM


class FlareRegistry:
    """Which coordinates have burned on which days.

    CI starts from a fresh checkout every run, so this only works if it can be
    published alongside the data and read back on the next build.
    """

    def __init__(self, sites=None):
        # [{"lat":, "lon":, "days": [ISO date, ...]}]
        self.sites = sites or []

    @classmethod
    def from_payload(cls, payload):
        """Rebuild from a published file, tolerating anything malformed.

        A corrupt registry must mask nothing rather than mask wrongly — the
        failure mode of a bad registry is hiding a real fire.
        """
        if not isinstance(payload, dict):
            return cls()
        rows = payload.get("sites")
        if not isinstance(rows, list):
            return cls()
        sites = []
        for row in rows:
            try:
                sites.append({
                    "lat": float(row["lat"]),
                    "lon": float(row["lon"]),
                    "days": sorted({str(d) for d in row["days"]}),
                })
            except (KeyError, TypeError, ValueError):
                continue  # one bad row must not disarm the whole mask
        return cls(sites)

    def payload(self):
        return {"window_days": WINDOW_DAYS, "sites": self.sites}

    def observe(self, incidents, day):
        """Record that these incidents burned on `day`, then drop old days."""
        for incident in incidents:
            lat, lon = incident.get("lat"), incident.get("lon")
            if lat is None or lon is None:
                continue
            site = self._find(lat, lon)
            if site is None:
                self.sites.append({"lat": lat, "lon": lon, "days": [day], "n": 1})
            else:
                if day not in site["days"]:
                    # A rebuild, a retry or a manual run must not turn one day
                    # into twenty, so days are a set rather than a counter.
                    site["days"] = sorted(site["days"] + [day])
                # Track the running centre. A flare's detected position wanders
                # between overpasses, and over a fortnight the drift can exceed
                # SAME_SITE_KM from wherever it was first seen — anchoring on the
                # first sighting would split one refinery into several sites,
                # none of which ever reaches the day count.
                n = site.get("n", 1) + 1
                site["lat"] += (lat - site["lat"]) / n
                site["lon"] += (lon - site["lon"]) / n
                site["n"] = n
        self._prune(day)

    def _find(self, lat, lon):
        for site in self.sites:
            if _near(lat, lon, site["lat"], site["lon"]):
                return site
        return None

    def _prune(self, today):
        """Drop days older than the window, measured from the latest build.

        Pruning per site would keep a decommissioned flare's record forever,
        because a site that stops burning stops receiving new days and so never
        loses its old ones. The window has to be wall-clock, not per-site.
        """
        cutoff = _shift_days(today, -WINDOW_DAYS)
        for site in self.sites:
            site["days"] = [d for d in sorted(site["days"]) if d > cutoff][-WINDOW_DAYS:]
        self.sites = [s for s in self.sites if s["days"]]

    def _history_days(self):
        return len({day for site in self.sites for day in site["days"]})

    def is_industrial(self, lat, lon):
        if self._history_days() < MIN_HISTORY_DAYS:
            return False  # too little record to judge; mask nothing
        site = self._find(lat, lon)
        return bool(site) and len(site["days"]) >= MIN_DAYS


def mask_incidents(incidents, registry):
    """Flag industrial heat rather than deleting it.

    A masked incident is still real heat and someone zooming into an industrial
    estate should see why it is there. But it must not count as a wildfire in a
    headline, a nearest-fire distance or an aircraft match.
    """
    out = []
    for incident in incidents:
        marked = dict(incident)
        marked["industrial"] = registry.is_industrial(
            incident.get("lat"), incident.get("lon"))
        out.append(marked)
    return out


def _in_ring(lon, lat, ring):
    """Ray casting. A point on the boundary may fall either way; harmless here."""
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
        if (y1 > lat) != (y2 > lat):
            if lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
                inside = not inside
    return inside


def tag_country(incidents, shapes):
    """Mark whether each incident is inside the country's real borders.

    The FIRMS query uses a bounding box, and a box is not a border: it reaches
    into Spain, Belgium, Germany and Italy. Leon in Spain came back as the single
    largest "French" fire.

    Foreign fires are kept — fires do not stop at borders and smoke certainly
    does not — but they must never be counted as the fire near a French reader,
    and the map draws them faded.
    """
    polygons = []
    for feature in (shapes or {}).get("features", []):
        geom = feature.get("geometry") or {}
        coords = geom.get("coordinates") or []
        if geom.get("type") == "Polygon":
            coords = [coords]
        for poly in coords:
            if poly and poly[0]:
                lons = [p[0] for p in poly[0]]
                lats = [p[1] for p in poly[0]]
                polygons.append((min(lons), min(lats), max(lons), max(lats), poly[0]))

    out = []
    for incident in incidents:
        lon, lat = incident.get("lon"), incident.get("lat")
        inside = False
        if lon is not None and lat is not None:
            for minx, miny, maxx, maxy, ring in polygons:
                # Bounding box first: 96 départements x ~130 vertices is a lot of
                # ray casting to do 300 times without a cheap rejection.
                if minx <= lon <= maxx and miny <= lat <= maxy and _in_ring(lon, lat, ring):
                    inside = True
                    break
        marked = dict(incident)
        marked["in_country"] = inside
        out.append(marked)
    return out
