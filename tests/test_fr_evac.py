"""Curated evacuation orders for France.

No national feed exists — France broadcasts by FR-Alert to phones and prefecture
arretes are PDFs across 101 sites. feugironde.fr solves this by hand: a person
reads the prefecture announcements and lists the communes under order. That works
because they cover two departements.

So this layer is curated, not fetched, and its integrity rests entirely on the
distinction between "no order here" and "we do not know". An empty file must
never render as an all-clear. That is the single rule this module exists to hold.
"""
import json

import pytest

from build.sources.fr import evac


def test_a_curated_order_becomes_a_zone_with_real_geometry(tmp_path):
    source = tmp_path / "orders.json"
    source.write_text(json.dumps({
        "curated_at": "2026-07-29T18:00:00Z",
        "curated_by": "test",
        "departements": ["33"],
        "orders": [
            {"insee": "33236", "kind": "order",
             "since": "2026-07-29T14:00:00Z",
             "source_url": "https://www.gironde.gouv.fr/example",
             "note": "Evacuation du camping"},
        ],
    }))
    shapes = {"33236": {"name": "Lacanau", "polygons": [[[[-1.1, 44.9], [-1.0, 44.9], [-1.0, 45.0], [-1.1, 45.0], [-1.1, 44.9]]]]}}

    zones = evac.normalize(evac.load(source), shapes)

    assert len(zones) == 1
    assert zones[0]["kind"] == "order"
    assert zones[0]["name"] == "Lacanau"
    assert zones[0]["polygons"]
    assert zones[0]["source_url"].startswith("https://")
    assert zones[0]["source"] == "curated"


def test_an_order_for_an_unknown_commune_is_kept_without_geometry(tmp_path):
    # A commune we cannot draw is still an order somebody must act on. Dropping
    # it because the polygon is missing would silently delete a live evacuation.
    source = tmp_path / "orders.json"
    source.write_text(json.dumps({
        "curated_at": "2026-07-29T18:00:00Z",
        "orders": [{"insee": "99999", "kind": "order"}],
    }))

    zones = evac.normalize(evac.load(source), {})

    assert len(zones) == 1
    assert zones[0]["polygons"] == []
    assert zones[0]["insee"] == "99999"


def test_a_missing_file_yields_no_zones_and_no_claim_of_coverage(tmp_path):
    payload = evac.load(tmp_path / "absent.json")

    assert evac.normalize(payload, {}) == []
    # The critical case. No file means we know nothing, so the frontend must be
    # told it cannot speak — not handed an empty list that reads as "none found".
    assert evac.curation_status(payload)["curated"] is False
    assert evac.curation_status(payload)["departements"] == []


def test_curation_status_reports_which_departements_are_actually_watched(tmp_path):
    source = tmp_path / "orders.json"
    source.write_text(json.dumps({
        "curated_at": "2026-07-29T18:00:00Z",
        "curated_by": "someone",
        "departements": ["33", "40"],
        "orders": [],
    }))

    status = evac.curation_status(evac.load(source))

    assert status["curated"] is True
    assert status["departements"] == ["33", "40"]
    # Zero orders in a watched departement is a real "none found". Zero orders
    # anywhere else is silence. The frontend needs both facts to say either.
    assert status["curated_at"] == "2026-07-29T18:00:00Z"


def test_stale_curation_is_reported_rather_than_trusted(tmp_path):
    source = tmp_path / "orders.json"
    source.write_text(json.dumps({
        "curated_at": "2026-07-01T00:00:00Z", "departements": ["33"], "orders": [],
    }))

    status = evac.curation_status(evac.load(source), now="2026-07-29T18:00:00Z")

    # A human-maintained list that nobody has touched for four weeks cannot be
    # claimed as current, even when it is syntactically fine.
    assert status["stale"] is True


def test_fresh_curation_is_not_stale(tmp_path):
    source = tmp_path / "orders.json"
    source.write_text(json.dumps({
        "curated_at": "2026-07-29T16:00:00Z", "departements": ["33"], "orders": [],
    }))

    status = evac.curation_status(evac.load(source), now="2026-07-29T18:00:00Z")
    assert status["stale"] is False


def test_a_malformed_file_is_treated_as_no_curation_at_all(tmp_path):
    source = tmp_path / "orders.json"
    source.write_text("{ this is not json")

    payload = evac.load(source)

    assert evac.normalize(payload, {}) == []
    assert evac.curation_status(payload)["curated"] is False


def test_an_alert_is_distinguished_from_an_order(tmp_path):
    source = tmp_path / "orders.json"
    source.write_text(json.dumps({
        "curated_at": "2026-07-29T18:00:00Z",
        "orders": [
            {"insee": "33236", "kind": "order"},
            {"insee": "33009", "kind": "alert"},
        ],
    }))

    zones = evac.normalize(evac.load(source), {})
    kinds = {z["insee"]: z["kind"] for z in zones}

    assert kinds["33236"] == "order"
    assert kinds["33009"] == "alert"


def test_an_unrecognised_kind_becomes_an_order_not_an_alert(tmp_path):
    # Failing toward caution, as the rest of this project does. Telling someone to
    # leave when they only needed to be ready is recoverable; the reverse is not.
    source = tmp_path / "orders.json"
    source.write_text(json.dumps({
        "curated_at": "2026-07-29T18:00:00Z",
        "orders": [{"insee": "33236", "kind": "peut-etre"}],
    }))

    assert evac.normalize(evac.load(source), {})[0]["kind"] == "order"


def test_an_order_with_no_insee_is_dropped(tmp_path):
    # Without a commune code there is nothing to place or name, so the entry
    # cannot be shown or acted on. This is the one case where dropping is right.
    source = tmp_path / "orders.json"
    source.write_text(json.dumps({
        "curated_at": "2026-07-29T18:00:00Z",
        "orders": [{"kind": "order", "note": "somewhere"}],
    }))

    assert evac.normalize(evac.load(source), {}) == []
