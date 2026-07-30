# Relay and Responder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a curated, tiered directory of outside help pages that ingests nothing, and give a responder two more water registers plus OpenStreetMap hydrants labelled as crowd data.

**Architecture:** The relay is a hand-maintained JSON file read at build time, validated, link-checked, and rendered as a page of clickable links — no content is ever fetched from the linked pages. Water gains a `tier` on every point and coverage row so a register and a crowd source can never be summed; OSM hydrants arrive through Overpass as a separate source with its own failure state.

**Tech Stack:** stdlib Python 3.11, vanilla ES modules, Leaflet. No new dependencies. pytest for Python, `node --test` for JavaScript.

## Global Constraints

- **No new dependencies.** stdlib Python, vanilla ES modules, Leaflet only.
- **A tier describes a publisher, never a post.** Copied verbatim from the spec.
- **Absence in a crowd source is not absence of the thing.** No hydrant on the map means nobody mapped one.
- **The relay vouches for nobody.** No content is read, quoted, counted or cached from a linked page.
- **The scam sentence is unconditional** on every `community` entry, never conditional on anything looking wrong.
- **Register and crowd are never summed** into a single total by any code path.
- **Canada must not regress.** `build/main.py`, `mapview.js` and the water source list are shared surfaces. Verify Canada's live fire and evacuation counts after deploy, not just its HTTP status.
- **Page-relative paths in HTML.** Root-absolute paths 404 on GitHub Pages.
- **Never `git add .`** — stage exact paths. Never `git commit --amend`.
- Commit messages: plain engineering prose explaining why. No AI or tooling mentions, no Co-Authored-By, no emoji.
- Strict TDD: failing test first, watch it fail for the right reason, minimal code, one behaviour per commit.

## File Structure

| File | Responsibility |
|---|---|
| `public/static/fr/relay.json` (create) | The curated directory. Hand-maintained data only. |
| `build/relay.py` (create) | Validate and normalize the curated file. Pure; no network. |
| `build/sources/fr/relay_check.py` (create) | Reachability check for relay URLs. The only networked half, kept separate so `relay.py` stays pure. |
| `tests/test_relay.py` (create) | Tests for validation, tiers, the scam sentence. |
| `tests/test_relay_check.py` (create) | Tests for reachability marking. |
| `public/js/relay.js` (create) | Render the directory. Pure of Leaflet; owns its own copy. |
| `tests-js/test_relay.js` (create) | Tests for rendering rules and the scam sentence. |
| `public/fr/entraide.html` (create) | The relay page shell. |
| `build/sources/fr/water.py` (modify) | Add `tier` to points and coverage; add registers 76 and 04. |
| `build/sources/fr/hydrants.py` (create) | OSM hydrants via Overpass, as a `crowd` source. |
| `tests/test_fr_hydrants.py` (create) | Tests for the crowd source and its failure state. |
| `build/main.py` (modify) | Wire relay + hydrants into the France build. |
| `public/js/pro-page.js` (modify) | Report water counts per tier. |
| `public/fr/zone.html` (modify) | Link the relay and the responder page. |

---

### Task 1: The curated relay file and its validator

**Files:**
- Create: `public/static/fr/relay.json`
- Create: `build/relay.py`
- Test: `tests/test_relay.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `build.relay.TIERS` (tuple of str), `build.relay.load(path) -> dict | None`, `build.relay.normalize(payload, now=None) -> dict` returning `{"curated_at": str|None, "stale": bool, "covers": list[str], "entries": list[dict]}` where each entry is `{"name": str, "url": str, "tier": str, "area": str, "note": str, "reachable": bool|None}`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_relay.py`:

```python
"""The curated directory of places where help is being organised.

Nothing here fetches a linked page. The tier states who publishes it, never
whether a particular post on it is true.
"""
import json

from build import relay


def _payload(**over):
    base = {
        "curated_at": "2026-07-30",
        "covers": ["33"],
        "entries": [
            {"name": "Préfecture de la Gironde", "tier": "official", "area": "33",
             "url": "https://www.gironde.gouv.fr/", "note": "Arrêtés et consignes."},
            {"name": "Entraide Incendie Gironde", "tier": "community", "area": "33",
             "url": "https://www.facebook.com/groups/example",
             "note": "Groupe d'entraide entre habitants."},
        ],
    }
    base.update(over)
    return base


def test_every_entry_keeps_its_tier_and_url():
    out = relay.normalize(_payload(), now="2026-07-30T12:00:00Z")

    assert [e["tier"] for e in out["entries"]] == ["official", "community"]
    assert out["entries"][0]["url"] == "https://www.gironde.gouv.fr/"
    assert out["covers"] == ["33"]


def test_an_unknown_tier_is_refused_rather_than_rendered_untiered():
    """An untiered entry would appear beside official ones with nothing said."""
    bad = _payload(entries=[{"name": "X", "tier": "trusted", "area": "33",
                             "url": "https://example.org/", "note": "n"}])

    out = relay.normalize(bad, now="2026-07-30T12:00:00Z")

    assert out["entries"] == []
    assert "trusted" in " ".join(out["problems"])


def test_an_entry_without_a_url_is_dropped():
    bad = _payload(entries=[{"name": "X", "tier": "official", "area": "33", "note": "n"}])

    assert relay.normalize(bad, now="2026-07-30T12:00:00Z")["entries"] == []


def test_a_non_https_url_is_refused():
    """These are links handed to somebody in an emergency, on a phone."""
    bad = _payload(entries=[{"name": "X", "tier": "official", "area": "33",
                             "url": "http://example.org/", "note": "n"}])

    assert relay.normalize(bad, now="2026-07-30T12:00:00Z")["entries"] == []


def test_a_malformed_file_is_no_directory_rather_than_an_empty_one(tmp_path):
    path = tmp_path / "relay.json"
    path.write_text("{ not json")

    assert relay.load(path) is None

    out = relay.normalize(None, now="2026-07-30T12:00:00Z")
    assert out["entries"] == []
    assert out["curated_at"] is None


def test_curation_goes_stale_and_says_so():
    """A directory nobody has touched for weeks is a directory of dead links."""
    fresh = relay.normalize(_payload(curated_at="2026-07-29"), now="2026-07-30T12:00:00Z")
    old = relay.normalize(_payload(curated_at="2026-05-01"), now="2026-07-30T12:00:00Z")

    assert fresh["stale"] is False
    assert old["stale"] is True


def test_reachability_starts_unknown_rather_than_true():
    """Nothing has been checked yet at this point, and unknown is not reachable."""
    out = relay.normalize(_payload(), now="2026-07-30T12:00:00Z")

    assert all(e["reachable"] is None for e in out["entries"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest -q tests/test_relay.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'build.relay'`

- [ ] **Step 3: Write minimal implementation**

Create `build/relay.py`:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest -q tests/test_relay.py`
Expected: PASS, 7 tests

- [ ] **Step 5: Create the curated file**

Create `public/static/fr/relay.json`. Every URL below must be opened and confirmed to exist before committing — this file's whole value is that somebody looked.

```json
{
  "_readme": "Where help is being organised, as links only. Nothing here is fetched, quoted or republished: the tier says who publishes a page, never whether a post on it is true. Facebook cannot be read at all — a public page needs a session and a private group is private — so community entries are links a reader follows at their own judgement, and they carry the scam warning unconditionally. Update curated_at every time you touch this file; past 14 days the page says it is stale.",
  "curated_at": "2026-07-30",
  "covers": ["33", "40"],
  "entries": [
    {
      "name": "Préfecture de la Gironde",
      "tier": "official",
      "area": "Gironde",
      "url": "https://www.gironde.gouv.fr/",
      "note": "Arrêtés, consignes et communiqués officiels."
    },
    {
      "name": "SDIS 33 — pompiers de la Gironde",
      "tier": "official",
      "area": "Gironde",
      "url": "https://www.sdis33.fr/",
      "note": "Le service qui combat l'incendie."
    },
    {
      "name": "Département de la Gironde — routes fermées",
      "tier": "official",
      "area": "Gironde",
      "url": "https://gironde.maps.arcgis.com/apps/instant/basic/index.html?appid=f0f0b0ae3c1b4b85a697e209e0fcbc4b",
      "note": "La carte officielle des routes coupées et des communes évacuées."
    },
    {
      "name": "Préfecture des Landes",
      "tier": "official",
      "area": "Landes",
      "url": "https://www.landes.gouv.fr/",
      "note": "Arrêtés et consignes pour les Landes."
    },
    {
      "name": "Croix-Rouge française",
      "tier": "institutional",
      "area": "France",
      "url": "https://www.croix-rouge.fr/",
      "note": "Bénévolat et aide aux personnes déplacées."
    },
    {
      "name": "Protection Civile",
      "tier": "institutional",
      "area": "France",
      "url": "https://www.protection-civile.org/",
      "note": "Bénévolat encadré, postes de secours et hébergement."
    }
  ]
}
```

- [ ] **Step 6: Add a test that the shipped file is valid**

Append to `tests/test_relay.py`:

```python
def test_the_shipped_file_parses_and_every_entry_survives_validation():
    """A file that fails its own validator ships a page with silent gaps."""
    from pathlib import Path

    payload = relay.load(Path("public/static/fr/relay.json"))
    assert payload is not None, "the shipped relay file must parse"

    out = relay.normalize(payload, now="2026-07-30T12:00:00Z")
    assert out["problems"] == [], f"shipped file has invalid entries: {out['problems']}"
    assert out["entries"], "the shipped file must list at least one place"
    assert out["covers"], "the file must say which départements it covers"
```

- [ ] **Step 7: Run the full Python suite**

Run: `.venv/bin/pytest -q`
Expected: PASS, all tests

- [ ] **Step 8: Commit**

```bash
git add build/relay.py tests/test_relay.py public/static/fr/relay.json
git commit -m "Curate a directory of where help is being organised

Links only, and that is not a reduced version of something better. Facebook
returns 309,942 bytes of login markup for a public prefecture page, a private
group is private by definition, and their terms forbid collection, so nothing
here reads a linked page.

A tier states who publishes a page and never whether a post on it is true. An
entry with an unknown tier is refused rather than rendered untiered, because an
untiered entry would sit beside an official one with nothing said about who runs
it. Non-https URLs are refused too: these are links handed to somebody on a phone
on a strange network.

Curation goes stale after fourteen days and says so, the same discipline the
evacuation file uses."
```

---

### Task 2: Reachability check

**Files:**
- Create: `build/sources/fr/relay_check.py`
- Test: `tests/test_relay_check.py`

**Interfaces:**
- Consumes: `build.relay.normalize` output — entries with `reachable: None`.
- Produces: `build.sources.fr.relay_check.check(entries, opener, cap=MAX_CHECKS) -> list[dict]` returning the same entries with `reachable` set to `True` or `False`. `opener` is a callable taking a url and returning an int status code, injected so tests never touch the network.

- [ ] **Step 1: Write the failing test**

Create `tests/test_relay_check.py`:

```python
"""Checking that a link still resolves, without reading the page behind it."""
from build.sources.fr import relay_check


def _entries():
    return [
        {"name": "Préfecture", "url": "https://ok.example/", "tier": "official",
         "area": "33", "note": "n", "reachable": None},
        {"name": "Groupe", "url": "https://gone.example/", "tier": "community",
         "area": "33", "note": "n", "reachable": None},
    ]


def test_a_live_link_is_marked_reachable_and_a_dead_one_is_marked_not():
    codes = {"https://ok.example/": 200, "https://gone.example/": 404}

    out = relay_check.check(_entries(), opener=lambda url: codes[url])

    assert [e["reachable"] for e in out] == [True, False]


def test_a_dead_link_is_kept_rather_than_dropped():
    """A page that is down during a fire is a fact worth showing.

    Dropping it would silently shorten the directory at the moment somebody most
    needs to know that the préfecture site is not answering.
    """
    out = relay_check.check(_entries(), opener=lambda url: 500)

    assert len(out) == 2
    assert all(e["reachable"] is False for e in out)


def test_a_check_that_raises_leaves_the_entry_unknown_not_dead():
    """A timeout on our side says nothing about the page."""
    def boom(url):
        raise OSError("network down")

    out = relay_check.check(_entries(), opener=boom)

    assert all(e["reachable"] is None for e in out)


def test_the_number_of_checks_is_capped():
    seen = []

    def counting(url):
        seen.append(url)
        return 200

    many = [dict(_entries()[0], url=f"https://x{i}.example/") for i in range(30)]
    out = relay_check.check(many, opener=counting, cap=5)

    assert len(seen) == 5
    assert len(out) == 30, "entries past the cap are kept, just unchecked"
    assert out[9]["reachable"] is None


def test_a_redirect_counts_as_reachable():
    """Government sites redirect constantly; a 301 is not a dead link."""
    out = relay_check.check(_entries()[:1], opener=lambda url: 301)

    assert out[0]["reachable"] is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest -q tests/test_relay_check.py`
Expected: FAIL with `ImportError: cannot import name 'relay_check'`

- [ ] **Step 3: Write minimal implementation**

Create `build/sources/fr/relay_check.py`:

```python
"""Does this link still resolve?

The only networked half of the relay, kept in its own module so build/relay.py
stays pure and testable without a network.

This asks for a status code and nothing else. It does not read the page, follow
its content, or store anything from it. A HEAD request would be lighter, but many
French government sites answer HEAD with 405 while serving GET fine, so this issues
GET and discards the body.
"""
from urllib import request

# Enough for a curated directory and a hard stop if the file ever grows. Every
# check is a request to somebody else's server, so this is bounded by policy.
MAX_CHECKS = 40
TIMEOUT_SECONDS = 10

# Anything that answers at all is reachable. Redirects especially: government sites
# move constantly, and a 301 is a working link.
REACHABLE_BELOW = 400


def _status(url):
    with request.urlopen(url, timeout=TIMEOUT_SECONDS) as response:  # noqa: S310
        return response.status


def check(entries, opener=_status, cap=MAX_CHECKS):
    """Mark each entry reachable, unreachable, or leave it unknown.

    Three states, deliberately. Unknown means our own check failed and says nothing
    about the page; False means the page answered with an error and is worth showing
    as such. A dead link during a fire is a fact, not a reason to shorten the list.
    """
    out = []
    for index, entry in enumerate(entries or []):
        marked = dict(entry)
        if index < cap:
            try:
                status = opener(entry["url"])
                marked["reachable"] = bool(status) and status < REACHABLE_BELOW
            except Exception:  # noqa: BLE001 - our failure is not their outage
                marked["reachable"] = None
        out.append(marked)
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest -q tests/test_relay_check.py`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add build/sources/fr/relay_check.py tests/test_relay_check.py
git commit -m "Check that relay links still resolve

Asks for a status code and discards the body: this must never read a page it
links to. GET rather than HEAD because several French government sites answer
HEAD with 405 while serving GET.

Three states rather than two. Unknown means our own check failed and says nothing
about the page; unreachable means the page answered with an error, and that entry
is kept and shown rather than dropped, because a prefecture site not answering
during a fire is a fact a reader wants."
```

---

### Task 3: Render the relay

**Files:**
- Create: `public/js/relay.js`
- Test: `tests-js/test_relay.js`

**Interfaces:**
- Consumes: the payload written by Task 6 at `fr/data/relay.json`, shaped as `build.relay.normalize` output with `reachable` filled in.
- Produces: `describeRelay(payload, lang) -> {stale: bool, staleNote: string|null, groups: [{tier, label, warning, entries}]}` from `public/js/relay.js`.

- [ ] **Step 1: Write the failing test**

Create `tests-js/test_relay.js`:

```javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeRelay, SCAM_WARNING } from '../public/js/relay.js';

const PAYLOAD = {
  curated_at: '2026-07-30',
  stale: false,
  covers: ['33'],
  entries: [
    { name: 'Préfecture', url: 'https://a.example/', tier: 'official',
      area: 'Gironde', note: 'Consignes.', reachable: true },
    { name: 'Croix-Rouge', url: 'https://b.example/', tier: 'institutional',
      area: 'France', note: 'Bénévolat.', reachable: true },
    { name: 'Groupe entraide', url: 'https://c.example/', tier: 'community',
      area: 'Gironde', note: 'Entre habitants.', reachable: null },
  ],
};

test('entries are grouped by tier, most accountable first', () => {
  const out = describeRelay(PAYLOAD, 'fr');
  assert.deepEqual(out.groups.map((g) => g.tier),
    ['official', 'institutional', 'community']);
  assert.equal(out.groups[0].entries.length, 1);
});

test('the community tier always carries the scam warning', () => {
  const out = describeRelay(PAYLOAD, 'fr');
  const community = out.groups.find((g) => g.tier === 'community');
  assert.ok(community.warning, 'community must warn');
  assert.equal(community.warning, SCAM_WARNING.fr);
  // And it is not conditional on anything about the entries.
  const single = describeRelay({ ...PAYLOAD, entries: [PAYLOAD.entries[2]] }, 'fr');
  assert.equal(single.groups[0].warning, SCAM_WARNING.fr);
});

test('the official tier carries no scam warning of its own', () => {
  const out = describeRelay(PAYLOAD, 'fr');
  assert.equal(out.groups.find((g) => g.tier === 'official').warning, null);
});

test('a tier label never claims a post is true', () => {
  for (const lang of ['fr', 'en']) {
    for (const group of describeRelay(PAYLOAD, lang).groups) {
      const label = group.label.toLowerCase();
      assert.ok(!/\bfiable\b|\btrustworthy\b|\bs[ûu]r\b|\bsafe\b/.test(label),
        `${group.tier} label in ${lang} implies a post can be trusted: ${group.label}`);
    }
  }
});

test('an unreachable entry is shown and marked, not hidden', () => {
  const down = { ...PAYLOAD, entries: [{ ...PAYLOAD.entries[0], reachable: false }] };
  const out = describeRelay(down, 'fr');
  assert.equal(out.groups[0].entries.length, 1);
  assert.equal(out.groups[0].entries[0].reachable, false);
});

test('stale curation is reported', () => {
  const fresh = describeRelay(PAYLOAD, 'fr');
  assert.equal(fresh.stale, false);
  assert.equal(fresh.staleNote, null);

  const old = describeRelay({ ...PAYLOAD, stale: true }, 'fr');
  assert.equal(old.stale, true);
  assert.ok(old.staleNote && old.staleNote.length > 20);
});

test('an empty or missing payload yields no groups rather than crashing', () => {
  assert.deepEqual(describeRelay(null, 'fr').groups, []);
  assert.deepEqual(describeRelay({ entries: [] }, 'fr').groups, []);
});

test('both languages define every tier label and the warning', () => {
  const fr = describeRelay(PAYLOAD, 'fr');
  const en = describeRelay(PAYLOAD, 'en');
  assert.equal(fr.groups.length, en.groups.length);
  for (let i = 0; i < fr.groups.length; i += 1) {
    assert.ok(fr.groups[i].label && en.groups[i].label);
    assert.notEqual(fr.groups[i].label, en.groups[i].label);
  }
  assert.ok(SCAM_WARNING.fr && SCAM_WARNING.en);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests-js/test_relay.js`
Expected: FAIL with `Cannot find module .../public/js/relay.js`

- [ ] **Step 3: Write minimal implementation**

Create `public/js/relay.js`:

```javascript
// Where help is being organised, as links this page never reads.
//
// Pure: no DOM, no Leaflet, no fetch. Decides what to say; local-page.js and
// entraide.html decide where to put it.
//
// A tier states who publishes a page. It is never a claim that a particular post
// on that page is true, and no label here may imply otherwise — an official page
// can carry an out-of-date notice, and a neighbourhood group can carry the most
// useful message of the day.

export const TIERS = ['official', 'institutional', 'community'];

// Unconditional on every community entry. The same sentence the coordination
// worker enforces server-side, so a reader meets it whether they post with us or
// leave for a group we cannot see.
export const SCAM_WARNING = {
  fr: "Personne ne vérifie ce qui est publié sur ces pages. Une aide réelle ne "
    + "demande jamais d'argent, de numéro de carte ni de mot de passe.",
  en: 'Nobody checks what is posted on these pages. Real help never asks for '
    + 'money, card numbers or passwords.',
};

const LABELS = {
  fr: {
    official: 'Source officielle',
    institutional: 'Organisation identifiée, non officielle',
    community: 'Nous ne pouvons pas lire cette page',
  },
  en: {
    official: 'Official source',
    institutional: 'Named organisation, not official',
    community: 'We cannot read this page',
  },
};

const STALE = {
  fr: "Cette liste n'a pas été revue récemment. Certains liens peuvent être morts.",
  en: 'This list has not been reviewed recently. Some links may be dead.',
};

export function describeRelay(payload, lang = 'fr') {
  const key = lang === 'en' ? 'en' : 'fr';
  const entries = (payload && payload.entries) || [];
  const groups = [];

  for (const tier of TIERS) {
    const mine = entries.filter((e) => e.tier === tier);
    if (!mine.length) continue;
    groups.push({
      tier,
      label: LABELS[key][tier],
      // Only the community tier warns, and it warns every time it appears.
      warning: tier === 'community' ? SCAM_WARNING[key] : null,
      entries: mine.map((e) => ({
        name: e.name,
        url: e.url,
        area: e.area || null,
        note: e.note || null,
        // null means we could not check, which is not the same as down.
        reachable: e.reachable === undefined ? null : e.reachable,
      })),
    });
  }

  const stale = Boolean(payload && payload.stale);
  return { stale, staleNote: stale ? STALE[key] : null, groups };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests-js/test_relay.js`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add public/js/relay.js tests-js/test_relay.js
git commit -m "Decide what the relay says about each tier

Pure module: no DOM, no Leaflet, no fetch. The community tier carries the scam
sentence every time it appears, unconditionally, and a test asserts no tier label
in either language implies a post can be trusted -- the tier is about who runs the
page and nothing else.

An unreachable entry is rendered and marked rather than hidden, because a
prefecture page not answering during a fire is information."
```

---

### Task 4: The relay page

**Files:**
- Create: `public/fr/entraide.html`
- Modify: `public/fr/zone.html` (footer link)

**Interfaces:**
- Consumes: `describeRelay` from Task 3; the payload at `data/relay.json` from Task 6.
- Produces: a page at `/fr/entraide.html`.

- [ ] **Step 1: Create the page shell**

Create `public/fr/entraide.html`. Note `../css/app.css` and `../js/` — page-relative, because root-absolute paths 404 on GitHub Pages.

```html
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Où trouver de l'aide — Feux près de moi</title>
  <meta name="description" content="Les pages où l'aide s'organise : préfecture, pompiers, associations, groupes d'entraide. Des liens, rien de plus.">
  <link rel="stylesheet" href="../css/app.css">
  <style>
    .page { max-width: 760px; margin: 0 auto; padding: 26px 20px 70px; }
    .page h1 { font-size: 1.5rem; margin: 0 0 6px; }
    .lede { color: var(--muted); margin: 0 0 8px; }
    .tier { margin-top: 30px; }
    .tier h2 {
      font-family: var(--mono); font-size: .7rem; letter-spacing: .12em;
      text-transform: uppercase; color: var(--faint); font-weight: 500; margin: 0 0 4px;
    }
    .warn {
      border-left: 3px solid var(--caution); background: var(--raised);
      padding: 10px 13px; margin: 8px 0 12px; color: var(--ink); font-size: .9rem;
    }
    .link {
      display: block; background: var(--surface); border: 1px solid var(--line);
      border-radius: var(--r); padding: 12px 14px; margin-bottom: 8px;
      text-decoration: none; color: var(--ink);
    }
    .link:hover { border-color: var(--faint); }
    .link b { display: block; }
    .link .note { color: var(--muted); font-size: .88rem; }
    .link .down { color: var(--danger); font-family: var(--mono); font-size: .74rem; }
    .stale { border-left: 3px solid var(--caution); padding: 9px 13px;
             background: var(--raised); margin-bottom: 16px; font-size: .9rem; }
    .foot { margin-top: 34px; border-top: 1px solid var(--line); padding-top: 14px;
            font-size: .82rem; color: var(--faint); display: flex; gap: 14px; }
  </style>
</head>
<body>
  <div class="page">
    <button class="btn-ghost" id="lang" style="float:right">English</button>
    <h1 id="title">Où trouver de l'aide</h1>
    <p class="lede" id="lede"></p>
    <p class="lede" id="emergency"></p>

    <div class="stale" id="stale" hidden></div>
    <div id="tiers"></div>

    <div class="foot">
      <a href="./" id="back-link">Carte France</a>
      <a href="zone.html" id="zone-link">Vue locale</a>
      <a href="sources.html" id="src-link">Sources</a>
    </div>
  </div>
  <script type="module" src="../js/relay-page.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create the page wiring**

Create `public/js/relay-page.js`:

```javascript
// DOM wiring for the relay. Every decision about what to say lives in relay.js.
import { describeRelay } from './relay.js';

const LANG_KEY = 'fire-near-me.fr.lang';
const $ = (id) => document.getElementById(id);

let lang = (() => { try { return localStorage.getItem(LANG_KEY) || 'fr'; } catch { return 'fr'; } })();
let payload = null;

const COPY = {
  fr: {
    lang: 'English', title: "Où trouver de l'aide",
    lede: "Les pages où l'aide s'organise. Ce site ne lit aucune de ces pages et "
      + "n'en republie rien : ce sont des liens, vous les ouvrez vous-même.",
    emergency: "Pour une urgence, appelez le 18 ou le 112. Cette page sert à la "
      + "logistique autour, pas à l'appel de secours.",
    down: 'ne répond pas', unknown: 'non vérifié',
    back: 'Carte France', zone: 'Vue locale', sources: 'Sources',
    failed: 'Liste indisponible.',
  },
  en: {
    lang: 'Français', title: 'Where to find help',
    lede: 'The pages where help is being organised. This site reads none of them and '
      + 'republishes nothing from them: these are links, you open them yourself.',
    emergency: 'In an emergency call 18 or 112. This page is for the logistics '
      + 'around that, not for calling for rescue.',
    down: 'not responding', unknown: 'unchecked',
    back: 'France map', zone: 'Local view', sources: 'Sources',
    failed: 'List unavailable.',
  },
};

const c = () => COPY[lang === 'en' ? 'en' : 'fr'];

function render() {
  const t = c();
  document.documentElement.lang = lang;
  $('lang').textContent = t.lang;
  $('title').textContent = t.title;
  $('lede').textContent = t.lede;
  $('emergency').textContent = t.emergency;
  $('back-link').textContent = t.back;
  $('zone-link').textContent = t.zone;
  $('src-link').textContent = t.sources;

  const out = describeRelay(payload, lang);
  $('stale').hidden = !out.stale;
  if (out.stale) $('stale').textContent = out.staleNote;

  const host = $('tiers');
  host.innerHTML = '';
  if (!out.groups.length) {
    const empty = document.createElement('p');
    empty.className = 'lede';
    empty.textContent = t.failed;
    host.append(empty);
    return;
  }

  for (const group of out.groups) {
    const section = document.createElement('section');
    section.className = 'tier';
    const heading = document.createElement('h2');
    heading.textContent = group.label;
    section.append(heading);

    // Unconditional: the warning belongs to the tier, not to any entry in it.
    if (group.warning) {
      const warn = document.createElement('p');
      warn.className = 'warn';
      warn.textContent = group.warning;
      section.append(warn);
    }

    for (const entry of group.entries) {
      const link = document.createElement('a');
      link.className = 'link';
      link.href = entry.url;
      link.target = '_blank';
      // These are pages we do not control.
      link.rel = 'noopener noreferrer';
      const name = document.createElement('b');
      name.textContent = entry.area ? `${entry.name} — ${entry.area}` : entry.name;
      link.append(name);
      if (entry.note) {
        const note = document.createElement('span');
        note.className = 'note';
        note.textContent = entry.note;
        link.append(note);
      }
      if (entry.reachable === false) {
        const down = document.createElement('span');
        down.className = 'down';
        down.textContent = t.down;
        link.append(down);
      }
      section.append(link);
    }
    host.append(section);
  }
}

$('lang').onclick = () => {
  lang = lang === 'fr' ? 'en' : 'fr';
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* private browsing */ }
  render();
};

fetch('data/relay.json', { cache: 'no-cache' })
  .then((r) => (r.ok ? r.json() : null))
  .then((data) => { payload = data; render(); })
  .catch(() => render());
```

- [ ] **Step 3: Link it from the local view**

In `public/fr/zone.html`, find the `rail-foot` block and add the link after `src-link`:

```html
        <a href="entraide.html" id="help-link">Où trouver de l'aide</a>
```

In `public/js/local-page.js`, inside `COPY.fr` add `help: "Où trouver de l'aide",` and inside `COPY.en` add `help: 'Where to find help',`. Then in `applyLanguage()` add:

```javascript
  if ($('help-link')) $('help-link').textContent = c().help;
```

- [ ] **Step 4: Verify in a browser**

```bash
cd public && python3 -m http.server 8200 &
sleep 2
```
Open `http://localhost:8200/fr/entraide.html`. Confirm: three tier headings appear, the community section shows the scam warning, every link opens in a new tab, and toggling the language changes every heading. Then `pkill -f "http.server 8200"`.

- [ ] **Step 5: Commit**

```bash
git add public/fr/entraide.html public/js/relay-page.js public/fr/zone.html public/js/local-page.js
git commit -m "Add the page that points at where help is organised

Links open in a new tab with rel=noopener noreferrer, because these are pages we
do not control. The scam warning renders from the tier rather than from any
entry, so it cannot be dropped by editing the data file.

The page states in its own lede that it reads none of these pages and republishes
nothing from them, so a reader knows what they are being handed."
```

---

### Task 5: Water gains a tier, and two more registers

**Files:**
- Modify: `build/sources/fr/water.py`
- Test: `tests/test_fr_water.py`

**Interfaces:**
- Consumes: existing `water.SOURCES`, `water.normalize(payload, cap)`.
- Produces: every point gains `"tier": "register"`; every coverage row gains `"tier": "register"`. Two new SOURCES entries keyed `sdis76` and `sdis04`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_fr_water.py`:

```python
def test_every_point_and_coverage_row_declares_its_tier():
    """A register and a crowd source must never be summable into one number.

    The failure mode of this layer is a firefighter concluding there is no water,
    so a point from an SDIS register and a point somebody added to OpenStreetMap
    cannot look alike or be counted together.
    """
    payload = {"sdis64": json.dumps({"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"id_sdis": "A1", "type_pei": "PI"},
         "geometry": {"type": "Point", "coordinates": [-0.5, 43.3]}},
    ]})}

    out = water.normalize(payload)

    assert out["points"][0]["tier"] == "register"
    assert out["coverage"][0]["tier"] == "register"


def test_the_two_new_registers_are_declared():
    """Seine-Maritime and Alpes-de-Haute-Provence publish PEI registers.

    Both are on data.gouv in the same shape as the ones already used, so covering
    them is pure gain rather than a change of standard.
    """
    keys = {s["key"]: s for s in water.SOURCES}

    assert "sdis76" in keys and keys["sdis76"]["dep"] == "76"
    assert "sdis04" in keys and keys["sdis04"]["dep"] == "04"
    for key in ("sdis76", "sdis04"):
        assert keys[key]["scope"] == "departement"
        assert keys[key]["url"].startswith("https://")


def test_adding_registers_does_not_disturb_the_existing_ones():
    existing = {s["key"] for s in water.SOURCES}
    for key in ("sdis64", "sdis81", "herault_sdis", "rennes", "annecy"):
        assert key in existing
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest -q tests/test_fr_water.py`
Expected: FAIL with `KeyError: 'tier'`

- [ ] **Step 3: Add the tier**

In `build/sources/fr/water.py`, inside `normalize`, in the `points.append({...})` dict add after `"source": "pei",`:

```python
                # A register is complete for its area, so absence inside it means
                # something. That is exactly what a crowd source cannot claim, and
                # the tier is how the two stay separable all the way to the map.
                "tier": "register",
```

And in the coverage append, change it to:

```python
        if found:
            coverage.append({"dep": source["dep"], "area": source["area"],
                             "scope": source["scope"], "count": found,
                             "tier": "register"})
```

- [ ] **Step 4: Add the two registers**

In `build/sources/fr/water.py`, append to the `SOURCES` tuple. Before committing, fetch each URL once and confirm it returns GeoJSON with the named fields — a source whose field names are guessed produces silently empty points.

```python
    # Both published by their SDIS on data.gouv, same shape as the registers
    # already here. Verified present 2026-07-30 by searching "points eau incendie".
    {"key": "sdis76", "dep": "76", "area": "Seine-Maritime", "scope": "departement",
     "format": "geojson", "id": "numero", "kind": "nature", "insee": "insee",
     "url": "https://www.data.gouv.fr/fr/datasets/r/REPLACE-WITH-RESOURCE-ID"},

    {"key": "sdis04", "dep": "04", "area": "Alpes-de-Haute-Provence",
     "scope": "departement", "format": "geojson", "id": "numero", "kind": "nature",
     "insee": "insee",
     "url": "https://www.data.gouv.fr/fr/datasets/r/REPLACE-WITH-RESOURCE-ID"},
```

To find each resource id and confirm the field names:

```bash
.venv/bin/python - <<'PY'
import json, urllib.request, urllib.parse
q = urllib.parse.urlencode({"q": "points eau incendie", "page_size": 12})
with urllib.request.urlopen(f"https://www.data.gouv.fr/api/1/datasets/?{q}") as r:
    data = json.load(r)
for d in data["data"]:
    title = d["title"]
    if "Seine-Maritime" in title or "Alpes de Haute" in title or "Alpes-de-Haute" in title:
        print("==", title)
        for res in d["resources"]:
            print("   ", res["format"], res["url"])
PY
```

Then fetch one resource and print its first feature's property names, and set `id`, `kind` and `insee` to the real field names before continuing.

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/pytest -q tests/test_fr_water.py`
Expected: PASS

- [ ] **Step 6: Verify against the live sources**

```bash
.venv/bin/python -c "
from build.sources.fr import water
from build.http import make_session
out = water.normalize(water.fetch(make_session()))
from collections import Counter
print('points', len(out['points']))
print('by tier', Counter(p['tier'] for p in out['points']))
print('coverage', [(c['dep'], c['scope'], c['count']) for c in out['coverage']])
"
```
Expected: `by tier` shows only `register`; coverage now includes rows for 76 and 04 with non-zero counts. If either new source yields zero, its field names are wrong — fix them rather than shipping an empty register.

- [ ] **Step 7: Commit**

```bash
git add build/sources/fr/water.py tests/test_fr_water.py
git commit -m "Tier the water points, and add two registers already published

Every point and coverage row now declares tier=register. A register is complete
for its area, so absence inside one means something; that is precisely what a
crowd-sourced layer cannot claim, and the tier is how the two stay separable all
the way to the map rather than being summed into one reassuring number.

Seine-Maritime and Alpes-de-Haute-Provence publish PEI registers on data.gouv in
the same shape as those already used. Covering them is pure gain: same
completeness, two more departements."
```

---

### Task 6: OSM hydrants as a crowd source

**Files:**
- Create: `build/sources/fr/hydrants.py`
- Test: `tests/test_fr_hydrants.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `hydrants.fetch(session, bbox=GIRONDE_BBOX, cap=MAX_POINTS)` and `hydrants.normalize(payload, cap=MAX_POINTS) -> {"points": [...], "coverage": [...], "available": bool}`. Points carry `tier: "crowd"` and the same keys as water points, so both can be drawn by one renderer.

- [ ] **Step 1: Write the failing test**

Create `tests/test_fr_hydrants.py`:

```python
"""Fire hydrants from OpenStreetMap, where no register exists.

Gironde publishes no PEI register -- data.gouv holds seven and none is 33 -- while
OSM holds 1,077 hydrants around the Saumos fire. That data is worth having and is
NOT a register: the same OSM extract has 4 fire stations in the Gironde bbox
against roughly 100 real. So it ships labelled, never merged.
"""
from build.sources.fr import hydrants


def _payload(*elements):
    return {"elements": list(elements)}


def _node(oid=1, lat=44.86, lon=-0.88, **tags):
    return {"type": "node", "id": oid, "lat": lat, "lon": lon, "tags": tags}


def test_a_hydrant_is_a_crowd_point_never_a_register_point():
    out = hydrants.normalize(_payload(_node(**{"emergency": "fire_hydrant"})))

    point = out["points"][0]
    assert point["tier"] == "crowd"
    assert point["source"] == "osm"
    assert all(row["tier"] == "crowd" for row in out["coverage"])


def test_a_crowd_point_carries_the_same_keys_as_a_register_point():
    """One renderer draws both, so a missing key would crash on the crowd layer."""
    out = hydrants.normalize(_payload(_node(**{"emergency": "fire_hydrant"})))

    for key in ("id", "lat", "lon", "kind", "capacity_m3", "dep", "source", "tier"):
        assert key in out["points"][0], f"missing {key}"


def test_a_node_without_a_position_is_dropped():
    broken = {"type": "node", "id": 2, "tags": {"emergency": "fire_hydrant"}}

    assert hydrants.normalize(_payload(broken))["points"] == []


def test_a_failed_fetch_is_unavailable_not_an_empty_map():
    """Absence here must never read as absence of water. It is the whole point."""
    out = hydrants.normalize(None)

    assert out["available"] is False
    assert out["points"] == []

    asked = hydrants.normalize(_payload())
    assert asked["available"] is True
    assert asked["points"] == []


def test_the_cap_bounds_an_unbounded_external_source():
    many = _payload(*[_node(oid=i, **{"emergency": "fire_hydrant"}) for i in range(50)])

    out = hydrants.normalize(many, cap=10)

    assert len(out["points"]) == 10
    assert out["truncated"] is True


def test_a_position_outside_france_is_dropped():
    """The same backstop the water module uses, for the same class of mistake."""
    out = hydrants.normalize(_payload(_node(lat=0.0, lon=0.0,
                                            **{"emergency": "fire_hydrant"})))

    assert out["points"] == []


def test_the_query_is_bounded_by_a_bbox_and_a_timeout():
    query = hydrants.query(hydrants.GIRONDE_BBOX)

    assert "fire_hydrant" in query
    assert "timeout:" in query, "an unbounded Overpass query is refused or hangs"
    for value in hydrants.GIRONDE_BBOX:
        assert str(value) in query
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest -q tests/test_fr_hydrants.py`
Expected: FAIL with `ImportError: cannot import name 'hydrants'`

- [ ] **Step 3: Write minimal implementation**

Create `build/sources/fr/hydrants.py`:

```python
"""Fire hydrants from OpenStreetMap, for ground no register covers.

Gironde publishes no PEI register: searching data.gouv for "points eau incendie" on
2026-07-30 returned seven datasets and none of them is 33. OpenStreetMap holds 1,077
hydrants in a 0.4 by 0.7 degree box around the Saumos fire, so the data exists.

It is not a register, and the difference is not pedantry. The same OSM extract holds
4 fire stations in the whole Gironde bbox against roughly 100 real. A register is
complete for its area, so a gap inside one means something; a gap here means nobody
has mapped that street yet. Shipping these as though they were a register would
reverse the standing decision that water is complete-and-narrow, because the failure
mode of this layer is a firefighter concluding there is no water.

So every point says tier="crowd", and nothing in the build sums crowd and register
into a single total.
"""
from build.http import get_json

ENDPOINT = "https://overpass-api.de/api/interpreter"

# Gironde and the coast where the fires are, as (south, west, north, east).
GIRONDE_BBOX = (44.2, -1.4, 45.6, 0.3)

# Overpass is a free volunteer service. Never query it without a bbox and a timeout.
QUERY_TIMEOUT = 90
MAX_POINTS = 20_000

# The France box, the same backstop water.py uses: it catches a swapped pair, a
# projected coordinate and a stray 0/0 in one test.
LON_MIN, LON_MAX = -5.4, 9.8
LAT_MIN, LAT_MAX = 41.2, 51.2


def query(bbox, timeout=QUERY_TIMEOUT):
    south, west, north, east = bbox
    return (f"[out:json][timeout:{timeout}];"
            f'node["emergency"="fire_hydrant"]({south},{west},{north},{east});'
            "out body;")


def fetch(session, bbox=GIRONDE_BBOX, cap=MAX_POINTS):
    return get_json(session, ENDPOINT, params={"data": query(bbox)})


def _kind(tags):
    """What sort of hydrant, when OSM says. Absent far more often than present."""
    raw = (tags.get("fire_hydrant:type") or "").strip().lower()
    return raw or None


def normalize(payload, cap=MAX_POINTS):
    """Crowd-sourced hydrants, or an honest statement that we could not ask.

    `available` false means the fetch failed. It is not the same as an empty list,
    and the interface must not render it as one.
    """
    out = {"points": [], "coverage": [], "available": payload is not None,
           "truncated": False}
    if payload is None:
        return out

    elements = payload.get("elements") or []
    for element in elements:
        if len(out["points"]) >= cap:
            out["truncated"] = True
            break
        lat, lon = element.get("lat"), element.get("lon")
        if lat is None or lon is None:
            continue
        if not (LON_MIN <= lon <= LON_MAX and LAT_MIN <= lat <= LAT_MAX):
            continue
        tags = element.get("tags") or {}
        out["points"].append({
            "id": f"osm-{element.get('id')}",
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            "kind": _kind(tags),
            # OSM records flow rate sometimes and volume almost never; claiming a
            # capacity we do not have would be worse than admitting none.
            "capacity_m3": None,
            "dep": None,
            "source": "osm",
            "tier": "crowd",
        })

    if out["points"]:
        out["coverage"].append({
            "dep": None,
            "area": "OpenStreetMap",
            "scope": "crowd",
            "count": len(out["points"]),
            "tier": "crowd",
        })
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest -q tests/test_fr_hydrants.py`
Expected: PASS, 7 tests

- [ ] **Step 5: Verify against live Overpass**

```bash
.venv/bin/python -c "
from build.sources.fr import hydrants
from build.http import make_session
out = hydrants.normalize(hydrants.fetch(make_session()))
print('available', out['available'], '| points', len(out['points']))
print('sample', out['points'][0] if out['points'] else None)
"
```
Expected: several hundred to a few thousand points, every one `tier: crowd`. Overpass answers 504 when busy — if it does, retry once; a 504 must produce `available: False`, not an empty success.

- [ ] **Step 6: Commit**

```bash
git add build/sources/fr/hydrants.py tests/test_fr_hydrants.py
git commit -m "Add OpenStreetMap hydrants as crowd data, never as a register

Gironde publishes no PEI register -- data.gouv holds seven and none is 33 -- while
OSM holds 1,077 hydrants around the Saumos fire. That data is worth having, and it
is not a register: the same extract has 4 fire stations in the Gironde bbox against
roughly 100 real.

So every point declares tier=crowd and nothing sums crowd with register. A gap in a
register means something; a gap here means nobody has mapped that street. Shipping
these as a register would reverse the standing rule that water is complete-and-narrow
precisely because its failure mode is a firefighter concluding there is no water.

A failed fetch is available=false rather than an empty point list, for the same
reason."
```

---

### Task 7: Wire both into the France build

**Files:**
- Modify: `build/main.py`
- Test: `tests/test_country.py`

**Interfaces:**
- Consumes: `build.relay`, `build.sources.fr.relay_check`, `build.sources.fr.hydrants` from Tasks 1, 2, 6.
- Produces: `fr/data/relay.json` and `fr/data/hydrants.json` as side files.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_country.py`:

```python
def test_neither_relay_nor_hydrants_is_a_gated_summary_section():
    """Both are side files, and a side file must never block the danger map.

    The publish gate refuses to ship a summary section that is empty after its
    source failed. A directory of links or a crowd hydrant layer failing is an
    inconvenience; blocking the evacuation map over it would be the inversion the
    gate exists to prevent.
    """
    from build.main import critical_sections, sections_for

    for country in ("ca", "fr"):
        owners = set(sections_for(country).values())
        assert "relay" not in owners
        assert "hydrants" not in owners
        assert "relay" not in critical_sections(country)
        assert "hydrants" not in critical_sections(country)
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `.venv/bin/pytest -q tests/test_country.py::test_neither_relay_nor_hydrants_is_a_gated_summary_section`
Expected: PASS immediately — this test guards a property that must stay true after the wiring below. Keep it; it fails if a later change promotes either to a summary section.

- [ ] **Step 3: Wire the relay**

In `build/main.py`, add to the imports near the other France sources:

```python
from build import relay
from build.sources.fr import relay_check
```

Then in `apply_france_extras`, after the `gironde.json` block, add:

```python
    # Where help is being organised, as links this build never reads. A side file:
    # it is curated data plus a reachability check, and neither can be allowed to
    # touch the danger map.
    def _relay():
        payload = relay.load(Path("public/static/fr/relay.json"))
        directory = relay.normalize(payload, now=datetime.now(timezone.utc).isoformat())
        directory["entries"] = relay_check.check(directory["entries"])
        return directory

    directory = write_side_file(out, "relay.json", _relay)
    if directory:
        down = sum(1 for e in directory["entries"] if e["reachable"] is False)
        print(f"wrote {out / 'relay.json'} ({len(directory['entries'])} places, "
              f"{down} not responding, curated {directory['curated_at']})")
        for problem in directory["problems"]:
            print(f"WARNING: relay entry refused: {problem}")
    else:
        print("WARNING: the relay is unavailable; the previous file keeps serving")
```

- [ ] **Step 4: Wire the hydrants**

Immediately after, in the same block:

```python
    # Crowd-sourced hydrants for ground no register covers. Never merged with
    # water.json: a register and a crowd source answer different questions.
    crowd = write_side_file(out, "hydrants.json", lambda: hydrants.normalize(
        hydrants.fetch(session)))
    if crowd:
        print(f"wrote {out / 'hydrants.json'} ({len(crowd['points'])} OSM hydrants, "
              f"crowd-sourced, completeness unknown)")
    else:
        print("WARNING: OSM hydrants unavailable; that is not the absence of water")
```

Add `hydrants` to the France source import line:

```python
from build.sources.fr import (arome, atmo, evac, firms, firms_history, gironde,
                              hydrants, mdf, terrain, water, wind)
```

- [ ] **Step 5: Run the whole Python suite**

Run: `.venv/bin/pytest -q`
Expected: PASS, all tests

- [ ] **Step 6: Run the France build and read the output**

```bash
.venv/bin/python -m build.main --country fr --out public/fr/data 2>&1 | tail -10
```
Expected: lines for `relay.json` and `hydrants.json`, plus the existing summary, water, history and gironde lines. Confirm the summary line still reports its usual sections.

- [ ] **Step 7: Verify Canada did not regress**

```bash
.venv/bin/python -m build.main --country ca --out public/data 2>&1 | tail -4
```
Expected: Canada's fire and evacuation counts unchanged in order of magnitude, `stale sources: none` or only `opensky`.

- [ ] **Step 8: Commit**

```bash
git add build/main.py tests/test_country.py
git commit -m "Write the relay and the crowd hydrants beside the summary

Both are side files. write_side_file leaves the previous copy serving on failure,
and neither is a gated summary section: a directory of links or a crowd hydrant
layer failing is an inconvenience, and blocking the evacuation map over it would
be the inversion the publish gate exists to prevent. A test asserts neither can be
promoted into the gate by a later change.

A refused relay entry is printed as a warning rather than passing silently, so a
typo in the curated file is visible in the build log the day it lands."
```

---

### Task 8: Show the tier where a responder reads it

**Files:**
- Modify: `public/js/pro-page.js`
- Test: `tests-js/test_pro.js`

**Interfaces:**
- Consumes: `water.json` points with `tier: "register"` (Task 5), `hydrants.json` with `tier: "crowd"` (Task 6).
- Produces: no new exports; the responder page reports counts per tier.

- [ ] **Step 1: Write the failing test**

Append to `tests-js/test_pro.js`:

```javascript
test('water counts are reported per tier and never summed', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../public/js/pro-page.js', import.meta.url), 'utf8');

  // A single total across both tiers is the failure this whole design prevents:
  // it would let crowd-sourced dots inflate a register's count and read as coverage.
  assert.ok(!/register\s*\+\s*crowd|crowd\s*\+\s*register/i.test(source),
    'register and crowd must never be added together');
  assert.ok(/crowd/.test(source), 'the page must know about the crowd tier');
});

test('the crowd tier states that absence is not absence of water', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../public/js/pro-page.js', import.meta.url), 'utf8');

  for (const phrase of ['pas la même chose', 'not the same as']) {
    // One of the two languages must carry the distinction explicitly.
    if (source.includes(phrase)) return;
  }
  assert.fail('the crowd tier must say that no hydrant shown is not no water');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests-js/test_pro.js`
Expected: FAIL — `pro-page.js` does not mention `crowd`

- [ ] **Step 3: Add the crowd copy and counts**

In `public/js/pro-page.js`, inside the `water` copy object for `fr`, add:

```javascript
      crowd: (n) => `${n} bouche(s) d'incendie cartographiée(s) par OpenStreetMap `
        + `dans ce rayon. Ce n'est pas un registre : personne ne garantit que la `
        + `liste soit complète, et l'absence de point n'est pas la même chose que `
        + `l'absence d'eau.`,
      crowdUnavailable: "Couche OpenStreetMap indisponible. Ce n'est pas l'absence d'eau.",
```

And inside the `en` object:

```javascript
      crowd: (n) => `${n} fire hydrant(s) mapped by OpenStreetMap in this radius. `
        + `This is not a register: nobody guarantees the list is complete, and no `
        + `point shown is not the same as no water.`,
      crowdUnavailable: 'OpenStreetMap layer unavailable. That is not the absence of water.',
```

Then load `data/hydrants.json` alongside the existing water load, and render the crowd count as its own line beneath the register line. Do not add the two counts.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests-js/test_pro.js`
Expected: PASS

- [ ] **Step 5: Run the whole JS suite**

Run: `node --test tests-js/*.js worker/test_*.js`
Expected: PASS, no failures

- [ ] **Step 6: Commit**

```bash
git add public/js/pro-page.js tests-js/test_pro.js
git commit -m "Report water per tier on the responder page

A register count and a crowd count are shown as separate lines and are never added.
A single total would let volunteer-mapped dots inflate a register's number and read
as coverage, which is the failure this whole tiering exists to prevent.

The crowd line says outright that no hydrant shown is not the same as no water,
because that is the sentence a firefighter needs and the one the map cannot say by
itself."
```

---

### Task 9: Link the responder page, and ship

**Files:**
- Modify: `public/fr/zone.html`
- Modify: `public/js/local-page.js`
- Modify: `tests-js/test_pro.js`

**Interfaces:**
- Consumes: everything above.
- Produces: `pro.html` reachable from the local view.

- [ ] **Step 1: Remove only the unlinked assertion, keeping the two beside it**

`tests-js/test_pro.js:275` holds one test doing three jobs: it asserts the page makes no safety claim, that every path is page-relative, and that the page stays unlinked. **Only the third is being changed.** Deleting the whole block would silently drop the safety-claim and page-relative checks, which must survive.

Delete exactly this loop and its comment from that test (currently lines 286–289):

```javascript
  // It ships unlinked until the owner decides it should exist.
  for (const page of ['public/fr/index.html', 'public/fr/zone.html', 'public/fr/sources.html']) {
    assert.doesNotMatch(readFileSync(page, 'utf8'), /pro\.html/, `${page} links the responder view`);
  }
```

Then rename the test, since it no longer describes what it checks:

```javascript
test('the page itself makes no safety claim and keeps page-relative paths', () => {
```

Leave the `en sécurité` / `aucun danger` / `zones brûlées` patterns and the root-absolute path loop exactly as they are. Then append the replacement test:

```javascript
test('the responder page is reachable and says who it is for', async () => {
  const { readFileSync } = await import('node:fs');
  const zone = readFileSync(new URL('../public/fr/zone.html', import.meta.url), 'utf8');
  assert.ok(zone.includes('pro.html'), 'the local view must link the responder page');

  const page = readFileSync(new URL('../public/fr/pro.html', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../public/js/pro-page.js', import.meta.url), 'utf8');
  // A public reader who follows the link must learn immediately that this page
  // shows modelled figures the public page deliberately withholds.
  assert.ok(/pompier|responder|secours/i.test(page + js),
    'the page must name its audience');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests-js/test_pro.js`
Expected: FAIL — `zone.html` does not contain `pro.html`

- [ ] **Step 3: Add the link**

In `public/fr/zone.html`, in the `rail-foot` block:

```html
        <a href="pro.html" id="pro-link">Vue pompiers</a>
```

In `public/js/local-page.js`, add `pro: 'Vue pompiers',` to `COPY.fr` and `pro: 'Responder view',` to `COPY.en`, then in `applyLanguage()`:

```javascript
  if ($('pro-link')) $('pro-link').textContent = c().pro;
```

- [ ] **Step 4: Run tests**

Run: `node --test tests-js/*.js worker/test_*.js` and `.venv/bin/pytest -q`
Expected: PASS both

- [ ] **Step 5: Verify in a browser**

```bash
cd public && python3 -m http.server 8201 &
sleep 2
```
Open `http://localhost:8201/fr/zone.html`, follow "Vue pompiers" and "Où trouver de l'aide" from the footer. Confirm both load, the relay shows its three tiers with the community warning, and the responder page shows register and crowd water on separate lines. Then `pkill -f "http.server 8201"`.

- [ ] **Step 6: Commit and push**

```bash
git add public/fr/zone.html public/js/local-page.js tests-js/test_pro.js
git commit -m "Link the responder view and the relay from the local view

The responder page has shipped unlinked since it was written, waiting on a decision
that has now been taken. Its test asserted it stayed unlinked; that assertion was
correct then and is the thing being changed, so it is replaced by one that the page
is reachable and names its audience.

A reader arriving from the public map has to learn immediately that this page shows
modelled figures the public page deliberately withholds."
git push origin main
```

- [ ] **Step 7: Verify the deploy**

```bash
gh run list --limit 4
```
Wait for both `test` and `build` to conclude `success`, then:

```bash
T=$(date +%s); B=https://gautier242.github.io/fire-app
for p in /fr/entraide.html /fr/pro.html /fr/data/relay.json /fr/data/hydrants.json; do
  printf "%-28s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' "$B$p?$T")"
done
curl -s "$B/data/summary.json?$T" | .venv/bin/python -c "
import json,sys; d=json.load(sys.stdin)
print('CANADA fires', len(d['fires']), '| evac', len(d['evacuations']),
      '| stale', [s['id'] for s in d['sources'] if not s['ok']] or 'none')"
```
Expected: all four 200; Canada's counts in their usual range with no new stale sources.

---

## Self-Review

**Spec coverage.** §1 relay → Tasks 1–4. §1 tiers → Task 3. §1 link check → Task 2. §1 shape and `curated_at` → Task 1. §2 pro.html linked → Task 9. §2 two registers → Task 5. §2 OSM hydrants tiered → Tasks 6 and 8. §3 safety rules → the Global Constraints block and the tests in Tasks 3, 5, 6, 8. §4 testing → each task's test step; the six spec bullets map to `test_a_dead_link_is_kept_rather_than_dropped`, `test_the_community_tier_always_carries_the_scam_warning`, `test_an_unknown_tier_is_refused_rather_than_rendered_untiered`, `test_water_counts_are_reported_per_tier`, `test_a_failed_fetch_is_unavailable_not_an_empty_map`, and `test_adding_registers_does_not_disturb_the_existing_ones`. §5 open items are decisions, not tasks, and are listed below.

**Placeholders.** One deliberate and marked: the two data.gouv resource ids in Task 5 Step 4 are `REPLACE-WITH-RESOURCE-ID`, with a runnable script in the same step to discover them and an instruction to confirm the field names before committing. Guessing a resource id or a field name would ship an empty register, which is exactly the failure this layer must not have. No other placeholders.

**Type consistency.** `normalize` returns `entries` in both `build/relay.py` and after `relay_check.check`. `describeRelay` consumes `entries` with `reachable` of `true|false|null`. Water points and hydrant points share the key set asserted in Task 6 Step 1. `tier` is the string `"register"` or `"crowd"` everywhere. `write_side_file(out, name, fetcher)` matches its existing signature at `build/main.py:164`.

**One flaw found and fixed during this review.** Task 9 originally said to delete the test block at `tests-js/test_pro.js:275`. That block asserts three things — no safety claim, page-relative paths only, and unlinked — and only the third is being changed. Deleting it wholesale would have quietly removed two safety assertions while every suite stayed green, which is the same shape as the publish-gate defect this project already shipped once. Task 9 Step 1 now removes the four-line loop and renames the test, leaving the other two checks untouched.

**Carried forward from the spec, needing your decision, not a task:** whether the relay ships Gironde-only or covers Landes and the other fire départements from the start. The file in Task 1 lists both 33 and 40; widening further is a curation cost, not a code change.
