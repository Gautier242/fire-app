"""Rothermel (1972) surface fire spread.

Approved by the site owner after being told plainly that a wrong prediction can
send somebody into a fire, and that nobody on this project can validate output
against real fire behaviour. What is claimed here is narrower and checkable: a
correct implementation of a published, peer-reviewed model. Every payload carries
validated=False and the UI says so.

Equation numbering follows Andrews 2018 (RMRS-GTR-371), which restates Rothermel
1972 (INT-115) in consistent notation. The model works in imperial units
throughout because its coefficients are empirical and unit-bound; converting the
coefficients rather than the inputs is how sign and scale errors get introduced.
Inputs and outputs are metric, conversion happens at the boundary.

ponytail: single fuel class (dead 1-hour). The real model handles several size
classes and live fuel with a weighted average. That matters most in mixed
brush; upgrade to multi-class if the projections read wrong in maquis.
"""
import math

# Anderson (1982) standard fuel models, single-class approximation.
# load: oven-dry fuel load, lb/ft2. depth: fuel bed depth, ft.
# sav: surface-area-to-volume ratio, ft2/ft3. moisture_ext: dead fuel moisture
# of extinction, fraction.
FUEL_MODELS = {
    "FM1": {"label": "Herbe rase", "load_lb_ft2": 0.034, "depth_ft": 1.0,
            "sav_ft2_ft3": 3500.0, "moisture_ext": 0.12},
    "FM2": {"label": "Herbe et litière sous couvert", "load_lb_ft2": 0.092,
            "depth_ft": 1.0, "sav_ft2_ft3": 2784.0, "moisture_ext": 0.15},
    "FM4": {"label": "Maquis haut", "load_lb_ft2": 0.230, "depth_ft": 6.0,
            "sav_ft2_ft3": 1739.0, "moisture_ext": 0.20},
    "FM5": {"label": "Garrigue basse", "load_lb_ft2": 0.046, "depth_ft": 2.0,
            "sav_ft2_ft3": 1683.0, "moisture_ext": 0.20},
    "FM8": {"label": "Litière de forêt fermée", "load_lb_ft2": 0.069,
            "depth_ft": 0.2, "sav_ft2_ft3": 2000.0, "moisture_ext": 0.30},
    "FM9": {"label": "Litière de feuillus", "load_lb_ft2": 0.134,
            "depth_ft": 0.2, "sav_ft2_ft3": 2484.0, "moisture_ext": 0.25},
    "FM10": {"label": "Sous-bois de conifères", "load_lb_ft2": 0.138,
             "depth_ft": 1.0, "sav_ft2_ft3": 1682.0, "moisture_ext": 0.25},
}

HEAT_CONTENT = 8000.0      # BTU/lb, h
PARTICLE_DENSITY = 32.0    # lb/ft3, rho_p
TOTAL_MINERAL = 0.0555     # S_T
EFFECTIVE_MINERAL = 0.010  # S_E

FT_PER_MIN_TO_M_PER_MIN = 0.3048
KMH_TO_FT_PER_MIN = 54.6807  # 1 km/h = 1000/60 m/min / 0.3048 ft/m

# Wind measured at 10 m is not the wind the flame front feels. The standard
# midflame adjustment for an unsheltered fuel bed is roughly 0.4.
MIDFLAME_FACTOR = 0.4


def rate_of_spread(fuel, moisture, wind_kmh, slope_deg):
    """Head-fire rate of spread, metres per minute.

    Returns None when any input is missing: a fabricated input produces a
    confident wrong number, which is the failure mode that matters here.
    """
    if moisture is None or wind_kmh is None or slope_deg is None:
        return None

    w0 = fuel["load_lb_ft2"]
    depth = fuel["depth_ft"]
    sav = fuel["sav_ft2_ft3"]
    m_ext = fuel["moisture_ext"]

    # Above the moisture of extinction a fire does not carry. Clamping here
    # rather than letting the damping polynomial go negative.
    if moisture >= m_ext:
        return 0.0

    bulk_density = w0 / depth                      # rho_b
    packing = bulk_density / PARTICLE_DENSITY      # beta
    optimum_packing = 3.348 * sav ** -0.8189       # beta_op
    ratio = packing / optimum_packing

    a = 133.0 * sav ** -0.7913
    gamma_max = sav ** 1.5 / (495.0 + 0.0594 * sav ** 1.5)
    gamma = gamma_max * ratio ** a * math.exp(a * (1.0 - ratio))

    net_load = w0 * (1.0 - TOTAL_MINERAL)          # w_n
    rm = moisture / m_ext
    moisture_damping = 1.0 - 2.59 * rm + 5.11 * rm ** 2 - 3.52 * rm ** 3
    moisture_damping = max(0.0, min(1.0, moisture_damping))
    mineral_damping = min(1.0, 0.174 * EFFECTIVE_MINERAL ** -0.19)

    reaction_intensity = gamma * net_load * HEAT_CONTENT * moisture_damping * mineral_damping

    propagating_flux = (math.exp((0.792 + 0.681 * math.sqrt(sav)) * (packing + 0.1))
                        / (192.0 + 0.2595 * sav))

    # Wind factor. The 10 m reading is reduced to midflame height first.
    midflame_ft_min = max(0.0, wind_kmh) * KMH_TO_FT_PER_MIN * MIDFLAME_FACTOR
    c = 7.47 * math.exp(-0.133 * sav ** 0.55)
    b = 0.02526 * sav ** 0.54
    e = 0.715 * math.exp(-3.59e-4 * sav)
    wind_factor = c * midflame_ft_min ** b * ratio ** -e if midflame_ft_min > 0 else 0.0

    slope_factor = 5.275 * packing ** -0.3 * math.tan(math.radians(abs(slope_deg))) ** 2

    heating_number = math.exp(-138.0 / sav)        # epsilon
    preignition_heat = 250.0 + 1116.0 * moisture   # Q_ig

    denominator = bulk_density * heating_number * preignition_heat
    if denominator <= 0:
        return None
    ros_ft_min = (reaction_intensity * propagating_flux
                  * (1.0 + wind_factor + slope_factor) / denominator)
    return ros_ft_min * FT_PER_MIN_TO_M_PER_MIN


# Fine dead fuel moisture from relative humidity. A crude standard-day
# approximation, adequate for an indicative projection and far better than
# assuming a fixed value.
# ponytail: replace with the FWI fine fuel moisture code if the projections
# read wrong in the morning and evening humidity swings.
def moisture_from_humidity(humidity_pct):
    if humidity_pct is None:
        return None
    return max(0.02, min(0.35, 0.03 + 0.001 * float(humidity_pct)))


def project(incident, wind_rows, slope_deg, fuel, hours=3, fuel_model_name=None):
    """Where the head of this fire could be in `hours`, as two arcs.

    Two arcs and not one line: mean wind and gust wind. A single crisp line
    implies a precision this model does not have, and a reader under stress reads
    the shape rather than the caveat beside it.
    """
    name = fuel_model_name or next(
        (k for k, v in FUEL_MODELS.items() if v is fuel), "FM1")
    out = {
        "id": incident.get("id"),
        "lat": incident.get("lat"),
        "lon": incident.get("lon"),
        "model": "rothermel-1972",
        "validated": False,
        "fuel_model": name,
        "hours": hours,
        # The slope the arcs were computed on. Reported because the caller falls
        # back to flat ground when terrain cannot be resolved, and a flat-ground
        # wedge must not be mistaken for a measured one.
        "slope_deg": slope_deg,
        "arcs": [],
    }

    usable = [r for r in (wind_rows or [])[:hours]
              if r.get("wind_kmh") is not None and r.get("wind_dir") is not None]
    if not usable:
        # No wind means we cannot say where it is going. A zero-wind projection
        # would draw a tidy circle and imply the fire is going nowhere.
        out["reason"] = "no wind data"
        return out

    mean_wind = sum(r["wind_kmh"] for r in usable) / len(usable)
    gusts = [r["gust_kmh"] for r in usable if r.get("gust_kmh") is not None]
    gust_wind = max(gusts) if gusts else mean_wind
    humidity = [r["humidity_pct"] for r in usable if r.get("humidity_pct") is not None]
    moisture = (moisture_from_humidity(sum(humidity) / len(humidity))
                if humidity else 0.08)

    # Vector-mean bearing: averaging 350 and 10 as plain numbers gives due south.
    east = sum(math.sin(math.radians(r["wind_dir"])) for r in usable)
    north = sum(math.cos(math.radians(r["wind_dir"])) for r in usable)
    from_dir = (math.degrees(math.atan2(east, north)) + 360) % 360
    bearing = int(round((from_dir + 180) % 360)) % 360

    for label, speed in (("mean", mean_wind), ("gust", gust_wind)):
        ros = rate_of_spread(fuel, moisture, speed, slope_deg)
        if ros is None:
            continue
        out["arcs"].append({
            "basis": label,
            "bearing": bearing,
            "ros_m_min": round(ros, 2),
            "distance_m": round(ros * 60 * hours, 1),
            "wind_kmh": round(speed, 1),
        })
    out["moisture"] = round(moisture, 3)
    return out
