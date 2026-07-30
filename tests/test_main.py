import pytest

from build.http import FetchError
from build.main import build, water_index

NOW = "2026-07-28T12:00:00Z"


def ok(value):
    return lambda: value


def boom():
    raise FetchError("source down")


def test_build_collects_all_sources():
    summary = build(now=NOW, previous=None, fetchers={
        "cwfis_perimeters": ok([{"id": "cwfis:idx:0", "lat": 50.0, "lon": -120.0, "named": False}]),
        "bc_fires": ok([{"id": "bc:V1", "lat": 50.1, "lon": -120.1, "named": True, "name": "A"}]),
        "bc_evac": ok([{"id": 1, "kind": "order", "name": "Z", "polygons": [[[[0, 0]]]]}]),
        "aqhi": ok([{"id": "S1", "lat": 50.0, "lon": -120.0, "value": 3.0}]),
    })
    assert summary["generated_at"] == NOW
    assert len(summary["fires"]) == 2
    assert len(summary["evacuations"]) == 1
    assert len(summary["aqhi"]) == 1


def test_build_includes_the_coverage_registry():
    summary = build(now=NOW, previous=None, fetchers={
        "cwfis_perimeters": ok([]), "bc_fires": ok([]),
        "bc_evac": ok([]), "aqhi": ok([]),
    })
    assert len(summary["coverage"]) == 13


def test_a_failing_source_reuses_previous_data_and_is_marked_stale():
    previous = {
        "evacuations": [{"id": 1, "kind": "order", "name": "Old zone", "polygons": [[[[0, 0]]]]}],
        "sources": [{"id": "bc_evac", "ok": True, "fetched_at": "2026-07-28T11:00:00Z", "stale": False}],
    }
    summary = build(now=NOW, previous=previous, fetchers={
        "cwfis_perimeters": ok([]), "bc_fires": ok([]),
        "bc_evac": boom, "aqhi": ok([]),
    })
    evac_source = next(s for s in summary["sources"] if s["id"] == "bc_evac")
    assert evac_source["ok"] is False
    assert evac_source["stale"] is True
    assert evac_source["fetched_at"] == "2026-07-28T11:00:00Z", "keeps the real age, not now"
    assert summary["evacuations"] == previous["evacuations"], "keeps the last good data"


def test_a_failing_source_with_no_previous_data_yields_an_empty_stale_section():
    summary = build(now=NOW, previous=None, fetchers={
        "cwfis_perimeters": ok([]), "bc_fires": ok([]),
        "bc_evac": boom, "aqhi": ok([]),
    })
    evac_source = next(s for s in summary["sources"] if s["id"] == "bc_evac")
    assert evac_source["stale"] is True
    assert evac_source["fetched_at"] is None
    assert summary["evacuations"] == []


def test_a_successful_source_is_never_stale():
    summary = build(now=NOW, previous=None, fetchers={
        "cwfis_perimeters": ok([]), "bc_fires": ok([]),
        "bc_evac": ok([]), "aqhi": ok([]),
    })
    for source in summary["sources"]:
        assert source["ok"] is True
        assert source["stale"] is False
        assert source["fetched_at"] == NOW


def test_build_raises_if_every_source_fails():
    # Writing an all-empty summary would render as "no fires anywhere in Canada".
    with pytest.raises(RuntimeError, match="every source failed"):
        build(now=NOW, previous=None, fetchers={
            "cwfis_perimeters": boom, "bc_fires": boom,
            "bc_evac": boom, "aqhi": boom,
        })


def test_road_closures_reach_their_own_section():
    summary = build(now=NOW, previous=None, fetchers={
        "cwfis_perimeters": ok([]), "bc_fires": ok([]), "bc_evac": ok([]), "aqhi": ok([]),
        "bc_roads": ok([{"id": "DBC-1", "kind": "closure", "name": "Hwy 97",
                         "geometry": {"type": "Point", "coordinates": [-120.0, 50.0]}}]),
    })
    assert len(summary["closures"]) == 1
    assert summary["closures"][0]["source"] == "bc_roads"


def test_a_failing_road_feed_keeps_its_last_good_closures():
    # A road that was shut an hour ago is still the safer assumption than a map
    # that quietly forgets it while the fetch is broken.
    previous = {
        "closures": [{"id": "DBC-9", "kind": "closure", "name": "Hwy 5", "source": "bc_roads"}],
        "sources": [{"id": "bc_roads", "ok": True, "fetched_at": "2026-07-28T11:00:00Z", "stale": False}],
    }
    summary = build(now=NOW, previous=previous, fetchers={
        "cwfis_perimeters": ok([]), "bc_fires": ok([]), "bc_evac": ok([]), "aqhi": ok([]),
        "bc_roads": boom,
    })
    roads = next(s for s in summary["sources"] if s["id"] == "bc_roads")
    assert roads["stale"] is True
    assert roads["fetched_at"] == "2026-07-28T11:00:00Z"
    assert summary["closures"] == previous["closures"]


def test_the_published_water_file_carries_coverage_without_the_coordinates():
    """water.json exists for the provenance page, which draws no map.

    It was 9.1 MB of coordinates for a page that renders eleven rows and one
    total. The points now travel inside the zone files that actually need them,
    narrowed to a radius; what remains here is the statement of which registers
    exist, which is the part a reader needs to tell "no water" from "nobody
    published a register".
    """
    layer = {"points": [{"id": "a", "lat": 43.1, "lon": -0.2, "tier": "register"}],
             "coverage": [{"dep": "64", "area": "Pyrénées-Atlantiques",
                           "scope": "departement", "count": 1, "tier": "register"}]}

    published = water_index(layer)

    assert published["coverage"] == layer["coverage"]
    assert "points" not in published, (
        "the coordinates are what made this file 9.1 MB and nothing draws them")


def test_an_unreadable_water_register_publishes_nothing_rather_than_empty_coverage():
    """A failed fetch must leave the previous file serving, not overwrite it.

    Empty coverage renders as "no register covers anywhere in France", which is
    a confident wrong answer about a country with eleven published registers.
    """
    assert water_index(None) is None
