"""Keeping the record after the sources go away.

Every feed this site reads publishes current state and nothing else. The Gironde
closures carry `since: null` on all 116 rows, the evacuated communes carry no
date at all, and FIRMS serves a rolling seven-day window. Nothing upstream
remembers last week, so if we do not write it down there is no record of this
fire to show in six months -- and the ArcGIS layers will be taken down long
before then, because they exist to serve an emergency that will end.

The archive is therefore append-only and lives in git history, which is the one
store here that cannot be quietly overwritten by the next build.
"""
import json

from build.archive import digest, merge_timeline, snapshot_paths

FR = {
    "generated_at": "2026-08-01T06:00:00Z",
    "fires": [{"id": "a", "frp_total": 120.0}, {"id": "b", "frp_total": 30.0}],
    "danger": [{"dep": "33", "level": 4}],
    "closures": [{"id": "c1"}, {"id": "c2"}],
    "evacuations": [],
    "sources": [{"id": "firms", "ok": True}, {"id": "atmo", "ok": False}],
}
GIRONDE = {
    "available": True,
    "closures": [{"id": "g1", "fire_related": True}, {"id": "g2", "fire_related": False}],
    "evacuations": [{"name": "Andernos-les-Bains"}, {"name": "Lège-Cap-Ferret"}],
    # The real shape, checked against the live payload: one dict with its own
    # survey date, not a list.
    "burn_area": {"observed": True, "surveyed": "2026-07-29",
                  "area_km2": 405.2, "source": "gironde"},
}
CA = {"generated_at": "2026-08-01T06:00:00Z",
      "fires": [{"id": "x"}], "evacuations": [{"id": "e"}],
      "sources": [{"id": "cwfis", "ok": True}]}


def test_a_days_digest_records_the_counts_a_timeline_needs():
    day = digest("2026-08-01", fr=FR, gironde=GIRONDE, ca=CA)

    assert day["date"] == "2026-08-01"
    assert day["fr"]["fires"] == 2
    assert day["fr"]["closures"] == 2
    assert day["gironde"]["closures"] == 2
    assert day["gironde"]["evacuations"] == 2
    assert day["gironde"]["burn_km2"] == 405.2
    assert day["ca"]["fires"] == 1
    assert day["ca"]["evacuations"] == 1


def test_the_digest_names_the_communes_because_a_count_is_not_an_event():
    """"11 communes" does not say which one was added on Tuesday.

    The whole value of a timeline is that a commune appears or disappears, and a
    number cannot carry that.
    """
    day = digest("2026-08-01", fr=FR, gironde=GIRONDE, ca=CA)

    assert day["gironde"]["evacuated"] == ["Andernos-les-Bains", "Lège-Cap-Ferret"]


def test_a_failed_feed_is_recorded_as_unknown_not_as_zero():
    """A day the Gironde feed was down must never read as a day nothing was shut.

    This is the archive's version of UNAVAILABLE IS NOT NONE, and it matters
    more here than anywhere: in six months nobody will remember that the feed
    was down, and a zero would be read as an observation.
    """
    day = digest("2026-08-01", fr=FR, gironde=None, ca=CA)

    assert day["gironde"] is None, "an absent feed is null, never a set of zeroes"


def test_an_unavailable_gironde_payload_is_also_unknown():
    day = digest("2026-08-01", fr=FR, gironde={"available": False}, ca=CA)

    assert day["gironde"] is None


def test_stale_sources_are_named_so_a_low_count_can_be_explained_later():
    day = digest("2026-08-01", fr=FR, gironde=GIRONDE, ca=CA)

    assert day["fr"]["stale"] == ["atmo"]
    assert day["ca"]["stale"] == []


def test_a_second_run_on_the_same_day_replaces_that_day_rather_than_duplicating():
    first = merge_timeline([], digest("2026-08-01", fr=FR, gironde=GIRONDE, ca=CA))
    heavier = dict(FR, fires=FR["fires"] + [{"id": "c", "frp_total": 9.0}])
    second = merge_timeline(first, digest("2026-08-01", fr=heavier, gironde=GIRONDE, ca=CA))

    assert len(second) == 1
    assert second[0]["fr"]["fires"] == 3, "the later run of a day wins"


def test_the_timeline_stays_in_date_order_however_it_was_written():
    out = []
    for date in ("2026-08-02", "2026-07-30", "2026-08-01"):
        out = merge_timeline(out, digest(date, fr=FR, gironde=GIRONDE, ca=CA))

    assert [d["date"] for d in out] == ["2026-07-30", "2026-08-01", "2026-08-02"]


def test_an_earlier_day_is_never_rewritten_by_a_later_run():
    """The archive is append-only. A backfill that changed history would make
    every earlier reading unreliable, which defeats the point of keeping it."""
    out = merge_timeline([], digest("2026-07-30", fr=FR, gironde=GIRONDE, ca=CA))
    before = json.dumps(out[0], sort_keys=True)

    out = merge_timeline(out, digest("2026-08-01", fr=FR, gironde=None, ca=CA))

    assert json.dumps(out[0], sort_keys=True) == before


def test_the_snapshot_paths_are_dated_and_gzipped():
    paths = snapshot_paths("2026-08-01")

    assert paths["fr"].as_posix() == "archive/2026-08-01/fr-summary.json.gz"
    assert paths["gironde"].as_posix() == "archive/2026-08-01/gironde.json.gz"
    assert paths["ca"].as_posix() == "archive/2026-08-01/ca-summary.json.gz"


def test_the_published_timeline_is_a_copy_of_the_archived_one(tmp_path):
    """The archive lives in git; the site serves from a rebuilt public/.

    build.main rebuilds public/ from nothing every half hour, so unless the
    archived timeline is copied across on each build the page fetches a 404 and
    the record exists but is unreachable.
    """
    from build.main import publish_timeline

    source = tmp_path / "archive" / "timeline.json"
    source.parent.mkdir(parents=True)
    source.write_text('{"days":[{"date":"2026-08-01"}]}')
    out = tmp_path / "out"
    out.mkdir()

    written = publish_timeline(out, source=source)

    assert written == out / "timeline.json"
    assert json.loads(written.read_text())["days"][0]["date"] == "2026-08-01"


def test_a_missing_archive_is_not_an_error_on_the_first_ever_build(tmp_path):
    from build.main import publish_timeline

    out = tmp_path / "out"
    out.mkdir()

    assert publish_timeline(out, source=tmp_path / "nope.json") is None


# --- satellite observations, which are the one thing that IS dated ------------

OBSERVED_HISTORY = {
    # Newest detection observed at 13:00 on the 30th; index 167 is that hour, so
    # the window opens at 14:00 on the 23rd. Both end days are therefore partial.
    "generated_at": "2026-07-30T13:00:00Z",
    "hours": 168,
    "points": [
        [-0.6, 44.8, 167, 2, False],   # 30 Jul 13:00
        [-0.6, 44.8, 160, 1, False],   # 30 Jul 06:00
        [-0.6, 44.8, 100, 2, False],   # 27 Jul 18:00
        [-8.0, 44.8, 100, 0, False],   # same hour, far outside the zone
        [-0.6, 44.8, 0, 1, False],     # 23 Jul 14:00, the partial first day
    ],
}


def test_detections_are_counted_into_the_days_they_were_observed_on():
    """FIRMS timestamps its detections, so unlike every other feed here a day's
    count is a dated observation rather than a reconstruction."""
    from build.archive import observed_days

    days = {d["date"]: d for d in observed_days(OBSERVED_HISTORY)}

    assert days["2026-07-30"]["detections"] == 2
    assert days["2026-07-27"]["detections"] == 2
    assert days["2026-07-23"]["detections"] == 1


def test_a_partial_day_says_so_rather_than_reading_as_a_quiet_one():
    """The window opens mid-afternoon on its first day and closes mid-afternoon
    on its last. A low count on either is our window, not the fire."""
    from build.archive import observed_days

    days = {d["date"]: d for d in observed_days(OBSERVED_HISTORY)}

    assert days["2026-07-23"]["partial"] is True
    assert days["2026-07-30"]["partial"] is True
    assert days["2026-07-27"]["partial"] is False


def test_detections_can_be_counted_inside_one_zone_as_well_as_the_country():
    """The Gironde is half of France's detections right now, so a national count
    alone would not show this fire's own arc."""
    from build.archive import observed_days

    days = {d["date"]: d for d in observed_days(
        OBSERVED_HISTORY, within=(44.8378, -0.5792, 50.0))}

    # The point at lon -8.0 is roughly 580 km west, in the Atlantic.
    assert days["2026-07-27"]["detections"] == 1


def test_an_observation_never_overwrites_a_day_the_archive_recorded():
    """A recorded day is what we served that day. An observation is derived
    afterwards from satellite timestamps. The first outranks the second, always,
    or the archive stops being a record of what readers were actually shown."""
    from build.archive import merge_observed

    recorded = merge_timeline([], digest("2026-07-30", fr=FR, gironde=GIRONDE, ca=CA))
    before = json.dumps(recorded[0], sort_keys=True)

    out = merge_observed(recorded, [{"date": "2026-07-30", "detections": 999,
                                     "partial": False}])

    assert json.dumps(out[0], sort_keys=True) == before


def test_an_observation_fills_a_day_the_archive_never_recorded():
    """Adding a day that was never written is not rewriting history: it is the
    only reading that will ever exist for it, and a gap would read as calm."""
    from build.archive import merge_observed

    out = merge_observed(
        merge_timeline([], digest("2026-08-01", fr=FR, gironde=GIRONDE, ca=CA)),
        [{"date": "2026-07-24", "detections": 2933, "partial": False}])

    assert [d["date"] for d in out] == ["2026-07-24", "2026-08-01"]
    assert out[0]["observed"]["detections"] == 2933
    # It carries no reading of the départemental feeds, because there is none.
    assert out[0].get("gironde") is None
