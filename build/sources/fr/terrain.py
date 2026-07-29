"""Slope and aspect from IGN elevation.

Fire runs uphill much faster than on the flat — the Rothermel slope factor needs
tan(slope) — and a resident needs to know that a fire below them arrives sooner
than the map distance suggests.

IGN's RGE ALTI service is free and needs no key. It is sampled on a coarse grid
rather than at full 1 m resolution: a 50 km zone at 1 m would be billions of
points, and the spread model works at the scale of a fire front, not a footpath.

The response shape was established against the live service on 2026-07-29 rather
than assumed. A call returns `{"elevations": [...]}`, one object per requested
point, in the order the points were asked for, each `{"lon", "lat", "z", "acc"}`.
A point outside coverage is not omitted and carries no flag — it comes back in
its place with `z` of -99999.0. That sentinel is the whole reason this module
exists in the shape it does: read literally it is a hundred-kilometre cliff, and
it would turn one hole in the data into a catastrophic rate of spread. Note that
0.0 is *not* missing — it is sea level, which the Mediterranean edge of a Var
zone genuinely returns.

Batching was measured the same day: 200 points travel in a 3,114-byte URL and
return 200 elevations. `BATCH` is set well under that, because the ceiling that
matters is nginx's 8 KB request line, the one that already bit the Open-Meteo
fetch in build/sources/fr/wind.py.

SAMPLING SCALE IS PART OF THE ANSWER, and callers modelling spread have to pick
it deliberately. Slope is not a property of the ground alone but of the distance
it is measured over. Measured over the Massif des Maures on 2026-07-29, centred
on 43.30/6.40, the maximum slope in the zone reads:

    spacing 5,714 m -> 2.95 deg   (radius_km=20, step=8, the defaults)
    spacing 1,429 m -> 10.46 deg
    spacing   571 m -> 17.34 deg
    spacing   286 m -> 24.15 deg
    spacing   143 m -> 28.43 deg

All five are arithmetically correct; they answer different questions. The first
is the regional tilt of a massif, the last is a hillside a fire actually climbs.
This matters more than it looks because the Rothermel slope factor goes as
tan(slope) SQUARED: tan^2 of 2.95 deg is 0.0027 against 0.293 for 28.43 deg, so
sampling a 40 km zone at eight steps understates the slope contribution to the
rate of spread by roughly a hundredfold. A fire front is a local thing, so
spread modelling should call this with a small radius centred on the fire rather
than the whole zone's defaults, and read `spacing_m` back to know what scale of
slope it was handed.
"""
import math

from build.http import get_json

_COMPASS = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")

URL = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json"
RESOURCE = "ign_rge_alti_wld"

# Points per request. IGN accepts pipe-delimited batches; keep well under any
# URL-length ceiling, the trap that bit the Open-Meteo fetch at 8192 bytes.
BATCH = 50

# What IGN puts in `z` for a point it has no elevation for.
NO_DATA = -99999.0

# Metres per degree of latitude. Good to a few parts per thousand anywhere in
# France, and the grid it spaces is kilometres coarse.
M_PER_DEG = 111320.0


def _compass(deg):
    return _COMPASS[int((deg % 360) / 45 + 0.5) % 8]


def slope_at(grid, row, col, spacing_m):
    """Slope in degrees and the uphill compass point, by finite difference.

    Returns None for both when any neighbour is missing: a slope computed from a
    hole is a wrong number, and a wrong slope feeds the spread model a wrong
    rate. The whole 3x3 block has to be present, diagonals included. The
    difference itself only reads the four cardinal neighbours, but a hole
    touching the block means the DEM is unreliable right there, and declining to
    answer costs one cell while guessing costs a projection somebody acts on.

    Bounds are checked rather than caught. At row or column 0 an index of -1 is
    a legal Python index that wraps to the far side of the grid, so an edge cell
    would quietly take its slope from terrain forty kilometres away instead of
    raising IndexError.
    """
    if not (0 < row < len(grid) - 1) or not (0 < col < len(grid[row]) - 1):
        return {"slope_deg": None, "aspect_deg": None, "uphill": None}
    block = [grid[r][c] for r in (row - 1, row, row + 1)
             for c in (col - 1, col, col + 1)]
    if None in block:
        return {"slope_deg": None, "aspect_deg": None, "uphill": None}

    north, south = grid[row - 1][col], grid[row + 1][col]
    west, east = grid[row][col - 1], grid[row][col + 1]

    # Rows run north to south, so a positive dz_dy means the ground rises north.
    dz_dy = (north - south) / (2 * spacing_m)
    dz_dx = (east - west) / (2 * spacing_m)
    magnitude = math.hypot(dz_dx, dz_dy)
    slope_deg = math.degrees(math.atan(magnitude))
    if magnitude == 0:
        # No uphill exists on the flat, and inventing one would hand the spread
        # model a direction it must not have.
        return {"slope_deg": 0.0, "aspect_deg": None, "uphill": None}

    aspect = (math.degrees(math.atan2(dz_dx, dz_dy)) + 360) % 360
    return {"slope_deg": round(slope_deg, 2), "aspect_deg": round(aspect, 1),
            "uphill": _compass(aspect)}


def _grid_points(lat, lon, radius_km, step):
    """The step x step sample points, row-major, row 0 north, column 0 west.

    The box spans radius_km each way from the centre. The longitude span is
    widened by 1/cos(lat) so that a step east covers the same ground as a step
    south, which is what lets one spacing serve both axes of the slope.
    """
    dlat = radius_km / (M_PER_DEG / 1000.0)
    dlon = dlat / math.cos(math.radians(lat))
    return [
        (round(lat + dlat - 2 * dlat * r / (step - 1), 6),
         round(lon - dlon + 2 * dlon * c / (step - 1), 6))
        for r in range(step) for c in range(step)
    ]


def fetch(session, lat, lon, radius_km=20, step=8, batch=BATCH):
    """Elevation over a step x step grid centred on lat/lon.

    Returns `{"points": [...], "step": step, "spacing_m": float}` with the IGN
    point objects in grid order. A step below 2 has no neighbourhood to take a
    difference over, so it returns nothing rather than an unusable grid.
    """
    if step < 2:
        return {"points": [], "step": step, "spacing_m": 0.0}

    points = _grid_points(lat, lon, radius_km, step)
    elevations = []
    for start in range(0, len(points), batch):
        chunk = points[start:start + batch]
        payload = get_json(session, URL, params={
            "lon": "|".join(f"{p_lon}" for _p_lat, p_lon in chunk),
            "lat": "|".join(f"{p_lat}" for p_lat, _p_lon in chunk),
            "resource": RESOURCE,
            "delimiter": "|",
        })
        elevations.extend((payload or {}).get("elevations") or [])

    return {"points": elevations, "step": step,
            "spacing_m": 2 * radius_km * 1000.0 / (step - 1)}


def _spacing_from(points, step):
    """Ground distance between two adjacent columns, in metres.

    Derived from the coordinates the service echoed back so that a payload read
    straight from IGN carries its own scale and no caller has to restate it.
    """
    first, second = points[0], points[1]
    dlon = abs(second.get("lon", 0) - first.get("lon", 0))
    return dlon * M_PER_DEG * math.cos(math.radians(first.get("lat", 0)))


def normalize(payload, step):
    """Walk the sampled points into a grid of cells carrying slope and aspect.

    Accepts either a `fetch()` result or a raw IGN response. A payload that does
    not hold a full step x step grid yields an empty one: a short batch would
    silently shift every row west, and a grid off by one column reports slopes
    for the wrong hillsides.
    """
    points = (payload or {}).get("points") or (payload or {}).get("elevations") or []
    if step < 2 or len(points) < step * step:
        return {"grid": [], "step": step}

    spacing_m = (payload.get("spacing_m") or 0.0) or _spacing_from(points, step)
    if not spacing_m:
        return {"grid": [], "step": step}

    elevations = [[None] * step for _ in range(step)]
    for index, point in enumerate(points[:step * step]):
        z = point.get("z")
        elevations[index // step][index % step] = None if z is None or z <= NO_DATA else z

    grid = []
    for r in range(step):
        row = []
        for c in range(step):
            point = points[r * step + c]
            cell = {"lat": point.get("lat"), "lon": point.get("lon"),
                    "elev_m": elevations[r][c]}
            cell.update(slope_at(elevations, r, c, spacing_m))
            row.append(cell)
        grid.append(row)
    return {"grid": grid, "step": step, "spacing_m": round(spacing_m, 1)}
