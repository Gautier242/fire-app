from pathlib import Path

from build.sources.fr.mdf import LEVEL_LABELS, normalize

FIXTURE = Path("tests/fixtures/mdf.csv").read_text(encoding="utf-8")

HEADER = "date;num_dep;niveau_j1;niveau_j2;nom_dep\n"


def rows(*lines):
    return HEADER + "".join(line + "\n" for line in lines)


def by_dep(records):
    return {r["dep"]: r for r in records}


def test_normalize_produces_one_record_per_departement():
    records = normalize(FIXTURE)
    assert len(records) == 96
    assert len(by_dep(records)) == 96


def test_records_carry_the_expected_shape():
    var = by_dep(normalize(FIXTURE))["83"]
    assert var == {
        "dep": "83",
        "name": "Var",
        "level_today": 3,
        "level_tomorrow": 3,
        "issued_at": "2026-07-28T14:50:04Z",
        "source": "mdf",
    }


def test_only_the_latest_date_survives():
    records = normalize(rows(
        "2026-07-27T14:50:04Z;83;1;1;Var",
        "2026-07-28T14:50:04Z;83;4;3;Var",
        "2026-07-26T14:50:04Z;13;1;1;Bouches-du-Rhône",
    ))
    assert len(records) == 1
    assert records[0]["level_today"] == 4
    assert records[0]["issued_at"] == "2026-07-28T14:50:04Z"


def test_departement_codes_keep_their_leading_zero():
    ain = by_dep(normalize(FIXTURE))["01"]
    assert ain["dep"] == "01"
    assert ain["name"] == "Ain"


def test_corsica_codes_stay_strings():
    deps = by_dep(normalize(FIXTURE))
    assert deps["2A"]["name"] == "Corse-du-Sud"
    assert deps["2B"]["name"] == "Haute-Corse"
    assert "20" not in deps


def test_levels_parse_as_ints():
    for record in normalize(FIXTURE):
        assert isinstance(record["level_today"], int)
        assert isinstance(record["level_tomorrow"], int)
        assert 1 <= record["level_today"] <= 4


def test_a_non_numeric_level_is_unknown_not_the_lowest():
    record = normalize(rows("2026-07-28T14:50:04Z;83;;n/a;Var"))[0]
    assert record["level_today"] is None
    assert record["level_tomorrow"] is None


def test_an_out_of_range_level_is_unknown():
    record = normalize(rows("2026-07-28T14:50:04Z;83;0;9;Var"))[0]
    assert record["level_today"] is None
    assert record["level_tomorrow"] is None


def test_a_row_with_no_departement_code_is_skipped():
    records = normalize(rows(
        "2026-07-28T14:50:04Z;;3;2;Nulle Part",
        "2026-07-28T14:50:04Z;83;3;2;Var",
    ))
    assert [r["dep"] for r in records] == ["83"]


def test_a_short_row_is_skipped_not_raised_on():
    records = normalize(rows(
        "2026-07-28T14:50:04Z;83",
        "2026-07-28T14:50:04Z;13;2;2;Bouches-du-Rhône",
    ))
    assert [r["dep"] for r in records] == ["13"]


def test_a_row_with_no_date_is_skipped():
    records = normalize(rows(
        ";83;4;4;Var",
        "2026-07-28T14:50:04Z;13;2;2;Bouches-du-Rhône",
    ))
    assert [r["dep"] for r in records] == ["13"]


def test_empty_input_returns_no_records():
    assert normalize("") == []
    assert normalize(HEADER) == []


def test_records_are_sorted_by_departement():
    records = normalize(FIXTURE)
    assert [r["dep"] for r in records] == sorted(r["dep"] for r in records)


def test_every_level_has_an_official_label():
    assert sorted(LEVEL_LABELS) == [1, 2, 3, 4]
    for label in LEVEL_LABELS.values():
        assert label["colour"] and label["fr"]
