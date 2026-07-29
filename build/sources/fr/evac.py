"""Curated evacuation orders for France.

France publishes no evacuation feed. Orders go out over FR-Alert, straight to the
phones inside a cell, and prefecture arretes exist as PDFs across 101 separate
sites. feugironde.fr — which covers Gironde and Landes — solves this by hand: a
person reads the prefecture announcements and lists the communes under order,
drawn with official commune boundaries.

That is the right answer at that scale, and this module is the same approach with
the honesty made structural. Scraping 101 prefecture sites was rejected because a
parser that silently goes stale is worse than a gap; a curated file has the same
risk, so it must state when it was last touched and which departements anybody is
actually watching.

The rule this module exists to hold: an empty list is never an all-clear. There
are three distinct states and the frontend must be able to tell them apart.

  no file at all      -> we cannot speak about evacuations anywhere
  file, dep watched   -> "aucun ordre connu" is sayable for that departement
  file, dep unwatched -> silence, exactly as if there were no file

Curation format (public/static/fr/evacuations.json):

  {"curated_at": "2026-07-29T18:00:00Z",
   "curated_by": "who to blame",
   "departements": ["33", "40"],      # what is actually being watched
   "orders": [{"insee": "33236",
               "kind": "order" | "alert",
               "since": "...",
               "source_url": "https://www.gironde.gouv.fr/...",
               "note": "free text shown to the reader"}]}
"""
import json
from datetime import datetime, timedelta, timezone

# Beyond this, a hand-maintained list cannot be claimed as current. Fire
# situations move in hours, and a list nobody touched yesterday is a guess.
STALE_AFTER = timedelta(hours=12)


def load(path):
    """Read the curation file, or return the "nothing at all" payload.

    A malformed file is treated as no curation rather than as an empty one. The
    difference matters: empty means somebody looked and found nothing, malformed
    means we have no idea, and only one of those permits saying "aucun ordre".
    """
    try:
        payload = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def normalize(payload, shapes):
    """Turn curated entries into drawable zones.

    `shapes` maps INSEE code to {"name", "polygons"} — commune boundaries from
    geo.api.gouv.fr, the same source feugironde.fr credits.
    """
    zones = []
    for entry in (payload or {}).get("orders") or []:
        if not isinstance(entry, dict):
            continue
        insee = str(entry.get("insee") or "").strip()
        if not insee:
            # Nothing to place, name or act on. The only case where dropping is
            # the right call rather than a silent deletion of an order.
            continue
        shape = shapes.get(insee) or {}
        # Failing toward caution, as the rest of this project does: telling
        # someone to leave when they only needed to be ready is recoverable, the
        # reverse is not.
        kind = "alert" if entry.get("kind") == "alert" else "order"
        zones.append({
            "insee": insee,
            "kind": kind,
            "name": shape.get("name") or entry.get("name") or insee,
            "polygons": shape.get("polygons") or [],
            "since": entry.get("since"),
            "source_url": entry.get("source_url"),
            "note": entry.get("note"),
            "source": "curated",
        })
    return zones


def curation_status(payload, now=None):
    """What the frontend is allowed to claim about evacuations.

    Returned to the browser so the decision lives in data rather than in copy
    somebody might edit without realising what it asserts.
    """
    if not payload or not payload.get("curated_at"):
        return {"curated": False, "departements": [], "curated_at": None, "stale": True}

    curated_at = payload["curated_at"]
    deps = [str(d) for d in (payload.get("departements") or [])]
    return {
        "curated": True,
        "curated_by": payload.get("curated_by"),
        "curated_at": curated_at,
        "departements": sorted(deps),
        "stale": _is_stale(curated_at, now),
    }


def _is_stale(curated_at, now=None):
    try:
        stamp = datetime.fromisoformat(curated_at.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return True  # an unreadable timestamp cannot be claimed as fresh
    current = (datetime.fromisoformat(now.replace("Z", "+00:00")) if now
               else datetime.now(timezone.utc))
    return (current - stamp) > STALE_AFTER
