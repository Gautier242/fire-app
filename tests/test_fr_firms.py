from datetime import datetime, timezone
from pathlib import Path

from build.sources.fr.firms import CONFIDENCE_RANK, normalize

FIXTURE = Path("tests/fixtures/fr_firms.csv").read_text(encoding="utf-8")

HEADER = ("latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,"
          "confidence,version,bright_ti5,frp,daynight\n")


def rows(*lines):
    return HEADER + "".join(line + "\n" for line in lines)


def detection(lat, lon, frp="10.0", time="1238", confidence="nominal",
              date="2026-07-29"):
    return (f"{lat},{lon},330.0,0.4,0.4,{date},{time},N20,{confidence},"
            f"2.0NRT,300.0,{frp},D")


def by_id(incidents):
    return {i["id"]: i for i in incidents}


def lacanau(incidents):
    return max(incidents, key=lambda i: i["detections"])


# The fixture was captured 2026-07-29; pin the clock so the future-timestamp
# guard does not start rejecting it a day later.
NOW = datetime(2026, 7, 29, 18, 0, tzinfo=timezone.utc)


def test_empty_csv_returns_nothing():
    assert normalize("") == []
    assert normalize(HEADER) == []


def test_the_lacanau_fire_is_one_incident_not_forty_eight():
    incidents = normalize(FIXTURE, now=NOW)
    fire = lacanau(incidents)
    assert fire["detections"] == 48
    assert round(fire["lat"], 3) == 44.863
    assert round(fire["lon"], 3) == -0.877


def test_the_fixture_clusters_to_nine_incidents():
    # 48 Lacanau detections plus 8 detections with no neighbour within 5 km.
    assert len(normalize(FIXTURE, now=NOW)) == 9


def test_detections_five_kilometres_apart_stay_two_incidents():
    incidents = normalize(rows(
        detection(44.00000, 3.00000),
        detection(44.04496, 3.00000),  # 5.0 km due north
    ), now=NOW)
    assert len(incidents) == 2


def test_detections_within_the_cluster_radius_become_one_incident():
    incidents = normalize(rows(
        detection(44.00000, 3.00000),
        detection(44.01000, 3.00000),  # 1.1 km due north
    ), now=NOW)
    assert len(incidents) == 1
    assert incidents[0]["detections"] == 2


def test_a_chain_of_close_detections_is_a_single_fire_front():
    # Single linkage: each step is under 1.5 km, so the front joins up even
    # though its ends are 3 km apart.
    incidents = normalize(rows(
        detection(44.00000, 3.00000),
        detection(44.01000, 3.00000),
        detection(44.02000, 3.00000),
        detection(44.03000, 3.00000),
    ), now=NOW)
    assert len(incidents) == 1
    assert incidents[0]["detections"] == 4


def test_acq_time_is_hhmm_and_a_short_value_is_minutes_past_midnight():
    incidents = normalize(rows(
        detection(44.0, 3.0, time="45"),
        detection(46.0, 5.0, time="1238"),
        detection(48.0, 1.0, time="0111"),
        detection(50.0, 2.0, time="5"),
    ), now=NOW)
    seen = sorted(i["first_seen"] for i in incidents)
    assert seen == [
        "2026-07-29T00:05:00Z",
        "2026-07-29T00:45:00Z",
        "2026-07-29T01:11:00Z",
        "2026-07-29T12:38:00Z",
    ]


def test_first_and_last_seen_span_the_cluster():
    fire = lacanau(normalize(FIXTURE, now=NOW))
    assert fire["first_seen"] == "2026-07-28T12:19:00Z"
    assert fire["last_seen"] == "2026-07-29T12:19:00Z"


def test_confidence_uses_the_word_vocabulary_the_feed_actually_sends():
    # The documentation says l/n/h. The feed says low/nominal/high, and a
    # filter written from the documentation matches nothing, so the vocabulary
    # is asserted against the captured fixture rather than against the docs.
    in_fixture = {line.split(",")[8] for line in FIXTURE.splitlines()[1:]}
    assert in_fixture == {"low", "nominal", "high"}
    assert set(CONFIDENCE_RANK) == in_fixture


def test_an_incident_takes_the_best_confidence_in_its_cluster():
    incidents = normalize(rows(
        detection(44.00, 3.00, confidence="low"),
        detection(44.01, 3.00, confidence="high"),
        detection(44.02, 3.00, confidence="nominal"),
    ), now=NOW)
    assert incidents[0]["confidence"] == "high"


def test_an_unknown_confidence_word_downgrades_but_keeps_the_detection():
    incidents = normalize(rows(
        detection(44.00, 3.00, confidence="7"),
    ), now=NOW)
    assert incidents[0]["detections"] == 1
    assert incidents[0]["confidence"] == "low"


def test_rows_outside_the_france_box_are_excluded():
    incidents = normalize(rows(
        detection(44.0, 3.0),        # inside
        detection(64.6456, 24.428),  # Finland
        detection(37.0, 3.0),        # south of the box
        detection(45.0, 14.0),       # east of the box
        detection(45.0, -12.0),      # Atlantic
    ), now=NOW)
    assert len(incidents) == 1
    assert incidents[0]["lat"] == 44.0


def test_the_fixture_out_of_box_rows_never_reach_an_incident():
    for incident in normalize(FIXTURE, now=NOW):
        assert 41.0 <= incident["lat"] <= 51.5
        assert -5.5 <= incident["lon"] <= 10.0


def test_a_malformed_row_is_skipped_and_the_rest_survive():
    incidents = normalize(rows(
        "not,a,row",
        ",,,,,,,,,,,,",
        "abc,def,330.0,0.4,0.4,2026-07-29,1238,N20,nominal,2.0NRT,300.0,1.0,D",
        detection(44.0, 3.0, date="not-a-date"),
        detection(44.0, 3.0, time="9999"),
        detection(44.0, 3.0, frp="nope"),
        detection(46.0, 5.0),
    ), now=NOW)
    assert len(incidents) == 1
    assert incidents[0]["detections"] == 1


def test_a_repeated_header_row_is_skipped():
    # fetch() concatenates two satellite files, so the second header lands
    # mid-payload. It must fall out as a malformed row.
    incidents = normalize(rows(
        detection(44.0, 3.0),
        HEADER.strip(),
        detection(46.0, 5.0),
    ), now=NOW)
    assert len(incidents) == 2


def test_a_detection_dated_in_the_future_is_dropped():
    incidents = normalize(rows(
        detection(44.0, 3.0, date="2027-01-01"),
        detection(46.0, 5.0),
    ), now=NOW)
    assert len(incidents) == 1
    assert incidents[0]["lat"] == 46.0


def test_one_big_fire_is_distinguishable_from_ten_small_ones():
    big = normalize(rows(detection(44.0, 3.0, frp="290.0")), now=NOW)[0]
    many = normalize(rows(*[detection(44.0 + 0.001 * n, 3.0, frp="29.0")
                            for n in range(10)]), now=NOW)[0]
    assert big["frp_total"] == 290.0 and many["frp_total"] == 290.0
    assert big["frp_max"] == 290.0
    assert many["frp_max"] == 29.0
    assert big["detections"] == 1 and many["detections"] == 10


def test_the_lacanau_incident_carries_its_totals_and_peak():
    fire = lacanau(normalize(FIXTURE, now=NOW))
    assert fire["frp_total"] == 2997.97
    assert fire["frp_max"] == 290.34


def test_an_incident_carries_the_documented_shape():
    incident = normalize(rows(detection(44.0, 3.0, frp="12.5")), now=NOW)[0]
    assert incident == {
        "id": "firms-44.000,3.000",
        "lat": 44.0,
        "lon": 3.0,
        "detections": 1,
        "frp_total": 12.5,
        "frp_max": 12.5,
        "first_seen": "2026-07-29T12:38:00Z",
        "last_seen": "2026-07-29T12:38:00Z",
        "bbox": [3.0, 44.0, 3.0, 44.0],
        "confidence": "nominal",
        "points": [[3.0, 44.0, "2026-07-29T12:38:00Z"]],
        "source": "firms",
    }


def test_the_bounding_box_spans_every_detection():
    fire = lacanau(normalize(FIXTURE, now=NOW))
    assert fire["bbox"] == [-0.88454, 44.85499, -0.86951, 44.87125]


def test_every_detection_is_kept_as_a_point_for_the_mask_and_spread_view():
    fire = lacanau(normalize(FIXTURE, now=NOW))
    assert len(fire["points"]) == fire["detections"]
    minlon, minlat, maxlon, maxlat = fire["bbox"]
    for lon, lat, seen in fire["points"]:
        assert minlon <= lon <= maxlon and minlat <= lat <= maxlat
        assert seen.endswith("Z")


def test_incident_ids_are_derived_from_the_centre_so_they_survive_a_rebuild():
    # The industrial mask matches a cluster to itself across days; an index
    # would renumber the moment an unrelated fire appears.
    first = normalize(rows(detection(44.0, 3.0)), now=NOW)
    second = normalize(rows(detection(48.0, 1.0), detection(44.0, 3.0)), now=NOW)
    assert by_id(first).keys() < by_id(second).keys()


def test_incidents_are_ordered_by_intensity():
    incidents = normalize(rows(
        detection(44.0, 3.0, frp="5.0"),
        detection(46.0, 5.0, frp="500.0"),
        detection(48.0, 1.0, frp="50.0"),
    ), now=NOW)
    assert [i["frp_total"] for i in incidents] == [500.0, 50.0, 5.0]


def test_the_parse_is_bounded():
    payload = rows(*[detection(44.0 + 0.1 * n, 3.0) for n in range(20)])
    assert len(normalize(payload, now=NOW, limit=5)) == 5
