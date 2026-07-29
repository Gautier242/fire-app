from datetime import datetime, timedelta, timezone
from pathlib import Path

from build.sources.fr.roads import FRANCE_BBOX, PARIS, normalize, paris_now, place_of

FIXTURE = Path("tests/fixtures/fr_roads.html").read_text(encoding="utf-8")

# The fixture was captured 2026-07-29 at 16:13 UTC (the file's own mtime on the
# Bison Fute server). Every "is this closure over" assertion below is relative
# to that instant, so the counts do not rot as the calendar moves.
CAPTURED = datetime(2026, 7, 29, 18, 13)

HEAD = """<html><body><table class="modeleTable"><thead><tr>
<td>Validit&eacute;</td><td>R&eacute;alit&eacute;</td><td>Importance</td><td>D&eacute;p</td>
<td>Axe</td><td>Sens</td><td>Localisation</td><td>Constat</td><td>Fin</td>
<td>&Eacute;v&egrave;nements</td></tr></thead><tbody>"""
TAIL = "</tbody></table></body></html>"


def page(*rows):
    return HEAD + "".join(rows) + TAIL


def row(dep="31", axe="N125", loc="PR24+530..., Lez (sur 2.1 km environ)",
        constat="27/07 06:40", fin="31/07 17:00", events="<span>RFer</span>",
        tr_class=""):
    cls = f' class="{tr_class}"' if tr_class else ""
    return (f"<tr{cls}><td></td><td></td><td>Moyen</td><td>{dep}</td><td>{axe}</td>"
            f"<td>DS</td><td>{loc}</td><td>{constat}</td><td>{fin}</td>"
            f"<td>{events}</td></tr>")


def fake_geocode(place, dep):
    """A geocoder that answers for Lez and knows nothing else."""
    return (42.9, 0.7) if place == "Lez" else None


def no_geocode(place, dep):
    return None


def only(records):
    assert len(records) == 1, records
    return records[0]


# --- the live fixture -----------------------------------------------------

def test_one_record_per_open_closure():
    # 72 data rows in the captured page; 18 of them carry a Fin that had
    # already passed at capture time.
    records = normalize(FIXTURE, geocode=no_geocode, now=CAPTURED)
    assert len(records) == 54


def test_rows_whose_published_end_has_passed_are_excluded():
    records = normalize(FIXTURE, geocode=no_geocode, now=CAPTURED)
    # The Col du Glandon winter closure on the D926: Fin 29/05/26, two months
    # before capture. It is the oldest stale row in the page.
    assert not [r for r in records if r["road"] == "D926"]
    # ...and it is present in the page, so the test is not passing vacuously.
    assert "D926" in FIXTURE


def test_rows_with_no_published_end_are_kept():
    # Two rows in the page have an empty Fin cell. No end time is not an end.
    records = normalize(FIXTURE, geocode=no_geocode, now=CAPTURED)
    assert len([r for r in records if r["until"] is None]) == 2


def test_a_row_with_one_finished_event_among_several_is_still_a_closure():
    # The A47 row at Rive-de-Gier strikes through one of its three event codes
    # (SFer) while Cons and VRet still stand. Striking one event does not end
    # the closure, and the fixture has exactly one such row.
    assert FIXTURE.count('class="fini"') == 1
    records = normalize(FIXTURE, geocode=no_geocode, now=CAPTURED)
    assert [r["place"] for r in records if r["road"] == "A47"] == ["Rive-de-Gier"]


def test_every_live_record_carries_the_full_shape():
    keys = {"id", "kind", "road", "place", "dep", "headline",
            "since", "until", "lat", "lon", "source"}
    for record in normalize(FIXTURE, geocode=no_geocode, now=CAPTURED):
        assert set(record) == keys
        assert record["kind"] == "closed"
        assert record["source"] == "bison_fute"
        assert record["dep"] and record["road"]


def test_ids_are_stable_and_unique():
    first = normalize(FIXTURE, geocode=no_geocode, now=CAPTURED)
    again = normalize(FIXTURE, geocode=no_geocode, now=CAPTURED)
    assert [r["id"] for r in first] == [r["id"] for r in again]
    assert len({r["id"] for r in first}) == len(first)


def test_the_default_clock_is_french_not_the_builders():
    # The page writes local French time and never says so. On a US-Eastern
    # runner a naive datetime.now() leaves every closure alive six hours past
    # its end. Derived here from UTC so the assertion does not simply repeat
    # the implementation.
    utc = datetime.now(timezone.utc)
    offset = utc.astimezone(PARIS).utcoffset()
    assert abs(paris_now() - (utc.replace(tzinfo=None) + offset)) < timedelta(seconds=5)


# --- finished rows --------------------------------------------------------

def test_a_row_struck_through_entirely_is_excluded():
    # `.fini` is line-through in the page's own stylesheet. It sits on event
    # spans, so a row is over only when every one of its events is struck.
    records = normalize(
        page(row(events='<span class="fini">RFer</span><span class="fini">Chan</span>')),
        geocode=fake_geocode, now=CAPTURED)
    assert records == []


def test_a_row_whose_tr_is_struck_through_is_excluded():
    records = normalize(page(row(tr_class="fini")), geocode=fake_geocode, now=CAPTURED)
    assert records == []


# --- rows we cannot use ---------------------------------------------------

def test_a_row_with_no_departement_is_skipped_not_crashed_on():
    records = normalize(page(row(dep=""), row()), geocode=fake_geocode, now=CAPTURED)
    assert only(records)["dep"] == "31"


def test_a_row_with_no_axe_is_skipped_not_crashed_on():
    records = normalize(page(row(axe=""), row()), geocode=fake_geocode, now=CAPTURED)
    assert only(records)["road"] == "N125"


def test_a_short_row_is_skipped_not_crashed_on():
    truncated = "<tr><td></td><td>Moyen</td><td>31</td></tr>"
    records = normalize(page(truncated, row()), geocode=fake_geocode, now=CAPTURED)
    assert only(records)["road"] == "N125"


def test_an_empty_page_returns_no_records():
    assert normalize("", geocode=fake_geocode, now=CAPTURED) == []
    assert normalize(page(), geocode=fake_geocode, now=CAPTURED) == []


def test_a_malformed_page_returns_no_records():
    assert normalize("<html><body><p>Service indisponible", geocode=fake_geocode,
                     now=CAPTURED) == []
    assert normalize("{not html at all", geocode=fake_geocode, now=CAPTURED) == []


# --- the fields -----------------------------------------------------------

def test_the_road_loses_the_publications_trailing_marker():
    # The page suffixes some axes with " *". It is not part of the road name a
    # driver reads off a sign.
    record = only(normalize(page(row(axe="A63 *")), geocode=fake_geocode, now=CAPTURED))
    assert record["road"] == "A63"


def test_the_place_is_the_commune_not_the_kilometre_marker():
    assert place_of("PR24+530..., Lez (sur 2.1 km environ)") == "Lez"
    assert place_of("Saint-Colomban-des-Villards") == "Saint-Colomban-des-Villards"
    assert place_of("PR0+400, Goussainville, sur accotement") == "Goussainville"
    assert place_of("PR34+1 000..., Albi, sur bande d'arret d'urgence") == "Albi"
    assert place_of("PR3+418, Saint-Cloud, situe sur la bretelle d'entree") == "Saint-Cloud"
    assert place_of("") == ""


def test_the_headline_keeps_the_publications_own_wording():
    # Whether the closure is the carriageway or only a slip road is stated in
    # the Localisation text and nowhere else, so it is carried verbatim.
    record = only(normalize(
        page(row(loc="PR0+176..., Lez, situe sur la bretelle de sortie")),
        geocode=fake_geocode, now=CAPTURED))
    assert record["headline"] == "N125 — PR0+176..., Lez, situe sur la bretelle de sortie"


def test_timestamps_become_iso_and_pick_up_the_missing_year():
    record = only(normalize(page(row(constat="27/07 06:40", fin="31/07 17:00")),
                            geocode=fake_geocode, now=CAPTURED))
    assert record["since"] == "2026-07-27T06:40"
    assert record["until"] == "2026-07-31T17:00"


def test_a_time_with_no_date_is_today():
    record = only(normalize(page(row(constat="06:53", fin="23:55")),
                            geocode=fake_geocode, now=CAPTURED))
    assert record["since"] == "2026-07-29T06:53"


def test_a_date_far_in_the_future_is_read_as_last_year():
    # On 3 January, "28/12 22:00" is eleven months ahead if the current year is
    # assumed. Without this it would never expire.
    record = only(normalize(page(row(constat="28/12 22:00", fin="")),
                            geocode=fake_geocode, now=datetime(2027, 1, 3, 9, 0)))
    assert record["since"] == "2026-12-28T22:00"


def test_the_publications_uncertainty_markers_are_not_part_of_the_timestamp():
    # Constat carries a trailing "?" on planned works and "!" on ones due to
    # start today. Neither belongs in a parsed datetime.
    record = only(normalize(page(row(constat="16/11/26 10:00  ?", fin="16/11/26 09:00")),
                            geocode=fake_geocode, now=CAPTURED))
    assert record["since"] == "2026-11-16T10:00"


def test_an_unparseable_timestamp_becomes_none_rather_than_dropping_the_row():
    record = only(normalize(page(row(constat="bient" + "ot", fin="")),
                            geocode=fake_geocode, now=CAPTURED))
    assert record["since"] is None
    assert record["until"] is None


# --- geocoding ------------------------------------------------------------

def test_a_geocoded_row_carries_coordinates():
    record = only(normalize(page(row()), geocode=fake_geocode, now=CAPTURED))
    assert (record["lat"], record["lon"]) == (42.9, 0.7)


def test_a_row_that_cannot_be_geocoded_keeps_its_place_in_the_list():
    # A closure we cannot place is still a shut road. Dropping it would
    # understate how many roads are shut.
    record = only(normalize(page(row(loc="PR1..., Nulle-Part")),
                            geocode=fake_geocode, now=CAPTURED))
    assert record["place"] == "Nulle-Part"
    assert record["lat"] is None and record["lon"] is None


def test_a_geocoder_that_raises_does_not_lose_the_row():
    def angry(place, dep):
        raise RuntimeError("BAN is down")

    record = only(normalize(page(row()), geocode=angry, now=CAPTURED))
    assert record["lat"] is None and record["lon"] is None


def test_a_geocoder_answering_outside_the_box_is_not_believed():
    # Madrid. The box is a coarse rectangle, not a France polygon -- London and
    # Brussels both fall inside it -- so it catches a geocoder that has gone
    # badly wrong, not one that has drifted over a border.
    record = only(normalize(page(row()), geocode=lambda p, d: (40.42, -3.70),
                            now=CAPTURED))
    assert record["lat"] is None and record["lon"] is None


def test_coordinates_that_are_kept_fall_inside_france():
    west, east, south, north = FRANCE_BBOX
    records = normalize(FIXTURE, geocode=lambda p, d: (45.0, 2.0), now=CAPTURED)
    assert records
    for record in records:
        assert west <= record["lon"] <= east
        assert south <= record["lat"] <= north


def test_each_place_is_geocoded_once_however_many_rows_name_it():
    calls = []

    def counting(place, dep):
        calls.append((place, dep))
        return (42.9, 0.7)

    normalize(page(row(), row(), row()), geocode=counting, now=CAPTURED)
    assert calls == [("Lez", "31")]


def test_the_geocoder_is_called_at_most_cap_times():
    calls = []

    def counting(place, dep):
        calls.append(place)
        return (45.0, 2.0)

    records = normalize(
        page(row(loc="PR1..., Un"), row(loc="PR1..., Deux"), row(loc="PR1..., Trois")),
        geocode=counting, cap=2, now=CAPTURED)
    assert len(calls) == 2
    # The row past the cap is still published, just without coordinates.
    assert len(records) == 3
    assert records[2]["lat"] is None
