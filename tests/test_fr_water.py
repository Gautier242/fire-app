import base64
import json
from pathlib import Path

import pytest

from build.sources.fr import water

FIXTURE = json.loads(Path("tests/fixtures/fr_water.json").read_text())

# The Hérault SDIS register ships as a GeoPackage, which is a SQLite database and
# therefore stdlib-readable. The fixtures are real ones, built small.
GPKG = {"herault_sdis": base64.b64decode(FIXTURE["herault_sdis_gpkg_b64"]),
        "wgs84": base64.b64decode(FIXTURE["gpkg_wgs84_b64"]),
        "webmercator": base64.b64decode(FIXTURE["gpkg_webmercator_b64"])}

# Agde, Hérault: the reference point for the inverse Lambert-93.
AGDE_L93 = (723894.42, 6262032.84)
AGDE_WGS84 = (3.29510, 43.45699)

# Six real rows of the Seine-Maritime register, as data.gouv's own parse of it
# serves them. It publishes no lon/lat at all: only Lambert-93 metres, so the
# whole file is the CRS trap. One row carries an empty commune code and one an
# undocumented "--" type, because both occur in the real 20,694.
SDIS76_CSV = """\
__id,id_interne_pei,label,ref_terr,domanialite,commune,code_insee,quartier,adresse,prec_adres,precis_don,type_rn,type_rd,disponible,date_disp_chgt,date_extraction_donnees,x_l93,y_l93
1,4486,1,1,public,Allouville-Bellefosse,76001,.,ROUTE DE LOUVETOT,,5,BI,121,t,,2024-11-22,532024.06,6946547.5
2,4487,2,2,public,Allouville-Bellefosse,76001,.,RUE DU DOCTEUR PATENOTRE,,5,CI,321,t,,2024-11-22,531853.56,6946665
4,4489,4,4,public,Allouville-Bellefosse,76001,.,ROUTE DE LILLEBONNE,RUE DE BREMARE,5,PI,111,t,,2024-11-22,528630.2,6945003.5
13,4501,16,16,public,Allouville-Bellefosse,76001,.,RUE DU PERE CERCEAU,ANGLE RUE RAYMOND POULIDOR,5,PA,223,t,,2024-11-22,532273.44,6946376
102,22376,47P,47,privé,Amfreville-la-Mi-Voie,,.,La Mivoie,cale CEDGP MULTISOL,2,PA,225,t,,2024-11-22,563442.5,6924003.5
986,5027,5P,5,privé,Beautot,76066,.,PEG,Au bout de la ZI des Vikings,5,--,999,t,,2024-11-22,559056.5,6950764.5
"""

# What a build actually normalizes: every source keyed as fetch() keys it.
PAYLOAD = dict(FIXTURE, herault_sdis=GPKG["herault_sdis"], sdis76=SDIS76_CSV)

LON_MIN, LON_MAX = -5.5, 10.0
LAT_MIN, LAT_MAX = 41.0, 51.5


def _points(payload):
    return water.normalize(payload)["points"]


def _by_id(payload, point_id):
    return next(p for p in _points(payload) if p["id"] == point_id)


# --- geography -------------------------------------------------------------

def test_every_point_lands_inside_metropolitan_france():
    for point in _points(PAYLOAD):
        assert LON_MIN <= point["lon"] <= LON_MAX, point
        assert LAT_MIN <= point["lat"] <= LAT_MAX, point


def test_a_lambert93_geometry_is_dropped_rather_than_plotted():
    # SDIS 64 publishes Lambert-93 x/y beside WGS84 lon/lat. A six-digit
    # easting read as a longitude puts the point in the Gulf of Guinea.
    ids = [p["id"] for p in _points(PAYLOAD)]
    assert "644170100" not in ids


def test_the_lambert93_columns_are_never_read_as_coordinates():
    point = _by_id(PAYLOAD, "644170027")
    assert point["lon"] == pytest.approx(-0.26622, abs=1e-4)
    assert point["lat"] == pytest.approx(43.17211, abs=1e-4)


def test_a_point_with_no_usable_geometry_is_skipped():
    ids = [p["id"] for p in _points(PAYLOAD)]
    assert "644170099" not in ids       # geometry: null
    assert "35055-9999" not in ids      # MultiPoint with no coordinates
    assert "300-005" not in ids         # empty COORDINATES column


def test_a_multipoint_geometry_is_read_from_its_first_point():
    point = _by_id(PAYLOAD, "35055-0034")
    assert point["lon"] == pytest.approx(-1.60872, abs=1e-4)
    assert point["lat"] == pytest.approx(48.08876, abs=1e-4)


def test_a_source_that_swaps_lat_and_lon_still_lands_in_france():
    # Sixt-sur-Aff publishes LAT_PEI=-2.00927 and LONG_PEI=47.75654.
    point = _by_id(PAYLOAD, "328-0001")
    assert point["lon"] == pytest.approx(-2.00927, abs=1e-4)
    assert point["lat"] == pytest.approx(47.75654, abs=1e-4)


def test_decimal_commas_are_read_as_decimal_points():
    assert _by_id(PAYLOAD, "328-0004")["lat"] == pytest.approx(47.76102, abs=1e-4)


def test_a_latitude_longitude_pair_packed_in_one_column_is_split():
    point = _by_id(PAYLOAD, "300-002")
    assert point["lat"] == pytest.approx(46.168854, abs=1e-5)
    assert point["lon"] == pytest.approx(-1.219538, abs=1e-5)


# --- capacity --------------------------------------------------------------

def test_unknown_capacity_is_none_and_never_zero():
    for point in _points(PAYLOAD):
        assert point["capacity_m3"] is None or point["capacity_m3"] > 0


def test_a_missing_capacity_reads_as_unknown():
    assert _by_id(PAYLOAD, "950-0001")["capacity_m3"] is None   # volume_pa null
    assert _by_id(PAYLOAD, "CAS0006")["capacity_m3"] is None    # capacite null


def test_a_zero_capacity_reads_as_unknown_not_as_an_empty_tank():
    # A 0 m3 water point reads as empty; sending a crew to an empty tank is
    # the failure that matters. Publishers use 0 for "not recorded".
    assert _by_id(PAYLOAD, "004-0012")["capacity_m3"] is None


def test_a_real_capacity_survives():
    assert _by_id(PAYLOAD, "162-0003")["capacity_m3"] == 120.0
    assert _by_id(PAYLOAD, "AVM0046")["capacity_m3"] == 20


def test_flow_rate_is_never_mistaken_for_capacity():
    # 92 m3/h out of a poteau is not 92 m3 of stored water.
    assert _by_id(PAYLOAD, "950-0001")["capacity_m3"] is None
    assert _by_id(PAYLOAD, "1364")["capacity_m3"] is None


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
    ("4486", "borne"),          # "BI", Seine-Maritime
    ("4487", "citerne"),        # "CI", Seine-Maritime
    ("4489", "borne"),          # "PI", Seine-Maritime
    ("4501", "naturel"),        # "PA", Seine-Maritime
])
def test_the_real_published_vocabulary_maps_onto_our_kinds(point_id, kind):
    assert _by_id(PAYLOAD, point_id)["kind"] == kind


def test_an_unrecognised_kind_is_none_and_never_guessed_as_a_borne():
    assert _by_id(PAYLOAD, "641020011")["kind"] is None   # "Autre"
    assert _by_id(PAYLOAD, "300-004")["kind"] is None     # "Indéterminé"
    assert _by_id(PAYLOAD, "1402")["kind"] is None        # type null


def test_a_source_with_no_kind_field_at_all_yields_none():
    # Saint-Ave publishes geometry and a diameter, and no type.
    kinds = {p["kind"] for p in _points(PAYLOAD) if p["dep"] == "56"}
    assert kinds == {None}


# --- départements and identity ---------------------------------------------

def test_the_departement_comes_from_the_commune_code_when_there_is_one():
    assert _by_id(PAYLOAD, "644170027")["dep"] == "64"
    assert _by_id(PAYLOAD, "950-0001")["dep"] == "81"
    assert _by_id(PAYLOAD, "35055-0034")["dep"] == "35"
    assert _by_id(PAYLOAD, "1364")["dep"] == "49"


def test_a_commune_outside_its_own_sources_departement_keeps_its_real_one():
    # One Grand Annecy row sits in Savoie, not Haute-Savoie.
    assert _by_id(PAYLOAD, "73008-0001")["dep"] == "73"


def test_an_unusable_commune_code_falls_back_to_the_sources_departement():
    point = next(p for p in _points(PAYLOAD) if p["id"].startswith("annecy-"))
    assert point["dep"] == "74"


def test_a_point_with_no_identifier_still_gets_a_stable_one():
    ids = [p["id"] for p in _points(PAYLOAD) if p["dep"] == "56"]
    assert all(i for i in ids)
    assert len(set(ids)) == len(ids)
    assert _points(PAYLOAD) == _points(PAYLOAD)


def test_every_point_is_tagged_as_a_water_point():
    assert {p["source"] for p in _points(PAYLOAD)} == {"pei"}


def test_every_point_carries_the_whole_schema():
    for point in _points(PAYLOAD):
        assert set(point) == {"id", "lat", "lon", "kind", "capacity_m3", "dep",
                              "source", "tier"}


# --- the tier ---------------------------------------------------------------

def test_every_point_and_coverage_row_declares_its_tier():
    """A register and a crowd source must never be summable into one number.

    The failure mode of this layer is a firefighter concluding there is no water,
    so a point from an SDIS register and a point somebody added to OpenStreetMap
    cannot look alike or be counted together.
    """
    payload = {"sdis64": {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"id_sdis": "A1", "type_pei": "PI"},
         "geometry": {"type": "Point", "coordinates": [-0.5, 43.3]}},
    ]}}

    out = water.normalize(payload)

    assert out["points"][0]["tier"] == "register"
    assert out["coverage"][0]["tier"] == "register"


def test_nothing_this_module_produces_is_ever_anything_but_a_register():
    # Every source here is a published register. If a crowd source is ever added
    # to this module, it must not inherit the completeness claim by accident.
    out = water.normalize(PAYLOAD)
    assert {p["tier"] for p in out["points"]} == {"register"}
    assert {c["tier"] for c in out["coverage"]} == {"register"}


# --- the coverage statement ------------------------------------------------

def test_the_layer_states_which_departements_it_actually_knows_about():
    coverage = water.normalize(PAYLOAD)["coverage"]
    assert coverage, "a partial layer that cannot state its limits must not ship"
    for area in coverage:
        assert set(area) == {"dep", "area", "scope", "count", "tier"}
        assert area["scope"] in ("departement", "local")
        assert area["count"] > 0


def test_a_complete_departement_is_not_advertised_as_a_local_patch():
    coverage = {a["area"]: a for a in water.normalize(PAYLOAD)["coverage"]}
    assert coverage["Pyrénées-Atlantiques"]["scope"] == "departement"
    assert coverage["Tarn"]["scope"] == "departement"
    assert coverage["Angers Loire Métropole"]["scope"] == "local"


def test_the_two_herault_registers_are_advertised_separately():
    # The SDIS register and the DFCI forest-water set are different registers,
    # not duplicates: only 3 of 328 DFCI points sit within 100 m of an SDIS one.
    herault = [a for a in water.normalize(PAYLOAD)["coverage"] if a["dep"] == "34"]
    assert {a["scope"] for a in herault} == {"departement", "local"}
    assert len(herault) == 2


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

    @property
    def text(self):
        return self.content.decode("utf-8", "replace")

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
    points = _points_capped = water.normalize(PAYLOAD, cap=1)["points"]
    assert len(points) == len([s for s in water.SOURCES if s["key"] in PAYLOAD])
    assert len(_points_capped) < len(_points(PAYLOAD))


def test_fetch_ignores_a_body_it_cannot_parse():
    session = _Session(bodies={"pigma.org": "<html>502 Bad Gateway</html>"})
    assert "sdis64" not in water.fetch(session)


# --- the source table itself -----------------------------------------------

def test_every_source_is_stdlib_parseable():
    # gpkg belongs here: a GeoPackage is a SQLite database, and sqlite3 is stdlib.
    assert {s["format"] for s in water.SOURCES} == {"geojson", "csv", "gpkg"}


def test_every_source_declares_where_it_applies():
    for source in water.SOURCES:
        assert source["scope"] in ("departement", "local")
        assert len(source["dep"]) == 2 and source["area"]


# --- Seine-Maritime, a register published only in Lambert-93 ---------------

def test_a_source_with_only_lambert93_columns_is_reprojected():
    # 532024.06 east, 6946547.5 north is Allouville-Bellefosse. Read as degrees
    # it is nowhere on Earth; silently dropped it is a département of no water.
    point = _by_id(PAYLOAD, "4486")
    assert point["lon"] == pytest.approx(0.67738, abs=1e-4)
    assert point["lat"] == pytest.approx(49.59590, abs=1e-4)


def test_the_seine_maritime_register_yields_every_one_of_its_rows():
    # A register that parses to nothing is the one failure this layer cannot
    # have: it reads as "no water here" rather than as "we could not read it".
    points = _points({"sdis76": SDIS76_CSV})
    assert len(points) == 6
    assert all(p["dep"] == "76" for p in points)


def test_a_seine_maritime_row_with_no_commune_code_keeps_the_departement():
    assert _by_id(PAYLOAD, "22376")["dep"] == "76"


def test_an_undocumented_seine_maritime_type_is_none_not_a_guessed_borne():
    assert _by_id(PAYLOAD, "5027")["kind"] is None      # type_rn "--"


def test_the_seine_maritime_register_is_declared_as_a_whole_departement():
    coverage, = water.normalize({"sdis76": SDIS76_CSV})["coverage"]
    assert (coverage["dep"], coverage["scope"], coverage["tier"]) == (
        "76", "departement", "register")


def test_seine_maritime_is_read_from_data_gouvs_mirror_not_the_dead_host():
    # geo.sdis76.fr resolves and drops every connection on 80 and 443; measured
    # 2026-07-29 and again 2026-07-30. data.gouv's own parse of the same
    # resource answers, so the register is fetched from there.
    source, = [s for s in water.SOURCES if s["key"] == "sdis76"]
    assert "geo.sdis76.fr" not in source["url"]
    assert source["url"].startswith("https://tabular-api.data.gouv.fr/")


# --- GeoPackage and the inverse Lambert-93 ---------------------------------

def test_the_inverse_lambert93_matches_a_known_point():
    lon, lat = water.lambert93_to_wgs84(*AGDE_L93)
    assert (round(lon, 5), round(lat, 5)) == AGDE_WGS84


def test_the_inverse_lambert93_round_trips_the_projection_origin():
    # False easting/northing sit exactly on lon 3, lat 46.5 by definition.
    lon, lat = water.lambert93_to_wgs84(700000.0, 6600000.0)
    assert lon == pytest.approx(3.0, abs=1e-9)
    assert lat == pytest.approx(46.5, abs=1e-9)


def test_a_geopackage_layer_is_read_and_reprojected():
    points = _points({"herault_sdis": GPKG["herault_sdis"]})
    assert len(points) == 5
    agde = next(p for p in points if p["id"] == "34001.00001")
    assert (agde["lon"], agde["lat"]) == AGDE_WGS84


def test_every_reprojected_geopackage_point_lands_inside_france():
    for point in _points({"herault_sdis": GPKG["herault_sdis"]}):
        assert LON_MIN <= point["lon"] <= LON_MAX, point
        assert LAT_MIN <= point["lat"] <= LAT_MAX, point


def test_raw_lambert93_metres_never_reach_the_output():
    # 723894 as a longitude is the whole point of this layer's CRS handling.
    for point in _points({"herault_sdis": GPKG["herault_sdis"]}):
        assert abs(point["lon"]) < 180 and abs(point["lat"]) < 90


def test_a_geopackage_row_with_no_geometry_is_skipped():
    ids = [p["id"] for p in _points({"herault_sdis": GPKG["herault_sdis"]})]
    assert "34001.09999" not in ids


def test_a_geopackage_already_in_wgs84_is_not_reprojected():
    point, = _points({"herault_sdis": GPKG["wgs84"]})
    assert (point["lon"], point["lat"]) == AGDE_WGS84


def test_a_geopackage_in_an_unhandled_projection_is_skipped_not_guessed():
    with pytest.warns(UserWarning, match="3857"):
        assert _points({"herault_sdis": GPKG["webmercator"]}) == []


def test_an_unhandled_projection_is_not_claimed_as_covered():
    with pytest.warns(UserWarning):
        assert water.normalize({"herault_sdis": GPKG["webmercator"]})["coverage"] == []


def test_the_geopackage_vocabulary_maps_onto_our_kinds():
    kinds = {p["id"]: p["kind"] for p in _points({"herault_sdis": GPKG["herault_sdis"]})}
    assert kinds["34001.00001"] == "borne"    # PI
    assert kinds["34001.00002"] == "borne"    # BI
    assert kinds["34003.00011"] == "citerne"  # CI
    assert kinds["34129.00004"] == "naturel"  # PA
    assert kinds["34129.00009"] is None       # BA, not a documented abbreviation


def test_the_geopackage_style_table_is_not_read_as_a_feature_layer():
    # gpkg_contents also lists layer_styles, whose data_type is "attributes".
    assert len(_points({"herault_sdis": GPKG["herault_sdis"]})) == 5


def test_a_body_that_is_not_a_geopackage_yields_nothing():
    for body in (b"", b"<html>502</html>", "not bytes", None):
        assert _points({"herault_sdis": body}) == []


def test_the_full_herault_register_counts_as_a_whole_departement():
    coverage, = water.normalize({"herault_sdis": GPKG["herault_sdis"]})["coverage"]
    assert coverage["scope"] == "departement"
    assert coverage["dep"] == "34"
    assert coverage["count"] == 5


def test_fetch_keeps_a_geopackage_as_bytes_rather_than_decoding_it():
    session = _Session(bodies={"peis-herault-l93.gpkg": GPKG["herault_sdis"]})
    assert water.fetch(session)["herault_sdis"] == GPKG["herault_sdis"]


def test_every_point_is_counted_in_exactly_one_coverage_row():
    """The provenance page derives its national total from the coverage counts.

    water.json no longer publishes the points, so `sum(count)` is the only
    remaining statement of how many water points we hold. If a point could be
    dropped after being counted, that page would overstate the register — the
    direction that tells a firefighter there is more water than there is.
    """
    layer = water.normalize(PAYLOAD)

    assert sum(row["count"] for row in layer["coverage"]) == len(layer["points"])


# --- Calvados, SDIS 14 ------------------------------------------------------
# A GeoJSON published in Lambert-93, which is legal and which nothing else here
# does: every other GeoJSON source is WGS84. Its CRS is declared in the file.
CALVADOS = {"calvados": FIXTURE["calvados"]}


def test_a_geojson_declaring_lambert93_is_reprojected_not_read_as_degrees():
    """Reading 426012, 6911080 as degrees is nowhere; dropping it is a lost département.

    The France box in normalize() would reject the raw metres, so the failure
    mode without this is a register that fetches perfectly and yields zero
    points -- a département that silently reads as having no water.
    """
    points = water.normalize(CALVADOS)["points"]

    assert points, "the whole register was dropped"
    for point in points:
        # Calvados sits around Caen: 49.2 N, -0.4 E.
        assert 48.7 < point["lat"] < 49.5, point
        assert -1.2 < point["lon"] < 0.6, point


def test_a_point_the_sdis_marks_out_of_service_is_not_published():
    """etat_cod IN means INdisponible, documented by the publisher.

    Sending a crew to a hydrant the map called usable is the failure this layer
    has to avoid. The fixture holds two such points among six real records.
    """
    points = water.normalize(CALVADOS)["points"]

    assert len(points) == 4, "the two INdisponible points must not be published"
    assert "142258001" not in {p["id"] for p in points}
    assert "147310016" not in {p["id"] for p in points}


def test_calvados_points_carry_their_own_commune_not_the_departement_default():
    # The département comes from the INSEE code, never a postcode.
    points = water.normalize(CALVADOS)["points"]

    assert {p["dep"] for p in points} == {"14"}


def test_the_documented_famille_decides_the_kind():
    """famille_id is 1 poteau, 2 bouche, 3 réserve, per the publisher's own notes.

    type_cod is finer (P01, A02, B01...) but the published list ends in "etc.",
    so it is not read: a code we guessed at would describe the wrong equipment.
    """
    kinds = {p["id"]: p["kind"] for p in water.normalize(CALVADOS)["points"]}

    assert kinds["140030010"] == "borne", "famille 1 is a poteau incendie"
    assert kinds["142580106"] == "borne", "famille 2 is a bouche incendie"
    assert kinds["141379005"] == "citerne", "famille 3 is a réserve"


def test_a_geojson_in_an_unexpected_crs_is_refused_rather_than_guessed():
    """A republication in Web Mercator must not be read as Lambert-93.

    The same rule the GeoPackage reader follows: an unknown SRS yields nothing,
    because a wrong projection puts water points in the wrong village.
    """
    other = json.loads(json.dumps(FIXTURE["calvados"]))
    other["crs"]["properties"]["name"] = "EPSG:3857"

    assert water.normalize({"calvados": other})["points"] == []


def test_calvados_counts_as_a_whole_departement():
    coverage = water.normalize(CALVADOS)["coverage"]

    assert [c["scope"] for c in coverage] == ["departement"]
    assert coverage[0]["dep"] == "14"
    assert coverage[0]["tier"] == "register"
