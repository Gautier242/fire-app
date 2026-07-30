"""Fetch every source, merge, and write the static data files.

A source that fails keeps its last good data and is flagged stale with its real
age. The frontend uses that flag to decide what it is allowed to claim.
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from build import registry
from build.http import make_session
from build.sources import aqhi, bc_evac, bc_fires, bc_roads, cwfis, cwfis_history, opensky
from build.sources.fr import arome, atmo, evac, firms, firms_history, mdf, terrain, water, wind
from build.sources.fr import roads as fr_roads
from build import fire_spread, flares, zone_build, zones

# Which summary section each source populates, per country.
#
# The two countries have opposite data availability. Canada publishes evacuation
# orders and no danger forecast; France publishes an official national danger
# forecast and no evacuation feed at all. So France has no "evacuations" section
# rather than a permanently empty one — an empty section reads as "none found",
# which is exactly the false all-clear this project refuses to ship.
#
# ponytail: Canadian modules stay at build/sources/*.py rather than moving to
# build/sources/ca/. Moving six modules and their test imports buys nothing
# functional and risks a live site. Split them if a third country lands.
SECTIONS = {
    "ca": {
        "cwfis_perimeters": "fires",
        "bc_fires": "fires",
        "bc_evac": "evacuations",
        "aqhi": "aqhi",
        "bc_roads": "closures",
        "opensky": "aircraft",
    },
    "fr": {
        "mdf": "danger",
        "atmo": "air_quality",
        "firms": "fires",
        "bison_fute": "closures",
        "opensky": "aircraft",
    },
}


def sections_for(country):
    if country not in SECTIONS:
        raise ValueError(f"unknown country {country!r}; expected one of {sorted(SECTIONS)}")
    return dict(SECTIONS[country])


# Sections whose emptiness would misinform rather than merely omit. Empty here,
# after the source that owns the section failed, stops the deploy so the previous
# build keeps serving. Stale data carries its own timestamp; zero fires reads as
# nothing burning, which is the absence-is-never-safety rule broken at the data
# layer rather than in the copy.
#
# This lived in the workflow YAML until France published fires 304 -> 0 on a FIRMS
# timeout: the list named fires for Canada and not for France, and no test could
# see it. Keep it here so adding a country cannot quietly skip its fire list.
CRITICAL_SECTIONS = {
    "ca": ("fires", "evacuations"),
    "fr": ("fires", "danger"),
}


def critical_sections(country):
    if country not in CRITICAL_SECTIONS:
        raise ValueError(f"unknown country {country!r}; "
                         f"expected one of {sorted(CRITICAL_SECTIONS)}")
    return CRITICAL_SECTIONS[country]


def fetchers_for(country, session):
    if country == "ca":
        return {
            "cwfis_perimeters": lambda: cwfis.normalize(cwfis.fetch(session)),
            "bc_fires": lambda: bc_fires.normalize(bc_fires.fetch(session)),
            "bc_evac": lambda: bc_evac.normalize(bc_evac.fetch(session)),
            "aqhi": lambda: aqhi.normalize(aqhi.fetch(session)),
            "bc_roads": lambda: bc_roads.normalize(bc_roads.fetch(session)),
            "opensky": lambda: opensky.normalize(opensky.fetch(session)),
        }
    if country == "fr":
        return {
            "mdf": lambda: mdf.normalize(mdf.fetch(session)),
            "atmo": lambda: atmo.normalize(atmo.fetch(session)),
            "firms": lambda: firms.normalize(firms.fetch(session)),
            "bison_fute": lambda: fr_roads.normalize(fr_roads.fetch(session)),
            "opensky": lambda: opensky.normalize(opensky.fetch(session, bbox=opensky.FRANCE)),
        }
    raise ValueError(f"unknown country {country!r}")


# Kept for the Canadian call sites and tests that predate the country split.
def default_fetchers(session):
    return fetchers_for("ca", session)


def _previous_items(previous, source_id, sections):
    """Last good items for one source, recovered from the previous summary.

    Items we write always carry a "source" tag, but an older or hand-made summary
    may not. An untagged item is only claimable when the section has a single
    owner; in a shared section (fires) it is dropped rather than attributed to
    the wrong source.
    """
    if not previous:
        return []
    section_name = sections[source_id]
    section = previous.get(section_name, [])
    sole_owner = list(sections.values()).count(section_name) == 1
    return [item for item in section
            if item.get("source") == source_id or (sole_owner and "source" not in item)]


def _previous_fetched_at(previous, source_id):
    if not previous:
        return None
    for source in previous.get("sources", []):
        if source["id"] == source_id:
            return source.get("fetched_at")
    return None


def build(now, previous, fetchers, country="ca"):
    owners = sections_for(country)
    sections = {name: [] for name in owners.values()}
    sources = []
    succeeded = 0

    for source_id in sorted(fetchers):
        try:
            items = fetchers[source_id]()
            for item in items:
                item.setdefault("source", source_id)
            sections[owners[source_id]].extend(items)
            sources.append({"id": source_id, "ok": True, "fetched_at": now, "stale": False})
            succeeded += 1
        except Exception:  # noqa: BLE001 - one bad source must not sink the build
            sections[owners[source_id]].extend(_previous_items(previous, source_id, owners))
            sources.append({
                "id": source_id,
                "ok": False,
                "fetched_at": _previous_fetched_at(previous, source_id),
                "stale": True,
            })

    if succeeded == 0:
        raise RuntimeError("every source failed; refusing to publish an empty summary")

    return {
        "generated_at": now,
        "country": country,
        "sources": sources,
        "coverage": registry.coverage_payload(country),
        **sections,
    }


def write_side_file(out, name, fetcher):
    """Write a lazy-loaded layer, or leave the previous one alone.

    Some layers are far too big for the summary — the water points are 532 KB
    gzipped against a 150 KB budget — and are only ever fetched by a reader who
    asks for them. A failure here must not touch the summary: a missing layer is
    an inconvenience, a missing danger level is not.
    """
    try:
        payload = fetcher()
    except Exception:  # noqa: BLE001 - the summary is what matters
        return None
    _write_atomically(Path(out) / name, payload)
    return payload


# Terrain is fetched per fire, not once per zone, and the radius is small. A
# 50 km grid over the Maures reports a 1.13 degree regional gradient where the
# ground the fire is actually on measures 14.09 degrees -- and Rothermel's slope
# term goes as tan squared, so the coarse figure understates the slope
# contribution by more than a hundredfold. Measured, not assumed.
SLOPE_RADIUS_KM = 2
SLOPE_STEP = 8

# Each fire costs one IGN request, so only the biggest get their own slope. The
# rest fall back to the zone median, which is honest: a small detection far from
# anywhere is not what a projection is for.
MAX_SLOPE_FETCHES = 4

# Garrigue basse. The most common Mediterranean fire fuel, and the map's centre
# of gravity is the south.
# ponytail: one fuel model for every zone. BD Foret would give real fuel per
# polygon and is the single biggest accuracy gain available to the spread model.
DEFAULT_FUEL = "FM5"


def _median_slope(grid):
    """Median slope across a grid, or None when nothing resolved.

    Median rather than max: one cliff face must not set the rate for a plain.
    """
    if not grid:
        return None
    values = sorted(cell["slope_deg"] for row in grid.get("grid", [])
                    for cell in row if cell.get("slope_deg") is not None)
    return values[len(values) // 2] if values else None


def _build_zones(summary, session, out, wildfires):
    """Pre-build detail files for today's hot zones.

    Every zone is independent and its failure is contained: the browser can fetch
    the same data live, so a zone must never take down the summary or the danger
    level.
    """
    zone_dir = Path(out) / "zones"
    config = zones.load_config(Path("public/static/fr/zones.json"))
    active = zones.active_zones(config, summary.get("danger", []))
    fuel = fire_spread.FUEL_MODELS[DEFAULT_FUEL]
    built = []

    for zone in active:
        try:
            wind_rows = arome.normalize(
                arome.fetch(session, zone["lat"], zone["lon"], hours=12),
                now=summary["generated_at"], hours=12)
        except Exception:  # noqa: BLE001 - a zone without wind is still useful
            wind_rows = []

        near = zone_build.fires_in_zone(zone, wildfires)
        projections = []
        zone_slope = None

        for index, fire in enumerate(near):
            slope = None
            if index < MAX_SLOPE_FETCHES:
                try:
                    grid = terrain.normalize(
                        terrain.fetch(session, fire["lat"], fire["lon"],
                                      radius_km=SLOPE_RADIUS_KM, step=SLOPE_STEP),
                        step=SLOPE_STEP)
                    slope = _median_slope(grid)
                    if zone_slope is None:
                        zone_slope = slope
                except Exception:  # noqa: BLE001
                    slope = None
            if slope is None:
                slope = zone_slope
            if slope is None:
                # No slope beats a wrong slope: the projection is flat-ground
                # only and says so through its own inputs.
                slope = 0.0
            projections.append(fire_spread.project(
                fire, wind_rows, slope_deg=slope, fuel=fuel, hours=3,
                fuel_model_name=DEFAULT_FUEL))

        try:
            zone_build.write_zone(zone_dir, zone, wildfires, wind_rows,
                                  terrain=None, spread=projections,
                                  closures=summary.get("closures"))
            built.append(zone)
        except Exception:  # noqa: BLE001 - one bad zone must not lose the others
            continue

    zone_build.write_zone_index(zone_dir, built)
    print(f"wrote {len(built)} zone file(s) to {zone_dir}")


def apply_france_extras(summary, session, out, previous_flares):
    """Everything that can only happen once the French sections are assembled.

    Wind and aircraft both attach to fire incidents, so they cannot run inside a
    fetcher — the incidents do not exist yet at that point.
    """
    day = summary["generated_at"][:10]

    # Curated evacuation orders. Not a fetcher: there is no feed to fetch, so a
    # person maintains the list and the payload carries who, when, and which
    # departements are actually being watched. Absence of an order is only
    # sayable inside a watched departement.
    curation = evac.load(Path("public/static/fr/evacuations.json"))
    shapes_file = Path("public/static/fr/communes-shapes.json")
    commune_shapes = (json.loads(shapes_file.read_text())
                      if shapes_file.exists() else {})
    summary["evacuations"] = evac.normalize(curation, commune_shapes)
    summary["evacuation_curation"] = evac.curation_status(curation)

    # Industrial heat is marked before anything else consumes the fires, so no
    # downstream step can mistake a refinery for a wildfire.
    registry = flares.FlareRegistry.from_payload(previous_flares)
    registry.observe(summary.get("fires", []), day=day)
    summary["fires"] = flares.mask_incidents(summary.get("fires", []), registry)
    _write_atomically(Path(out) / "flares.json", registry.payload())

    # A bounding box is not a border: the FIRMS query reaches into Spain,
    # Belgium, Germany and Italy, and Leon came back as the largest French fire.
    shapes_path = Path("public/static/fr/departements.geojson")
    if shapes_path.exists():
        summary["fires"] = flares.tag_country(
            summary["fires"], json.loads(shapes_path.read_text()))
    else:
        for incident in summary["fires"]:
            incident.setdefault("in_country", True)

    wildfires = [f for f in summary["fires"]
                 if not f["industrial"] and f.get("in_country", True)]

    # Wind is the observed answer to "which way is this going", so it belongs to
    # the incident rather than to the country. Biggest fires first: the fetch is
    # capped and the tail is dropped, not split into a second call.
    ranked = sorted(wildfires, key=lambda f: -(f.get("frp_total") or 0))
    points = [(f["lat"], f["lon"]) for f in ranked[:wind.MAX_POINTS]]
    if points:
        try:
            readings = wind.normalize(wind.fetch(session, points))
            for incident, reading in zip(ranked, readings):
                if reading:
                    incident["wind"] = reading
        except Exception:  # noqa: BLE001 - a fire without wind is still a fire
            pass

    _build_zones(summary, session, out, wildfires)

    # Aircraft are matched against real wildfires only. An aircraft circling a
    # refinery flare is not fighting a fire.
    summary["aircraft"] = opensky.near_fires(summary.get("aircraft", []), wildfires)
    engaged = aircraft_engagement(summary["aircraft"], wildfires)
    for incident in summary["fires"]:
        incident["aircraft"] = engaged.get(incident["id"], 0)

    return summary


# An aircraft this close and this low over a fire is working, not transiting.
ENGAGED_KM = 10.0
ENGAGED_ALTITUDE_FT = 5000


def aircraft_engagement(aircraft, wildfires):
    """Count low aircraft near each incident.

    This is an observation about aircraft, never a claim about the response. The
    absence of aircraft means nothing at all — they do not fly at night, and the
    France box held zero Securite Civile callsigns at 07:00 and MILAN78 at 17:30
    the same day. The UI must never let an empty count read as "nobody is
    coming".
    """
    counts = {}
    for incident in wildfires:
        near = 0
        for plane in aircraft:
            if (plane.get("altitude_ft") or 0) > ENGAGED_ALTITUDE_FT:
                continue
            if opensky._km_between(plane["lat"], plane["lon"],
                                   incident["lat"], incident["lon"]) <= ENGAGED_KM:
                near += 1
        counts[incident["id"]] = near
    return counts


def write_history(out, fetcher):
    """Write the 72-hour replay beside the summary, or leave the old one alone.

    The history is a separate file because it is lazy-loaded by the Advanced
    view only, and because it must stay outside the summary's size budget. A
    failure here is not allowed to touch the summary: a replay nobody can see
    is an inconvenience, an evacuation map nobody can see is not.
    """
    try:
        payload = fetcher()
    except Exception:  # noqa: BLE001 - the summary is what matters
        return None
    _write_atomically(Path(out) / "history.json", payload)
    return payload


def _write_atomically(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(payload, separators=(",", ":")))
    temp.replace(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="public/data")
    parser.add_argument("--country", default="ca", choices=sorted(SECTIONS))
    args = parser.parse_args()

    country = args.country
    out = Path(args.out)
    summary_path = out / "summary.json"
    previous = json.loads(summary_path.read_text()) if summary_path.exists() else None

    session = make_session()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    summary = build(now=now, previous=previous,
                    fetchers=fetchers_for(country, session), country=country)

    # Aircraft can only be filtered once the fires are known, so it happens here
    # rather than in the fetcher. Every light aircraft in a country is noise; one
    # circling a fire is information. France has no fire detection until FIRMS is
    # wired, so its aircraft list is empty rather than unfiltered — showing every
    # low-flying aircraft in France would imply a response that is not happening.
    if country == "fr":
        flares_path = out / "flares.json"
        previous_flares = (json.loads(flares_path.read_text())
                           if flares_path.exists() else None)
        summary = apply_france_extras(summary, session, out, previous_flares)
    elif "aircraft" in summary:
        summary["aircraft"] = opensky.near_fires(summary["aircraft"], summary.get("fires", []))

    _write_atomically(summary_path, summary)

    counts = ", ".join(f"{len(v)} {k}" for k, v in summary.items() if isinstance(v, list) and k != "sources")
    print(f"wrote {summary_path} [{country}] ({counts})")

    failed = [s["id"] for s in summary["sources"] if not s["ok"]]
    if failed:
        print(f"WARNING: stale sources: {', '.join(failed)}")

    if country == "fr":
        water_layer = write_side_file(
            out, "water.json", lambda: water.normalize(water.fetch(session)))
        if water_layer:
            print(f"wrote {out / 'water.json'} ({len(water_layer.get('points', []))} water points)")

        # Seven days of detections, so a reader can see where the fire has already
        # been. A side file, not a summary section: it is 3 MB of bulk CSV per
        # build, and a timeout on it must never be able to block the danger map.
        shapes_path = Path("public/static/fr/departements.geojson")
        trail = write_side_file(out, "history.json", lambda: firms_history.normalize(
            firms_history.fetch(session),
            now=datetime.now(timezone.utc),
            shapes=json.loads(shapes_path.read_text()) if shapes_path.exists() else None,
            registry=flares.FlareRegistry.from_payload(previous_flares)))
        if trail:
            passes = len({point[2] for point in trail["points"]})
            print(f"wrote {out / 'history.json'} ({len(trail['points'])} detections "
                  f"across {passes} observed passes, newest {trail['generated_at']})")
        else:
            print("WARNING: the 7-day trail is unavailable; the previous file keeps serving")

    if country == "ca":
        history = write_history(out, lambda: cwfis_history.normalize(cwfis_history.fetch(session)))
        if history:
            hours = len({point[2] for point in history["points"]})
            print(f"wrote {out / 'history.json'} "
                  f"({len(history['points'])} hotspots across {hours} observed hours)")
        else:
            print("WARNING: history unavailable; the scrubber will fall back to the last file")


if __name__ == "__main__":
    main()
