"""The official ATMO air quality index, published per commune by Atmo France.

Two indices come back per commune and both are kept. `code_qual` is the overall
ATMO index, which is the worst of its sub-indices — on a hot day that is usually
ozone. `code_pm25` is the fine-particle sub-index, and that is the one wildfire
smoke moves. Reporting only the overall index would hide smoke behind ozone on
exactly the days that matter, so the two travel separately all the way to the
frontend.

Never query this layer without a date filter. Unfiltered it is 24,635,169
features; one day is about 29,000. The Canadian hotspot layer has the same trap,
and `build/sources/cwfis_history.py` answers it the same way: the filter is built
inside `fetch`, so there is no parameter through which a caller could drop it.

One day of communes is 3.5 MB, 479 KB gzipped — past the whole 150 KB payload
budget on its own. `normalize` therefore thins to the worst commune per grid
cell. ATMO is a modelled surface interpolated from a few hundred stations, so
commune-level resolution is arithmetic rather than measurement; a 0.2 degree
sample keeps 1,588 real communes and 38.7 KB gzipped.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

from build.http import get_json

WFS_URL = "https://data.atmo-france.org/geoserver/ind/ows"
# Not ind:ind_atmo_2026, which the server rejects as an unknown feature type.
LAYER = "ind:ind_atmo"
SRS = "EPSG:4326"
MAX_FEATURES = 40000

# The publication day is the French civil day, not the build machine's. CI runs
# in UTC, where "today" is still yesterday for the first two hours of a Paris
# summer morning.
PARIS = ZoneInfo("Europe/Paris")

# Metropolitan France. The feed also carries Guadeloupe, Martinique and Guyane;
# the map does not, so they are dropped rather than drawn a hemisphere away.
LON_MIN, LON_MAX = -5.5, 10.0
LAT_MIN, LAT_MAX = 41.0, 51.5

# Roughly 22 km north-south, 16 km east-west at these latitudes.
GRID_DEG = 0.2


def fetch(session, day=None, count=MAX_FEATURES):
    day = day or datetime.now(PARIS).date()
    return get_json(session, WFS_URL, params={
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": LAYER,
        "outputFormat": "application/json",
        "srsName": SRS,
        "count": count,
        "CQL_FILTER": f"date_ech='{day.isoformat()}'",
    })
    # ponytail: a single day, so between midnight and the ~04:00 Paris
    # publication the section is empty and reads as "no data" rather than as
    # clean air. Widen to a two-day IN() filter keeping the newest date_ech per
    # commune if that gap turns out to matter.


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


def _index(value):
    """An ATMO index 1..6, or None. A missing reading is never a good one."""
    return value if isinstance(value, int) and 1 <= value <= 6 else None


def normalize(payload, step=GRID_DEG):
    """One record per grid cell, carrying the worst commune reading in it.

    Thinning may only ever overstate, so the cell keeps whichever commune reads
    worst — ranked on PM2.5 first, because that is the smoke. A cell can
    therefore report an overall index one step below its true peak when the two
    rankings disagree; understating ozone is the acceptable half of that trade.
    """
    worst = {}
    for feature in payload.get("features") or []:
        properties = feature.get("properties") or {}
        zone = properties.get("code_zone")
        position = _position(feature.get("geometry"))
        if not zone or position is None:
            continue
        lon, lat = position
        overall, pm25 = _index(properties.get("code_qual")), _index(properties.get("code_pm25"))
        rank = (pm25 or 0, overall or 0)
        cell = (int(lon // step), int(lat // step))
        if cell in worst and worst[cell][0] >= rank:
            continue
        name = properties.get("lib_zone") or zone
        worst[cell] = (rank, {
            "id": zone,
            "lat": round(lat, 4),
            "lon": round(lon, 4),
            # The feed publishes one name, and a French place name does not
            # translate. Both keys carry it so the frontend can read this
            # section the same way it reads the Canadian one.
            "name": {"en": name, "fr": name},
            "value": overall,
            "pm25": pm25,
            "observed_at": properties.get("date_ech") or "",
            "source": "atmo",
        })
    return sorted((record for _rank, record in worst.values()), key=lambda r: r["id"])
