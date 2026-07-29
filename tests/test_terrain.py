"""Slope and aspect, because fire runs uphill.

The Rothermel slope factor needs tan(slope), and a resident needs to know that
the fire below them will reach them faster than the distance suggests.
"""
import json
import math
from pathlib import Path

import pytest

from build.sources.fr import terrain

PAYLOAD = json.loads(Path("tests/fixtures/terrain.json").read_text())


def test_a_flat_grid_has_no_slope_and_no_uphill_direction():
    flat = [[100.0, 100.0, 100.0], [100.0, 100.0, 100.0], [100.0, 100.0, 100.0]]

    cell = terrain.slope_at(flat, 1, 1, spacing_m=100.0)

    assert cell["slope_deg"] == 0.0
    # On the flat there is no uphill, and inventing one would send the spread
    # model a direction it should not have.
    assert cell["uphill"] is None


def test_slope_and_uphill_are_computed_from_the_neighbourhood():
    # Rising toward the north: row 0 is high, row 2 is low.
    grid = [[200.0, 200.0, 200.0], [150.0, 150.0, 150.0], [100.0, 100.0, 100.0]]

    cell = terrain.slope_at(grid, 1, 1, spacing_m=100.0)

    assert 25.0 < cell["slope_deg"] < 30.0
    assert cell["uphill"] == "N"


def test_a_45_degree_rise_reads_as_45_degrees():
    grid = [[200.0, 200.0, 200.0], [100.0, 100.0, 100.0], [0.0, 0.0, 0.0]]

    cell = terrain.slope_at(grid, 1, 1, spacing_m=100.0)

    assert 44.0 < cell["slope_deg"] < 46.0


def test_a_missing_neighbour_yields_no_slope_rather_than_a_wrong_one():
    grid = [[None, 100.0, 100.0], [100.0, 100.0, 100.0], [100.0, 100.0, None]]

    assert terrain.slope_at(grid, 1, 1, spacing_m=100.0)["slope_deg"] is None


def test_an_edge_cell_does_not_take_its_slope_from_the_opposite_edge():
    # An index of -1 is legal Python and wraps, so a row-0 cell asking for its
    # northern neighbour would be handed the southernmost row - terrain tens of
    # kilometres away - and report a confident slope across the whole zone.
    grid = [[0.0, 0.0, 0.0], [100.0, 100.0, 100.0], [200.0, 200.0, 200.0]]

    assert terrain.slope_at(grid, 0, 1, spacing_m=100.0)["slope_deg"] is None
    assert terrain.slope_at(grid, 1, 0, spacing_m=100.0)["slope_deg"] is None


def test_the_same_hillside_reads_steeper_when_sampled_more_closely():
    # Slope is a property of the sampling scale, not just the ground. The same
    # 100 m rise is a gentle regional gradient over kilometres and a steep
    # hillside over hundreds of metres. Halving the spacing must roughly double
    # tan(slope) - if it does not, spacing is not reaching the difference and
    # every slope in the zone is wrong by that factor.
    grid = [[200.0, 200.0, 200.0], [150.0, 150.0, 150.0], [100.0, 100.0, 100.0]]

    coarse = terrain.slope_at(grid, 1, 1, spacing_m=1000.0)["slope_deg"]
    fine = terrain.slope_at(grid, 1, 1, spacing_m=500.0)["slope_deg"]

    # Loose because slope_deg is rounded to two decimals for the payload.
    assert math.tan(math.radians(fine)) == pytest.approx(
        2 * math.tan(math.radians(coarse)), rel=2e-3)


def test_a_live_payload_normalizes_into_a_grid():
    out = terrain.normalize(PAYLOAD, step=3)

    assert out["step"] == 3
    assert out["grid"]
    assert all("elev_m" in cell for row in out["grid"] for cell in row)


def test_an_empty_payload_returns_an_empty_grid():
    assert terrain.normalize(None, step=3)["grid"] == []


def test_the_no_data_sentinel_is_not_mistaken_for_an_elevation():
    # IGN returns z = -99999.0 for a point outside coverage. Taken literally it
    # would read as a hundred-kilometre cliff; 0.0 by contrast is real sea level.
    out = terrain.normalize(PAYLOAD, step=3)
    elevations = [cell["elev_m"] for row in out["grid"] for cell in row]

    assert None in elevations
    assert all(e is None or e > -1000 for e in elevations)
    # The corner is missing, so its neighbouring cell must decline to guess.
    assert out["grid"][1][1]["slope_deg"] is None
