"""A fire boundary computed from our own detections.

Google's wildfire layer draws boundaries over France at 1 km. There is no API
and scraping it is rejected -- it breaches their terms and it fails silently,
and a silently empty layer on this map reads as "no fire". But Google's inputs
are our inputs: Suomi NPP and NOAA-20 VIIRS, which build.sources.fr.firms
already ingests, and FIRMS serves them at 375 m. The only thing Google adds is
clustering points into a shape. That is this module, and at 375 m it can be
finer than theirs.

What this is not:

- **Not a perimeter.** A VIIRS detection is a 375 m pixel that was hot at the
  moment a satellite happened to look. The hull of a handful of those is a
  hypothesis about extent, not a survey of it. Every payload carries
  validated=False and the method name, exactly as fire_spread does for the
  Rothermel arcs, so the frontend can draw it as visibly not-observed.
- **Not a burnt area.** Nothing here may be labelled "zones brûlées".
- **Not continuous in time.** VIIRS passes a few times a day and cloud stops it
  outright. A single ring drawn across a six-hour hole claims the fire was that
  shape throughout, which nobody saw. Detections are cut into observation
  windows first, and each window gets its own ring and its own timestamps.

Degenerate input produces nothing rather than something: one or two detections,
or any number of collinear ones, enclose no area, and a polygon invented around
them is a claim about whose house is inside it.

Pure functions -- no network, no clock, no file I/O -- so the caller decides
what "now" means and the tests never touch anything.
"""
from datetime import datetime, timezone

METHOD = "convex-hull-viirs375"

# The nominal VIIRS pixel edge. The ring joins pixel *centres*, so the ground
# that tripped the sensor extends about half this beyond it. Published so a
# consumer can widen the stroke instead of guessing.
PIXEL_M = 375

# Both caps are fuses against a feed that changes shape, not tuning knobs.
# 24 h of France yields 111 detections in about 90 incidents, so a seven-day
# window projects to a low four figures across all of them; 5 000 in a single
# incident means something upstream broke. A convex hull over 375 m pixels does
# not reach 64 vertices either -- neither cap is expected to fire.
MAX_POINTS = 5000
MAX_VERTICES = 64

# What counts as a hole in the record rather than the ordinary wait between
# overpasses. Measured 2026-07-29: five VIIRS passes over France in 24 h across
# both satellites, so roughly five hours is normal cadence. Longer than six and
# a pass was missed or cloud blocked it, and detections either side of it belong
# to two observations, not one continuous burn.
MAX_GAP_HOURS = 6.0


def _stamp(value):
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _iso(stamp):
    return stamp.strftime("%Y-%m-%dT%H:%M:%SZ")


def _points(incident):
    """[lon, lat, stamp] triples, oldest first. A row that does not parse is
    dropped: one bad point must not cost the fire it belongs to."""
    out = []
    for point in incident.get("points") or ():
        try:
            lon, lat, when = float(point[0]), float(point[1]), point[2]
        except (IndexError, TypeError, ValueError):
            continue
        stamp = _stamp(when)
        if stamp is not None:
            out.append((lon, lat, stamp))
    return sorted(out, key=lambda p: p[2])


def _windows(points, max_gap_hours):
    """Cut the run of detections wherever the record has a hole in it."""
    windows = []
    for point in points:
        if windows and (point[2] - windows[-1][-1][2]).total_seconds() \
                <= max_gap_hours * 3600.0:
            windows[-1].append(point)
        else:
            windows.append([point])
    return windows


def _area2(a, b, c):
    """Twice the signed area of the triangle abc."""
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _cap_ring(ring, cap):
    """Drop vertices until the ring fits the cap, cheapest corner first.

    Visvalingam: the vertex whose triangle with its two neighbours is smallest
    is the one whose removal changes the shape least. Ramer-Douglas-Peucker is
    already in build/simplify.py but takes a distance tolerance rather than a
    vertex budget, and pins the first and last positions -- on a ring those are
    an arbitrary pair of neighbours, not the two that matter.

    The ring only ever moves inward, so a capped boundary understates. That is
    the wrong direction for a fire, which is why the cap is set where it cannot
    realistically fire and why PIXEL_M ships beside it.

    ponytail: rescans every triangle per removal, O(n^2). At the 64-vertex cap
    that is a few thousand multiplications; keep a heap if the cap ever grows.
    """
    ring = list(ring)
    if len(ring) <= cap:
        return ring, False
    while len(ring) > max(3, cap):
        count = len(ring)
        areas = [abs(_area2(ring[i - 1], ring[i], ring[(i + 1) % count]))
                 for i in range(count)]
        ring.pop(areas.index(min(areas)))
    return ring, True


def _hull(points):
    """Andrew's monotone chain. Returns the ring counter-clockwise, or fewer
    than three positions when the points enclose no area.

    Computed in degrees. Longitude is compressed relative to latitude away from
    the equator, but that compression is a uniform scaling over a cluster this
    small, and uniform scaling does not change which points are on the hull.

    `cross <= 0` pops collinear points, so three detections along a road come
    back as two positions and are refused upstream.
    """
    unique = sorted(set((lon, lat) for lon, lat, _ in points))
    if len(unique) < 3:
        return []

    def half(ordered):
        chain = []
        for point in ordered:
            while len(chain) >= 2:
                (ax, ay), (bx, by) = chain[-2], chain[-1]
                cross = (bx - ax) * (point[1] - ay) - (by - ay) * (point[0] - ax)
                if cross > 0:
                    break
                chain.pop()
            chain.append(point)
        return chain[:-1]

    ring = half(unique) + half(reversed(unique))
    return ring if len(ring) >= 3 else []


def _boundary(incident, points, index, max_vertices, truncated):
    ring, simplified = _cap_ring(_hull(points), max_vertices)
    if len(ring) < 3:
        return None
    first, last = points[0][2], points[-1][2]
    return {
        "id": f"{incident.get('id')}#{index}",
        "incident_id": incident.get("id"),
        "method": METHOD,
        # Derived, never observed. The frontend must be able to tell without
        # reading the caption.
        "validated": False,
        "pixel_m": PIXEL_M,
        "detections": len(points),
        "first_seen": _iso(first),
        "last_seen": _iso(last),
        "span_hours": round((last - first).total_seconds() / 3600.0, 2),
        # Vertices were dropped to meet the cap: the ring is inside the hull.
        "simplified": simplified,
        # Detections were dropped to meet the cap: older ones are missing.
        "truncated": truncated,
        "ring": [[lon, lat] for lon, lat in ring],
    }


def boundaries(incidents, max_points=MAX_POINTS, max_vertices=MAX_VERTICES,
               max_gap_hours=MAX_GAP_HOURS):
    """One ring per observation window per incident, most detections first.

    An incident yields several rings when its detections straddle a gap in the
    record, and none at all when no window of it encloses area.
    """
    out = []
    for incident in incidents or ():
        points = _points(incident)
        # Over the cap the oldest go: a boundary is a question about now, and
        # the drop is declared rather than hidden.
        truncated = len(points) > max_points
        # Not points[-max_points:]: at a cap of zero that slice keeps everything.
        points = points[len(points) - max_points:] if truncated else points
        for index, window in enumerate(_windows(points, max_gap_hours)):
            boundary = _boundary(incident, window, index, max_vertices, truncated)
            if boundary is not None:
                out.append(boundary)
    return sorted(out, key=lambda b: -b["detections"])
