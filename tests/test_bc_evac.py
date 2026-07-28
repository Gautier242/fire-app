import json
from pathlib import Path

from build.sources.bc_evac import classify, normalize

FIXTURE = json.loads(Path("tests/fixtures/bc_evac.json").read_text())


def test_classify_maps_status_strings_to_order_or_alert():
    assert classify("Evacuation Order") == "order"
    assert classify("ORDER") == "order"
    assert classify("Evacuation Alert") == "alert"
    assert classify("Alert") == "alert"


def test_classify_defaults_unknown_wording_to_order():
    # Fail towards the more urgent reading, never towards the calmer one.
    assert classify("Something unexpected") == "order"
    assert classify(None) == "order"


def test_normalize_produces_one_zone_per_feature():
    assert len(normalize(FIXTURE)) == 5


def test_zones_carry_polygons_kind_name_and_agency():
    for zone in normalize(FIXTURE):
        assert zone["kind"] in {"order", "alert"}
        assert zone["polygons"], "a zone with no polygon can never match a point"
        assert zone["name"]
        assert "agency" in zone


def test_polygon_coordinates_are_longitude_latitude():
    for zone in normalize(FIXTURE):
        lon, lat = zone["polygons"][0][0][0]
        assert -141.0 <= lon <= -114.0
        assert 48.0 <= lat <= 60.0


def test_normalize_skips_zones_without_geometry():
    assert normalize({"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": None,
         "properties": {"ORDER_ALERT_STATUS": "Evacuation Order"}},
    ]}) == []
