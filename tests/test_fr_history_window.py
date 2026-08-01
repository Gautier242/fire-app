"""A trail anchored to the fire, not to the clock.

The seven-day trail rolls: it is indexed from the newest detection observed, so
every build slides the window forward. That is right for "what is burning now"
and wrong for "what happened during the Gironde fire". Six months after the
event, a rolling window shows the six months since and none of the fire.

So a window can be pinned. Given a start, the index grid runs from that hour
regardless of when the build runs, detections outside it are dropped rather than
clamped, and the window stops moving once its fortnight is spent.

Clamping instead of dropping is the failure that matters. It would take heat
from six months after the fire and file it under the fire's last hour, drawing
this summer's stubble burning as part of the Gironde fire.
"""
from datetime import datetime, timedelta, timezone

from build.sources.fr.firms_history import WINDOW_HOURS, normalize

HEADER = ("latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,"
          "confidence,version,bright_ti5,frp,daynight\n")

# The day before the fire, which is where the window starts.
WINDOW_START = datetime(2026, 7, 21, 0, 0, tzinfo=timezone.utc)


def _row(when, frp=50.0, lat=44.8, lon=-0.6):
    return (f"{lat},{lon},330.0,0.4,0.4,{when:%Y-%m-%d},{when:%H%M},N,"
            f"nominal,2.0,290.0,{frp},D\n")


def _csv(*whens):
    return HEADER + "".join(_row(w) for w in whens)


def test_the_window_is_a_fortnight():
    assert WINDOW_HOURS == 14 * 24


def test_the_first_hour_of_the_window_is_index_zero():
    out = normalize(_csv(WINDOW_START), now=WINDOW_START + timedelta(days=1),
                    window_start=WINDOW_START)
    assert [p[2] for p in out["points"]] == [0]


def test_an_hour_into_the_window_is_index_one():
    out = normalize(_csv(WINDOW_START + timedelta(hours=1)),
                    now=WINDOW_START + timedelta(days=1), window_start=WINDOW_START)
    assert [p[2] for p in out["points"]] == [1]


def test_the_last_hour_of_the_fortnight_is_the_last_index():
    last = WINDOW_START + timedelta(hours=WINDOW_HOURS - 1)
    out = normalize(_csv(last), now=last + timedelta(hours=1), window_start=WINDOW_START)
    assert [p[2] for p in out["points"]] == [WINDOW_HOURS - 1]


def test_heat_before_the_window_is_dropped_not_clamped():
    out = normalize(_csv(WINDOW_START - timedelta(hours=1)),
                    now=WINDOW_START + timedelta(days=1), window_start=WINDOW_START)
    assert out["points"] == []


def test_heat_after_the_window_is_dropped_not_clamped():
    """The whole point. Six months on, today's heat is not the fire's last hour."""
    later = WINDOW_START + timedelta(days=180)
    out = normalize(_csv(later), now=later + timedelta(hours=1),
                    window_start=WINDOW_START)
    assert out["points"] == []


def test_the_window_does_not_move_when_the_build_does():
    """Same detections, two builds six months apart, identical indices."""
    during = WINDOW_START + timedelta(days=3, hours=7)
    soon = normalize(_csv(during), now=during + timedelta(hours=2),
                     window_start=WINDOW_START)
    much_later = normalize(_csv(during), now=during + timedelta(days=180),
                           window_start=WINDOW_START)
    assert soon["points"] == much_later["points"]
    assert soon["window_start"] == much_later["window_start"]


def test_the_payload_states_the_window_it_used():
    out = normalize(_csv(WINDOW_START), now=WINDOW_START + timedelta(days=1),
                    window_start=WINDOW_START)
    assert out["window_start"] == "2026-07-21T00:00:00Z"
    assert out["hours"] == WINDOW_HOURS


def test_without_a_window_the_trail_still_rolls():
    """The national trail is unchanged: no window means anchored on the newest hour."""
    newest = datetime(2026, 7, 29, 12, 0, tzinfo=timezone.utc)
    out = normalize(_csv(newest, newest - timedelta(hours=1)),
                    now=newest + timedelta(hours=1))
    assert out.get("window_start") is None
    assert max(p[2] for p in out["points"]) == out["hours"] - 1
