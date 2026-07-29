"""One detail file per hot zone.

A zone file makes the local view instant and available offline. Its absence is
not an error -- the browser fetches the same data live -- so a zone that fails
must never fail the build.
"""
import json
import math
from pathlib import Path

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


def write_zone(out, zone, fires, wind_rows, terrain, spread=None):
    """Write one zone's detail file and return the payload."""
    payload = {
        "id": zone["id"],
        "label": zone.get("label") or zone["id"],
        "lat": zone["lat"],
        "lon": zone["lon"],
        "radius_km": zone.get("radius_km") or 50,
        "reason": zone.get("reason"),
        "fires": fires_in_zone(zone, fires),
        "wind": wind_rows or [],
        "terrain": terrain or None,
        "spread": spread or [],
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
