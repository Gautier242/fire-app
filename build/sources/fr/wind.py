"""The wind at each fire incident, from Open-Meteo.

Full fire-behaviour modelling was deferred on purpose, so the observed wind is
the whole of what this app is allowed to say about where a fire is going. Two
things therefore have to be right. The hour must be the current one — the
forecast array starts at midnight and index 0 would report last night's calm
over an afternoon fire. And an unknown must never arrive as a number: 0 km/h
reads as a still day, and a fabricated direction points somebody the wrong way
down a road.

`wind_dir` is meteorological, the direction the wind comes FROM. `wind_toward`
is where it is blowing TO, which is the half that matters when it is carrying a
fire at you. The conversion is the one `public/js/history.js` already applies to
Canadian wind, reproduced here so the two countries can never disagree.

Open-Meteo is free and unauthenticated, so the build owes it restraint. Every
point travels in one call: the endpoint accepts comma-separated coordinates,
and 400 of them fit. The real ceiling is not a documented point limit but
nginx's 8 KB request line — measured 2026-07-29 by binary search, 8203 URL
bytes accepted and 8204 refused with a 414. That makes the limit depend on how
long the coordinates are: 501 points at one decimal passed, while 500 points at
six decimals overran it. `MAX_POINTS` is set well under the shortest of those
so no coordinate format can walk the build into a 414. Probing this also earned
a 429, which is the other reason there is exactly one call and no retry loop of
our own.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

from build.http import get_json

URL = "https://api.open-meteo.com/v1/forecast"
HOURLY = "wind_speed_10m,wind_direction_10m,temperature_2m,relative_humidity_2m"
FORECAST_DAYS = 2

# 425 French coordinate pairs overrun the 8 KB request line; 400 fit in 7,792
# bytes. Half of that is ample for a map that has never had more than a few
# dozen incidents, and leaves room for longer coordinates than we send today.
MAX_POINTS = 200

# The hours are asked for and read back in French civil time, matching
# build/sources/fr/atmo.py. A record labelled in UTC would be two hours stale
# to every reader of the map through a French summer.
PARIS = ZoneInfo("Europe/Paris")

COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


def fetch(session, points, cap=MAX_POINTS):
    """One call for every point. `points` is an iterable of (lat, lon).

    Returns the payload unchanged: an object for a single point, a list of them
    for several. Beyond `cap` the tail is dropped rather than split into a
    second call, so callers should pass their most significant incidents first.
    """
    points = list(points)[:cap]
    if not points:
        return []
    return get_json(session, URL, params={
        "latitude": ",".join(f"{lat:.4f}" for lat, _lon in points),
        "longitude": ",".join(f"{lon:.4f}" for _lat, lon in points),
        "hourly": HOURLY,
        "timezone": "Europe/Paris",
        "forecast_days": FORECAST_DAYS,
    })


def wind_toward(direction):
    """The compass point the wind is blowing toward, or None if unknown.

    public/js/history.js: COMPASS[Math.round(((d + 180) % 360) / 45) % 8].
    Python's round() breaks ties to even where JavaScript's rounds half up, and
    the two disagree on exactly the eight bearings that sit on a boundary — a
    wind from 202.5 blows toward NE in Canada and would blow toward N here.
    int(x + 0.5) is the JavaScript rule.
    """
    if not isinstance(direction, (int, float)) or isinstance(direction, bool):
        return None
    return COMPASS[int(((direction + 180) % 360) / 45 + 0.5) % 8]


def _number(value):
    """A reading, or None. A missing reading is never a zero one."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _coordinate(value):
    return round(value, 4) if isinstance(value, (int, float)) else None


def _hour_index(times, now):
    wanted = now.strftime("%Y-%m-%dT%H:00")
    for index, value in enumerate(times):
        if value == wanted:
            return index
    return None


def _is_point(point):
    """Whether an entry is a forecast for somewhere, however unreadable."""
    hourly = point.get("hourly") if isinstance(point, dict) else None
    return isinstance(hourly, dict) and isinstance(hourly.get("time"), list)


def _record(point, now):
    """One point, always — an unreadable one empties its fields, not the row.

    Callers match these against their incidents by position, so dropping a row
    would silently shift every wind after it onto the wrong fire.
    """
    if not isinstance(point, dict):
        point = {}
    hourly = point.get("hourly")
    hourly = hourly if isinstance(hourly, dict) else {}
    times = hourly.get("time")
    index = _hour_index(times, now) if isinstance(times, list) else None

    def at(key):
        values = hourly.get(key)
        if index is None or not isinstance(values, list) or index >= len(values):
            return None
        return _number(values[index])

    direction = at("wind_direction_10m")
    return {
        # Open-Meteo echoes the coordinate it actually answered for, which is
        # the requested one to within float32 noise. Reporting its answer
        # rather than our question keeps the record honest about where the
        # reading applies.
        "lat": _coordinate(point.get("latitude")),
        "lon": _coordinate(point.get("longitude")),
        "observed_at": (datetime.fromisoformat(times[index])
                        .replace(tzinfo=PARIS).isoformat()
                        if index is not None else None),
        "wind_kmh": at("wind_speed_10m"),
        "wind_dir": direction,
        "wind_toward": wind_toward(direction),
        "temp_c": at("temperature_2m"),
        "humidity_pct": at("relative_humidity_2m"),
        "source": "open_meteo",
    }


def normalize(payload, now=None):
    """One record per requested point, in request order.

    `now` is injected so the hour selection is testable; it defaults to the
    current French civil hour.
    """
    now = now or datetime.now(PARIS)
    if isinstance(payload, dict):
        payload = [payload]
    if not isinstance(payload, list):
        return []
    # A payload holding no forecast at all — an error object, or nothing —
    # produces no records. One bad entry among good ones keeps its place,
    # because callers match records to incidents by position.
    if not any(_is_point(point) for point in payload):
        return []
    return [_record(point, now) for point in payload]
