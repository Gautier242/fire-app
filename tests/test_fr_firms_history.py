"""The seven-day burn trail: where fire has already been.

The trail is the most dangerous layer on the map to get wrong, because a gap in
it looks exactly like ground that did not burn. Every test here is about one of
three failures: claiming safety from absence, claiming a perimeter from
detections, or counting a Spanish fire as French.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from build.flares import FlareRegistry
from build.sources.fr.firms_history import (
    BAND_CUTS, HOURS, MAX_POINTS, normalize,
)

FIXTURE = Path("tests/fixtures/fr_firms_7d.csv").read_text(encoding="utf-8")

HEADER = ("latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,"
          "confidence,version,bright_ti5,frp,daynight\n")

# The fixture spans 2026-07-22..29, the real window measured that day. Pin the
# clock so the future-timestamp guard does not start rejecting it tomorrow.
NOW = datetime(2026, 7, 29, 18, 0, tzinfo=timezone.utc)

# The newest row in the fixture, and therefore index HOURS - 1.
ANCHOR = "2026-07-29T12:00:00Z"

SHAPES = json.loads(Path("public/static/fr/departements.geojson").read_text())

LACANAU = (44.863, -0.877)
LEON = (42.657, -5.409)      # inside the bbox, outside the border
LA_MEDE = (43.395, 5.106)    # refinery


def rows(*lines):
    return HEADER + "".join(line + "\n" for line in lines)


def detection(lat, lon, frp="10.0", time="1219", confidence="nominal",
              date="2026-07-29"):
    return (f"{lat},{lon},330.0,0.4,0.4,{date},{time},N20,{confidence},"
            f"2.0NRT,300.0,{frp},D")


def registry_for(lat, lon, days):
    """A published flare registry that has seen one site on `days` dates."""
    return FlareRegistry.from_payload({"sites": [
        {"lat": lat, "lon": lon, "days": days},
    ]})


def hours_of(payload):
    return sorted({point[2] for point in payload["points"]})


# --- the contract the frontend already consumes -----------------------------

def test_the_payload_carries_the_history_contract_and_nothing_else():
    # public/js/history.js reads generated_at, hours, points and wind. A missing
    # key is a blank scrubber, which on this map reads as no fire.
    payload = normalize(FIXTURE, NOW, shapes=SHAPES)
    assert set(payload) == {"generated_at", "hours", "points", "wind"}
    assert payload["hours"] == HOURS == 168


def test_a_point_is_lon_lat_hour_band_foreign():
    payload = normalize(rows(detection(44.863, -0.877, frp="150.0")), NOW,
                        shapes=SHAPES)
    assert payload["points"] == [[-0.877, 44.863, 167, 2, False]]


def test_wind_is_empty_because_firms_carries_no_weather():
    # Canada's history gets wind from the same WFS row as the hotspot. FIRMS has
    # no such column, and inventing one per hour from an incident's forecast
    # would put a modelled arrow on an observed layer.
    assert normalize(FIXTURE, NOW, shapes=SHAPES)["wind"] == []


# --- absence is never safety ------------------------------------------------

def test_generated_at_is_the_last_time_a_satellite_looked_not_the_build_clock():
    """The single most important assertion in this file.

    If generated_at were the build clock, an empty trail would read as "as of
    now, nothing is burning". It must instead read as "the last time we looked
    was 12:00, and this is what we saw" — a statement about our data.
    """
    payload = normalize(FIXTURE, NOW, shapes=SHAPES)
    assert payload["generated_at"] == ANCHOR
    assert payload["generated_at"] != NOW.strftime("%Y-%m-%dT%H:%M:%SZ")


def test_the_anchor_is_the_newest_detection_in_the_box_not_in_the_feed():
    """The feed is Europe-wide, and its newest row is usually not French.

    Measured 2026-07-30 04:27Z: newest row in the Europe file 22:57Z, newest
    inside the France box 14:00Z. Anchoring on the feed would slide the whole
    French trail eight hours younger than the passes that produced it.
    """
    payload = normalize(rows(
        detection(*LACANAU, date="2026-07-29", time="1219"),
        detection(64.6456, 24.428, date="2026-07-29", time="2257"),  # Finland
    ), NOW, shapes=SHAPES)
    assert payload["generated_at"] == ANCHOR
    assert [p[2] for p in payload["points"]] == [HOURS - 1]


def test_a_cloud_gap_is_absent_hours_not_a_claim_of_no_fire():
    """2026-07-24 and 07-25 are missing from the fixture: two overcast days.

    The gap must survive into the payload as hours with no points, so the
    scrubber steps over them, and it must not be compressed away by re-indexing
    the surviving passes onto consecutive hours — that would silently assert the
    fire went out and came back.
    """
    payload = normalize(FIXTURE, NOW, shapes=SHAPES)
    assert hours_of(payload) == [0, 24, 96, 120, 134, 144, 158, 167]
    # 07-24T00:00 through 07-25T23:00 are indices 36..83 inclusive.
    assert not [h for h in hours_of(payload) if 36 <= h <= 83]
    assert payload["hours"] == HOURS, "the window must not shrink to fit the data"


def test_an_unparseable_payload_returns_an_empty_trail_never_a_partial_one():
    for junk in ("", None, HEADER, "<html>503</html>"):
        payload = normalize(junk, NOW, shapes=SHAPES)
        assert payload == {"generated_at": None, "hours": HOURS,
                           "points": [], "wind": []}


# --- a bounding box is not a border ----------------------------------------

def test_a_spanish_detection_inside_the_box_is_kept_and_flagged_foreign():
    # Leon was once the largest "French" fire on this map. It is kept, because
    # fires do not stop at borders, and flagged, because it is not French.
    payload = normalize(rows(
        detection(*LACANAU, frp="50.0"),
        detection(*LEON, frp="300.0"),
    ), NOW, shapes=SHAPES)
    flags = {(round(p[1], 3), round(p[0], 3)): p[4] for p in payload["points"]}
    assert flags[LACANAU] is False
    assert flags[LEON] is True


def test_foreign_is_computed_server_side_from_real_borders():
    """history.js guesses `foreign` with a hardcoded Canadian latitude test.

    Applied to France that heuristic calls every detection south of 45 foreign —
    Provence, Corsica and the whole Pyrenean front — and every Spanish one north
    of 45 French. The flag has to arrive already computed.
    """
    payload = normalize(rows(detection(43.5, 5.5)), NOW, shapes=SHAPES)
    assert payload["points"][0][4] is False, "Provence is not foreign"


def test_without_border_shapes_nothing_is_claimed_foreign():
    # Matches build.main's existing fallback for the summary: a missing geojson
    # must not fade the entire French trail to a quarter opacity.
    payload = normalize(rows(detection(*LEON)), NOW, shapes=None)
    assert payload["points"][0][4] is False


def test_rows_outside_the_bounding_box_never_reach_the_trail():
    payload = normalize(rows(
        detection(44.0, 3.0),          # inside
        detection(64.6456, 24.428),    # Finland
        detection(37.0, 3.0),          # south of the box
        detection(45.0, 14.0),         # east of the box
        detection(45.0, -12.0),        # Atlantic
    ), NOW, shapes=SHAPES)
    assert [p[:2] for p in payload["points"]] == [[3.0, 44.0]]


# --- the hour index --------------------------------------------------------

def test_the_hour_index_spans_the_window_with_the_newest_pass_largest():
    payload = normalize(FIXTURE, NOW, shapes=SHAPES)
    assert payload["points"], "the fixture produced no points"
    assert all(0 <= p[2] < HOURS for p in payload["points"])
    assert max(p[2] for p in payload["points"]) == HOURS - 1


def test_a_detection_older_than_the_window_is_dropped_not_clamped():
    # The fixture holds one Lacanau row at 2026-07-22T12:19, exactly 168 h
    # before the anchor. Clamping it to index 0 would date week-old heat to the
    # start of the window and draw it as part of the trail.
    payload = normalize(FIXTURE, NOW, shapes=SHAPES)
    assert len([p for p in payload["points"] if p[2] == 0]) == 2


def test_a_detection_dated_after_the_build_clock_is_dropped():
    payload = normalize(rows(
        detection(44.0, 3.0, date="2027-01-01"),
        detection(46.0, 5.0),
    ), NOW, shapes=SHAPES)
    assert [p[:2] for p in payload["points"]] == [[5.0, 46.0]]


def test_normalize_never_reads_the_clock_itself():
    # A module that called datetime.now() would make the future-guard and the
    # window untestable, and would drift between the summary and the trail.
    with pytest.raises(TypeError):
        normalize(FIXTURE)


# --- bands from FRP, never from confidence ---------------------------------

def test_bands_split_on_the_documented_frp_cut_values():
    assert BAND_CUTS == (10.0, 100.0)
    payload = normalize(rows(
        detection(44.00, 3.00, frp="0.0"),
        detection(44.10, 3.00, frp="9.99"),
        detection(44.20, 3.00, frp="10.0"),
        detection(44.30, 3.00, frp="99.99"),
        detection(44.40, 3.00, frp="100.0"),
        detection(44.50, 3.00, frp="629.84"),   # the hottest pixel measured
    ), NOW, shapes=SHAPES)
    by_lat = {p[1]: p[3] for p in payload["points"]}
    assert [by_lat[lat] for lat in (44.0, 44.1, 44.2, 44.3, 44.4, 44.5)] == \
        [0, 0, 1, 1, 2, 2]


def test_confidence_never_decides_a_band():
    # The feed sends the words low/nominal/high, and a low-confidence pixel is
    # still 200 MW of heat. Banding on confidence would draw the hottest
    # detection in the fixture as the coolest.
    payload = normalize(rows(detection(44.0, 3.0, frp="200.0", confidence="low")),
                        NOW, shapes=SHAPES)
    assert payload["points"][0][3] == 2


def test_a_malformed_frp_loses_the_row_not_the_run():
    payload = normalize(rows(
        detection(44.0, 3.0, frp="nope"),
        detection(46.0, 5.0, frp="12.0"),
    ), NOW, shapes=SHAPES)
    assert [p[:2] for p in payload["points"]] == [[5.0, 46.0]]


# --- the industrial mask ---------------------------------------------------

def test_an_industrial_site_with_only_two_days_of_history_is_not_masked():
    """Showing a refinery is a smaller failure than hiding a fire.

    La Mede burns every day in reality, but two days of record cannot tell a
    refinery from a two-day wildfire, so nothing is masked below three.
    """
    payload = normalize(FIXTURE, NOW, shapes=SHAPES, registry=registry_for(
        *LA_MEDE, ["2026-07-28", "2026-07-29"]))
    lons = {round(p[0], 3) for p in payload["points"]}
    assert LA_MEDE[1] in lons


def test_a_site_burning_on_most_days_of_a_full_record_is_masked():
    # The other half of the same rule: with a fortnight of record and heat at
    # one spot on six days of it, the mask must actually fire, or the trail
    # carries a permanent smear over Fos-sur-Mer.
    payload = normalize(FIXTURE, NOW, shapes=SHAPES, registry=registry_for(
        *LA_MEDE, [f"2026-07-{day}" for day in range(20, 30)]))
    lons = {round(p[0], 3) for p in payload["points"]}
    assert LA_MEDE[1] not in lons
    assert LACANAU[1] in lons, "masking a refinery must not cost the real fire"


def test_without_a_registry_nothing_is_masked():
    payload = normalize(FIXTURE, NOW, shapes=SHAPES)
    assert LA_MEDE[1] in {round(p[0], 3) for p in payload["points"]}


def test_the_mask_does_not_move_the_anchor_off_the_last_observed_pass():
    # A refinery detection is still proof a satellite looked. Anchoring after
    # the mask would backdate generated_at and understate how fresh the look was.
    payload = normalize(rows(
        detection(*LACANAU, date="2026-07-28", time="1300"),
        detection(*LA_MEDE, date="2026-07-29", time="1219"),
    ), NOW, shapes=SHAPES, registry=registry_for(
        *LA_MEDE, [f"2026-07-{day}" for day in range(20, 30)]))
    assert payload["generated_at"] == ANCHOR
    assert [p[2] for p in payload["points"]] == [144]


# --- the cap ---------------------------------------------------------------

def test_the_cap_truncates_worst_first():
    payload = normalize(rows(
        detection(44.0, 3.0, frp="5.0"),
        detection(45.0, 3.0, frp="500.0"),
        detection(46.0, 3.0, frp="50.0"),
    ), NOW, shapes=SHAPES, cap=2)
    assert [p[1] for p in payload["points"]] == [45.0, 46.0]


def test_the_cap_keeps_a_hot_foreign_detection_over_a_cold_french_one():
    # Worst-first is worst-first. A 300 MW fire ten kilometres into Spain
    # matters more to a reader in the Pyrenees than a 1 MW French pixel.
    payload = normalize(rows(
        detection(*LACANAU, frp="1.0"),
        detection(*LEON, frp="300.0"),
    ), NOW, shapes=SHAPES, cap=1)
    assert payload["points"][0][4] is True


def test_the_default_cap_clears_a_measured_bad_week():
    """Measured 2026-07-30 against both live 7d feeds: 9,583 detections inside
    the France box, 7,886 of them inside the border.

    The design brief projected ~2,100 from a 304-detection 24 h sample. The
    sample was a quiet hour; 2026-07-24 alone held 2,933. The default has to
    clear the measurement, not the projection.
    """
    assert MAX_POINTS >= 2 * 9583


def test_a_repeated_header_row_is_skipped():
    # fetch() concatenates two satellite files, so the second header lands
    # mid-payload and must fall out as a malformed row.
    payload = normalize(rows(
        detection(44.0, 3.0),
        HEADER.strip(),
        detection(46.0, 5.0),
    ), NOW, shapes=SHAPES)
    assert len(payload["points"]) == 2


def test_the_fixture_normalizes_within_the_declared_shape():
    payload = normalize(FIXTURE, NOW, shapes=SHAPES)
    assert len(payload["points"]) == 11
    for point in payload["points"]:
        assert len(point) == 5
        lon, lat, hour, band, foreign = point
        assert -5.5 <= lon <= 10.0 and 41.0 <= lat <= 51.5
        assert 0 <= hour < HOURS
        assert band in (0, 1, 2)
        assert isinstance(foreign, bool)
