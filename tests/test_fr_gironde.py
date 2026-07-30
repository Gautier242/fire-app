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
