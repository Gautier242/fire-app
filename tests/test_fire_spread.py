"""Rothermel surface fire spread.

Approved by the site owner after being told that a wrong prediction can send
somebody into a fire and that nobody here can validate the output against real
fire behaviour. The mitigation is that this is verified as a correct
implementation of a published model -- a narrower claim than "validated", and one
the UI states.

The tests below are mostly invariants: relationships that must hold whatever the
absolute numbers are. They catch the errors that actually happen -- a sign flip,
a unit mix-up, an exponent typo -- without depending on a figure nobody here can
independently source.
"""
from build.fire_spread import MIDFLAME_FACTOR, FUEL_MODELS, project, rate_of_spread


def test_every_fuel_model_has_the_parameters_the_model_needs():
    for name, fuel in FUEL_MODELS.items():
        for key in ("load_lb_ft2", "depth_ft", "sav_ft2_ft3", "moisture_ext"):
            assert key in fuel, f"{name} missing {key}"
            assert fuel[key] > 0, f"{name} has non-positive {key}"


def test_spread_increases_with_wind():
    slow = rate_of_spread(FUEL_MODELS["FM1"], moisture=0.08, wind_kmh=0, slope_deg=0)
    fast = rate_of_spread(FUEL_MODELS["FM1"], moisture=0.08, wind_kmh=30, slope_deg=0)
    assert fast > slow * 2, "wind must drive spread hard, not marginally"


def test_spread_increases_with_slope():
    flat = rate_of_spread(FUEL_MODELS["FM1"], moisture=0.08, wind_kmh=0, slope_deg=0)
    steep = rate_of_spread(FUEL_MODELS["FM1"], moisture=0.08, wind_kmh=0, slope_deg=30)
    assert steep > flat, "fire runs uphill"


def test_wet_fuel_at_the_extinction_moisture_does_not_spread():
    fuel = FUEL_MODELS["FM1"]
    assert rate_of_spread(fuel, moisture=fuel["moisture_ext"], wind_kmh=20, slope_deg=0) == 0.0
    # Above extinction it must stay at zero rather than going negative, which is
    # what an unclamped moisture damping polynomial does.
    assert rate_of_spread(fuel, moisture=0.9, wind_kmh=20, slope_deg=0) == 0.0


def test_wetter_fuel_spreads_more_slowly():
    dry = rate_of_spread(FUEL_MODELS["FM1"], moisture=0.04, wind_kmh=10, slope_deg=0)
    damp = rate_of_spread(FUEL_MODELS["FM1"], moisture=0.10, wind_kmh=10, slope_deg=0)
    assert dry > damp


def test_grass_spreads_faster_than_closed_timber_litter():
    # FM1 short grass against FM8 closed timber litter. If this inverts, a unit
    # or exponent is wrong somewhere.
    grass = rate_of_spread(FUEL_MODELS["FM1"], moisture=0.06, wind_kmh=15, slope_deg=0)
    litter = rate_of_spread(FUEL_MODELS["FM8"], moisture=0.06, wind_kmh=15, slope_deg=0)
    assert grass > litter


def test_the_result_is_in_metres_per_minute_and_physically_plausible():
    # A grass fire under 30 km/h wind runs fast but not absurdly. This is a
    # sanity band, not a validation: it catches a factor-of-60 unit error.
    ros = rate_of_spread(FUEL_MODELS["FM1"], moisture=0.06, wind_kmh=30, slope_deg=0)
    assert 1.0 < ros < 200.0, f"{ros} m/min is outside any plausible range"


def test_negative_or_missing_inputs_do_not_produce_a_number():
    fuel = FUEL_MODELS["FM1"]
    for kwargs in (
        {"moisture": None, "wind_kmh": 10, "slope_deg": 0},
        {"moisture": 0.08, "wind_kmh": None, "slope_deg": 0},
        {"moisture": 0.08, "wind_kmh": 10, "slope_deg": None},
    ):
        assert rate_of_spread(fuel, **kwargs) is None


def test_matches_a_published_reference_value():
    # Source: Andrews, Patricia L. 2018. The Rothermel surface fire spread model
    # and associated developments: A comprehensive explanation. USDA Forest
    # Service RMRS-GTR-371, page 59, table 17, first row -- "The effect of
    # dividing a total fuel load of 2 tons/ac into 1-h and 10-h classes".
    # Conditions (table 17 footnote a): all 2 tons/ac in the 1-h class, 1-h SAV
    # 2,500 ft2/ft3, depth 1 ft, moisture of extinction 20 percent, dead fuel
    # moisture 5 percent, midflame wind speed 5 mi/h, no slope.
    # Published: rate of spread 81.6 ft/min. The same row publishes the
    # intermediates this implementation also reproduces -- bulk density
    # 0.0918 lb/ft3, packing ratio 0.0029, optimum packing ratio 0.0055,
    # relative packing ratio 0.5195, wind factor 17.8.
    fuel = {"load_lb_ft2": 4000.0 / 43560.0,   # 2 tons/ac
            "depth_ft": 1.0, "sav_ft2_ft3": 2500.0, "moisture_ext": 0.20}
    # The published wind is already at midflame height; rate_of_spread takes a
    # 10 m wind and reduces it, so undo that reduction rather than the model's.
    midflame_kmh = 5 * 1.609344
    wind_kmh = midflame_kmh / MIDFLAME_FACTOR

    got_m_min = rate_of_spread(fuel, moisture=0.05, wind_kmh=wind_kmh, slope_deg=0)

    published_m_min = 81.6 * 0.3048
    assert abs(got_m_min - published_m_min) / published_m_min < 0.10


def test_a_projection_carries_its_own_uncertainty_and_provenance():
    incident = {"id": "firms-44.863,-0.880", "lat": 44.863, "lon": -0.880}
    wind_rows = [
        {"time": "2026-07-29T14:00", "wind_kmh": 12.0, "gust_kmh": 30.0,
         "wind_dir": 270, "wind_toward": "E", "humidity_pct": 30},
        {"time": "2026-07-29T15:00", "wind_kmh": 14.0, "gust_kmh": 34.0,
         "wind_dir": 280, "wind_toward": "E", "humidity_pct": 28},
    ]

    out = project(incident, wind_rows, slope_deg=5.0, fuel=FUEL_MODELS["FM1"], hours=2)

    assert out["model"] == "rothermel-1972"
    assert out["validated"] is False, "the payload must never claim validation"
    assert out["fuel_model"] == "FM1"
    # Two arcs: one on mean wind, one on gusts. A single line implies a precision
    # this model does not have.
    assert len(out["arcs"]) == 2
    assert out["arcs"][1]["ros_m_min"] > out["arcs"][0]["ros_m_min"]
    # Vector-mean of the two "from" directions is 275; a fire is pushed the way
    # the wind goes, so the bearing is that flipped by 180.
    assert out["arcs"][0]["bearing"] == 95


def test_a_projection_without_wind_yields_no_arcs_rather_than_a_still_fire():
    incident = {"id": "x", "lat": 44.0, "lon": -1.0}
    out = project(incident, [], slope_deg=5.0, fuel=FUEL_MODELS["FM1"], hours=2)

    # No wind data means we cannot say where it is going. A zero-wind projection
    # would draw a neat circle and imply the fire is going nowhere.
    assert out["arcs"] == []
    assert out["reason"] == "no wind data"
