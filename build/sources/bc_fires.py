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
