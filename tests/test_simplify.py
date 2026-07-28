from build.simplify import count_vertices, rdp, simplify_polygons


def test_rdp_keeps_the_endpoints():
    points = [(0, 0), (1, 0.001), (2, 0)]
    assert rdp(points, 0.1)[0] == (0, 0)
    assert rdp(points, 0.1)[-1] == (2, 0)


def test_rdp_drops_a_point_within_tolerance_of_the_line():
    assert rdp([(0, 0), (1, 0.001), (2, 0)], 0.1) == [(0, 0), (2, 0)]


def test_rdp_keeps_a_point_outside_tolerance():
    assert len(rdp([(0, 0), (1, 5), (2, 0)], 0.1)) == 3


def test_rdp_leaves_short_inputs_alone():
    assert rdp([(0, 0), (1, 1)], 0.1) == [(0, 0), (1, 1)]
    assert rdp([], 0.1) == []


def test_rdp_handles_a_ring_that_starts_and_ends_at_the_same_point():
    ring = [(0, 0), (0, 2), (2, 2), (2, 0), (0, 0)]
    assert len(rdp(ring, 0.0001)) == 5


def test_rdp_survives_a_very_long_ring_without_recursion_limits():
    # A real evacuation zone can carry thousands of vertices.
    ring = [(i * 0.0001, 0.0) for i in range(20000)]
    assert len(rdp(ring, 0.001)) == 2


def test_simplify_polygons_reduces_vertices_on_a_zone_larger_than_the_tolerance():
    # A 1-degree square whose edges are padded with redundant collinear points,
    # which is what the real evacuation polygons look like.
    edge = [[i * 0.005, 0.0] for i in range(200)]
    ring = edge + [[1.0, 1.0], [0.0, 1.0], [0.0, 0.0]]
    before = count_vertices([[ring]])
    after = count_vertices(simplify_polygons([[ring]], 0.0005))
    assert after < before
    assert after >= 4, "the zone itself must survive"


def test_a_zone_smaller_than_the_tolerance_survives_at_full_resolution():
    # A real BC evacuation Order covers four addresses in a 55 m x 57 m box.
    # Simplifying it away would tell those households they are not evacuated.
    tiny = [[[[-122.2000, 49.0500], [-122.2000, 49.0505], [-122.1995, 49.0505],
              [-122.1995, 49.0500], [-122.2000, 49.0500]]]]
    result = simplify_polygons(tiny, 0.0005)
    assert result, "a zone smaller than the tolerance must not be discarded"
    assert len(result[0][0]) == 5, "kept at full resolution, not collapsed"


def test_simplify_polygons_preserves_a_square_that_is_already_minimal():
    square = [[[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]]]
    assert count_vertices(simplify_polygons(square, 0.0001)) == 5


def test_simplification_does_not_move_a_boundary_more_than_the_tolerance():
    # The safety property: a point well inside a zone must stay inside it.
    ring = [[0.0, 0.0], [0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]]
    simplified = simplify_polygons([[ring]], 0.0005)[0][0]
    lons = [p[0] for p in simplified]
    lats = [p[1] for p in simplified]
    assert min(lons) >= -0.0005 and max(lons) <= 1.0005
    assert min(lats) >= -0.0005 and max(lats) <= 1.0005
