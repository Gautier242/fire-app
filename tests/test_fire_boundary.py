"""Fire boundaries computed from our own VIIRS detections.

The thing under test is a claim about ground truth, so most of these are
honesty tests rather than geometry tests: what the module refuses to draw
matters more than what it draws.
"""
from build.fire_boundary import METHOD, boundaries


def incident(identifier, points):
    """The shape build.sources.fr.firms.normalize emits: points are
    [lon, lat, iso] triples, sorted by time."""
    return {"id": identifier, "points": points}


def square(lon, lat, size=0.01, hour=10):
    stamp = f"2026-07-30T{hour:02d}:00:00Z"
    return [[lon, lat, stamp],
            [lon + size, lat, stamp],
            [lon + size, lat + size, stamp],
            [lon, lat + size, stamp]]


def test_a_single_detection_yields_no_polygon():
    # One 375 m pixel is a point that was hot. Any polygon drawn round it is
    # invented area, and invented area on this map is a claim about somebody's
    # house.
    assert boundaries([incident("a", [[-1.20, 44.98, "2026-07-30T10:00:00Z"]])]) == []


def test_two_detections_yield_no_polygon():
    out = boundaries([incident("a", [[-1.20, 44.98, "2026-07-30T10:00:00Z"],
                                     [-1.19, 44.98, "2026-07-30T10:10:00Z"]])])
    assert out == []


def test_collinear_detections_yield_no_polygon():
    # Three pixels along one road have no enclosed area. A hull that reports
    # one is reporting a rounding error as burnt ground.
    line = [[-1.20 + i * 0.01, 44.98, "2026-07-30T10:00:00Z"] for i in range(3)]
    assert boundaries([incident("a", line)]) == []


def test_a_square_of_detections_yields_one_ring():
    out = boundaries([incident("a", square(-1.20, 44.98))])
    assert len(out) == 1
    assert len(out[0]["ring"]) == 4


def test_a_detection_inside_the_cluster_is_not_a_vertex():
    points = square(-1.20, 44.98) + [[-1.195, 44.985, "2026-07-30T10:00:00Z"]]
    ring = boundaries([incident("a", points)])[0]["ring"]
    assert [-1.195, 44.985] not in ring
    assert len(ring) == 4


def test_two_fires_forty_km_apart_yield_two_polygons():
    # 0.4 degrees of latitude is ~44 km. firms.py has already separated these
    # into two incidents; hulling across them would draw a burning corridor
    # through forty kilometres nobody detected anything in.
    out = boundaries([incident("lacanau", square(-1.20, 44.98)),
                      incident("landes", square(-1.20, 44.58))])
    assert len(out) == 2
    lats = [[p[1] for p in b["ring"]] for b in out]
    for ring_lats in lats:
        assert max(ring_lats) - min(ring_lats) < 0.1, "one ring spans both fires"


def test_every_boundary_says_it_is_derived_and_from_how_much():
    points = square(-1.20, 44.98, hour=10)
    points[-1] = [points[-1][0], points[-1][1], "2026-07-30T12:30:00Z"]
    boundary = boundaries([incident("lacanau", points)])[0]
    assert boundary["validated"] is False, "a computed boundary is never observed"
    assert boundary["method"] == METHOD
    assert boundary["detections"] == 4
    assert boundary["first_seen"] == "2026-07-30T10:00:00Z"
    assert boundary["last_seen"] == "2026-07-30T12:30:00Z"
    assert boundary["span_hours"] == 2.5
    assert boundary["incident_id"] == "lacanau"


def test_a_boundary_from_three_detections_is_distinguishable_from_one_from_many():
    small = boundaries([incident("a", square(-1.20, 44.98)[:3])])[0]
    dense = [[-1.20 + (i % 8) * 0.002, 44.98 + (i // 8) * 0.002,
              "2026-07-30T10:00:00Z"] for i in range(64)]
    big = boundaries([incident("b", dense)])[0]
    assert small["detections"] == 3
    assert big["detections"] == 64


def test_rows_that_do_not_parse_are_skipped_rather_than_raised():
    points = square(-1.20, 44.98) + [
        ["x", 44.98, "2026-07-30T10:00:00Z"],       # unparseable longitude
        [-1.19, 44.99, "yesterday afternoon"],      # unparseable stamp
        [-1.19],                                    # truncated row
    ]
    out = boundaries([incident("a", points), {"id": "b"}, {}])
    assert len(out) == 1
    assert out[0]["detections"] == 4
