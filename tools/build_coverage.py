"""Build province polygons used to decide which coverage rules apply.

Source is the CWFIS basemap we already depend on, filtered to Canada. Features
are tagged CA-BC, CA-AB and so on. Run manually; boundaries do not change.
"""
import json
from pathlib import Path

from build.http import get_json, make_session
from build.simplify import simplify_polygons

URL = "https://cwfis.cfs.nrcan.gc.ca/geoserver/ows"
OUT = Path("public/static/coverage.geojson")


# ~1 km. Province borders are answered by point-in-polygon, so vertex precision
# finer than this buys nothing and costs the user a slower first load.
TOLERANCE_DEG = 0.01
# Below this bounding-box area an island cannot contain a community whose
# province we would get wrong by dropping it.
MIN_AREA_SQ_DEG = 0.01


def _ring_area(ring):
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    return (max(lons) - min(lons)) * (max(lats) - min(lats))


def _shrink(geometry):
    """Drop negligible islands and simplify what remains."""
    if not geometry:
        return None
    kind = geometry.get("type")
    coords = geometry.get("coordinates") or []
    polygons = [coords] if kind == "Polygon" else coords
    big = [rings for rings in polygons
           if rings and _ring_area(rings[0]) >= MIN_AREA_SQ_DEG]
    kept = simplify_polygons(big, TOLERANCE_DEG, precision=4)
    if not kept:
        return None
    return {"type": "MultiPolygon", "coordinates": kept}


def _bbox(geometry):
    lons, lats = [], []
    for rings in geometry["coordinates"]:
        for lon, lat in rings[0]:
            lons.append(lon)
            lats.append(lat)
    return [min(lons), min(lats), max(lons), max(lats)]


def main():
    payload = get_json(make_session(), URL, params={
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": "public:basemap_land",
        "outputFormat": "application/json",
        # This server defaults to EPSG:3978 (Canada Atlas Lambert) in metres.
        # Province polygons in metres would make provinceAt() never match, and
        # every user in Canada would be told we cannot check their province.
        "srsName": "EPSG:4326",
        # No propertyName. Restricting the returned columns also drops the
        # geometry column, which produced 712 features with geometry: null --
        # a file that looked correct by every count and contained no polygons.
        "CQL_FILTER": "COUNTRY='CAN'",
    }, timeout=180)

    features = []
    for feature in payload["features"]:
        abbreviation = (feature["properties"].get("STATEABB") or "")
        if not abbreviation.startswith("CA-"):
            continue
        geometry = _shrink(feature["geometry"])
        if geometry is None:
            continue
        features.append({
            "type": "Feature",
            "properties": {"province": abbreviation[3:], "bbox": _bbox(geometry)},
            "geometry": geometry,
        })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(
        {"type": "FeatureCollection", "features": features}, separators=(",", ":")))
    print(f"wrote {OUT} with {len(features)} features")


if __name__ == "__main__":
    main()
