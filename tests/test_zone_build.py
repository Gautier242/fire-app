"""Writing one detail file per hot zone.

A zone file makes the local view instant and available offline. Its absence is
not an error -- the browser fetches the same data live -- so a failing zone must
never fail the build.
"""
import json

from build.zone_build import fires_in_zone, write_zone, write_zone_index


def test_a_zone_file_carries_only_what_is_near_it(tmp_path):
    zone = {"id": "gironde", "label": "Gironde", "lat": 44.84, "lon": -0.58,
            "radius_km": 50, "reason": "config"}
    fires = [
        {"id": "near", "lat": 44.86, "lon": -0.88, "frp_total": 100.0,
         "industrial": False, "in_country": True},
        {"id": "far", "lat": 43.12, "lon": 5.93, "frp_total": 500.0,
         "industrial": False, "in_country": True},
    ]

    payload = write_zone(tmp_path, zone, fires, wind_rows=[], terrain=None)

    assert [f["id"] for f in payload["fires"]] == ["near"]
    assert json.loads((tmp_path / "gironde.json").read_text())["id"] == "gironde"


def test_industrial_and_foreign_heat_are_excluded_from_a_zone(tmp_path):
    zone = {"id": "z", "label": "z", "lat": 44.84, "lon": -0.58, "radius_km": 50}
    fires = [
        {"id": "flare", "lat": 44.85, "lon": -0.59, "industrial": True, "in_country": True},
        {"id": "spain", "lat": 44.85, "lon": -0.60, "industrial": False, "in_country": False},
        {"id": "real", "lat": 44.86, "lon": -0.61, "industrial": False, "in_country": True},
    ]

    payload = write_zone(tmp_path, zone, fires, wind_rows=[], terrain=None)

    assert [f["id"] for f in payload["fires"]] == ["real"]


def test_a_zone_with_no_fires_is_still_written(tmp_path):
    # The file carries wind and the danger level too, and a quiet day is exactly
    # when somebody checks their evacuation route.
    zone = {"id": "quiet", "label": "Quiet", "lat": 48.0, "lon": 2.0, "radius_km": 50}

    payload = write_zone(tmp_path, zone, [], wind_rows=[], terrain=None)

    assert payload["fires"] == []
    assert (tmp_path / "quiet.json").exists()


def test_the_index_lists_every_written_zone(tmp_path):
    zones = [{"id": "a", "label": "A", "lat": 44.0, "lon": -1.0, "radius_km": 50,
              "reason": "config"},
             {"id": "b", "label": "B", "lat": 43.0, "lon": 6.0, "radius_km": 50,
              "reason": "danger"}]

    index = write_zone_index(tmp_path, zones)

    assert [z["id"] for z in index["zones"]] == ["a", "b"]
    assert json.loads((tmp_path / "index.json").read_text())["zones"]
    # The browser needs the reason to explain why a zone exists at all.
    assert index["zones"][1]["reason"] == "danger"


def test_an_empty_zone_list_writes_an_empty_index_rather_than_nothing(tmp_path):
    # An absent index is indistinguishable from a failed deploy. An empty one
    # says clearly that nothing was pre-built.
    index = write_zone_index(tmp_path, [])

    assert index["zones"] == []
    assert (tmp_path / "index.json").exists()


def test_fires_in_zone_is_ordered_worst_first(tmp_path):
    # Terrain fetches are capped, so the order decides which fires get a real
    # local slope and which fall back to the zone median.
    zone = {"id": "z", "lat": 44.0, "lon": -1.0, "radius_km": 50}
    fires = [
        {"id": "small", "lat": 44.01, "lon": -1.01, "frp_total": 10.0,
         "industrial": False, "in_country": True},
        {"id": "big", "lat": 44.02, "lon": -1.02, "frp_total": 3000.0,
         "industrial": False, "in_country": True},
    ]

    assert [f["id"] for f in fires_in_zone(zone, fires)] == ["big", "small"]


def test_a_fire_with_no_position_is_skipped_rather_than_crashing(tmp_path):
    zone = {"id": "z", "lat": 44.0, "lon": -1.0, "radius_km": 50}
    fires = [{"id": "nowhere", "lat": None, "lon": None,
              "industrial": False, "in_country": True}]

    assert fires_in_zone(zone, fires) == []


def test_a_spread_projection_is_attached_by_fire_id(tmp_path):
    zone = {"id": "z", "label": "z", "lat": 44.0, "lon": -1.0, "radius_km": 50}
    fires = [{"id": "f1", "lat": 44.01, "lon": -1.01, "frp_total": 100.0,
              "industrial": False, "in_country": True}]
    spread = [{"id": "f1", "model": "rothermel-1972", "validated": False, "arcs": []}]

    payload = write_zone(tmp_path, zone, fires, wind_rows=[], terrain=None,
                         spread=spread)

    assert payload["spread"][0]["id"] == "f1"
    # The flag must survive to the browser so the interface can say the
    # projection is modelled and not measured.
    assert payload["spread"][0]["validated"] is False


def test_closures_near_the_zone_reach_the_zone_file(tmp_path):
    """The local map draws zone.closures, so an absent key means an empty layer.

    mapview.drawLocal iterates zone["closures"]. Nothing wrote that key, so the
    local view rendered no closures at all while the owner was asking why blocked
    roads were missing. A reader who cannot see a cut drives into it.
    """
    zone = {"id": "gironde", "lat": 44.84, "lon": -0.58, "radius_km": 50,
            "reason": "config"}
    closures = [
        {"id": "near", "road": "A63", "place": "Le Barp",
         "lat": 44.61, "lon": -0.77, "in_force": True},
        {"id": "far", "road": "N118", "place": "Sevres",
         "lat": 48.82, "lon": 2.21, "in_force": True},
        {"id": "scheduled", "road": "N125", "place": "Lez",
         "lat": 44.70, "lon": -0.60, "in_force": False},
        {"id": "nowhere", "road": "D1", "place": "?",
         "lat": None, "lon": None, "in_force": True},
    ]

    payload = write_zone(tmp_path, zone, [], [], None, closures=closures)

    assert [c["id"] for c in payload["closures"]] == ["near"], (
        "only cuts in force and inside the radius belong on a local map")
    assert json.loads((tmp_path / "gironde.json").read_text())["closures"]


def test_a_zone_written_without_closures_still_has_the_key(tmp_path):
    """An absent key and an empty list are different failures downstream.

    The frontend cannot tell "no cuts near you" from "closures were never
    written", so the key is always present.
    """
    zone = {"id": "landes", "lat": 44.0, "lon": -0.77, "radius_km": 50}

    payload = write_zone(tmp_path, zone, [], [], None)

    assert payload["closures"] == []
