"""The record of this fire, kept after the sources stop serving it.

Every feed here publishes current state and nothing else. All 116 Gironde
closures carry `since: null`, the evacuated communes carry no date, and FIRMS
serves a rolling seven-day window that forgets the eighth. So there is no
retrospective timeline to recover: what is not written down as it happens is
gone, and the départemental ArcGIS layers will be taken down when the emergency
they exist for ends.

Two artefacts, for two different jobs:

  * `archive/<date>/*.json.gz` -- the day's payloads as published, so the site
    can still be shown when nothing upstream answers.
  * `archive/timeline.json` -- one small digest per day, which is what the
    timeline page reads. Kept separate because it must stay small enough to
    fetch on a phone after a year of accumulating.

Append-only. A day already written is never rewritten by a later run, because a
record that can change retroactively is not a record.
"""
from pathlib import Path

ARCHIVE = Path("archive")


def snapshot_paths(date):
    """Where a day's full payloads live. Gzipped: they are mostly geometry."""
    day = ARCHIVE / date
    return {
        "fr": day / "fr-summary.json.gz",
        "gironde": day / "gironde.json.gz",
        "ca": day / "ca-summary.json.gz",
    }


def _count(payload, key):
    value = (payload or {}).get(key)
    return len(value) if isinstance(value, list) else 0


def _stale(payload):
    return sorted(s["id"] for s in (payload or {}).get("sources") or []
                  if not s.get("ok"))


def digest(date, fr=None, gironde=None, ca=None):
    """One day, small enough that a year of them is still a quick fetch.

    A feed that did not answer is null rather than a set of zeroes. In six
    months nobody will remember that the Gironde ArcGIS was down on a Tuesday,
    and a row of zeroes would be read as an observation that nothing was shut.
    """
    day = {
        "date": date,
        "fr": {
            "generated_at": (fr or {}).get("generated_at"),
            "fires": _count(fr, "fires"),
            "closures": _count(fr, "closures"),
            "danger": _count(fr, "danger"),
            "evacuations": _count(fr, "evacuations"),
            "stale": _stale(fr),
        } if fr else None,
        "ca": {
            "generated_at": (ca or {}).get("generated_at"),
            "fires": _count(ca, "fires"),
            "evacuations": _count(ca, "evacuations"),
            "stale": _stale(ca),
        } if ca else None,
        "gironde": None,
    }

    # `available: false` is the feed telling us it could not be read. It is the
    # same state as no payload at all and must not become a count.
    if gironde and gironde.get("available") is not False:
        # A dict, not a list: one surveyed perimeter with its own survey date,
        # which is not the date we read it. Taken from the real payload rather
        # than assumed -- an invented shape here silently drops the one figure
        # that says how much ground has burnt.
        burn = gironde.get("burn_area")
        burn = burn if isinstance(burn, dict) else {}
        day["gironde"] = {
            "closures": _count(gironde, "closures"),
            "fire_closures": sum(1 for c in gironde.get("closures") or []
                                 if c.get("fire_related")),
            "evacuations": _count(gironde, "evacuations"),
            # Named, not just counted: the event a timeline exists to show is a
            # commune appearing or leaving the list, and a number cannot carry
            # that.
            "evacuated": [c.get("name") for c in gironde.get("evacuations") or []
                          if c.get("name")],
            "burn_km2": burn.get("area_km2"),
            "surveyed": burn.get("surveyed"),
        }
    return day


def merge_timeline(existing, day):
    """Add or replace today, leave every earlier day exactly as it was.

    Re-running on the same day replaces that day -- the later reading is the
    better one, and a build can legitimately run many times in a day. Any other
    date is left alone: a backfill that rewrote history would make every earlier
    reading unreliable.
    """
    kept = [d for d in existing or [] if d.get("date") != day["date"]]
    return sorted(kept + [day], key=lambda d: d["date"])
