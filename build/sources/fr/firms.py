"""Satellite fire detections over France, grouped into incidents.

NASA FIRMS publishes a rolling 24-hour CSV of VIIRS thermal anomalies for
Europe, one row per 375 m pixel. No API key: the keyed `api/area` endpoint is a
different service.

Three things must be said out loud, because the frontend repeats them to people
deciding whether to leave a house:

- **Absence of detection is never safety.** A satellite that saw nothing saw
  nothing — it did not check. Cloud blocks the sensor outright.
- **Detection lags.** VIIRS passes a few times a day (measured 2026-07-29: five
  passes over France in 24 h across both satellites). A fire that started an
  hour ago may not be here at all.
- **FIRMS detects heat, not wildfire.** Refineries, flares and agricultural
  burning light up exactly like a forest does. La Mède and Lacq appear every
  day. Filtering them is the industrial mask's job, not this module's, so
  normalize() keeps what the mask needs: an exact cluster centre and every
  detection timestamp.

Detections are not fires. A VIIRS pixel is 375 m and one fire lights many; the
Lacanau fire of 2026-07-28 was 48 detections inside 1 km. Anything within
CLUSTER_KM of another detection joins the same incident.

Both satellites are read. They are not redundant: they fly different overpass
times, so merging cuts the gap between passes. Double counting cannot survive
clustering, which is spatial — the same fire seen by both lands in one incident.
Measured 2026-07-29: J1 alone 179 incidents, SUOMI alone 189, merged 294. Only
74 locations were common, so a single satellite would have missed roughly a
hundred incidents the other saw.
"""
import csv
import math
from datetime import datetime, timezone

from build.http import TIMEOUT_SECONDS

BASE = "https://firms.modaps.eosdis.nasa.gov/data/active_fire"
URLS = (
    f"{BASE}/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Europe_24h.csv",
    f"{BASE}/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Europe_24h.csv",
)

# A bound, not a border. This rectangle reaches into Spain, Belgium, Switzerland
# and northern Italy, so detections just over the frontier survive it — which is
# wanted, since a fire 5 km into Spain still matters in the Pyrénées-Orientales.
# It exists to cap the work, not to draw a coastline.
LON_MIN, LON_MAX = -5.5, 10.0
LAT_MIN, LAT_MAX = 41.0, 51.5

# 1.5 km: four VIIRS pixels. Wide enough to join one fire's pixels across two
# overpasses, tight enough that two fires in the same valley stay two.
CLUSTER_KM = 1.5

# The Europe file measured 2 724 and 3 524 rows on 2026-07-29. The cap is a
# fuse against a feed that changes shape, not a tuning knob.
MAX_ROWS = 50000

# The feed sends words. The documentation says "l"/"n"/"h"; a filter written
# from the documentation matches zero rows. Verified against real data.
CONFIDENCE_RANK = {"low": 0, "nominal": 1, "high": 2}

# Five decimals is the feed's own precision, ~1 m. Nothing is rounded away
# because the industrial mask has to recognise a refinery as the same cluster
# from one day to the next, and its centre already wanders by a pixel or two as
# different parts of the flare trip the sensor.
PRECISION = 5

_KM_PER_DEGREE = 111.195


def fetch(session):
    """Both satellites, concatenated. The second file's header line lands
    mid-payload and falls out of normalize() as a malformed row."""
    payloads = []
    for url in URLS:
        response = session.get(url, timeout=TIMEOUT_SECONDS)
        response.raise_for_status()
        payloads.append(response.text)
    return "\n".join(payloads)


def _timestamp(row, now):
    """acq_date plus acq_time, which is HHMM and not always four characters:
    "1238" is 12:38 and "45" is 00:45, never 45:00."""
    try:
        date = datetime.strptime(row["acq_date"].strip(), "%Y-%m-%d")
        clock = row["acq_time"].strip().zfill(4)
        stamp = date.replace(hour=int(clock[:2]), minute=int(clock[2:]),
                             tzinfo=timezone.utc)
    except (AttributeError, KeyError, TypeError, ValueError):
        return None
    # A detection dated after the build clock is a broken row, and letting it
    # through would put a future last_seen on the map.
    return None if stamp > now else stamp


def _detection(row, now):
    try:
        lat = float(row["latitude"])
        lon = float(row["longitude"])
        frp = float(row["frp"])
    except (KeyError, TypeError, ValueError):
        return None
    if not (LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX):
        return None
    stamp = _timestamp(row, now)
    if stamp is None:
        return None
    # An unrecognised confidence word is kept but ranked lowest: dropping the
    # detection would hide a fire over a vocabulary change.
    confidence = (row.get("confidence") or "").strip().lower()
    if confidence not in CONFIDENCE_RANK:
        confidence = "low"
    return lon, lat, frp, stamp, confidence


def _distance_km(a, b):
    """Equirectangular approximation. At 1.5 km over France its error is under
    a metre, and it costs one cosine instead of haversine's four."""
    (lon1, lat1), (lon2, lat2) = a[:2], b[:2]
    east = (lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(east, lat2 - lat1) * _KM_PER_DEGREE


def _clusters(detections):
    """Single-linkage grouping: a detection joins a cluster if it is within
    CLUSTER_KM of any member, so a fire front chains along its own length.

    ponytail: all-pairs scan, O(n^2). 1 271 detections is 0.8 M distance
    checks and runs in well under a second. At 10x it is 81 M checks, roughly a
    minute — put the points in a CLUSTER_KM grid and compare only the nine
    neighbouring cells if the box ever widens that far.
    """
    unassigned = set(range(len(detections)))
    groups = []
    while unassigned:
        seed = unassigned.pop()
        group, frontier = [seed], [seed]
        while frontier:
            here = detections[frontier.pop()]
            near = [i for i in unassigned
                    if _distance_km(here, detections[i]) <= CLUSTER_KM]
            unassigned.difference_update(near)
            group.extend(near)
            frontier.extend(near)
        groups.append([detections[i] for i in group])
    return groups


def _iso(stamp):
    return stamp.strftime("%Y-%m-%dT%H:%M:%SZ")


def _incident(group):
    lon = round(sum(d[0] for d in group) / len(group), PRECISION)
    lat = round(sum(d[1] for d in group) / len(group), PRECISION)
    stamps = [d[3] for d in group]
    return {
        # Derived from the centre, so a fire that does not move keeps its id
        # across builds. Clusters are at least CLUSTER_KM apart, so two of them
        # cannot round to the same 110 m.
        "id": f"firms-{lat:.3f},{lon:.3f}",
        "lat": lat,
        "lon": lon,
        "detections": len(group),
        # A 24-hour sum over every pass, not an instantaneous power: it says how
        # much fire there was, while frp_max says how hot the worst pixel got.
        "frp_total": round(sum(d[2] for d in group), 2),
        "frp_max": round(max(d[2] for d in group), 2),
        "first_seen": _iso(min(stamps)),
        "last_seen": _iso(max(stamps)),
        "bbox": [round(min(d[0] for d in group), PRECISION),
                 round(min(d[1] for d in group), PRECISION),
                 round(max(d[0] for d in group), PRECISION),
                 round(max(d[1] for d in group), PRECISION)],
        "confidence": max((d[4] for d in group), key=CONFIDENCE_RANK.__getitem__),
        "points": [[round(d[0], PRECISION), round(d[1], PRECISION), _iso(d[3])]
                   for d in sorted(group, key=lambda d: d[3])],
        "source": "firms",
    }


def normalize(payload, now=None, limit=MAX_ROWS):
    """One record per incident, hottest first. A bad row is skipped, never
    raised on: one malformed line must not cost the other six hundred."""
    now = now or datetime.now(timezone.utc)
    detections = []
    for row in csv.DictReader((payload or "").splitlines()):
        if len(detections) >= limit:
            break
        detection = _detection(row, now)
        if detection is not None:
            detections.append(detection)

    incidents = [_incident(group) for group in _clusters(detections)]
    return sorted(incidents, key=lambda i: -i["frp_total"])
