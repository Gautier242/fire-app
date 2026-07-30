"""The Gironde departement's own crisis feeds.

Everything here is somebody else's server describing a live emergency, so the
tests are mostly about the difference between "we could not ask" and "there is
nothing" -- the two states this map must never conflate.
"""
from build.sources.fr import gironde


def _closure(objectid=1, road="D807", cause="Incendie", closure="Fermeture totale",
             start="2026-07-24+02:00", reopen=None, coords=None):
    return {
        "type": "Feature",
        "properties": {
            "OBJECTID": objectid,
            "voie_designation": road,
            "evenements_de_crise_cause_de_la_fermeture": cause,
            "evenements_de_crise_fermeture": closure,
            "evenements_de_crise_libelle": "Incendie de Saumos",
            "evenements_de_crise_date_heure_de_debut_de_fermeture": start,
            "evenements_de_crise_date_heure_de_reouverture": reopen,
        },
        "geometry": {"type": "LineString",
                     "coordinates": coords or [[-1.21, 44.89], [-1.11, 44.87]]},
    }


def _commune(name="Lacanau", insee=33214, coords=None):
    return {
        "type": "Feature",
        "properties": {"nom": name, "code_insee": insee, "statut": "Commune simple"},
        "geometry": {"type": "Polygon",
                     "coordinates": coords if coords is not None
                     else [[[-1.2, 44.9], [-1.1, 44.9], [-1.1, 45.0], [-1.2, 44.9]]]},
    }


def test_a_closed_road_keeps_its_cause_and_its_line():
    out = gironde.normalize({"roads": {"features": [_closure()]}},
                            now="2026-07-30T12:00:00Z")

    road = out["closures"][0]
    assert road["road"] == "D807"
    assert road["cause"] == "Incendie"
    assert road["fire_related"] is True
    # A line, not a point: Bison Fute gives a dot on a road and this gives the
    # stretch that is shut, which is what a reader has to drive around.
    assert road["geometry"]["type"] == "LineString"


def test_a_closure_for_some_other_reason_is_kept_but_not_called_a_fire():
    """Marked rather than dropped: a shut road matters whatever shut it.

    Silently treating every closure as a fire closure would let roadworks imply a
    fire, which is the mirror of the Bison Fute defect.
    """
    out = gironde.normalize(
        {"roads": {"features": [_closure(cause="Travaux"), _closure(objectid=2)]}},
        now="2026-07-30T12:00:00Z")

    causes = {c["road"]: c["fire_related"] for c in out["closures"]}
    assert len(out["closures"]) == 2
    assert causes["D807"] is True
    assert list(c["fire_related"] for c in out["closures"]).count(False) == 1


def test_a_reopened_road_is_not_reported_as_shut():
    out = gironde.normalize(
        {"roads": {"features": [_closure(reopen="2026-07-29+02:00")]}},
        now="2026-07-30T12:00:00Z")

    assert out["closures"] == []


def test_a_closure_with_no_geometry_is_dropped_rather_than_drawn_at_null_island():
    broken = _closure()
    broken["geometry"] = None

    out = gironde.normalize({"roads": {"features": [broken]}},
                            now="2026-07-30T12:00:00Z")

    assert out["closures"] == []


def test_an_evacuated_commune_carries_its_name_and_insee():
    out = gironde.normalize({"evacuations": {"features": [_commune()]}},
                            now="2026-07-30T12:00:00Z")

    commune = out["evacuations"][0]
    assert commune["name"] == "Lacanau"
    # The departement code comes from the INSEE code, never a postcode.
    assert commune["insee"] == "33214"
    assert commune["dep"] == "33"
    assert commune["geometry"]["type"] == "Polygon"


def test_a_commune_without_geometry_is_dropped():
    ghost = _commune(name="Nowhere")
    ghost["geometry"] = {"type": "Polygon", "coordinates": []}

    out = gironde.normalize({"evacuations": {"features": [ghost]}},
                            now="2026-07-30T12:00:00Z")

    assert out["evacuations"] == []


def test_the_burn_perimeter_is_observed_and_says_so():
    """An official perimeter is not a model and must not carry a model's caveat.

    The computed hull in build/fire_boundary.py is validated=false and draws
    dashed. This is the departement's own mapping of ground that burned, so it is
    observed, and the frontend has to be able to tell them apart without reading a
    caption.
    """
    burn = {"type": "Feature",
            "properties": {"Shape_Area": 405170600.0},
            "geometry": {"type": "Polygon",
                         "coordinates": [[[-1.2, 44.8], [-1.0, 44.8],
                                          [-1.0, 45.0], [-1.2, 44.8]]]}}

    out = gironde.normalize({"burn": {"features": [burn]}},
                            now="2026-07-30T12:00:00Z")

    perimeter = out["burn_area"]
    assert perimeter["observed"] is True
    assert "validated" not in perimeter, "an observation has nothing to validate"
    assert perimeter["area_km2"] == 405.2


def test_a_failed_fetch_is_unavailable_and_not_an_empty_scene():
    """The whole risk of depending on somebody else's server, in one test.

    An empty list means the departement says nothing is shut. A failed fetch means
    we could not ask. Rendering the second as the first tells a reader the roads
    are open when we have no idea.
    """
    out = gironde.normalize(None, now="2026-07-30T12:00:00Z")

    assert out["available"] is False
    assert out["closures"] == []
    assert out["evacuations"] == []
    assert out["burn_area"] is None

    asked = gironde.normalize({"roads": {"features": []},
                               "evacuations": {"features": []}},
                              now="2026-07-30T12:00:00Z")
    assert asked["available"] is True


def test_a_single_failed_layer_does_not_sink_the_others():
    out = gironde.normalize({"roads": None, "evacuations": {"features": [_commune()]}},
                            now="2026-07-30T12:00:00Z")

    assert out["evacuations"], "an evacuation order must survive a road-layer failure"
    assert out["layers"]["roads"] is False
    assert out["layers"]["evacuations"] is True


def test_the_payload_names_the_departement_it_covers():
    """A reader in Landes must not read an empty Gironde layer as calm."""
    out = gironde.normalize({"roads": {"features": []}}, now="2026-07-30T12:00:00Z")

    assert out["covers"] == ["33"]
    assert out["source"] == "Département de la Gironde"


def test_the_cap_bounds_what_a_live_incident_can_return():
    many = {"roads": {"features": [_closure(objectid=i) for i in range(50)]}}

    out = gironde.normalize(many, now="2026-07-30T12:00:00Z", cap=10)

    assert len(out["closures"]) == 10
    assert out["truncated"] is True


def test_geometry_is_simplified_without_losing_a_road_or_a_commune():
    """1.4 MB is too heavy for a phone, and nothing may vanish to shrink it.

    Measured on the live payload: 20,795 closure vertices and 17,786 commune
    vertices. A tolerance is applied, but a road simplified into a straight line
    between two towns would point a reader down a different street, and a commune
    that collapsed would tell those households no order covers them -- the failure
    build/simplify.py already documents for Kilgard Road.
    """
    # A near-straight road surveyed at high resolution: the wobble is 0.00002 deg,
    # about 2 m, well under the 25 m tolerance, so these are redundant positions
    # rather than real corners. A 0.0004 deg zigzag would be ~44 m of genuine
    # deviation and must NOT be flattened -- that is a real bend in a real road.
    zigzag = [[-1.20 + i * 0.001, 44.89 + (0.00002 if i % 2 else 0)] for i in range(60)]
    payload = {"roads": {"features": [_closure(coords=zigzag)]},
               "evacuations": {"features": [_commune()]}}

    out = gironde.normalize(payload, now="2026-07-30T12:00:00Z")

    road = out["closures"][0]["geometry"]["coordinates"]
    assert len(road) >= 2, "a closed road must stay drawable"
    assert len(road) < 60, "the zigzag should have been reduced"
    # The ends are where the closure starts and stops, so they must survive exactly.
    assert road[0][0] == -1.2 and road[-1][0] == round(-1.20 + 59 * 0.001, 5)
    assert out["evacuations"][0]["geometry"]["coordinates"], "the commune survived"


def test_a_tiny_commune_is_kept_at_full_resolution_rather_than_collapsed():
    tiny = _commune(name="Hameau", coords=[[[-1.2000, 44.9000], [-1.1996, 44.9000],
                                            [-1.1996, 44.9004], [-1.2000, 44.9000]]])

    out = gironde.normalize({"evacuations": {"features": [tiny]}},
                            now="2026-07-30T12:00:00Z")

    assert len(out["evacuations"]) == 1
    ring = out["evacuations"][0]["geometry"]["coordinates"][0]
    assert len(ring) >= 4, "a collapsed ring encloses nothing and deletes the order"


def test_a_real_bend_in_a_road_survives_simplification():
    """The other half of the tolerance, found by getting a fixture wrong.

    A 0.0004 deg deviation is about 44 m -- a genuine bend, further from the
    straight line than the width of the road. Flattening it would draw the closure
    across ground the road does not cross, which is how a simplified map sends
    somebody down the wrong street.
    """
    bend = [[-1.20 + i * 0.001, 44.89 + (0.0004 if i % 2 else 0)] for i in range(60)]

    out = gironde.normalize({"roads": {"features": [_closure(coords=bend)]}},
                            now="2026-07-30T12:00:00Z")

    assert len(out["closures"][0]["geometry"]["coordinates"]) == 60, (
        "44 m of real deviation is a corner, not noise")


def test_the_burn_perimeter_layer_is_discovered_rather_than_hardcoded():
    """The departement names each perimeter for its survey date.

    Observed titles: emprise_27_07_26, and an earlier ec_26_07_26_8h. So the day a
    new survey lands, a hardcoded emprise_27_07_26 keeps returning the old polygon
    and the map shows a three-day-old burn as if it were current -- stale data
    wearing a fresh timestamp, which is worse than no polygon.
    """
    catalogue = {"results": [
        {"title": "emprise_27_07_26", "url": "https://x/services/emprise_27_07_26/FeatureServer",
         "modified": 1000},
        {"title": "emprise_29_07_26", "url": "https://x/services/emprise_29_07_26/FeatureServer",
         "modified": 3000},
        {"title": "communes_evacuees", "url": "https://x/services/communes_evacuees/FeatureServer",
         "modified": 4000},
    ]}

    found = gironde.newest_burn_layer(catalogue)

    # The layer index is appended, matching the other layer constants.
    assert found["url"] == "https://x/services/emprise_29_07_26/FeatureServer/0"
    # The survey date is read from the title so the interface can say how old the
    # perimeter is rather than implying it is live.
    assert found["surveyed"] == "2026-07-29"


def test_an_undiscoverable_perimeter_falls_back_without_inventing_a_date():
    assert gironde.newest_burn_layer(None) is None
    assert gironde.newest_burn_layer({"results": []}) is None
    # A title that does not carry a parseable date is still usable as a layer, but
    # must not be given a made-up survey date.
    odd = {"results": [{"title": "emprise_finale", "url": "https://x/e/FeatureServer",
                        "modified": 1}]}
    assert gironde.newest_burn_layer(odd)["surveyed"] is None


def test_the_payload_reports_when_the_perimeter_was_surveyed():
    burn = {"type": "Feature", "properties": {"Shape_Area": 405170600.0},
            "geometry": {"type": "Polygon",
                         "coordinates": [[[-1.2, 44.8], [-1.0, 44.8],
                                          [-1.0, 45.0], [-1.2, 44.8]]]}}

    out = gironde.normalize({"burn": {"features": [burn]},
                             "burn_surveyed": "2026-07-27"},
                            now="2026-07-30T12:00:00Z")

    assert out["burn_area"]["surveyed"] == "2026-07-27"
