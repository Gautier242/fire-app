"""What each published file is allowed to weigh.

The summary had a budget and nothing else did, so water.json reached 9.1 MB --
737 KB gzipped, 74,632 coordinates -- for pages that draw no water marker, and
two separate source comments describing its size drifted to half the truth
because nothing measured them.

Budgets are gzipped, at level 9, which is close to what a CDN serves. They are
deliberately loose: the point is not to police kilobytes, it is that a layer
cannot quietly grow an order of magnitude without the build saying so.
"""
import fnmatch
import gzip
import json
from pathlib import Path

import pytest

PUBLIC = Path("public")
SUMMARY = PUBLIC / "data/summary.json"

# Files a reader loads to decide whether to leave. These are the ones worth
# being strict about: they are fetched on the critical path, often on a phone,
# often on a degraded network in exactly the conditions that produced the fire.
CRITICAL_KB = 150

# Fetched off the critical path, by a reader who asked or after the numbers have
# already rendered. Slow is acceptable here; silently enormous is not.
SIDE_KB = 150

BUDGETS_KB = {
    "data/summary.json": CRITICAL_KB,
    "fr/data/summary.json": CRITICAL_KB,
    # The local view fetches one of these to draw the map around an address. It
    # carries the water register narrowed to its own radius, which costs about
    # 0.3 KB today; a zone over a dense register would cost 136 KB and is meant
    # to fail here so somebody caps it deliberately.
    "fr/data/zones/*.json": 60,
    "fr/data/gironde.json": CRITICAL_KB,
    "data/history.json": SIDE_KB,
    "fr/data/history.json": SIDE_KB,
    "fr/data/hydrants.json": SIDE_KB,
    "fr/data/flares.json": 50,
    "fr/data/relay.json": 50,
    # Coverage rows only: eleven registers and their counts, no coordinates.
    # Comfortably under 1 KB, so this budget exists to catch the points coming
    # back rather than to leave room for growth.
    "fr/data/water.json": 50,
}


def published():
    """Every file the build writes, relative to public/.

    public/static/ is excluded: it is committed input, not build output, and a
    map of French communes is supposed to be large.
    """
    for directory in (PUBLIC / "data", PUBLIC / "fr/data"):
        for path in sorted(directory.rglob("*.json")):
            yield path.relative_to(PUBLIC).as_posix(), path


def budget_for(name):
    for pattern, kb in BUDGETS_KB.items():
        if fnmatch.fnmatch(name, pattern):
            return kb
    return None


def gzipped_kb(path):
    return len(gzip.compress(path.read_bytes(), 9)) / 1024


needs_build = pytest.mark.skipif(
    not SUMMARY.exists(), reason="run `python -m build.main` first")


@needs_build
@pytest.mark.parametrize("name,path", list(published()))
def test_every_published_file_stays_within_its_gzipped_budget(name, path):
    budget = budget_for(name)
    assert budget is not None, f"{name} has no budget; add one to BUDGETS_KB"
    size = gzipped_kb(path)
    assert size < budget, (
        f"{name} is {size:.1f} KB gzipped, over its {budget} KB budget. "
        "Narrow it to what the page actually reads rather than raising this "
        "number: the register was 737 KB to render one sentence.")


@needs_build
def test_a_new_published_file_cannot_ship_without_a_budget():
    """The gap that let water.json reach 9.1 MB was a missing entry, not a loose one.

    A layer added without a line here would repeat it exactly: nothing would
    measure the new file, and its size would only surface as a slow page for
    somebody on a phone during a fire.
    """
    unbudgeted = [name for name, _ in published() if budget_for(name) is None]

    assert not unbudgeted, f"no size budget covers: {', '.join(unbudgeted)}"


@needs_build
def test_summary_has_no_geometry_in_the_fires_section():
    # Fire polygons belong in perimeters.geojson, which is lazy-loaded.
    summary = json.loads(SUMMARY.read_text())
    for fire in summary["fires"]:
        assert "polygons" not in fire and "geometry" not in fire


@needs_build
def test_the_water_register_publishes_no_coordinates():
    """The 9.1 MB was 74,632 lat/lon pairs that nothing draws.

    A size budget alone would not catch them coming back one register at a time,
    and the points have a correct home now: the zone file, narrowed to a radius.
    """
    water = json.loads((PUBLIC / "fr/data/water.json").read_text())

    assert "points" not in water, (
        "water.json publishes the coverage statement; the points travel per zone")
    assert water["coverage"], "coverage is the whole point of the file"
