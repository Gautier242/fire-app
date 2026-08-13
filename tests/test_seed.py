"""Recovering the last published summary before a rebuild.

`build()` already keeps a failing source's last good data and flags it stale
with its real age -- but only if it is handed a `previous` summary. In CI there
is none: public/data is gitignored, so a fresh checkout starts blank and every
source that fails carries forward nothing.

The workflow used to fill that gap with one curl, and the curl named Canada
only. So when NASA FIRMS went down on 4 August 2026, France rebuilt with no
history, published 0 fires, and the publish gate -- correctly -- refused to
deploy. It refused for nine days. Both countries froze on 4 August data,
including Canada, whose own sources never missed a build.

That is the mistake CRITICAL_SECTIONS already documents: a per-country list
living in workflow YAML, naming one country and not the other, where no test
could see it. These tests exist so the seed cannot repeat it.
"""
import json

import pytest

from build.main import SECTIONS, seed_previous, seed_url

BASE = "https://gautier242.github.io/fire-app"


def test_the_french_summary_is_seeded_from_the_french_path_not_canada_s():
    # The exact bug: one URL served both builds, so France always rebuilt blank.
    assert seed_url(BASE, "public/data") == f"{BASE}/data/summary.json"
    assert seed_url(BASE, "public/fr/data") == f"{BASE}/fr/data/summary.json"


@pytest.mark.parametrize("country", sorted(SECTIONS))
def test_every_country_the_build_supports_can_locate_its_summary(country):
    """Derived from where the build writes, so a third country cannot be added
    without one -- which is precisely how France came to be missed."""
    out = "public/data" if country == "ca" else f"public/{country}/data"
    assert seed_url(BASE, out), f"{country} has no published summary to seed from"


def test_a_trailing_slash_on_the_site_root_does_not_double_up():
    assert seed_url(BASE + "/", "public/data") == f"{BASE}/data/summary.json"


def test_an_output_outside_the_site_root_is_not_guessed_at():
    """`--out /tmp/scratch` has no published counterpart. Inventing one risks
    seeding a build from another country's data."""
    assert seed_url(BASE, "/tmp/scratch") is None
    assert seed_url(BASE, "build") is None


def test_no_url_means_no_seed_rather_than_a_crash(tmp_path):
    def never(url):
        raise AssertionError("fetched despite having nowhere to fetch from")

    assert seed_previous(tmp_path, None, fetch=never) is None


def test_a_seed_that_cannot_be_fetched_leaves_the_build_to_run(tmp_path):
    """First-ever run, or the site down. Neither is a reason not to build."""
    def boom(url):
        raise OSError("404")

    assert seed_previous(tmp_path, "https://x/summary.json", fetch=boom) is None
    assert not (tmp_path / "summary.json").exists()


def test_a_seed_that_is_not_json_is_discarded_rather_than_written(tmp_path):
    """GitHub Pages answers an unknown path with an HTML 404 page. Writing that
    would leave build() unable to parse its own previous summary, turning one
    missing file into a failed build."""
    assert seed_previous(tmp_path, "https://x/summary.json",
                         fetch=lambda url: "<!DOCTYPE html>") is None
    assert not (tmp_path / "summary.json").exists()


def test_a_summary_without_sources_is_not_a_summary(tmp_path):
    """Fail safe: something answered, but not the thing we asked for."""
    assert seed_previous(tmp_path, "https://x/summary.json",
                         fetch=lambda url: json.dumps({"hello": "world"})) is None


def test_a_fetched_summary_is_written_where_build_will_look_for_it(tmp_path):
    published = {"generated_at": "2026-08-04T14:56:12Z", "fires": [{"id": "a"}],
                 "sources": [{"id": "firms", "ok": True,
                              "fetched_at": "2026-08-04T14:56:12Z", "stale": False}]}

    seeded = seed_previous(tmp_path, "https://x/summary.json",
                           fetch=lambda url: json.dumps(published))

    assert seeded == published
    assert json.loads((tmp_path / "summary.json").read_text()) == published


def test_a_local_summary_is_never_overwritten_by_the_published_one(tmp_path):
    """Running the build twice locally must not reach for the internet and
    replace what the first run just produced."""
    mine = {"generated_at": "2026-08-13T09:00:00Z", "fires": [], "sources": []}
    (tmp_path / "summary.json").write_text(json.dumps(mine))

    def never(url):
        raise AssertionError("the published summary was fetched over a local one")

    assert seed_previous(tmp_path, "https://x/summary.json", fetch=never) == mine
