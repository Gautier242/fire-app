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
from build.sources.fr import atmo, mdf

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
        "opensky": "aircraft",
    },
}


def sections_for(country):
    if country not in SECTIONS:
        raise ValueError(f"unknown country {country!r}; expected one of {sorted(SECTIONS)}")
    return dict(SECTIONS[country])


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
    if "aircraft" in summary:
        summary["aircraft"] = opensky.near_fires(summary["aircraft"], summary.get("fires", []))

    _write_atomically(summary_path, summary)

    counts = ", ".join(f"{len(v)} {k}" for k, v in summary.items() if isinstance(v, list) and k != "sources")
    print(f"wrote {summary_path} [{country}] ({counts})")

    failed = [s["id"] for s in summary["sources"] if not s["ok"]]
    if failed:
        print(f"WARNING: stale sources: {', '.join(failed)}")

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
