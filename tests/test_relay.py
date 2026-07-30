"""The curated directory of places where help is being organised.

Nothing here fetches a linked page. The tier states who publishes it, never
whether a particular post on it is true.
"""
from build import relay


def _payload(**over):
    base = {
        "curated_at": "2026-07-30",
        "covers": ["33"],
        "entries": [
            {"name": "Préfecture de la Gironde", "tier": "official", "area": "33",
             "url": "https://www.gironde.gouv.fr/", "note": "Arrêtés et consignes."},
            {"name": "Entraide Incendie Gironde", "tier": "community", "area": "33",
             "url": "https://www.facebook.com/groups/example",
             "note": "Groupe d'entraide entre habitants."},
        ],
    }
    base.update(over)
    return base


def test_every_entry_keeps_its_tier_and_url():
    out = relay.normalize(_payload(), now="2026-07-30T12:00:00Z")

    assert [e["tier"] for e in out["entries"]] == ["official", "community"]
    assert out["entries"][0]["url"] == "https://www.gironde.gouv.fr/"
    assert out["covers"] == ["33"]


def test_an_unknown_tier_is_refused_rather_than_rendered_untiered():
    """An untiered entry would appear beside official ones with nothing said."""
    bad = _payload(entries=[{"name": "X", "tier": "trusted", "area": "33",
                             "url": "https://example.org/", "note": "n"}])

    out = relay.normalize(bad, now="2026-07-30T12:00:00Z")

    assert out["entries"] == []
    assert "trusted" in " ".join(out["problems"])


def test_an_entry_without_a_url_is_dropped():
    bad = _payload(entries=[{"name": "X", "tier": "official", "area": "33", "note": "n"}])

    assert relay.normalize(bad, now="2026-07-30T12:00:00Z")["entries"] == []


def test_a_non_https_url_is_refused():
    """These are links handed to somebody in an emergency, on a phone."""
    bad = _payload(entries=[{"name": "X", "tier": "official", "area": "33",
                             "url": "http://example.org/", "note": "n"}])

    assert relay.normalize(bad, now="2026-07-30T12:00:00Z")["entries"] == []


def test_a_malformed_file_is_no_directory_rather_than_an_empty_one(tmp_path):
    path = tmp_path / "relay.json"
    path.write_text("{ not json")

    assert relay.load(path) is None

    out = relay.normalize(None, now="2026-07-30T12:00:00Z")
    assert out["entries"] == []
    assert out["curated_at"] is None


def test_curation_goes_stale_and_says_so():
    """A directory nobody has touched for weeks is a directory of dead links."""
    fresh = relay.normalize(_payload(curated_at="2026-07-29"), now="2026-07-30T12:00:00Z")
    old = relay.normalize(_payload(curated_at="2026-05-01"), now="2026-07-30T12:00:00Z")

    assert fresh["stale"] is False
    assert old["stale"] is True


def test_reachability_starts_unknown_rather_than_true():
    """Nothing has been checked yet at this point, and unknown is not reachable."""
    out = relay.normalize(_payload(), now="2026-07-30T12:00:00Z")

    assert all(e["reachable"] is None for e in out["entries"])


def test_the_shipped_file_parses_and_every_entry_survives_validation():
    """A file that fails its own validator ships a page with silent gaps."""
    from pathlib import Path

    payload = relay.load(Path("public/static/fr/relay.json"))
    assert payload is not None, "the shipped relay file must parse"

    out = relay.normalize(payload, now="2026-07-30T12:00:00Z")
    assert out["problems"] == [], f"shipped file has invalid entries: {out['problems']}"
    assert out["entries"], "the shipped file must list at least one place"
    assert out["covers"], "the file must say which départements it covers"


def test_the_shipped_file_links_nowhere_we_cannot_check(tmp_path):
    """A facebook.com URL cannot be verified, so it cannot be curated.

    Measured 2026-07-30: a deleted group and a live prefecture page both answer
    HTTP 200 with the same ~270 KB of login markup. A link check over such a URL
    returns "reachable" for a page that no longer exists, which is a green light
    nobody earned. Until a check exists that can tell the two apart, an entry
    somebody could not open is an entry this file does not carry.
    """
    from pathlib import Path

    payload = relay.load(Path("public/static/fr/relay.json")) or {}
    urls = [e.get("url", "") for e in payload.get("entries") or []]

    assert not [u for u in urls if "facebook.com" in u], (
        "facebook.com entries cannot be verified by opening them")
