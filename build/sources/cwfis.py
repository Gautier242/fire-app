"""National estimated fire perimeters from the Canadian Wildland Fire
Information System.

These polygons are derived from satellite hotspots and carry no name and no
stable identifier — they are re-derived on every CWFIS run as hotspots
accumulate and merge. Identifiers here are therefore explicitly run-scoped and
must never be persisted or linked to.
"""
from build.http import get_json

WFS_URL = "https://cwfis.cfs.nrcan.gc.ca/geoserver/ows"
LAYER = "public:m3_polygons_current"
MAX_FEATURES = 5000

# The layer's native CRS is EPSG:3978 (Canada Atlas Lambert), whose coordinates
# are metres, not degrees. Ask the server to reproject; without this every
# centroid comes back as a six-digit "longitude".
SRS = "EPSG:4326"


def fetch(session):
    return get_json(session, WFS_URL, params={
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": LAYER,
        "outputFormat": "application/json",
        "srsName": SRS,
        "count": MAX_FEATURES,
    })


def _centroid(geometry):
    """Mean of the outer-ring vertices. Good enough to answer "how far away".

    ponytail: vertex mean, not a true area centroid. Upgrade to a proper
    polygon centroid only if a fire's reported distance is visibly wrong.
    """
    if not geometry:
        return None
    kind = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if kind == "Polygon":
        rings = [coords]
    elif kind == "MultiPolygon":
        rings = coords
    else:
        return None
    points = [pt for polygon in rings if polygon for pt in polygon[0]]
    if not points:
        return None
    return (
        sum(p[0] for p in points) / len(points),
        sum(p[1] for p in points) / len(points),
    )


def normalize(payload):
    fires = []
    for index, feature in enumerate(payload.get("features", [])):
        centre = _centroid(feature.get("geometry"))
        if centre is None:
            continue
        lon, lat = centre
        fires.append({
            "id": f"cwfis:idx:{index}",
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            "named": False,
            "source": "cwfis_perimeters",
        })
    return fires
