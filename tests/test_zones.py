"""Which places get pre-built detail.

The config exists so the site owner can pin a région they care about without
waiting for it to catch fire, and the danger threshold exists so somewhere
nobody pinned still gets detail on the day it matters.
"""
import json

from build.zones import active_zones, load_config


def test_a_pinned_zone_is_always_active(tmp_path):
    path = tmp_path / "zones.json"
    path.write_text(json.dumps({
        "auto_danger_min": 3,
        "radius_km": 50,
        "always": [{"id": "gironde", "label": "Gironde", "lat": 44.84, "lon": -0.58}],
    }))

    zones = active_zones(load_config(path), danger_rows=[])

    assert len(zones) == 1
    assert zones[0]["id"] == "gironde"
    assert zones[0]["reason"] == "config"
    assert zones[0]["radius_km"] == 50


def test_a_departement_at_high_danger_becomes_active_without_being_pinned(tmp_path):
    path = tmp_path / "zones.json"
    path.write_text(json.dumps({"auto_danger_min": 3, "radius_km": 50, "always": []}))
    rows = [
        {"dep": "83", "name": "Var", "level_today": 4, "lat": 43.4, "lon": 6.2},
        {"dep": "29", "name": "Finistère", "level_today": 1, "lat": 48.2, "lon": -4.1},
    ]

    zones = active_zones(load_config(path), rows)

    assert [z["id"] for z in zones] == ["dep-83"]
    assert zones[0]["reason"] == "danger"


def test_tomorrow_counts_too_because_detail_must_exist_before_the_fire(tmp_path):
    path = tmp_path / "zones.json"
    path.write_text(json.dumps({"auto_danger_min": 3, "radius_km": 50, "always": []}))
    rows = [{"dep": "33", "name": "Gironde", "level_today": 2, "level_tomorrow": 4,
             "lat": 44.84, "lon": -0.58}]

    assert [z["id"] for z in active_zones(load_config(path), rows)] == ["dep-33"]


def test_a_pinned_zone_is_not_duplicated_when_it_also_hits_the_threshold(tmp_path):
    path = tmp_path / "zones.json"
    path.write_text(json.dumps({
        "auto_danger_min": 3, "radius_km": 50,
        "always": [{"id": "dep-33", "label": "Gironde", "lat": 44.84, "lon": -0.58}],
    }))
    rows = [{"dep": "33", "name": "Gironde", "level_today": 4, "lat": 44.84, "lon": -0.58}]

    zones = active_zones(load_config(path), rows)

    assert len(zones) == 1
    assert zones[0]["reason"] == "config"


def test_a_departement_row_with_no_coordinates_is_skipped_not_crashed_on(tmp_path):
    path = tmp_path / "zones.json"
    path.write_text(json.dumps({"auto_danger_min": 3, "radius_km": 50, "always": []}))
    rows = [{"dep": "83", "name": "Var", "level_today": 4}]

    assert active_zones(load_config(path), rows) == []


def test_a_missing_config_still_yields_danger_zones(tmp_path):
    # The config is a convenience. Losing it must not stop the map from building
    # detail where it is actually burning.
    config = load_config(tmp_path / "absent.json")
    rows = [{"dep": "83", "name": "Var", "level_today": 4, "lat": 43.4, "lon": 6.2}]

    assert [z["id"] for z in active_zones(config, rows)] == ["dep-83"]


def test_the_number_of_zones_is_capped(tmp_path):
    # Every zone is a full set of fetches on a 30-minute cron. An August day with
    # 60 departements at level 3 must not turn into 60 zone builds.
    path = tmp_path / "zones.json"
    path.write_text(json.dumps({"auto_danger_min": 3, "radius_km": 50,
                                "max_zones": 6, "always": []}))
    rows = [{"dep": f"{n:02d}", "name": str(n), "level_today": 4,
             "lat": 44.0 + n / 100, "lon": 2.0} for n in range(1, 20)]

    assert len(active_zones(load_config(path), rows)) == 6
