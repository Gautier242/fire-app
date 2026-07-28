import json
from pathlib import Path

from build.sources.aqhi import normalize

FIXTURE = json.loads(Path("tests/fixtures/aqhi.json").read_text())


def test_normalize_produces_one_reading_per_station():
    assert len(normalize(FIXTURE)) == 5


def test_readings_carry_bilingual_names():
    for reading in normalize(FIXTURE):
        assert reading["name"]["en"]
        assert reading["name"]["fr"]


def test_readings_carry_a_numeric_value_and_timestamp():
    for reading in normalize(FIXTURE):
        assert isinstance(reading["value"], float)
        assert reading["observed_at"].endswith("Z")


def test_readings_are_located():
    for reading in normalize(FIXTURE):
        assert -141.0 <= reading["lon"] <= -52.0
        assert 41.0 <= reading["lat"] <= 84.0


def test_normalize_drops_stations_with_no_reading():
    assert normalize({"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-120.0, 50.0]},
         "properties": {"location_id": "X", "aqhi": None,
                        "location_name_en": "X", "location_name_fr": "X",
                        "observation_datetime": "2026-07-28T11:00:00Z"}},
    ]}) == []


def test_normalize_keeps_only_the_newest_reading_per_station():
    def obs(station, when, value):
        return {"type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-120.0, 50.0]},
                "properties": {"location_id": station, "aqhi": value,
                               "location_name_en": station, "location_name_fr": station,
                               "observation_datetime": when}}

    readings = normalize({"type": "FeatureCollection", "features": [
        obs("A", "2026-07-28T10:00:00Z", 2.0),
        obs("A", "2026-07-28T11:00:00Z", 5.0),
    ]})
    assert len(readings) == 1
    assert readings[0]["value"] == 5.0
