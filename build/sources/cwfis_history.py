"""72 hours of satellite hotspot detections, for replaying how a fire moved.

Each detection carries the modelled weather at its hour, so the scrubber can
show why the fire moved and not merely that it did.

Two things about this layer bite hard:

- It is continental, not Canadian. `agency` is a mix of country and US state
  codes ("CA" is California, not Canada), so it cannot be used to select
  Canada. Position is the only reliable filter.
- Its native CRS is EPSG:3978 (metres). Without srsName every "longitude"
  comes back six digits wide.

Never query it without the date filter: unfiltered it is the whole season,
roughly 17.9 million features.
"""
import math
from datetime import datetime, timedelta, timezone
from statistics import median

from build.http import get_json

WFS_URL = "https://cwfis.cfs.nrcan.gc.ca/geoserver/ows"
LAYER = "public:hotspots"
SRS = "EPSG:4326"
HOURS = 72
MAX_FEATURES = 40000

# A bound, not a border: this rectangle reaches well into the western US, so
# Oregon and Idaho hotspots survive it. It exists to cap the query and to catch
# a wrong CRS, not to draw a coastline.
# ponytail: bounding box, not a real boundary. Upgrade to a coastline test only
# if US detections actually confuse people on the map.
LON_MIN, LON_MAX = -141.0, -52.0
LAT_MIN, LAT_MAX = 41.0, 84.0

# Head fire intensity in kW/m, cut on the Canadian Forest Fire Behaviour
# Prediction System's published intensity classes. 2000 is where hand crews
# with water can no longer hold a line; 10000 is the class 6 floor, where fire
# crowns and spots and control is not expected to succeed.
BAND_CUTS = (2000, 10000)


def fetch(session, hours=HOURS, count=MAX_FEATURES):
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    return get_json(session, WFS_URL, params={
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": LAYER,
        "outputFormat": "application/json",
        "srsName": SRS,
        "count": count,
        # BBOX() over this layer's geometry returns nothing and the standalone
        # bbox parameter is rejected alongside cql_filter, so bound the query
        # on the lat/lon columns the layer already publishes.
        "CQL_FILTER": (
            f"rep_date AFTER {since.strftime('%Y-%m-%dT%H:%M:%SZ')}"
            f" AND lat > {LAT_MIN} AND lat < {LAT_MAX}"
            f" AND lon > {LON_MIN} AND lon < {LON_MAX}"
        ),
    })


def _hour(properties):
    """Top of the hour a detection was reported in, or None if unusable."""
    raw = properties.get("rep_date")
    if not isinstance(raw, str):
        return None
    try:
        stamp = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)


def _position(geometry):
    if not geometry or geometry.get("type") != "Point":
        return None
    coords = geometry.get("coordinates") or []
    if len(coords) < 2:
        return None
    lon, lat = coords[0], coords[1]
    if not isinstance(lon, (int, float)) or not isinstance(lat, (int, float)):
        return None
    if not (LON_MIN <= lon <= LON_MAX and LAT_MIN <= lat <= LAT_MAX):
        return None
    return lon, lat


def _band(hfi):
    if not isinstance(hfi, (int, float)):
        return 0
    return sum(hfi >= cut for cut in BAND_CUTS)


def _wind(properties):
    speed, direction = properties.get("ws"), properties.get("wd")
    if not isinstance(speed, (int, float)) or not isinstance(direction, (int, float)):
        return None
    if speed < 0:
        return None
    return float(speed), float(direction)


def _representative(readings):
    """One wind per hour: median speed, vector-mean direction.

    Directions must be averaged as vectors. Treating them as plain numbers puts
    the mean of 350 and 10 at due south, which would draw the arrow backwards.
    """
    speed = median(s for s, _ in readings)
    east = sum(math.sin(math.radians(d)) for _, d in readings)
    north = sum(math.cos(math.radians(d)) for _, d in readings)
    direction = round(math.degrees(math.atan2(east, north))) % 360
    return [round(speed), direction]


def normalize(payload):
    """Points and per-hour wind, indexed 0..71 with 71 the most recent hour."""
    detections = []
    for feature in payload.get("features") or []:
        properties = feature.get("properties") or {}
        hour = _hour(properties)
        position = _position(feature.get("geometry"))
        if hour is None or position is None:
            continue
        detections.append((hour, position, _band(properties.get("hfi")),
                           _wind(properties)))

    if not detections:
        return {"generated_at": None, "hours": HOURS, "points": [], "wind": []}

    # Index against the newest hour present rather than the wall clock, so the
    # scrubber's right-hand end is always the last hour we actually observed.
    anchor = max(hour for hour, _, _, _ in detections)

    points, by_hour = [], {}
    for hour, (lon, lat), band, wind in detections:
        index = HOURS - 1 - int((anchor - hour).total_seconds() // 3600)
        if not 0 <= index < HOURS:
            continue
        points.append([round(lon, 3), round(lat, 3), index, band])
        if wind is not None:
            by_hour.setdefault(index, []).append(wind)

    wind = [[index] + _representative(by_hour[index]) for index in sorted(by_hour)]
    return {
        "generated_at": anchor.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "hours": HOURS,
        "points": points,
        "wind": wind,
    }
