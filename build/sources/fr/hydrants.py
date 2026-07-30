"""Fire hydrants from OpenStreetMap, for ground no register covers.

Gironde publishes no PEI register: searching data.gouv for "points eau incendie" on
2026-07-30 returned seven datasets and none of them is 33. OpenStreetMap holds 1,077
hydrants in a 0.4 by 0.7 degree box around the Saumos fire, so the data exists.

It is not a register, and the difference is not pedantry. The same OSM extract holds
4 fire stations in the whole Gironde bbox against roughly 100 real. A register is
complete for its area, so a gap inside one means something; a gap here means nobody
has mapped that street yet. Shipping these as though they were a register would
reverse the standing decision that water is complete-and-narrow, because the failure
mode of this layer is a firefighter concluding there is no water.

So every point says tier="crowd", and nothing in the build sums crowd and register
into a single total.

The same reasoning is why `available` exists and why it is computed from the body
rather than the status. Measured 2026-07-30: an Overpass query that times out answers
**HTTP 200** with 371 bytes of valid JSON carrying `elements: []` and a `remark`
reading `runtime error: Query timed out`. Trusting the status there would turn a
failed query into a map of no hydrants.
"""
import time

from build.http import FetchError, get_json
# One France box for the whole water layer rather than two that drift apart. It is
# the backstop for every CRS mistake at once: a swapped pair, a projected
# coordinate, a stray 0/0.
from build.sources.fr.water import LAT_MAX, LAT_MIN, LON_MAX, LON_MIN

ENDPOINT = "https://overpass-api.de/api/interpreter"

# Gironde and the coast where the fires are, as (south, west, north, east).
GIRONDE_BBOX = (44.2, -1.4, 45.6, 0.3)

# Overpass is a free volunteer service. Never query it without a bbox and a cap, and
# never without a timeout: the server-side one is what turns an overrunning query
# into an answer we can recognise instead of a dropped connection.
QUERY_TIMEOUT = 90
MAX_POINTS = 20_000

# The HTTP read must outlast the server-side timeout, or a query Overpass would have
# reported on becomes a client-side abort with nothing to read.
HTTP_TIMEOUT = QUERY_TIMEOUT + 30


def query(bbox, timeout=QUERY_TIMEOUT, cap=MAX_POINTS):
    south, west, north, east = bbox
    return (f"[out:json][timeout:{timeout}];"
            f'node["emergency"="fire_hydrant"]({south},{west},{north},{east});'
            f"out body {cap};")


def fetch(session, bbox=GIRONDE_BBOX, cap=MAX_POINTS, sleep=time.sleep):
    """The Overpass body, or None when we could not get one.

    None rather than a raised FetchError because `available=False` is a safety
    property of this layer, and it must not depend on every caller remembering to
    catch. get_json already retries, which covers the 504 Overpass returns when busy.
    """
    try:
        return get_json(session, ENDPOINT, params={"data": query(bbox, cap=cap)},
                        timeout=HTTP_TIMEOUT, sleep=sleep)
    except FetchError:
        return None


def normalize(payload, cap=MAX_POINTS):
    """Crowd-sourced hydrants, or an honest statement that we could not ask.

    `available` false means we do not know what is there. It is not the same as an
    empty list, and the interface must not render it as one.
    """
    out = {"points": [], "coverage": [], "available": False, "truncated": False}
    if not isinstance(payload, dict):
        return out

    # Overpass signals every error this way, on a 200: a timeout, running out of
    # memory, a partial answer. A partial answer is refused rather than published,
    # because there is no way to say "some of the hydrants" on a map.
    if payload.get("remark"):
        return out

    out["available"] = True
    for element in payload.get("elements") or []:
        if len(out["points"]) >= cap:
            out["truncated"] = True
            break
        lat, lon = element.get("lat"), element.get("lon")
        if lat is None or lon is None:
            continue
        if not (LON_MIN <= lon <= LON_MAX and LAT_MIN <= lat <= LAT_MAX):
            continue
        if (element.get("tags") or {}).get("emergency") != "fire_hydrant":
            continue
        out["points"].append({
            "id": f"osm-{element.get('id')}",
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            # The query asks for hydrants and nothing else, and water.py already
            # maps "hydrant" onto "borne". OSM's own pillar/underground/wall
            # wording is a vocabulary the shared renderer does not know.
            "kind": "borne",
            # OSM records flow rate sometimes and stored volume almost never;
            # claiming a capacity we do not have would be worse than admitting none.
            "capacity_m3": None,
            # No INSEE code on an OSM node, and deriving one from the position
            # needs commune boundaries this module does not have.
            "dep": None,
            "source": "osm",
            "tier": "crowd",
        })

    if out["points"]:
        out["coverage"].append({
            "dep": None,
            "area": "OpenStreetMap",
            "scope": "crowd",
            "count": len(out["points"]),
            "tier": "crowd",
        })
    return out
