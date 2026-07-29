"""AROME 1.3 km wind, gusts, temperature and humidity for one point.

Meteo-France's high-resolution model, reached through Open-Meteo's free
endpoint. build/sources/fr/wind.py already fetches wind nationally at ~11 km for
one hour per fire; this is the zone forecast at the resolution a fire responds
to, over the next hours, and it carries gusts.

Gusts are the point. Measured at Lacanau on 2026-07-29: mean 8.8 km/h against
gusts of 32.0. A fire run happens on the gust, not the average.
"""
URL = "https://api.open-meteo.com/v1/meteofrance"
MAX_HOURS = 48

FIELDS = ("wind_speed_10m", "wind_gusts_10m", "wind_direction_10m",
          "temperature_2m", "relative_humidity_2m")

_COMPASS = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")


def wind_toward(direction):
    """The compass point the wind is blowing toward.

    int(x + 0.5) rather than round(), matching public/js/history.js: Python
    rounds halves to even and JavaScript rounds them up, and they disagree on
    exactly the eight boundary bearings.
    """
    if direction is None:
        return None
    return _COMPASS[int(((direction + 180) % 360) / 45 + 0.5) % 8]


def fetch(session, lat, lon, hours=24):
    hours = max(1, min(int(hours), MAX_HOURS))
    response = session.get(URL, timeout=30, params={
        "latitude": round(float(lat), 4),
        "longitude": round(float(lon), 4),
        "hourly": ",".join(FIELDS),
        "models": "arome_france_hd",
        "forecast_days": 2,
        # French civil time, matching atmo.py. UTC would read two hours stale to
        # every French user through the summer.
        "timezone": "Europe/Paris",
    })
    response.raise_for_status()
    return response.json()


def normalize(payload, now=None, hours=MAX_HOURS):
    hourly = (payload or {}).get("hourly") or {}
    times = hourly.get("time")
    if not isinstance(times, list):
        return []

    def col(name):
        values = hourly.get(name)
        return values if isinstance(values, list) else []

    speed, gust = col("wind_speed_10m"), col("wind_gusts_10m")
    direction = col("wind_direction_10m")
    temp, humidity = col("temperature_2m"), col("relative_humidity_2m")

    def at(values, i):
        return values[i] if i < len(values) else None

    rows = []
    for i, stamp in enumerate(times[:max(1, min(int(hours), MAX_HOURS))]):
        bearing = at(direction, i)
        rows.append({
            "time": stamp,
            "wind_kmh": at(speed, i),
            "gust_kmh": at(gust, i),
            "wind_dir": bearing,
            "wind_toward": wind_toward(bearing),
            "temp_c": at(temp, i),
            "humidity_pct": at(humidity, i),
        })
    return rows
