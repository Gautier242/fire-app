import json
from pathlib import Path

from build.sources.bc_roads import classify, is_travel_stopping, normalize, road_name

FIXTURE = json.loads(Path("tests/fixtures/bc_roads.json").read_text())


def event(**kwargs):
    """A minimal ACTIVE event, overridable field by field."""
    base = {
        "id": "drivebc.ca/DBC-1",
        "event_type": "INCIDENT",
        "event_subtypes": ["FIRE"],
        "severity": "MAJOR",
        "status": "ACTIVE",
        "headline": "INCIDENT",
        "description": "Test Rd, in both directions. Road closed.",
        "geography": {"type": "Point", "coordinates": [-121.9, 51.1]},
        "roads": [{"name": "Other Roads", "from": "A Rd", "direction": "BOTH"}],
        "url": "https://api.open511.gov.bc.ca/events/drivebc.ca/DBC-1",
    }
    base.update(kwargs)
    return base


# --- classify -------------------------------------------------------------

def test_classify_reads_the_road_state_field_when_present():
    assert classify("CLOSED", "") == "closed"
    assert classify("ALL_LANES_OPEN", "Expect delays.") == "restricted"


def test_classify_reads_closure_wording_when_state_is_missing():
    # The wildfire closures in this feed carry no state at all; the only
    # closure signal they have is the sentence "Road closed."
    assert classify(None, "There is a wildfire between A and B. Road closed.") == "closed"
    assert classify(None, "Johnston Bridge. Bridge is closed.") == "closed"
    assert classify(None, "Wildfire. Closed.") == "closed"
    assert classify(None, "Big Bar Reaction Ferry. Ferry route closed.") == "closed"


def test_classify_recognises_wording_that_only_restricts_travel():
    assert classify(None, "Vehicle incident. Right lane blocked.") == "restricted"
    assert classify(None, "Wildfire. Expect delays. Watch for traffic control.") == "restricted"
    assert classify(None, "Washout. Single lane alternating traffic.") == "restricted"


def test_classify_defaults_unrecognised_wording_to_closed():
    # Saying a road is shut when it is merely slow costs a detour. The reverse
    # routes someone into a fire, so unknown wording fails towards "closed".
    assert classify(None, "Something nobody has phrased this way before") == "closed"
    assert classify(None, "") == "closed"
    assert classify(None, None) == "closed"


def test_closure_wording_beats_restriction_wording_in_the_same_text():
    # "Road closed" alongside "expect delays" must not be read as a restriction.
    assert classify(None, "Road closed. Expect delays. Detour in effect.") == "closed"


# --- is_travel_stopping ---------------------------------------------------

def test_major_incidents_stop_travel():
    assert is_travel_stopping(event(event_type="INCIDENT", severity="MAJOR"), None)


def test_minor_incidents_are_not_closures():
    assert not is_travel_stopping(event(severity="MINOR"), None)
    # The feed's own trap: a MINOR rest-area notice reading "Washrooms closed."
    assert not is_travel_stopping(
        event(severity="MINOR", description="Washrooms closed."), "ALL_LANES_OPEN")


def test_construction_is_not_a_closure_unless_the_road_is_actually_shut():
    assert not is_travel_stopping(event(event_type="CONSTRUCTION"), "ALL_LANES_OPEN")
    assert not is_travel_stopping(event(event_type="CONSTRUCTION"), None)
    # Overnight paving is roadworks noise even when the road is shut.
    assert not is_travel_stopping(
        event(event_type="CONSTRUCTION", severity="MINOR"), "CLOSED")
    # A major bridge closure stops travel whatever caused it.
    assert is_travel_stopping(event(event_type="CONSTRUCTION", severity="MAJOR"), "CLOSED")


def test_a_closed_road_stops_travel_even_when_not_flagged_major():
    assert is_travel_stopping(event(event_type="INCIDENT", severity="MINOR"), "CLOSED")


# --- road_name ------------------------------------------------------------

def test_road_name_prefers_the_named_route():
    assert road_name([{"name": "Highway 97"}], "Highway 97. Road closed.") == "Highway 97"


def test_road_name_falls_back_to_the_description_when_the_route_is_generic():
    # "Other Roads" is the feed's placeholder; the road is in the first sentence.
    assert road_name(
        [{"name": "Other Roads", "from": "Big Bar Rd"}],
        "Jesmond Rd, in both directions. There is a wildfire.") == "Jesmond Rd"


def test_road_name_uses_the_extent_when_the_description_names_no_road():
    assert road_name(
        [{"name": "Other Roads", "from": "Chaumox Road"}],
        "Wildfire. Closed.") == "Chaumox Road"


def test_road_name_ignores_a_first_sentence_that_names_the_work_not_the_road():
    # "Bridge maintenance" and "Road maintenance" both contain a road token but
    # name the job, not the place a driver is trying to get through.
    assert road_name(
        [{"name": "Other Roads", "from": "Kicking Horse Drive"}],
        "Bridge maintenance. Bridge closed.") == "Kicking Horse Drive"
    assert road_name(
        [{"name": "Other Roads", "from": "NW Marine Drive"}],
        "Road maintenance. Closed. Culvert replacement.") == "NW Marine Drive"


def test_road_name_never_returns_empty():
    assert road_name([], "")
    assert road_name([{"name": "Other Roads"}], "Wildfire. Closed.")


# --- normalize ------------------------------------------------------------

def test_normalize_returns_one_record_per_usable_event():
    payload = {"events": [
        event(id="a"),
        event(id="b", description="Cave Road. Landslide. Road closed."),
        event(id="c", severity="MINOR", event_type="CONSTRUCTION"),  # roadworks
    ]}
    records = normalize(payload)
    assert [r["id"] for r in records] == ["a", "b"]


def test_records_carry_the_full_contract():
    for record in normalize({"events": [event()]}):
        assert set(record) == {"id", "kind", "name", "headline", "severity",
                               "geometry", "url", "source"}
        assert record["kind"] in {"closed", "restricted"}
        assert record["source"] == "bc_roads"
        assert record["name"]
        assert record["headline"]


def test_normalize_skips_events_without_geography():
    assert normalize({"events": [event(geography=None)]}) == []
    assert normalize({"events": [event(geography={})]}) == []


def test_normalize_skips_geometry_outside_british_columbia():
    assert normalize({"events": [
        event(geography={"type": "Point", "coordinates": [-79.4, 43.7]}),  # Toronto
    ]}) == []


def test_normalize_returns_empty_list_for_an_empty_feed():
    assert normalize({"events": []}) == []
    assert normalize({}) == []


# --- the real feed --------------------------------------------------------

def test_fixture_yields_records_and_every_one_sits_inside_bc():
    records = normalize(FIXTURE)
    assert records, "the fixture should contain at least one travel-stopping event"
    for record in records:
        for lon, lat in coordinates(record["geometry"]):
            assert -141.0 <= lon <= -114.0, record["name"]
            assert 48.0 <= lat <= 60.0, record["name"]


def test_fixture_surfaces_no_routine_roadworks():
    for record in normalize(FIXTURE):
        assert "Starting" not in record["headline"] or record["kind"] == "closed"


def coordinates(geometry):
    coords = geometry["coordinates"]
    return [coords] if geometry["type"] == "Point" else coords
