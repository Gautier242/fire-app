import json
from pathlib import Path

from build.sources.cwfis import normalize

FIXTURE = json.loads(Path("tests/fixtures/cwfis_perimeters.json").read_text())


def test_normalize_produces_one_fire_per_feature():
    assert len(normalize(FIXTURE)) == 3


def test_fires_are_unnamed_because_cwfis_has_no_names():
    for fire in normalize(FIXTURE):
        assert fire["named"] is False
        assert "name" not in fire


def test_fires_carry_a_run_scoped_id():
    ids = [f["id"] for f in normalize(FIXTURE)]
    assert ids == ["cwfis:idx:0", "cwfis:idx:1", "cwfis:idx:2"]


def test_fires_have_a_centroid_within_canada():
    for fire in normalize(FIXTURE):
        assert -141.0 <= fire["lon"] <= -52.0
        assert 41.0 <= fire["lat"] <= 84.0


def test_size_is_omitted_because_the_area_unit_is_unconfirmed():
    # See the spec: displaying a size that is wrong by 100x is worse than none.
    for fire in normalize(FIXTURE):
        assert "size_ha" not in fire


def test_normalize_tolerates_an_empty_feature_collection():
    assert normalize({"type": "FeatureCollection", "features": []}) == []


def test_normalize_skips_features_with_unusable_geometry():
    broken = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {}, "geometry": None},
        {"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": []}},
    ]}
    assert normalize(broken) == []
