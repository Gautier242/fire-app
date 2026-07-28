"""Air Quality Health Index observations from Environment and Climate Change
Canada.

The feed is already bilingual, which is why no translation step exists anywhere
in this project for air quality text.
"""
from build.http import get_json

URL = "https://api.weather.gc.ca/collections/aqhi-observations-realtime/items"
MAX_FEATURES = 500


def fetch(session):
    return get_json(session, URL, params={
        "latest": "true",
        "limit": MAX_FEATURES,
        "f": "json",
    })


def normalize(payload):
    newest = {}
    for feature in payload.get("features", []):
        props = feature.get("properties") or {}
        value = props.get("aqhi")
        station = props.get("location_id")
        coords = (feature.get("geometry") or {}).get("coordinates")
        if value is None or not station or not coords:
            continue
        observed_at = props.get("observation_datetime") or ""
        existing = newest.get(station)
        if existing and existing["observed_at"] >= observed_at:
            continue
        newest[station] = {
            "id": station,
            "lat": round(coords[1], 5),
            "lon": round(coords[0], 5),
            "name": {
                "en": props.get("location_name_en") or station,
                "fr": props.get("location_name_fr") or station,
            },
            "value": float(value),
            "observed_at": observed_at,
            "source": "aqhi",
        }
    return sorted(newest.values(), key=lambda r: r["id"])
