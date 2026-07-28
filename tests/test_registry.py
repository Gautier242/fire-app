from build.registry import PROVINCES, SOURCES, coverage_payload


def test_every_province_and_territory_is_declared():
    assert len(PROVINCES) == 13


def test_bc_has_both_named_fires_and_evacuations():
    bc = next(p for p in PROVINCES if p["province"] == "BC")
    assert bc["named_fires"] is True
    assert bc["evacuations"] is True


def test_provinces_without_a_feed_declare_no_evacuation_coverage():
    ab = next(p for p in PROVINCES if p["province"] == "AB")
    assert ab["evacuations"] is False


def test_every_province_has_an_official_url():
    assert all(p["official_url"].startswith("https://") for p in PROVINCES)


def test_coverage_payload_is_serialisable_and_complete():
    payload = coverage_payload()
    assert len(payload) == 13
    assert set(payload[0]) == {"province", "named_fires", "evacuations", "official_url"}


def test_sources_declare_stable_ids():
    ids = [s["id"] for s in SOURCES]
    assert ids == sorted(set(ids)), "source ids must be unique"
    assert "bc_evac" in ids
