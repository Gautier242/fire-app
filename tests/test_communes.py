import json
from pathlib import Path

from build.sources.fr.communes import FIELDS, normalize

FIXTURE = json.loads(Path("tests/fixtures/communes.json").read_text())


def rows(payload):
    return normalize(payload)["communes"]


def by_name(payload, name):
    return next(r for r in rows(payload) if r[FIELDS.index("nom")] == name)


def test_normalize_keeps_every_well_formed_commune():
    assert len(rows(FIXTURE)) == len(FIXTURE)


def test_output_declares_its_column_order():
    # The rows are positional to keep the file small, so the file has to say
    # what the positions mean. lat before lon is the trap this guards: the
    # upstream centre is [lon, lat].
    assert normalize(FIXTURE)["fields"] == FIELDS
    assert FIELDS == ["code", "nom", "departement", "lat", "lon", "population"]


def test_rows_carry_the_insee_code_department_and_population():
    marseille = by_name(FIXTURE, "Marseille")
    assert marseille[FIELDS.index("code")] == "13055"
    assert marseille[FIELDS.index("departement")] == "13"
    assert marseille[FIELDS.index("population")] == 886040


def test_coordinates_are_read_lat_then_lon_from_the_upstream_lon_lat_centre():
    # Marseille is 43.3 N, 5.4 E. Swapped, it lands in the Sahara.
    marseille = by_name(FIXTURE, "Marseille")
    assert marseille[FIELDS.index("lat")] == 43.2803
    assert marseille[FIELDS.index("lon")] == 5.3806


def test_communes_are_ranked_by_population_descending():
    # Typing "mar" must offer Marseille before Marseille-en-Beauvaisis. The
    # Canadian place list shipped with exactly this bug.
    names = [r[FIELDS.index("nom")] for r in rows(FIXTURE)]
    assert names.index("Marseille") < names.index("Marseille-en-Beauvaisis")
    assert names.index("Marseille-en-Beauvaisis") < names.index("Marseillette")

    populations = [r[FIELDS.index("population")] for r in rows(FIXTURE)]
    assert populations == sorted(populations, reverse=True)


def test_a_commune_with_no_population_sorts_last_rather_than_being_dropped():
    # Six communes upstream report no population. A commune missing from the
    # picker cannot be searched for at all, so it keeps its place at the end.
    payload = FIXTURE + [{
        "nom": "Sans Habitants", "code": "99999", "codeDepartement": "99",
        "centre": {"type": "Point", "coordinates": [2.0, 46.0]},
        "population": None,
    }]
    assert rows(payload)[-1][FIELDS.index("nom")] == "Sans Habitants"
    assert rows(payload)[-1][FIELDS.index("population")] == 0


def test_normalize_skips_malformed_records_rather_than_raising():
    payload = [
        {"nom": "No Code", "codeDepartement": "01",
         "centre": {"type": "Point", "coordinates": [2.0, 46.0]}, "population": 10},
        {"code": "01002", "codeDepartement": "01",
         "centre": {"type": "Point", "coordinates": [2.0, 46.0]}, "population": 10},
        {"nom": "No Centre", "code": "01003", "codeDepartement": "01", "population": 10},
        {"nom": "Bad Centre", "code": "01004", "codeDepartement": "01",
         "centre": {"type": "Point", "coordinates": ["x", "y"]}, "population": 10},
        {"nom": "No Departement", "code": "01005",
         "centre": {"type": "Point", "coordinates": [2.0, 46.0]}, "population": 10},
    ]
    assert rows(payload) == []


def test_normalize_returns_an_empty_list_for_an_empty_payload():
    assert rows([]) == []
