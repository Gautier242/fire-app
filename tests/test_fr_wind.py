"""The wind at each fire incident.

The wind is the whole of what this app is allowed to say about where a fire is
going — full fire-behaviour modelling was deliberately deferred. That puts the
weight on two things being right: the hour must be the current one, and an
unknown must never arrive as a number.
"""
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from build.sources.fr import wind

FIXTURE = json.loads(Path("tests/fixtures/fr_wind.json").read_text())
PARIS = ZoneInfo("Europe/Paris")

LACANAU = (44.86, -0.87)
TOULON = (43.12, 5.93)


def _hours(start="2026-07-29T00:00", count=24):
    day, hour = start.split("T")
    first = int(hour.split(":")[0])
    return [f"{day}T{(first + i) % 24:02d}:00" for i in range(count)]


def _point(lat=44.86, lon=-0.87, times=None, speed=None, direction=None,
           temp=None, humidity=None):
    times = times or _hours()
    n = len(times)
    return {
        "latitude": lat,
        "longitude": lon,
        "utc_offset_seconds": 7200,
        "timezone": "Europe/Paris",
        "hourly_units": {"wind_speed_10m": "km/h", "wind_direction_10m": "°"},
        "hourly": {
            "time": times,
            "wind_speed_10m": speed if speed is not None else [float(i) for i in range(n)],
            "wind_direction_10m": direction if direction is not None else [90.0] * n,
            "temperature_2m": temp if temp is not None else [20.0] * n,
            "relative_humidity_2m": humidity if humidity is not None else [50.0] * n,
        },
    }


def _at(hour):
    return datetime(2026, 7, 29, hour, 37, tzinfo=PARIS)


class _Response:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


class _Session:
    """Records every network call the fetcher makes."""

    def __init__(self, payload=None):
        self.calls = []
        self.payload = payload if payload is not None else []

    def get(self, url, params=None, timeout=None):
        self.calls.append((url, params))
        return _Response(self.payload)


# --- fetch: one call, bounded ---------------------------------------------
# Open-Meteo is free and unauthenticated. The build gets one batched call and
# an explicit ceiling; the measured limit is nginx's 8 KB request line, which
# at French coordinates is a little over 400 points.

def test_no_points_makes_no_network_call():
    # An empty France box is the normal case at 04:00 in February. Asking a
    # free service for the weather at nowhere is rude and pointless.
    session = _Session()
    assert wind.fetch(session, []) == []
    assert session.calls == []


def test_every_point_travels_in_a_single_call():
    session = _Session()
    wind.fetch(session, [LACANAU, TOULON])
    assert len(session.calls) == 1
    _url, params = session.calls[0]
    assert params["latitude"] == "44.8600,43.1200"
    assert params["longitude"] == "-0.8700,5.9300"


def test_the_request_is_bounded_by_an_explicit_cap():
    session = _Session()
    wind.fetch(session, [LACANAU] * 50, cap=3)
    _url, params = session.calls[0]
    assert params["latitude"].count(",") == 2


def test_the_default_cap_stays_under_the_measured_url_ceiling():
    # 8203 URL bytes is the last length the server accepts; 425 French
    # coordinate pairs overrun it. The default leaves room to spare.
    assert 0 < wind.MAX_POINTS <= 400


def test_the_hours_are_asked_for_in_french_local_time():
    # The record is read on a French map. An hour labelled in UTC would be two
    # hours stale to every reader of it in summer.
    session = _Session()
    wind.fetch(session, [LACANAU])
    _url, params = session.calls[0]
    assert params["timezone"] == "Europe/Paris"


# --- the current hour ------------------------------------------------------

def test_the_current_hour_is_used_not_the_first_one():
    # The array starts at midnight. Reading index 0 would report the calm of
    # last night over an afternoon fire.
    record = wind.normalize(_point(), now=_at(14))[0]
    assert record["observed_at"].startswith("2026-07-29T14:00")
    assert record["wind_kmh"] == 14.0


def test_the_reported_hour_carries_its_timezone():
    record = wind.normalize(_point(), now=_at(14))[0]
    assert record["observed_at"] == "2026-07-29T14:00:00+02:00"


def test_an_hour_missing_from_the_forecast_reads_as_unknown():
    # One record per point always comes back, in request order, so a caller can
    # zip it against its incidents. A gap empties the fields, never the row.
    record = wind.normalize(_point(times=_hours(count=6)), now=_at(14))[0]
    assert record["lat"] == 44.86
    assert record["wind_kmh"] is None
    assert record["wind_dir"] is None
    assert record["wind_toward"] is None
    assert record["observed_at"] is None


# --- which way it is blowing ----------------------------------------------
# public/js/history.js: COMPASS[Math.round(((d + 180) % 360) / 45) % 8]
# Values below were read out of that function, not derived from it.

def test_wind_toward_is_where_the_wind_is_going_not_where_it_is_from():
    record = wind.normalize(_point(direction=[90.0] * 24), now=_at(14))[0]
    assert record["wind_dir"] == 90.0
    assert record["wind_toward"] == "W"


def test_wind_toward_matches_the_canadian_conversion_exactly():
    for direction, toward in [(0, "S"), (22, "S"), (22.5, "SW"), (45, "SW"),
                              (67.5, "W"), (90, "W"), (135, "NW"), (180, "N"),
                              (202.5, "NE"), (225, "NE"), (270, "E"),
                              (315, "SE"), (337.5, "S"), (348, "S"),
                              (359, "S"), (360, "S")]:
        record = wind.normalize(_point(direction=[direction] * 24), now=_at(14))[0]
        assert record["wind_toward"] == toward, f"{direction} should blow toward {toward}"


# --- unknown is not a number ----------------------------------------------

def test_a_missing_wind_reads_as_unknown_not_as_calm():
    # 0 km/h is a still afternoon. None is a satellite we could not read. A
    # fabricated direction points somebody the wrong way down a road.
    speed = [None] * 24
    direction = [None] * 24
    record = wind.normalize(_point(speed=speed, direction=direction), now=_at(14))[0]
    assert record["wind_kmh"] is None
    assert record["wind_dir"] is None
    assert record["wind_toward"] is None


def test_a_known_speed_survives_an_unknown_direction():
    record = wind.normalize(
        _point(speed=[18.0] * 24, direction=[None] * 24), now=_at(14))[0]
    assert record["wind_kmh"] == 18.0
    assert record["wind_dir"] is None
    assert record["wind_toward"] is None


def test_a_calm_hour_is_reported_as_calm():
    record = wind.normalize(_point(speed=[0.0] * 24), now=_at(14))[0]
    assert record["wind_kmh"] == 0.0


def test_temperature_and_humidity_are_unknown_rather_than_zero():
    record = wind.normalize(
        _point(temp=[None] * 24, humidity=[None] * 24), now=_at(14))[0]
    assert record["temp_c"] is None
    assert record["humidity_pct"] is None


# --- payload shapes --------------------------------------------------------
# One point returns an object. Two or more return a list of them.

def test_a_single_point_payload_is_one_record():
    records = wind.normalize(_point(), now=_at(14))
    assert len(records) == 1


def test_a_multi_point_payload_keeps_request_order():
    payload = [_point(lat=44.86, lon=-0.87), _point(lat=43.12, lon=5.93)]
    records = wind.normalize(payload, now=_at(14))
    assert [(r["lat"], r["lon"]) for r in records] == [(44.86, -0.87), (43.12, 5.93)]


def test_both_live_payload_shapes_normalize():
    single = wind.normalize(FIXTURE["single"], now=_at(14))
    multi = wind.normalize(FIXTURE["multi"], now=_at(14))
    assert len(single) == 1
    assert len(multi) == 2
    assert (multi[0]["lat"], multi[0]["lon"]) == LACANAU
    assert (multi[1]["lat"], multi[1]["lon"]) == TOULON
    for record in single + multi:
        assert record["wind_kmh"] is not None
        assert record["wind_toward"] in {"N", "NE", "E", "SE", "S", "SW", "W", "NW"}


def test_a_record_carries_the_agreed_shape():
    record = wind.normalize(_point(speed=[18.0] * 24, direction=[45.0] * 24,
                                   temp=[31.2] * 24, humidity=[28.0] * 24),
                            now=_at(14))[0]
    assert record == {
        "lat": 44.86,
        "lon": -0.87,
        "observed_at": "2026-07-29T14:00:00+02:00",
        "wind_kmh": 18.0,
        "wind_dir": 45.0,
        "wind_toward": "SW",
        "temp_c": 31.2,
        "humidity_pct": 28.0,
        "source": "open_meteo",
    }


# --- malformed input -------------------------------------------------------
# A build must not die because a free service answered badly.

def test_a_malformed_response_yields_no_records_rather_than_raising():
    # Nothing in any of these is a point, so there is nothing to report on.
    for payload in [None, {}, [], "", 7, {"hourly": None}, {"hourly": {}},
                    {"hourly": {"time": None}},
                    {"error": True, "reason": "bad latitude"},
                    [{"nonsense": 1}, None]]:
        assert wind.normalize(payload, now=_at(14)) == [], payload


def test_one_unreadable_point_does_not_shift_the_others():
    # Records are matched to incidents by position. Dropping a row would move
    # every wind after it onto the wrong fire, which is worse than a blank.
    records = wind.normalize([_point(lat=44.86, lon=-0.87), {"nonsense": 1},
                              _point(lat=43.12, lon=5.93)], now=_at(14))
    assert [r["lat"] for r in records] == [44.86, None, 43.12]
    assert records[1]["wind_kmh"] is None


def test_a_point_without_coordinates_is_not_given_invented_ones():
    records = wind.normalize({"hourly": {"time": _hours()}}, now=_at(14))
    assert records == [] or records[0]["lat"] is None
