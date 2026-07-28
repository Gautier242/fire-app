"""Polygon simplification, shared by the evacuation source and the coverage builder.

Both ship polygons to the browser over connections we do not control, and both
were measured to be dominated by vertex count rather than anything else.

Iterative rather than recursive: a single evacuation zone can carry thousands of
vertices, and recursion depth is not something a nightly build should depend on.
"""


def rdp(points, tolerance):
    """Ramer-Douglas-Peucker. Planar, which is accurate enough at these scales."""
    count = len(points)
    if count < 3:
        return list(points)

    keep = [False] * count
    keep[0] = keep[count - 1] = True
    stack = [(0, count - 1)]

    while stack:
        start, end = stack.pop()
        if end - start < 2:
            continue
        ax, ay = points[start]
        bx, by = points[end]
        dx, dy = bx - ax, by - ay
        scale = (dx * dx + dy * dy) ** 0.5

        worst_index, worst = -1, tolerance
        for i in range(start + 1, end):
            px, py = points[i]
            if scale == 0:
                distance = ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
            else:
                distance = abs(dy * px - dx * py + bx * ay - by * ax) / scale
            if distance > worst:
                worst_index, worst = i, distance

        if worst_index != -1:
            keep[worst_index] = True
            stack.append((start, worst_index))
            stack.append((worst_index, end))

    return [points[i] for i in range(count) if keep[i]]


def simplify_polygons(polygons, tolerance, precision=5):
    """Simplify GeoJSON MultiPolygon coordinates without ever losing a ring.

    A ring smaller than the tolerance collapses below four positions and would
    stop enclosing any area. Such a ring is kept at full resolution instead of
    being discarded: it is by definition tiny, so it costs almost nothing, and
    dropping it would silently delete the feature it describes.

    This is not hypothetical. At a 55 m tolerance the BC evacuation feed contains
    a genuine evacuation Order covering four addresses on Kilgard Road, 55 m by
    57 m. Discarding collapsed rings removed it entirely, which would have told
    those households that no evacuation order covered them.
    """
    result = []
    for rings in polygons:
        simplified = []
        for ring in rings:
            source = [(p[0], p[1]) for p in ring]
            reduced = rdp(source, tolerance)
            if len(reduced) < 4:
                reduced = source
            simplified.append([[round(x, precision), round(y, precision)]
                               for x, y in reduced])
        if simplified:
            result.append(simplified)
    return result


def count_vertices(polygons):
    return sum(len(ring) for rings in polygons for ring in rings)
