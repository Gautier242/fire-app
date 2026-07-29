import inspect
import json
from datetime import date
from pathlib import Path

from build.sources.fr import atmo

FIXTURE = json.loads(Path("tests/fixtures/atmo.json").read_text())

FRANCE = {"lon": (-5.5, 10.0), "lat": (41.0, 51.5)}


def _feature(lon, lat, code_zone="33063", **props):
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": dict({"code_zone": code_zone, "lib_zone": "Bordeaux",
                            "code_qual": 4, "code_pm25": 4,
                            "date_ech": "2026-07-29"}, **props),
    }


def _collection(*features):
    return {"type": "FeatureCollection", "features": list(features)}


class _Response:
    def raise_for_status(self):
        pass

    def json(self):
        return _collection()


class _Session:
    """Records what the fetcher asked the network for."""

    def __init__(self):
        self.params = None

    def get(self, url, params=None, timeout=None):
        self.url, self.params = url, params
        return _Response()


# --- the query bound ------------------------------------------------------
# Unfiltered this layer is 24.6 million features. The date filter is the only
# thing standing between the build and that download.

def test_fetch_always_carries_a_date_filter():
    session = _Session()
    atmo.fetch(session)
    assert "date_ech=" in session.params["CQL_FILTER"]


def test_fetch_cannot_be_asked_for_an_unfiltered_query():
    # No parameter exists through which a caller could drop or replace the
    # filter, so omitting it is impossible by construction rather than by
    # convention.
    assert list(inspect.signature(atmo.fetch).parameters) == ["session", "day", "count"]
    session = _Session()
    atmo.fetch(session, day=date(2026, 7, 29))
    assert session.params["CQL_FILTER"] == "date_ech='2026-07-29'"


def test_fetch_caps_the_number_of_features():
    session = _Session()
    atmo.fetch(session)
    assert 0 < session.params["count"] <= atmo.MAX_FEATURES


def test_fetch_asks_for_degrees_not_metres():
    session = _Session()
    atmo.fetch(session)
    assert session.params["srsName"] == "EPSG:4326"


# --- normalize ------------------------------------------------------------

def test_each_record_is_one_commune_located_inside_france():
    records = atmo.normalize(FIXTURE)
    assert records, "fixture produced no records"
    ids = [r["id"] for r in records]
    assert len(ids) == len(set(ids))
    for record in records:
        assert FRANCE["lon"][0] <= record["lon"] <= FRANCE["lon"][1]
        assert FRANCE["lat"][0] <= record["lat"] <= FRANCE["lat"][1]


def test_a_record_matches_the_canadian_air_quality_shape():
    record = atmo.normalize(_collection(_feature(-0.5734, 44.8576)))[0]
    assert record == {
        "id": "33063",
        "lat": 44.8576,
        "lon": -0.5734,
        "name": {"en": "Bordeaux", "fr": "Bordeaux"},
        "value": 4,
        "pm25": 4,
        "observed_at": "2026-07-29",
        "source": "atmo",
    }


def test_pm25_is_carried_separately_from_the_overall_index():
    # During a fire the overall index can be driven by ozone while PM2.5 is the
    # smoke. Collapsing the two would lose the signal this app exists for.
    record = atmo.normalize(_collection(
        _feature(-0.5734, 44.8576, code_qual=4, code_pm25=1)))[0]
    assert (record["value"], record["pm25"]) == (4, 1)


def test_a_missing_index_reads_as_unknown_not_as_good_air():
    record = atmo.normalize(_collection(
        _feature(-0.5734, 44.8576, code_qual=None, code_pm25=None)))[0]
    assert record["value"] is None
    assert record["pm25"] is None


def test_unusable_features_are_skipped_not_raised_on():
    # All of these occur live: 14 features carried a null geometry today.
    records = atmo.normalize(_collection(
        {"type": "Feature", "geometry": None,
         "properties": {"code_zone": "33063", "code_qual": 4}},
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-0.5, 44.8]},
         "properties": {"code_qual": 4}},
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": []},
         "properties": {"code_zone": "33063"}},
        {"type": "Feature",
         "geometry": {"type": "Polygon", "coordinates": [[[-0.5, 44.8]]]},
         "properties": {"code_zone": "33063"}},
        _feature(-0.5734, 44.8576),
    ))
    assert [r["id"] for r in records] == ["33063"]


def test_zones_outside_metropolitan_france_are_dropped():
    # The feed covers Guadeloupe, Martinique and Guyane; the map does not.
    records = atmo.normalize(_collection(
        _feature(-61.53, 16.24, code_zone="97101"),    # Guadeloupe
        _feature(-52.33, 4.94, code_zone="97302"),     # Guyane
        _feature(-0.5734, 44.8576, code_zone="33063"),
    ))
    assert [r["id"] for r in records] == ["33063"]


def test_an_empty_feature_collection_returns_no_records():
    assert atmo.normalize(_collection()) == []
    assert atmo.normalize({}) == []


# --- thinning -------------------------------------------------------------
# 29,080 communes is 479 KB gzipped, over the whole 150 KB payload budget.

def test_communes_in_the_same_cell_thin_down_to_one():
    records = atmo.normalize(_collection(
        _feature(-0.5734, 44.8576, code_zone="33063"),
        _feature(-0.5483, 44.8019, code_zone="33039"),
        _feature(-0.5195, 44.8764, code_zone="33249"),
    ), step=0.2)
    assert len(records) == 1


def test_thinning_keeps_the_worst_reading_in_the_cell():
    # Thinning may only ever overstate. Keeping the cleaner commune would tell
    # someone inside the smoke that the air is fine.
    records = atmo.normalize(_collection(
        _feature(-0.5734, 44.8576, code_zone="33063", code_qual=2, code_pm25=1),
        _feature(-0.5483, 44.8019, code_zone="33039", code_qual=4, code_pm25=5),
    ), step=0.2)
    assert [(r["id"], r["value"], r["pm25"]) for r in records] == [("33039", 4, 5)]


def test_thinning_ranks_on_pm25_before_the_overall_index():
    # An ozone day in one commune must not displace the smoke in its neighbour.
    records = atmo.normalize(_collection(
        _feature(-0.5734, 44.8576, code_zone="33063", code_qual=5, code_pm25=1),
        _feature(-0.5483, 44.8019, code_zone="33039", code_qual=3, code_pm25=4),
    ), step=0.2)
    assert [r["id"] for r in records] == ["33039"]


def test_an_unknown_reading_never_wins_its_cell_over_a_known_one():
    records = atmo.normalize(_collection(
        _feature(-0.5734, 44.8576, code_zone="33063", code_qual=None, code_pm25=None),
        _feature(-0.5483, 44.8019, code_zone="33039", code_qual=1, code_pm25=1),
    ), step=0.2)
    assert [r["id"] for r in records] == ["33039"]


def test_distant_communes_are_not_thinned_together():
    records = atmo.normalize(_collection(
        _feature(-0.5734, 44.8576, code_zone="33063"),
        _feature(5.3698, 43.2965, code_zone="13055"),   # Marseille
    ), step=0.2)
    assert len(records) == 2


def test_the_fixture_thins_a_dense_cluster_without_losing_the_peak():
    records = atmo.normalize(FIXTURE)
    assert len(records) < len(FIXTURE["features"])
    worst = max((f["properties"]["code_pm25"] for f in FIXTURE["features"]))
    assert max(r["pm25"] for r in records) == worst
