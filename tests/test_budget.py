import gzip
import json
from pathlib import Path

import pytest

SUMMARY = Path("public/data/summary.json")
BUDGET_KB = 150


@pytest.mark.skipif(not SUMMARY.exists(), reason="run `python -m build.main` first")
def test_summary_stays_within_the_gzipped_size_budget():
    raw = SUMMARY.read_bytes()
    gzipped_kb = len(gzip.compress(raw, 9)) / 1024
    assert gzipped_kb < BUDGET_KB, (
        f"summary.json is {gzipped_kb:.1f} KB gzipped, over the {BUDGET_KB} KB budget. "
        "Simplify evacuation polygons or move data out of the near-me payload."
    )


@pytest.mark.skipif(not SUMMARY.exists(), reason="run `python -m build.main` first")
def test_summary_has_no_geometry_in_the_fires_section():
    # Fire polygons belong in perimeters.geojson, which is lazy-loaded.
    summary = json.loads(SUMMARY.read_text())
    for fire in summary["fires"]:
        assert "polygons" not in fire and "geometry" not in fire
