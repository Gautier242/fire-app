import json
import unicodedata
from pathlib import Path

import pytest

from build.sources.fr.georisques import BATCH_SIZE, MAX_COMMUNES, fetch, normalize

FIXTURE = json.loads(Path("tests/fixtures/georisques.json").read_text())


def by_insee(records):
    return {r["insee"]: r for r in records}


def test_normalize_produces_one_record_per_commune():
    assert len(normalize(FIXTURE)) == 5


def test_classified_commune_sets_fire_risk_true():
    records = by_insee(normalize(FIXTURE))
    # Frejus, Nice, Marseille are all classified "Feu de foret" in GASPAR.
    for insee in ("83061", "06088", "13055"):
        assert records[insee]["fire_risk"] is True


def test_unclassified_commune_sets_fire_risk_false_meaning_not_classified():
    records = by_insee(normalize(FIXTURE))
    # Paris and Lille carry no "Feu de foret" entry in GASPAR.
    #
    # fire_risk False means ONLY "this commune is not legally classified as
    # exposed to forest fire". It does NOT mean the commune is safe, and it
    # must never be rendered as reassurance. A commune can burn without being
    # classified; classification drives debroussaillement obligations, not
    # today's danger.
    for insee in ("75056", "59350"):
        assert records[insee]["fire_risk"] is False


def test_records_carry_the_full_risk_list_and_source():
    records = by_insee(normalize(FIXTURE))
    assert "Inondation" in records["83061"]["risks"]
    assert "Feu de forêt" in records["83061"]["risks"]
    assert records["83061"]["source"] == "georisques"


def test_fire_risk_matches_regardless_of_unicode_normalization_form():
    # The live API returns NFC. Nothing guarantees it stays that way, and a
    # naive == against a hardcoded NFC string would silently report "not
    # classified" for every commune in France if it ever emitted NFD.
    nfd = unicodedata.normalize("NFD", "Feu de forêt")
    assert nfd != "Feu de forêt"

    payload = {"data": [{"code_insee": "83061", "risques_detail": [
        {"num_risque": "16", "libelle_risque_long": nfd},
    ]}]}
    assert normalize(payload)[0]["fire_risk"] is True


def test_risk_labels_are_emitted_in_a_single_normalization_form():
    payload = {"data": [{"code_insee": "83061", "risques_detail": [
        {"num_risque": "16",
         "libelle_risque_long": unicodedata.normalize("NFD", "Feu de forêt")},
    ]}]}
    assert normalize(payload)[0]["risks"] == ["Feu de forêt"]


def test_empty_payload_yields_no_records():
    assert normalize({}) == []
    assert normalize({"data": []}) == []


def test_commune_with_no_risk_detail_yields_no_record_not_a_negative():
    # Absence of data and "not classified" are different answers. A commune we
    # could not read must vanish from the payload so the frontend renders
    # "non disponible", rather than appearing as a confident False.
    assert normalize({"data": [{"code_insee": "83061"}]}) == []
    assert normalize({"data": [{"code_insee": "83061", "risques_detail": []}]}) == []


def test_malformed_records_are_skipped_without_raising():
    payload = {"data": [
        {"risques_detail": [{"libelle_risque_long": "Feu de forêt"}]},  # no insee
        "not a dict",
        {"code_insee": "83061", "risques_detail": "not a list"},
        {"code_insee": "06088", "risques_detail": [
            {"libelle_risque_long": None},
            {"libelle_risque_long": "Feu de forêt"},
        ]},
    ]}
    assert normalize(payload) == [
        {"insee": "06088", "fire_risk": True, "risks": ["Feu de forêt"],
         "source": "georisques"},
    ]


class FakeSession:
    def __init__(self):
        self.calls = []

    def get_json(self, session, url, params=None, **kwargs):
        self.calls.append(params["code_insee"].split(","))
        return {"data": [{"code_insee": code, "risques_detail": [
            {"num_risque": "16", "libelle_risque_long": "Feu de forêt"},
        ]} for code in params["code_insee"].split(",")]}


def test_fetch_batches_requests_within_the_api_cap(monkeypatch):
    fake = FakeSession()
    monkeypatch.setattr("build.sources.fr.georisques.get_json", fake.get_json)

    codes = [f"8306{i:02d}" for i in range(45)]
    payload = fetch(None, codes)

    assert [len(c) for c in fake.calls] == [BATCH_SIZE, BATCH_SIZE, 5]
    assert len(payload["data"]) == 45


def test_fetch_refuses_an_unbounded_sweep(monkeypatch):
    fake = FakeSession()
    monkeypatch.setattr("build.sources.fr.georisques.get_json", fake.get_json)

    with pytest.raises(ValueError):
        fetch(None, [f"{i:05d}" for i in range(MAX_COMMUNES + 1)])
    assert fake.calls == []


def test_fetch_honours_an_explicit_lower_cap(monkeypatch):
    fake = FakeSession()
    monkeypatch.setattr("build.sources.fr.georisques.get_json", fake.get_json)

    with pytest.raises(ValueError):
        fetch(None, ["83061", "06088", "13055"], cap=2)
    assert fake.calls == []


def test_fetch_of_nothing_makes_no_calls(monkeypatch):
    fake = FakeSession()
    monkeypatch.setattr("build.sources.fr.georisques.get_json", fake.get_json)

    assert fetch(None, [])["data"] == []
    assert fake.calls == []
