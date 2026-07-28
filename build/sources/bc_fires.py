"""Named active fires from the BC Wildfire Service.

Unlike the national CWFIS perimeters these have real names, a stage of
control, a size, and an official page — everything the incident copy needs.
"""
from build.http import get_json

URL = ("https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/"
       "BCWS_ActiveFires_PublicView/FeatureServer/0/query")
MAX_FEATURES = 3000
FALLBACK_URL = "https://wildfiresituation.nrs.gov.bc.ca/"


def fetch(session):
    return get_json(session, URL, params={
        "where": "1=1",
        "outFields": "FIRE_NUMBER,INCIDENT_NAME,FIRE_STATUS,CURRENT_SIZE,FIRE_URL",
        "f": "geojson",
        "outSR": 4326,
        "resultRecordCount": MAX_FEATURES,
    })


def is_extinguished(status):
    """True for fires the feed reports as out.

    This feed carries the whole season, and most of it is history: 643 of 782
    records were "Out" when this was written. Passing those through would tell
    someone there is a wildfire 3 km away that has been extinguished for weeks.

    Deliberately a denylist of the one known terminal status, not an allowlist
    of active ones. An unfamiliar or newly introduced status is kept and shown,
    because over-warning is the safe direction to be wrong in.
    """
    return (status or "").strip().lower() == "out"


def normalize(payload):
    fires = []
    for feature in payload.get("features", []):
        geometry = feature.get("geometry") or {}
        coords = geometry.get("coordinates")
        if geometry.get("type") != "Point" or not coords:
            continue
        props = feature.get("properties") or {}
        number = props.get("FIRE_NUMBER")
        if not number:
            continue
        if is_extinguished(props.get("FIRE_STATUS")):
            continue
        fire = {
            "id": f"bc:{number}",
            "lat": round(coords[1], 5),
            "lon": round(coords[0], 5),
            "named": True,
            "name": props.get("INCIDENT_NAME") or number,
            "status": props.get("FIRE_STATUS") or "Unknown",
            "url": props.get("FIRE_URL") or FALLBACK_URL,
            "source": "bc_fires",
        }
        size = props.get("CURRENT_SIZE")
        if isinstance(size, (int, float)) and size > 0:
            fire["size_ha"] = size
        fires.append(fire)
    return fires
