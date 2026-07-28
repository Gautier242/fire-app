"""Evacuation orders and alerts aggregated by the Province of BC.

Covers orders issued by local governments and First Nations. This is the only
evacuation feed in v1, which is why `registry.PROVINCES` marks BC as the only
province where the app may say "no evacuation near you".
"""
from build.http import get_json
from build.simplify import simplify_polygons

URL = ("https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/"
       "Evacuation_Orders_and_Alerts/FeatureServer/0/query")
MAX_FEATURES = 2000

# ~55 m. These polygons dominate the payload: at full resolution 67 zones carry
# 26,079 vertices and cost 342 KB gzipped, against a 150 KB budget for the whole
# near-me file. Simplification shifts a boundary in both directions, and the
# dangerous direction is outward -- a resident just inside a zone being told they
# are outside it. 55 m is finer than the real-world precision of an evacuation
# boundary, which is drawn along roads and property lines, so the error stays
# below the uncertainty already present in the source.
SIMPLIFY_TOLERANCE_DEG = 0.0005


def fetch(session):
    return get_json(session, URL, params={
        "where": "1=1",
        "outFields": "OBJECTID,EVENT_NAME,ORDER_ALERT_NAME,ORDER_ALERT_STATUS,ISSUING_AGENCY",
        "f": "geojson",
        "outSR": 4326,
        "resultRecordCount": MAX_FEATURES,
    })


def classify(status):
    """Map the feed's status wording to 'order' or 'alert'.

    Anything we do not recognise is treated as an order. An alert asks people to
    be ready; an order tells them to leave. Guessing the calmer of the two on
    unfamiliar wording is the dangerous direction to be wrong in.
    """
    text = (status or "").strip().lower()
    if "alert" in text:
        return "alert"
    return "order"


def _polygons(geometry):
    if not geometry:
        return []
    kind = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if kind == "Polygon":
        return [coords]
    if kind == "MultiPolygon":
        return coords
    return []


def normalize(payload):
    zones = []
    for feature in payload.get("features", []):
        polygons = simplify_polygons(
            _polygons(feature.get("geometry")), SIMPLIFY_TOLERANCE_DEG)
        if not polygons:
            continue
        props = feature.get("properties") or {}
        zones.append({
            "id": props.get("OBJECTID"),
            "kind": classify(props.get("ORDER_ALERT_STATUS")),
            "name": (props.get("ORDER_ALERT_NAME")
                     or props.get("EVENT_NAME")
                     or "Evacuation area"),
            "agency": props.get("ISSUING_AGENCY") or "",
            "polygons": polygons,
            "source": "bc_evac",
        })
    return zones
