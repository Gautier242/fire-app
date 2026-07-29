"""Aircraft over fires.

ADS-B tells us where an aircraft is, never what it is doing. Nothing here may
claim an aircraft is fighting a fire — only that it is low, slow and close to
one. The map says "aircraft near this fire" because that is all we know.
"""
import pytest

from build.sources.opensky import near_fires, normalize

# states vectors, as OpenSky orders them
def state(icao="abc123", callsign="TANKER42", lon=-120.0, lat=50.0,
          baro=900.0, on_ground=False, velocity=70.0, track=180.0, geo=910.0):
    return [icao, callsign, "Canada", 0, 0, lon, lat, baro,
            on_ground, velocity, track, 0.0, None, geo, None, False, 0]


def test_a_low_flying_aircraft_is_reported_with_metric_and_imperial_altitude():
    out = normalize({"time": 1, "states": [state()]})

    assert len(out) == 1
    assert out[0]["callsign"] == "TANKER42"
    assert out[0]["lat"] == 50.0
    assert out[0]["altitude_ft"] == pytest.approx(2953, abs=2)
    assert out[0]["speed_kt"] == pytest.approx(136, abs=2)
    assert out[0]["track"] == 180.0


def test_airliners_at_cruise_are_not_aircraft_over_a_fire():
    assert normalize({"states": [state(baro=11000.0, geo=11000.0)]}) == []


def test_aircraft_on_the_ground_are_dropped():
    assert normalize({"states": [state(on_ground=True)]}) == []


def test_a_state_with_no_position_is_skipped_not_crashed_on():
    assert normalize({"states": [state(lon=None, lat=None), state()]}) != []
    assert len(normalize({"states": [state(lon=None, lat=None)]})) == 0


def test_a_missing_or_empty_payload_returns_no_aircraft():
    assert normalize({}) == []
    assert normalize({"states": None}) == []


def test_an_unnamed_aircraft_keeps_its_icao_rather_than_inventing_a_callsign():
    out = normalize({"states": [state(callsign="   ")]})
    assert out[0]["callsign"] is None
    assert out[0]["id"] == "abc123"


def test_only_aircraft_close_to_a_known_fire_are_kept():
    fires = [{"lat": 50.0, "lon": -120.0}]
    close = normalize({"states": [state(lat=50.1, lon=-120.1)]})
    far = normalize({"states": [state(lat=54.0, lon=-110.0)]})

    assert len(near_fires(close, fires, km=50)) == 1
    # An aircraft hundreds of km from any fire says nothing about a fire.
    assert near_fires(far, fires, km=50) == []


def test_no_fires_means_no_aircraft_worth_showing():
    assert near_fires(normalize({"states": [state()]}), [], km=50) == []
