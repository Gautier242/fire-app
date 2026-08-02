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


def observed_days(history, within=None):
    """Per-day detection counts from a trail payload.

    The one exception to this module's opening paragraph. Every other feed here
    publishes undated current state, but FIRMS timestamps each detection, so the
    day a pixel was hot is a fact the payload carries rather than something we
    infer from when we happened to read it. That makes these days recoverable
    after the fact, and it is the only thing on this page that is.

    `within` is (lat, lon, km): the Gironde is about half of France's detections
    at the moment, so a national count alone would not show one fire's own arc.

    The first and last day of a window are almost always partial -- the window
    opens and closes on the hour of a detection, not at midnight -- and a partial
    day carries fewer detections for a reason that has nothing to do with the
    fire. It is flagged rather than dropped: dropping it would move the start of
    the record, which is the one thing the timeline page must not misstate.
    """
    from datetime import datetime, timedelta

    stamp = (history or {}).get("generated_at")
    points = (history or {}).get("points") or []
    if not stamp or not points:
        return []
    newest = datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ")
    last_index = (history.get("hours") or 0) - 1
    if last_index < 0:
        return []

    counts = {}
    for point in points:
        lon, lat, hour = point[0], point[1], point[2]
        if within and _km_between(lat, lon, within[0], within[1]) > within[2]:
            continue
        when = newest - timedelta(hours=last_index - hour)
        counts[when.date().isoformat()] = counts.get(when.date().isoformat(), 0) + 1

    oldest = (newest - timedelta(hours=last_index)).date().isoformat()
    newest_day = newest.date().isoformat()
    return [{"date": date, "detections": counts[date],
             "partial": date in (oldest, newest_day)}
            for date in sorted(counts)]


def _km_between(lat_a, lon_a, lat_b, lon_b):
    import math

    x = (lon_a - lon_b) * 111.32 * math.cos(math.radians(lat_b))
    y = (lat_a - lat_b) * 110.57
    return math.hypot(x, y)


def merge_observed(existing, days):
    """Add satellite observations for days the archive never recorded.

    A recorded day is what readers were actually served, written down while it
    was being served. An observation is derived afterwards from timestamps in a
    payload. The first outranks the second in every case, so a day already in the
    record keeps exactly what it had -- `merge_timeline`'s rule, unchanged.

    What this does add is days that were never written at all. That is not a
    backfill rewriting history: it is the only reading that will ever exist for
    those days, and leaving them out would let the page open on a date that
    suggests nothing was burning before it.
    """
    recorded = {d.get("date") for d in existing or []}
    added = [{"date": day["date"], "fr": None, "ca": None, "gironde": None,
              "observed": {"detections": day["detections"],
                           "partial": day["partial"]}}
             for day in days or [] if day["date"] not in recorded]
    return sorted(list(existing or []) + added, key=lambda d: d["date"])
