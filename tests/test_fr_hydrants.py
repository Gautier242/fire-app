"""Fire hydrants from OpenStreetMap, where no register exists.

Gironde publishes no PEI register -- data.gouv holds seven and none is 33 -- while
OSM holds 1,077 hydrants around the Saumos fire. That data is worth having and is
NOT a register: the same OSM extract has 4 fire stations in the Gironde bbox
against roughly 100 real. So it ships labelled, never merged.
"""
import pytest

from build.http import FetchError
from build.sources.fr import hydrants, water


def _payload(*elements):
    return {"elements": list(elements)}


def _node(oid=1, lat=44.86, lon=-0.88, **tags):
    return {"type": "node", "id": oid, "lat": lat, "lon": lon, "tags": tags}


def _hydrant(**kwargs):
    return _node(**{"emergency": "fire_hydrant", **kwargs})


def test_a_hydrant_is_a_crowd_point_never_a_register_point():
    out = hydrants.normalize(_payload(_hydrant()))

    point = out["points"][0]
    assert point["tier"] == "crowd"
    assert point["source"] == "osm"
    assert all(row["tier"] == "crowd" for row in out["coverage"])


def test_a_crowd_point_carries_the_same_keys_as_a_register_point():
    """One renderer draws both, so a missing key would crash on the crowd layer."""
    out = hydrants.normalize(_payload(_hydrant()))

    for key in ("id", "lat", "lon", "kind", "capacity_m3", "dep", "source", "tier"):
        assert key in out["points"][0], f"missing {key}"


def test_a_crowd_point_speaks_the_registers_vocabulary():
    """`kind` is read by the shared renderer, so OSM's words cannot leak into it.

    water.py maps the token "hydrant" onto "borne", and this query asks Overpass
    for emergency=fire_hydrant and nothing else, so every point it returns is one.
    Passing OSM's own "pillar"/"underground" through would hand the renderer a
    vocabulary it does not know.
    """
    out = hydrants.normalize(_payload(_hydrant(**{"fire_hydrant:type": "pillar"})))

    assert out["points"][0]["kind"] == "borne"
    assert water._kind("hydrant") == "borne"


def test_capacity_is_never_invented_from_a_flow_rate():
    """OSM records flow sometimes and stored volume almost never.

    A crew sent to a tank because the map published a number it did not have is
    the failure this layer cannot afford, so capacity is None and stays None.
    """
    out = hydrants.normalize(_payload(_hydrant(**{"flow_rate": "60 m3/h"})))

    assert out["points"][0]["capacity_m3"] is None


def test_a_node_without_a_position_is_dropped():
    broken = {"type": "node", "id": 2, "tags": {"emergency": "fire_hydrant"}}

    assert hydrants.normalize(_payload(broken))["points"] == []


def test_a_node_that_is_not_a_hydrant_is_not_drawn_as_one():
    """normalize must not depend on the query having filtered correctly."""
    out = hydrants.normalize(_payload(_node(**{"amenity": "bench"})))

    assert out["points"] == []


def test_a_failed_fetch_is_unavailable_not_an_empty_map():
    """Absence here must never read as absence of water. It is the whole point."""
    out = hydrants.normalize(None)

    assert out["available"] is False
    assert out["points"] == []

    asked = hydrants.normalize(_payload())
    assert asked["available"] is True
    assert asked["points"] == []


def test_a_timed_out_query_is_unavailable_even_though_it_answered_200():
    """Measured 2026-07-30: Overpass reports a timeout as HTTP 200.

    The body is 371 bytes of valid JSON carrying elements: [] and
    remark: 'runtime error: Query timed out in "query" at line 1 after 2 seconds.'
    Reading the status alone turns a failed query into a map of no hydrants, which
    is the one thing this layer must never say.
    """
    timed_out = {"version": 0.6, "elements": [],
                 "remark": 'runtime error: Query timed out in "query" at line 1'}

    out = hydrants.normalize(timed_out)

    assert out["available"] is False
    assert out["points"] == []


def test_a_partial_answer_is_not_passed_off_as_a_complete_one():
    """Overpass can emit some elements and then give up with a remark."""
    partial = {"elements": [_hydrant()],
               "remark": "runtime error: Query run out of memory"}

    out = hydrants.normalize(partial)

    assert out["available"] is False
    assert out["points"] == []


def test_the_cap_bounds_an_unbounded_external_source():
    many = _payload(*[_hydrant(oid=i) for i in range(50)])

    out = hydrants.normalize(many, cap=10)

    assert len(out["points"]) == 10
    assert out["truncated"] is True


def test_a_position_outside_france_is_dropped():
    """The same backstop the water module uses, for the same class of mistake."""
    out = hydrants.normalize(_payload(_hydrant(lat=0.0, lon=0.0)))

    assert out["points"] == []


def test_the_france_backstop_is_the_water_modules_own():
    """One box, not two that drift apart."""
    assert (hydrants.LAT_MIN, hydrants.LAT_MAX) == (water.LAT_MIN, water.LAT_MAX)
    assert (hydrants.LON_MIN, hydrants.LON_MAX) == (water.LON_MIN, water.LON_MAX)


def test_the_query_is_bounded_by_a_bbox_and_a_timeout():
    query = hydrants.query(hydrants.GIRONDE_BBOX)

    assert "fire_hydrant" in query
    assert "timeout:" in query, "an unbounded Overpass query is refused or hangs"
    for value in hydrants.GIRONDE_BBOX:
        assert str(value) in query


def test_the_cap_bounds_the_query_itself_not_just_the_result():
    """Overpass is a free volunteer service; the cheapest cap is the one it applies."""
    assert "42" in hydrants.query(hydrants.GIRONDE_BBOX, cap=42)


def test_a_fetch_failure_returns_none_so_normalize_can_say_unavailable():
    """get_json raises. If that escaped, available=False would be unreachable and
    the caller would decide the safety property instead of this module."""
    class Down:
        def get(self, *args, **kwargs):
            raise OSError("overpass 504")

    assert hydrants.fetch(Down(), sleep=lambda _: None) is None


def test_a_fetch_failure_is_not_silently_confused_with_an_empty_answer():
    class Empty:
        def get(self, *args, **kwargs):
            return _Response({"elements": []})

    assert hydrants.fetch(Empty(), sleep=lambda _: None) == {"elements": []}


class _Response:
    def __init__(self, body):
        self._body = body

    def raise_for_status(self):
        return None

    def json(self):
        return self._body


def test_get_json_still_raises_so_the_catch_above_is_load_bearing():
    """Guards the assumption: if build.http ever starts returning None instead,
    this test fails and fetch's try/except can be reconsidered."""
    class Down:
        def get(self, *args, **kwargs):
            raise OSError("overpass 504")

    with pytest.raises(FetchError):
        from build.http import get_json
        get_json(Down(), "https://example.invalid", sleep=lambda _: None)
