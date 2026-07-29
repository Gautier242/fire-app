"""Telling a refinery apart from a wildfire.

FIRMS detects heat, not wildfire. Refineries, steelworks and gas flares burn
every day at the same coordinates. Two agents found the same trap independently:
Duisburg steelworks (104 detections, frp_max 17.7 MW, never off) and the
Fos-sur-Mer flares in Bouches-du-Rhone.

Left unmasked, the map shows permanent fires that never move — and once a reader
learns to ignore two fixed dots, they ignore the real one beside them.

The signature is persistence, not a hand-maintained blocklist: something burning
at the same spot on most days is infrastructure. A blocklist would need a human
to notice each new flare, and would never cover a country we have not thought
about.
"""
from build.flares import FlareRegistry, mask_incidents


def incident(lat, lon, detections=10, frp_max=50.0, **kw):
    return {"id": f"firms-{lat},{lon}", "lat": lat, "lon": lon,
            "detections": detections, "frp_max": frp_max, **kw}


def test_a_site_seen_on_most_days_is_flagged_as_industrial():
    registry = FlareRegistry()
    for day in range(1, 8):
        registry.observe([incident(51.488, 6.721)], day=f"2026-07-0{day}")

    assert registry.is_industrial(51.488, 6.721)


def test_a_fire_burning_a_few_days_is_never_flagged():
    registry = FlareRegistry()
    # A serious wildfire can burn for days. Two or three days of detections is
    # a fire doing what fires do, not a refinery.
    for day in ("2026-07-01", "2026-07-02", "2026-07-03"):
        registry.observe([incident(44.86, -0.87)], day=day)

    assert not registry.is_industrial(44.86, -0.87)


def test_a_flagged_site_still_needs_a_long_enough_record_to_judge():
    registry = FlareRegistry()
    # One day of history cannot distinguish anything. Until we have enough days,
    # nothing is masked — showing a refinery is a smaller failure than hiding a
    # fire.
    registry.observe([incident(51.488, 6.721)], day="2026-07-01")
    assert not registry.is_industrial(51.488, 6.721)


def test_a_site_that_stops_burning_ages_out():
    registry = FlareRegistry()
    for day in range(1, 8):
        registry.observe([incident(51.488, 6.721)], day=f"2026-07-0{day}")
    assert registry.is_industrial(51.488, 6.721)

    # An agricultural burn repeated during one harvest must not be masked
    # forever. Days outside the window no longer count.
    for day in range(10, 25):
        registry.observe([incident(1.0, 1.0)], day=f"2026-07-{day}")
    assert not registry.is_industrial(51.488, 6.721)


def test_position_matching_tolerates_the_sensor_wandering():
    registry = FlareRegistry()
    # The detected centre of a fixed flare moves a pixel or two between
    # overpasses as different parts trip the sensor. An exact-coordinate match
    # would never accumulate a record.
    for i, day in enumerate(range(1, 8)):
        registry.observe([incident(51.488 + i * 0.002, 6.721)], day=f"2026-07-0{day}")

    assert registry.is_industrial(51.488, 6.721)


def test_masking_marks_rather_than_deletes():
    registry = FlareRegistry()
    for day in range(1, 8):
        registry.observe([incident(51.488, 6.721)], day=f"2026-07-0{day}")

    out = mask_incidents([incident(51.488, 6.721), incident(44.86, -0.87)], registry)

    # Both survive. A masked incident is still real heat, and a reader zooming
    # into an industrial estate should see why it is there — but it must not
    # count as a wildfire in any headline or nearest-fire calculation.
    assert len(out) == 2
    flare = [i for i in out if i["lat"] == 51.488][0]
    fire = [i for i in out if i["lat"] == 44.86][0]
    assert flare["industrial"] is True
    assert fire["industrial"] is False


def test_the_registry_survives_a_round_trip_through_json():
    registry = FlareRegistry()
    for day in range(1, 8):
        registry.observe([incident(51.488, 6.721)], day=f"2026-07-0{day}")

    # CI starts from a fresh checkout every run, so the record only persists if
    # it can be published and read back.
    restored = FlareRegistry.from_payload(registry.payload())
    assert restored.is_industrial(51.488, 6.721)


def test_a_missing_or_corrupt_registry_masks_nothing():
    for payload in (None, {}, {"sites": None}, {"sites": [{"bad": "row"}]}):
        registry = FlareRegistry.from_payload(payload)
        out = mask_incidents([incident(51.488, 6.721)], registry)
        assert out[0]["industrial"] is False


def test_observing_the_same_day_twice_does_not_inflate_the_record():
    registry = FlareRegistry()
    for _ in range(20):
        registry.observe([incident(51.488, 6.721)], day="2026-07-01")

    # A rebuild, a retry or a manual run must not turn one day into twenty.
    assert not registry.is_industrial(51.488, 6.721)


def test_a_fire_outside_france_is_marked_not_dropped():
    from build.flares import tag_country
    import json
    shapes = json.load(open("public/static/fr/departements.geojson"))
    out = tag_country([
        incident(44.863, -0.880),   # Lacanau, Gironde
        incident(42.657, -5.409),   # Leon, Spain - inside the bbox, not France
    ], shapes)
    # Fires do not stop at borders and smoke certainly does not, so a Spanish
    # fire is kept. It must not be counted as the fire near a French reader.
    assert out[0]["in_country"] is True
    assert out[1]["in_country"] is False
