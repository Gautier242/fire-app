import json
from pathlib import Path

from build.sources.bc_fires import normalize

FIXTURE = json.loads(Path("tests/fixtures/bc_fires.json").read_text())


def test_normalize_produces_one_fire_per_feature():
    assert len(normalize(FIXTURE)) == 5


def test_bc_fires_are_named_and_stably_identified():
    for fire in normalize(FIXTURE):
        assert fire["named"] is True
        assert fire["id"].startswith("bc:")
        assert fire["name"]


def test_bc_fires_carry_status_and_official_url():
    for fire in normalize(FIXTURE):
        assert fire["status"]
        assert fire["url"].startswith("https://")


def test_coordinates_are_longitude_latitude_not_web_mercator():
    for fire in normalize(FIXTURE):
        assert -141.0 <= fire["lon"] <= -114.0
        assert 48.0 <= fire["lat"] <= 60.0


def test_size_is_included_only_when_positive():
    fires = normalize({"type": "FeatureCollection", "features": [
        {"type": "Feature",
         "geometry": {"type": "Point", "coordinates": [-120.0, 50.0]},
         "properties": {"FIRE_NUMBER": "V1", "INCIDENT_NAME": "A",
                        "FIRE_STATUS": "Out of Control", "CURRENT_SIZE": 0,
                        "FIRE_URL": "https://example.test/1"}},
        {"type": "Feature",
         "geometry": {"type": "Point", "coordinates": [-120.0, 50.0]},
         "properties": {"FIRE_NUMBER": "V2", "INCIDENT_NAME": "B",
                        "FIRE_STATUS": "Under Control", "CURRENT_SIZE": 12.5,
                        "FIRE_URL": "https://example.test/2"}},
    ]})
    assert "size_ha" not in fires[0]
    assert fires[1]["size_ha"] == 12.5


def test_normalize_falls_back_to_the_fire_number_when_the_name_is_blank():
    fires = normalize({"type": "FeatureCollection", "features": [
        {"type": "Feature",
         "geometry": {"type": "Point", "coordinates": [-120.0, 50.0]},
         "properties": {"FIRE_NUMBER": "V70397", "INCIDENT_NAME": None,
                        "FIRE_STATUS": "Active", "CURRENT_SIZE": 1,
                        "FIRE_URL": "https://example.test/3"}},
    ]})
    assert fires[0]["name"] == "V70397"


def test_normalize_skips_features_without_geometry():
    assert normalize({"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": None, "properties": {"FIRE_NUMBER": "V9"}},
    ]}) == []
