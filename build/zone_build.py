"""One detail file per hot zone.

A zone file makes the local view instant and available offline. Its absence is
not an error -- the browser fetches the same data live -- so a zone that fails
must never fail the build.
"""
import json
import math
from pathlib import Path

from build import fire_boundary

EARTH_KM = 6371.0


def km_between(a_lat, a_lon, b_lat, b_lon):
    phi1, phi2 = math.radians(a_lat), math.radians(b_lat)
    d_phi = math.radians(b_lat - a_lat)
    d_lambda = math.radians(b_lon - a_lon)
    h = (math.sin(d_phi / 2) ** 2
         + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2)
    return 2 * EARTH_KM * math.asin(math.sqrt(h))


def _write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(payload, separators=(",", ":")))
    temp.replace(path)


def fires_in_zone(zone, fires):
    """Real wildfires inside the zone radius, worst first.

    Industrial heat and fires across the border belong on the national map but
    are never the fire near a reader.

    Ordered by radiative power because terrain fetches downstream are capped:
    the order decides which fires get a real local slope and which fall back to
    the zone median.
    """
    radius = zone.get("radius_km") or 50
    near = []
    for fire in fires or []:
        if fire.get("industrial") or fire.get("in_country") is False:
            continue
        if fire.get("lat") is None or fire.get("lon") is None:
            continue
        if km_between(zone["lat"], zone["lon"], fire["lat"], fire["lon"]) <= radius:
            near.append(fire)
    return sorted(near, key=lambda f: -(f.get("frp_total") or 0))


def closures_in_zone(zone, closures):
    """Road cuts in force inside the zone radius.

    Cuts scheduled to start later are excluded rather than dated: this list feeds
    a map of what is shut now, and a marker is not a place to explain that a road
    will close in December. The national list keeps them.
    """
    radius = zone.get("radius_km") or 50
    near = []
    for closure in closures or []:
        if closure.get("in_force") is False:
            continue
        lat, lon = closure.get("lat"), closure.get("lon")
        if lat is None or lon is None:
            continue
        if km_between(zone["lat"], zone["lon"], lat, lon) <= radius:
            near.append(closure)
    return near


def write_zone(out, zone, fires, wind_rows, terrain, spread=None, closures=None,
               official_perimeter=False):
    """Write one zone's detail file and return the payload.

    `official_perimeter` says somebody whose job it is has already mapped the
    burned ground for this zone. When they have, no hull is computed: a surveyed
    perimeter and a convex hull over satellite pixels answer the same question, and
    showing both asks a reader to choose between an observation and a model.
    """
    near = fires_in_zone(zone, fires)
    payload = {
        "id": zone["id"],
        "label": zone.get("label") or zone["id"],
        "lat": zone["lat"],
        "lon": zone["lon"],
        "radius_km": zone.get("radius_km") or 50,
        "reason": zone.get("reason"),
        "fires": near,
        "wind": wind_rows or [],
        "terrain": terrain or None,
        "spread": spread or [],
        # Always present, even when empty: the frontend cannot tell "no cuts near
        # you" from "closures were never written" if the key can be missing.
        "closures": closures_in_zone(zone, closures),
        # Where the detections say fire has reached, for zones nobody has surveyed.
        # Always present, empty when a real perimeter exists or when the detections
        # are too sparse to enclose anything honestly.
        "boundaries": [] if official_perimeter else fire_boundary.boundaries(near),
    }
    _write(Path(out) / f"{zone['id']}.json", payload)
    return payload


def write_zone_index(out, zones):
    """List the pre-built zones so the browser knows what is instant.

    An absent index is indistinguishable from a failed deploy, so an empty list
    is written rather than no file.
    """
    index = {"zones": [
        {"id": z["id"], "label": z.get("label") or z["id"],
         "lat": z["lat"], "lon": z["lon"],
         "radius_km": z.get("radius_km") or 50,
         "reason": z.get("reason")}
        for z in zones or []
    ]}
    _write(Path(out) / "index.json", index)
    return index
