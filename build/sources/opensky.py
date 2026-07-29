"""Aircraft near active fires, from the OpenSky Network.

ADS-B reports where an aircraft is, never what it is doing. Nothing here decides
that an aircraft is fighting a fire — it reports that one is flying low near a
known fire, which is all the data supports. The frontend must say the same.

Budget: the free tier allows 4000 credits a day and a Canada-wide bounding box
costs 4 per call. A five-minute refresh spends 1152 a day and fits; a
thirty-second refresh would spend 23000 and be cut off before lunch. Air tankers
are not something anyone should evacuate on, so five minutes is honest.
"""
import math
import os

TOKEN_URL = ("https://auth.opensky-network.org/auth/realms/opensky-network"
             "/protocol/openid-connect/token")
STATES_URL = "https://opensky-network.org/api/states/all"

# Canada, as a bounding box. Costs 4 credits per call.
BBOX = {"lamin": 41.0, "lamax": 84.0, "lomin": -141.0, "lomax": -52.0}

# Airliners cruise near 11 000 m. Firefighting aircraft work far below that, and
# so does anything on approach — proximity to a fire does the rest of the work.
MAX_ALTITUDE_M = 3500.0

# How close an aircraft must be to a known fire to be worth drawing at all.
NEAR_FIRE_KM = 50.0

M_TO_FT = 3.28084
MS_TO_KT = 1.94384
EARTH_KM = 6371.0

# states vector indices, per the OpenSky API
ICAO, CALLSIGN, LON, LAT, BARO, ON_GROUND, VELOCITY, TRACK = 0, 1, 5, 6, 7, 8, 9, 10


def token(session, client_id=None, client_secret=None):
    """Exchange client credentials for a bearer token.

    Credentials come from the environment so they stay in CI secrets and never
    reach the repository.
    """
    client_id = client_id or os.environ.get("OPENSKY_CLIENT_ID")
    client_secret = client_secret or os.environ.get("OPENSKY_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise RuntimeError("OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET are required")

    response = session.post(TOKEN_URL, data={
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
    }, timeout=30)
    response.raise_for_status()
    return response.json()["access_token"]


def fetch(session, access_token=None):
    access_token = access_token or token(session)
    response = session.get(STATES_URL, params=BBOX, timeout=30,
                           headers={"Authorization": f"Bearer {access_token}"})
    response.raise_for_status()
    return response.json()


def normalize(payload):
    """Low-flying aircraft with a known position. Anything else is dropped."""
    aircraft = []
    for state in (payload or {}).get("states") or []:
        try:
            lon, lat = state[LON], state[LAT]
            if lon is None or lat is None or state[ON_GROUND]:
                continue
            altitude = state[BARO]
            if altitude is None or altitude > MAX_ALTITUDE_M:
                continue
            callsign = (state[CALLSIGN] or "").strip() or None
            aircraft.append({
                "id": state[ICAO],
                "callsign": callsign,
                "lat": lat,
                "lon": lon,
                "altitude_ft": round(altitude * M_TO_FT),
                "speed_kt": round(state[VELOCITY] * MS_TO_KT) if state[VELOCITY] else None,
                "track": state[TRACK],
                "source": "opensky",
            })
        except (IndexError, TypeError):
            continue  # one malformed vector must not lose the rest
    return aircraft


def _km_between(a_lat, a_lon, b_lat, b_lon):
    phi1, phi2 = math.radians(a_lat), math.radians(b_lat)
    d_phi = math.radians(b_lat - a_lat)
    d_lambda = math.radians(b_lon - a_lon)
    h = (math.sin(d_phi / 2) ** 2
         + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2)
    return 2 * EARTH_KM * math.asin(math.sqrt(h))


def near_fires(aircraft, fires, km=NEAR_FIRE_KM):
    """Keep only aircraft within km of a known fire.

    Without this the layer is every light aircraft and every approach in the
    country, which tells a reader nothing about a fire.
    """
    if not fires:
        return []
    kept = []
    for plane in aircraft:
        for fire in fires:
            if fire.get("lat") is None or fire.get("lon") is None:
                continue
            if _km_between(plane["lat"], plane["lon"], fire["lat"], fire["lon"]) <= km:
                kept.append(plane)
                break
    return kept
