"""AROME 1.3 km wind for a zone.

Meteo-France's high-resolution model, reached through Open-Meteo. Gusts matter
more than mean wind: measured at Lacanau, mean 8.8 km/h against gusts of 32.0.
A fire run happens on the gust.
"""
import json
from pathlib import Path

from build.sources.fr import arome

PAYLOAD = json.loads(Path("tests/fixtures/arome.json").read_text())


def test_hours_are_returned_in_order_with_gusts():
    rows = arome.normalize(PAYLOAD)

    assert len(rows) >= 24
    assert rows[0]["time"] < rows[-1]["time"]
    assert any(r["gust_kmh"] is not None for r in rows)


def test_wind_toward_is_the_reciprocal_of_the_reported_direction():
    # Meteorology reports where wind comes FROM. For a fire the useful half is
    # where it is going. public/js/history.js holds the same convention for
    # Canada and the two must never disagree.
    rows = arome.normalize({"hourly": {
        "time": ["2026-07-29T14:00"], "wind_speed_10m": [10.0],
        "wind_gusts_10m": [25.0], "wind_direction_10m": [270],
        "temperature_2m": [30.0], "relative_humidity_2m": [25],
    }})

    assert rows[0]["wind_dir"] == 270
    assert rows[0]["wind_toward"] == "E"


def test_a_null_reading_stays_null_and_never_becomes_zero():
    # Calm and unknown are different. A fabricated 0 km/h reads as "no wind" when
    # we simply do not know, and the spread model would treat it as fact.
    rows = arome.normalize({"hourly": {
        "time": ["2026-07-29T14:00"], "wind_speed_10m": [None],
        "wind_gusts_10m": [None], "wind_direction_10m": [None],
        "temperature_2m": [None], "relative_humidity_2m": [None],
    }})

    assert rows[0]["wind_kmh"] is None
    assert rows[0]["gust_kmh"] is None
    assert rows[0]["wind_toward"] is None


def test_a_malformed_payload_returns_no_rows_rather_than_raising():
    for payload in (None, {}, {"hourly": None}, {"hourly": {"time": None}}):
        assert arome.normalize(payload) == []


def test_the_requested_hour_count_is_bounded():
    rows = arome.normalize(PAYLOAD, hours=6)
    assert len(rows) == 6
