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

# How many points may be published, and how they are shed when there are more.
#
# On 2026-08-29 a busy day produced 172 KB gzipped against history.json's 150 KB
# budget. The build failed on it, and since the Pages deploy uploads public/ as
# a single artifact, the whole site -- Canada and France -- stopped refreshing
# for the day. The layer was unbounded: MAX_FEATURES lets 40,000 detections
# through, and 40,000 detections cannot fit the budget however they are written.
#
# 20,000 points is 131 KB gzipped even for points scattered across the bbox with
# no digits in common, which is the worst gzip can do here; real detections
# cluster into fires and cost about 5 bytes each.
MAX_POINTS = 20000

# Merge detections onto a grid, finest first. 3 decimal places is 110 m, finer
# than anything that saw these (VIIRS 375 m, MODIS 1 km), so that pass costs no
# resolution a reader could perceive -- it removes only the same ground seen
# twice in one hour. 2 places is 1.1 km, at the sensors' own footprint, and is
# used only when a day needs it. Coarser than that would smear a fire front, so
# the last resort is dropping whole old hours instead.
GRIDS = (3, 2)


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


def _grid(rows, places):
    """One cell per place per hour, keeping the strongest reading in it.

    The strongest, never the first or the mean: merging must not turn a
    crowning fire into a smouldering one.
    """
    cells = {}
    for lon, lat, index, band in rows:
        key = (round(lon, places), round(lat, places), index)
        cells[key] = max(cells.get(key, band), band)
    return cells


def _newest(cells, cap):
    """Whole hours off the old end until what is left fits.

    Whole hours, because the scrubber steps through observed passes: a dropped
    hour is one fewer stop at the left of the slider, while a pass drawn from a
    random subset of its own detections would understate how far the fire had
    reached by then.
    """
    kept = {}
    for index in sorted({key[2] for key in cells}, reverse=True):
        hour = {key: band for key, band in cells.items() if key[2] == index}
        if kept and len(kept) + len(hour) > cap:
            break
        kept.update(hour)
    # ponytail: a single hour holding more than the cap on its own is sliced
    # arbitrarily. That needs 20,000 detections in one hour over Canada, about
    # 30x the busiest hour of August 2026; give the slice a real rule if it
    # ever fires.
    return dict(list(kept.items())[:cap])


def thin(rows, cap=MAX_POINTS):
    """Detections narrowed to what the map can draw inside its weight budget."""
    for places in GRIDS:
        cells = _grid(rows, places)
        if len(cells) <= cap:
            break
    if len(cells) > cap:
        cells = _newest(cells, cap)
    return [[lon, lat, index, band] for (lon, lat, index), band in cells.items()]


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

    rows, by_hour = [], {}
    for hour, (lon, lat), band, wind in detections:
        index = HOURS - 1 - int((anchor - hour).total_seconds() // 3600)
        if not 0 <= index < HOURS:
            continue
        rows.append((lon, lat, index, band))
        if wind is not None:
            by_hour.setdefault(index, []).append(wind)

    points = thin(rows)

    wind = [[index] + _representative(by_hour[index]) for index in sorted(by_hour)]
    return {
        "generated_at": anchor.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "hours": HOURS,
        "points": points,
        "wind": wind,
    }
