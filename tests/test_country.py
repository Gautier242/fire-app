"""One build, two countries.

Canada and France have opposite data availability — Canada publishes evacuation
orders and no danger forecast, France the reverse — so the sections differ. What
must not differ is the safety machinery: staleness, the refusal to publish an
empty summary, and the rule that absence of data never renders as safety.
"""
import pytest

from build.main import build, sections_for, fetchers_for
from build.registry import coverage_payload


def test_each_country_declares_its_own_sections():
    ca = set(sections_for("ca").values())
    fr = set(sections_for("fr").values())
    assert "evacuations" in ca
    # France has no evacuation feed at all; the section must not exist rather
    # than sit permanently empty, which would read as "none found".
    assert "evacuations" not in fr
    assert "danger" in fr
    assert "danger" not in ca


def test_coverage_is_country_specific():
    ca = coverage_payload("ca")
    fr = coverage_payload("fr")
    assert any(row.get("province") == "BC" for row in ca)
    assert ca != fr
    assert fr, "France must declare coverage so the UI can state its limits"


def test_an_unknown_country_raises_rather_than_guessing():
    with pytest.raises(ValueError):
        sections_for("de")


def test_a_french_build_populates_its_own_sections():
    summary = build(
        now="2026-07-29T12:00:00Z",
        previous=None,
        fetchers={"mdf": lambda: [{"dep": "83", "level_today": 3}]},
        country="fr",
    )
    assert summary["danger"] == [{"dep": "83", "level_today": 3, "source": "mdf"}]
    assert "evacuations" not in summary
    assert summary["country"] == "fr"


def test_a_failing_french_source_still_publishes_the_rest():
    def explode():
        raise RuntimeError("Meteo-France is down")

    summary = build(
        now="2026-07-29T12:00:00Z",
        previous=None,
        fetchers={"mdf": explode, "atmo": lambda: [{"insee": "13055"}]},
        country="fr",
    )
    assert summary["danger"] == []
    assert summary["air_quality"]
    assert [s["stale"] for s in summary["sources"] if s["id"] == "mdf"] == [True]


def test_every_country_still_refuses_to_publish_when_all_sources_fail():
    def explode():
        raise RuntimeError("down")

    with pytest.raises(RuntimeError):
        build(now="2026-07-29T12:00:00Z", previous=None,
              fetchers={"mdf": explode}, country="fr")


def test_the_canadian_build_is_unchanged_by_the_country_parameter():
    summary = build(
        now="2026-07-29T12:00:00Z",
        previous=None,
        fetchers={"bc_evac": lambda: [{"name": "Zone 1"}]},
        country="ca",
    )
    assert summary["evacuations"] == [{"name": "Zone 1", "source": "bc_evac"}]
    assert "fires" in summary and "closures" in summary


def test_fetchers_are_declared_for_both_countries():
    assert "bc_evac" in fetchers_for("ca", session=None)
    assert "mdf" in fetchers_for("fr", session=None)
    assert "bc_evac" not in fetchers_for("fr", session=None)
