import json
from pathlib import Path

import pytest

from build.sources.fr import water

FIXTURE = json.loads(Path("tests/fixtures/fr_water.json").read_text())

LON_MIN, LON_MAX = -5.5, 10.0
LAT_MIN, LAT_MAX = 41.0, 51.5


def _points(payload):
    return water.normalize(payload)["points"]


def _by_id(payload, point_id):
    return next(p for p in _points(payload) if p["id"] == point_id)


# --- geography -------------------------------------------------------------

def test_every_point_lands_inside_metropolitan_france():
    for point in _points(FIXTURE):
        assert LON_MIN <= point["lon"] <= LON_MAX, point
        assert LAT_MIN <= point["lat"] <= LAT_MAX, point


def test_a_lambert93_geometry_is_dropped_rather_than_plotted():
    # SDIS 64 publishes Lambert-93 x/y beside WGS84 lon/lat. A six-digit
    # easting read as a longitude puts the point in the Gulf of Guinea.
    ids = [p["id"] for p in _points(FIXTURE)]
    assert "644170100" not in ids


def test_the_lambert93_columns_are_never_read_as_coordinates():
    point = _by_id(FIXTURE, "644170027")
    assert point["lon"] == pytest.approx(-0.26622, abs=1e-4)
    assert point["lat"] == pytest.approx(43.17211, abs=1e-4)


def test_a_point_with_no_usable_geometry_is_skipped():
    ids = [p["id"] for p in _points(FIXTURE)]
    assert "644170099" not in ids       # geometry: null
    assert "35055-9999" not in ids      # MultiPoint with no coordinates
    assert "300-005" not in ids         # empty COORDINATES column


def test_a_multipoint_geometry_is_read_from_its_first_point():
    point = _by_id(FIXTURE, "35055-0034")
    assert point["lon"] == pytest.approx(-1.60872, abs=1e-4)
    assert point["lat"] == pytest.approx(48.08876, abs=1e-4)


def test_a_source_that_swaps_lat_and_lon_still_lands_in_france():
    # Sixt-sur-Aff publishes LAT_PEI=-2.00927 and LONG_PEI=47.75654.
    point = _by_id(FIXTURE, "328-0001")
    assert point["lon"] == pytest.approx(-2.00927, abs=1e-4)
    assert point["lat"] == pytest.approx(47.75654, abs=1e-4)


def test_decimal_commas_are_read_as_decimal_points():
    assert _by_id(FIXTURE, "328-0004")["lat"] == pytest.approx(47.76102, abs=1e-4)


def test_a_latitude_longitude_pair_packed_in_one_column_is_split():
    point = _by_id(FIXTURE, "300-002")
    assert point["lat"] == pytest.approx(46.168854, abs=1e-5)
    assert point["lon"] == pytest.approx(-1.219538, abs=1e-5)


# --- capacity --------------------------------------------------------------

def test_unknown_capacity_is_none_and_never_zero():
    for point in _points(FIXTURE):
        assert point["capacity_m3"] is None or point["capacity_m3"] > 0


def test_a_missing_capacity_reads_as_unknown():
    assert _by_id(FIXTURE, "950-0001")["capacity_m3"] is None   # volume_pa null
    assert _by_id(FIXTURE, "CAS0006")["capacity_m3"] is None    # capacite null


def test_a_zero_capacity_reads_as_unknown_not_as_an_empty_tank():
    # A 0 m3 water point reads as empty; sending a crew to an empty tank is
    # the failure that matters. Publishers use 0 for "not recorded".
    assert _by_id(FIXTURE, "004-0012")["capacity_m3"] is None


def test_a_real_capacity_survives():
    assert _by_id(FIXTURE, "162-0003")["capacity_m3"] == 120.0
    assert _by_id(FIXTURE, "AVM0046")["capacity_m3"] == 20


def test_flow_rate_is_never_mistaken_for_capacity():
    # 92 m3/h out of a poteau is not 92 m3 of stored water.
    assert _by_id(FIXTURE, "950-0001")["capacity_m3"] is None
    assert _by_id(FIXTURE, "1364")["capacity_m3"] is None


# --- the kind vocabulary ---------------------------------------------------

@pytest.mark.parametrize("point_id, kind", [
    ("644170027", "borne"),     # "Poteau Incendie"
    ("644950083", "citerne"),   # "Réserve incendie"
    ("950-0001", "borne"),      # "poteau"
    ("162-0003", "naturel"),    # "point_aspiration"
    ("004-0012", "borne"),      # "bouche"
    ("AVM0046", "citerne"),     # "CI"
    ("CAS0006", "citerne"),     # "RE"
    ("35055-0034", "borne"),    # "Poteau incendie de 100mm"
    ("35206-0002", "naturel"),  # "Plan d'eau naturel"
    ("1364", "borne"),          # "PI"
    ("1400", "citerne"),        # "CITERNE"
    ("1401", "naturel"),        # "PRISERIV"
    ("300-002", "borne"),       # "BI 150"
    ("300-003", "citerne"),     # "Citerne 120m3"
    ("328-0001", "borne"),      # "Poteau d'Incendie"
    ("328-0004", "naturel"),    # "Puisard"
    ("74011-0002", "citerne"),  # "CI"
    ("73008-0001", "citerne"),  # "BS", bache souple
])
def test_the_real_published_vocabulary_maps_onto_our_kinds(point_id, kind):
    assert _by_id(FIXTURE, point_id)["kind"] == kind


def test_an_unrecognised_kind_is_none_and_never_guessed_as_a_borne():
    assert _by_id(FIXTURE, "641020011")["kind"] is None   # "Autre"
    assert _by_id(FIXTURE, "300-004")["kind"] is None     # "Indéterminé"
    assert _by_id(FIXTURE, "1402")["kind"] is None        # type null


def test_a_source_with_no_kind_field_at_all_yields_none():
    # Saint-Ave publishes geometry and a diameter, and no type.
    kinds = {p["kind"] for p in _points(FIXTURE) if p["dep"] == "56"}
    assert kinds == {None}


# --- départements and identity ---------------------------------------------

def test_the_departement_comes_from_the_commune_code_when_there_is_one():
    assert _by_id(FIXTURE, "644170027")["dep"] == "64"
    assert _by_id(FIXTURE, "950-0001")["dep"] == "81"
    assert _by_id(FIXTURE, "35055-0034")["dep"] == "35"
    assert _by_id(FIXTURE, "1364")["dep"] == "49"


def test_a_commune_outside_its_own_sources_departement_keeps_its_real_one():
    # One Grand Annecy row sits in Savoie, not Haute-Savoie.
    assert _by_id(FIXTURE, "73008-0001")["dep"] == "73"


def test_an_unusable_commune_code_falls_back_to_the_sources_departement():
    point = next(p for p in _points(FIXTURE) if p["id"].startswith("annecy-"))
    assert point["dep"] == "74"


def test_a_point_with_no_identifier_still_gets_a_stable_one():
    ids = [p["id"] for p in _points(FIXTURE) if p["dep"] == "56"]
    assert all(i for i in ids)
    assert len(set(ids)) == len(ids)
    assert _points(FIXTURE) == _points(FIXTURE)


def test_every_point_is_tagged_as_a_water_point():
    assert {p["source"] for p in _points(FIXTURE)} == {"pei"}


def test_every_point_carries_the_whole_schema():
    for point in _points(FIXTURE):
        assert set(point) == {"id", "lat", "lon", "kind", "capacity_m3", "dep", "source"}


# --- the coverage statement ------------------------------------------------

def test_the_layer_states_which_departements_it_actually_knows_about():
    coverage = water.normalize(FIXTURE)["coverage"]
    assert coverage, "a partial layer that cannot state its limits must not ship"
    for area in coverage:
        assert set(area) == {"dep", "area", "scope", "count"}
        assert area["scope"] in ("departement", "local")
        assert area["count"] > 0


def test_a_complete_departement_is_not_advertised_as_a_local_patch():
    coverage = {a["dep"]: a for a in water.normalize(FIXTURE)["coverage"]}
    assert coverage["64"]["scope"] == "departement"
    assert coverage["81"]["scope"] == "departement"
    assert coverage["49"]["scope"] == "local"
    assert coverage["34"]["scope"] == "local"


def test_a_source_that_yielded_nothing_is_not_claimed_as_covered():
    payload = {"sdis64": FIXTURE["empty_geojson"], "annecy": FIXTURE["empty_csv"]}
    assert water.normalize(payload)["coverage"] == []


def test_a_source_that_did_not_come_back_is_not_claimed_as_covered():
    payload = {"herault_dfci": FIXTURE["herault_dfci"]}
    assert [a["dep"] for a in water.normalize(payload)["coverage"]] == ["34"]


# --- empty and broken input ------------------------------------------------

def test_an_empty_source_returns_no_points():
    assert _points({"sdis64": FIXTURE["empty_geojson"]}) == []
    assert _points({"annecy": FIXTURE["empty_csv"]}) == []


def test_an_absent_payload_returns_an_empty_layer():
    for payload in ({}, None):
        assert water.normalize(payload) == {"points": [], "coverage": []}


def test_a_malformed_payload_does_not_raise():
    assert _points({"sdis64": {"features": "not a list"}}) == []
    assert _points({"sdis64": {}}) == []
    assert _points({"annecy": ""}) == []
    assert _points({"unknown_source": FIXTURE["sdis64"]}) == []


# --- fetching --------------------------------------------------------------

class _Response:
    def __init__(self, body):
        self.content = body.encode() if isinstance(body, str) else body
        self.text = self.content.decode()

    def raise_for_status(self):
        pass


class _Session:
    """Serves one canned body per URL and records what was asked for."""

    def __init__(self, bodies=None, fail=()):
        self.bodies, self.fail, self.calls = bodies or {}, set(fail), []

    def get(self, url, timeout=None, **kwargs):
        self.calls.append(url)
        for key in self.fail:
            if key in url:
                raise OSError("connection timed out")
        for key, body in self.bodies.items():
            if key in url:
                return _Response(body)
        return _Response("")


def test_fetch_asks_every_source_exactly_once():
    session = _Session()
    water.fetch(session)
    assert len(session.calls) == len(water.SOURCES)
    assert len(set(session.calls)) == len(session.calls)


def test_a_source_that_fails_does_not_take_the_whole_layer_down():
    # data.calvados.fr and geo.sdis76.fr were both unreachable on 2026-07-29.
    session = _Session(bodies={"herault-data.fr": json.dumps(FIXTURE["herault_dfci"])},
                       fail=("pigma.org", "tigeo.fr"))
    payload = water.fetch(session)
    assert "sdis64" not in payload and "sdis81" not in payload
    assert [a["dep"] for a in water.normalize(payload)["coverage"]] == ["34"]


def test_fetch_bounds_every_source_with_an_explicit_byte_cap():
    session = _Session(bodies={"herault-data.fr": json.dumps(FIXTURE["herault_dfci"])})
    assert water.fetch(session, max_bytes=10) == {}
    assert "herault_dfci" in water.fetch(session, max_bytes=10_000_000)


def test_normalize_bounds_every_source_with_an_explicit_point_cap():
    points = _points_capped = water.normalize(FIXTURE, cap=1)["points"]
    assert len(points) == len([s for s in water.SOURCES if s["key"] in FIXTURE])
    assert len(_points_capped) < len(_points(FIXTURE))


def test_fetch_ignores_a_body_it_cannot_parse():
    session = _Session(bodies={"pigma.org": "<html>502 Bad Gateway</html>"})
    assert "sdis64" not in water.fetch(session)


# --- the source table itself -----------------------------------------------

def test_every_source_is_stdlib_parseable():
    assert {s["format"] for s in water.SOURCES} == {"geojson", "csv"}


def test_every_source_declares_where_it_applies():
    for source in water.SOURCES:
        assert source["scope"] in ("departement", "local")
        assert len(source["dep"]) == 2 and source["area"]
