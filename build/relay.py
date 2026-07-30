"""Where help is being organised, as links and nothing else.

This module reads a hand-maintained file and validates it. It never fetches a
linked page, and it never repeats anything published on one. The moment this tool
restates a post from a group it cannot read, it has vouched for it.

Facebook settled the shape rather than the shape being a compromise. Measured
2026-07-30, `facebook.com/prefet33/` returns 309,942 bytes whose only recognisable
content is "Login" and "Cookie": a public page needs an authenticated session, a
private group is private by definition, and their terms forbid collection either
way. So there is no version of this that reads anything.

A tier states WHO PUBLISHES a page. It is never a claim about a particular post. An
official page can carry an out-of-date notice and a neighbourhood group can carry
the most useful message of the day; who runs the page is the only thing knowable
from outside.
"""
import json
from datetime import date, datetime, timezone

# Ordered most accountable first, and the interface renders them in this order.
TIERS = ("official", "institutional", "community")

# A directory nobody has touched in this long is a directory of dead links.
STALE_DAYS = 14


def load(path):
    """Read the curated file, or return None.

    A malformed file is no directory rather than an empty one: empty means somebody
    looked and listed nothing, malformed means we have no idea.
    """
    try:
        payload = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def _stale(curated_at, now):
    if not curated_at:
        return True
    try:
        when = date.fromisoformat(str(curated_at)[:10])
    except ValueError:
        return True
    today = (datetime.fromisoformat(str(now).replace("Z", "+00:00"))
             if now else datetime.now(timezone.utc)).date()
    return (today - when).days > STALE_DAYS


def normalize(payload, now=None):
    """Validate the curated entries. Returns entries plus what was refused.

    An entry that cannot be rendered honestly is dropped and reported rather than
    shown with a missing field: an untiered entry would sit beside an official one
    with nothing said about who runs it.
    """
    out = {"curated_at": None, "stale": True, "covers": [], "entries": [],
           "problems": []}
    if not isinstance(payload, dict):
        return out

    out["curated_at"] = payload.get("curated_at")
    out["stale"] = _stale(out["curated_at"], now)
    out["covers"] = [str(d) for d in (payload.get("covers") or [])]

    for raw in payload.get("entries") or []:
        if not isinstance(raw, dict):
            out["problems"].append("entry is not an object")
            continue
        tier = raw.get("tier")
        url = str(raw.get("url") or "")
        name = str(raw.get("name") or "").strip()
        if tier not in TIERS:
            out["problems"].append(f"unknown tier: {tier}")
            continue
        # These links are handed to somebody in an emergency, often on a phone on a
        # strange network. http would be a downgrade we chose for them.
        if not url.startswith("https://"):
            out["problems"].append(f"{name or url}: url must be https")
            continue
        if not name:
            out["problems"].append(f"{url}: no name")
            continue
        out["entries"].append({
            "name": name,
            "url": url,
            "tier": tier,
            "area": str(raw.get("area") or "").strip() or None,
            "note": str(raw.get("note") or "").strip() or None,
            # Nothing has been checked at this point, and unknown is not reachable.
            "reachable": None,
        })
    return out
