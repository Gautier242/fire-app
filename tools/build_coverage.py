"""Build province polygons used to decide which coverage rules apply.

Source is the CWFIS basemap we already depend on, filtered to Canada. Features
are tagged CA-BC, CA-AB and so on. Run manually; boundaries do not change.
"""
import json
from pathlib import Path

from build.http import get_json, make_session

URL = "https://cwfis.cfs.nrcan.gc.ca/geoserver/ows"
OUT = Path("public/static/coverage.geojson")


def main():
    payload = get_json(make_session(), URL, params={
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": "public:basemap_land",
        "outputFormat": "application/json",
        "propertyName": "NAME,COUNTRY,STATEABB",
        "CQL_FILTER": "COUNTRY='CAN'",
    }, timeout=120)

    features = []
    for feature in payload["features"]:
        abbreviation = (feature["properties"].get("STATEABB") or "")
        if not abbreviation.startswith("CA-"):
            continue
        features.append({
            "type": "Feature",
            "properties": {"province": abbreviation[3:]},
            "geometry": feature["geometry"],
        })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(
        {"type": "FeatureCollection", "features": features}, separators=(",", ":")))
    print(f"wrote {OUT} with {len(features)} features")


if __name__ == "__main__":
    main()
