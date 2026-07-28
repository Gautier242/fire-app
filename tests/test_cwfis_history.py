import json
from pathlib import Path

from build.sources.cwfis_history import normalize

FIXTURE = json.loads(Path("tests/fixtures/cwfis_history.json").read_text())

CANADA = {"lon": (-141.0, -52.0), "lat": (41.0, 84.0)}


def _feature(lon, lat, rep_date, **props):
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": dict({"rep_date": rep_date, "hfi": 0, "ws": None, "wd": None},
                           **props),
    }


def _collection(*features):
    return {"type": "FeatureCollection", "features": list(features)}


def test_each_usable_feature_becomes_one_point():
    out = normalize(_collection(
        _feature(-120.0, 55.0, "2026-07-25T21:00:00Z"),
        _feature(-121.0, 56.0, "2026-07-25T22:00:00Z"),
    ))
    assert len(out["points"]) == 2


def test_a_point_is_lon_lat_hour_band():
    out = normalize(_collection(_feature(-120.1234, 55.6789, "2026-07-25T21:00:00Z")))
    lon, lat, hour, band = out["points"][0]
    assert (lon, lat) == (-120.123, 55.679)
    assert hour == 71
    assert band == 0


def test_every_point_lands_inside_canada():
    # A missing srsName returns EPSG:3978 metres, which fails this by five digits.
    # It also drops the continental hotspots this layer carries outside Canada.
    out = normalize(FIXTURE)
    assert out["points"], "fixture produced no Canadian points"
    for lon, lat, _hour, _band in out["points"]:
        assert CANADA["lon"][0] <= lon <= CANADA["lon"][1]
        assert CANADA["lat"][0] <= lat <= CANADA["lat"][1]


def test_hotspots_outside_canada_are_dropped():
    out = normalize(_collection(
        _feature(-110.986, 29.498, "2026-07-25T21:00:00Z"),   # Sonora, Mexico
        _feature(-118.300, 37.000, "2026-07-25T21:00:00Z"),   # California
        _feature(-120.000, 55.000, "2026-07-25T21:00:00Z"),   # British Columbia
    ))
    assert [p[:2] for p in out["points"]] == [[-120.0, 55.0]]


def test_hour_index_spans_0_to_71_with_the_newest_hour_largest():
    out = normalize(_collection(
        _feature(-120.0, 55.0, "2026-07-23T00:30:00Z"),   # 71h before the anchor
        _feature(-120.0, 55.0, "2026-07-24T12:00:00Z"),   # 35h before the anchor
        _feature(-120.0, 55.0, "2026-07-25T23:59:00Z"),   # the anchor hour
    ))
    hours = [p[2] for p in out["points"]]
    assert all(0 <= h <= 71 for h in hours)
    assert hours == [0, 36, 71]


def test_readings_older_than_the_window_are_dropped_not_clamped():
    out = normalize(_collection(
        _feature(-120.0, 55.0, "2026-07-22T23:00:00Z"),   # 72h before the anchor
        _feature(-120.0, 55.0, "2026-07-25T23:00:00Z"),
    ))
    assert [p[2] for p in out["points"]] == [71]


def test_bands_split_on_the_published_intensity_class_boundaries():
    out = normalize(_collection(
        _feature(-120.0, 55.0, "2026-07-25T21:00:00Z", hfi=0),
        _feature(-120.0, 55.0, "2026-07-25T21:00:00Z", hfi=1999),
        _feature(-120.0, 55.0, "2026-07-25T21:00:00Z", hfi=2000),
        _feature(-120.0, 55.0, "2026-07-25T21:00:00Z", hfi=9999),
        _feature(-120.0, 55.0, "2026-07-25T21:00:00Z", hfi=10000),
        _feature(-120.0, 55.0, "2026-07-25T21:00:00Z", hfi=623830),
    ))
    assert [p[3] for p in out["points"]] == [0, 0, 1, 1, 2, 2]


def test_a_missing_hfi_bands_low_rather_than_dropping_the_point():
    out = normalize(_collection(
        _feature(-120.0, 55.0, "2026-07-25T21:00:00Z", hfi=None)))
    assert [p[3] for p in out["points"]] == [0]


def test_wind_carries_one_reading_per_hour_not_one_per_point():
    out = normalize(_collection(
        _feature(-120.0, 55.0, "2026-07-25T21:00:00Z", ws=10.0, wd=90),
        _feature(-120.1, 55.1, "2026-07-25T21:30:00Z", ws=20.0, wd=90),
        _feature(-120.2, 55.2, "2026-07-25T22:00:00Z", ws=30.0, wd=180),
    ))
    assert len(out["points"]) == 3
    assert out["wind"] == [[70, 15, 90], [71, 30, 180]]


def test_wind_direction_averages_across_north_without_pointing_south():
    out = normalize(_collection(
        _feature(-120.0, 55.0, "2026-07-25T21:00:00Z", ws=10.0, wd=350),
        _feature(-120.1, 55.1, "2026-07-25T21:10:00Z", ws=10.0, wd=10),
    ))
    assert out["wind"] == [[71, 10, 0]]


def test_hours_without_a_wind_reading_are_omitted():
    out = normalize(_collection(
        _feature(-120.0, 55.0, "2026-07-25T21:00:00Z", ws=None, wd=None),
        _feature(-120.1, 55.1, "2026-07-25T22:00:00Z", ws=12.0, wd=270),
    ))
    assert out["wind"] == [[71, 12, 270]]


def test_unusable_features_are_skipped_not_raised_on():
    out = normalize(_collection(
        {"type": "Feature", "geometry": None,
         "properties": {"rep_date": "2026-07-25T21:00:00Z"}},
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-120.0, 55.0]},
         "properties": {}},
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-120.0, 55.0]},
         "properties": {"rep_date": "not a date"}},
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": []},
         "properties": {"rep_date": "2026-07-25T21:00:00Z"}},
        {"type": "Feature",
         "geometry": {"type": "Polygon", "coordinates": [[[-120.0, 55.0]]]},
         "properties": {"rep_date": "2026-07-25T21:00:00Z"}},
        _feature(-120.0, 55.0, "2026-07-25T21:00:00Z"),
    ))
    assert len(out["points"]) == 1


def test_a_malformed_wind_reading_loses_the_hour_not_the_run():
    out = normalize(_collection(
        _feature(-120.0, 55.0, "2026-07-25T21:00:00Z", ws="gusty", wd=90),
        _feature(-120.1, 55.1, "2026-07-25T22:00:00Z", ws=12.0, wd=270),
    ))
    assert len(out["points"]) == 2
    assert out["wind"] == [[71, 12, 270]]


def test_an_empty_feature_collection_returns_empty_lists():
    out = normalize(_collection())
    assert out["points"] == []
    assert out["wind"] == []
    assert out["hours"] == 72
    assert out["generated_at"] is None


def test_generated_at_is_the_hour_that_index_71_means():
    out = normalize(_collection(_feature(-120.0, 55.0, "2026-07-25T21:42:00Z")))
    assert out["generated_at"] == "2026-07-25T21:00:00Z"


def test_the_fixture_normalizes_within_the_declared_shape():
    out = normalize(FIXTURE)
    assert set(out) == {"generated_at", "hours", "points", "wind"}
    for point in out["points"]:
        assert len(point) == 4
        assert 0 <= point[2] <= 71
        assert point[3] in (0, 1, 2)
    for hour, speed, direction in out["wind"]:
        assert 0 <= hour <= 71
        assert speed >= 0
        assert 0 <= direction < 360
