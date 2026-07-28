# Fire Near Me Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a static, bilingual web page that tells someone in Canada whether there is a fire near them, whether they are in an evacuation area, and whether the air is safe to breathe — and that is explicit about what it cannot check.

**Architecture:** A Python script runs on a GitHub Actions cron every 10 minutes, fetches five public feeds, normalizes them into one `summary.json` under 150 KB gzipped, and deploys a plain static site to Cloudflare Pages. All distance, direction, and point-in-polygon work happens in the browser. There is no server and no database.

**Tech Stack:** Python 3.11 + `requests` + `pytest` for the build; vanilla ES modules + Leaflet for the frontend; `node --test` (Node stdlib) for frontend tests; GitHub Actions + Cloudflare Pages for CI/CD.

**Source spec:** `docs/superpowers/specs/2026-07-28-fire-near-me-design.md`

---

## File Structure

**Build (Python) — one module per source, one shared HTTP policy:**

| File | Responsibility |
|---|---|
| `build/http.py` | The only place that talks to the network. Timeouts, bounded retries, feature caps. |
| `build/registry.py` | Declares each source and each province's coverage. Single source of truth for §3 of the spec. |
| `build/sources/cwfis.py` | National perimeters + 24h hotspots → normalized fires. |
| `build/sources/bc_fires.py` | BC named fires → normalized fires. |
| `build/sources/bc_evac.py` | BC evacuation orders/alerts → normalized polygons. |
| `build/sources/aqhi.py` | ECCC AQHI latest observations → normalized readings. |
| `build/simplify.py` | Ramer–Douglas–Peucker, used only on map polygons. |
| `build/main.py` | Orchestrates: fetch all, merge with previous on failure, write files. |
| `tools/build_coverage.py` | One-time: province polygons → `public/static/coverage.geojson`. |
| `tools/build_places.py` | One-time: CGN → `public/static/places.json`. |

**Frontend (vanilla ES modules) — pure logic separated from DOM:**

| File | Responsibility |
|---|---|
| `public/js/geo.js` | Pure math: haversine, bearing, compass, point-in-polygon. No DOM. |
| `public/js/status.js` | Pure decision logic: AQHI banding, fire state, evacuation state. No DOM. |
| `public/js/i18n.js` | All bilingual strings and the `t()` template function. |
| `public/js/location.js` | Geolocation, place fallback, `localStorage`. |
| `public/js/near-me.js` | Near-me page controller. DOM only. |
| `public/js/map-page.js` | Map page controller. DOM + Leaflet only. |

`geo.js` and `status.js` are pure and carry all the safety-critical logic, so they are fully unit tested. The controllers stay thin.

---

## Task 1: Project scaffold

**Files:**
- Create: `.gitignore`, `requirements.txt`, `README.md`, `build/__init__.py`, `build/sources/__init__.py`, `tests/__init__.py`

- [ ] **Step 1: Create the directory skeleton**

```bash
mkdir -p build/sources tools tests/fixtures public/js public/css public/static tests-js .github/workflows
touch build/__init__.py build/sources/__init__.py tests/__init__.py
```

- [ ] **Step 2: Write `.gitignore`**

```
__pycache__/
*.pyc
.venv/
.pytest_cache/
node_modules/
public/data/
.DS_Store
```

`public/data/` is generated every 10 minutes by CI and deployed directly. It is never committed — committing it would create thousands of noise commits per month.

- [ ] **Step 3: Write `requirements.txt`**

```
requests==2.32.3
pytest==8.3.3
```

- [ ] **Step 4: Create the virtualenv and install**

```bash
python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt && .venv/bin/pytest --version
```
Expected: prints a pytest 8.3.3 version banner.

- [ ] **Step 5: Write `README.md`**

````markdown
# Fire Near Me

Is there a fire near me? A plain-language wildfire, evacuation, and air quality
page for Canada, in English and French.

Static site. No server, no database. A GitHub Actions cron rebuilds the data
every 10 minutes and deploys to Cloudflare Pages.

## Develop

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m build.main --out public/data   # build the data files
python3 -m http.server -d public 8000              # serve the site
```

## Test

```bash
.venv/bin/pytest -q      # build pipeline
node --test tests-js/    # frontend logic
```

## Design

See `docs/superpowers/specs/2026-07-28-fire-near-me-design.md`.
````

- [ ] **Step 6: Commit**

```bash
git add .gitignore requirements.txt README.md build tests
git commit -m "Add project scaffold"
```

---

## Task 2: Geo primitives

Pure functions, no DOM, no network. Everything downstream depends on these being right.

**Files:**
- Create: `public/js/geo.js`
- Test: `tests-js/test_geo.js`

- [ ] **Step 1: Write the failing test**

`tests-js/test_geo.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { haversineKm, bearingDeg, compassPoint, pointInPolygon, pointInMultiPolygon, nearest } from '../public/js/geo.js';

const VANCOUVER = { lat: 49.2827, lon: -123.1207 };
const KAMLOOPS  = { lat: 50.6745, lon: -120.3273 };

test('haversineKm matches a known distance', () => {
  // Vancouver to Kamloops is 252.7 km great-circle (verified independently).
  assert.ok(Math.abs(haversineKm(VANCOUVER, KAMLOOPS) - 252.7) < 1);
});

test('haversineKm is zero for identical points', () => {
  assert.equal(haversineKm(VANCOUVER, VANCOUVER), 0);
});

test('bearingDeg points northeast from Vancouver to Kamloops', () => {
  const b = bearingDeg(VANCOUVER, KAMLOOPS);
  assert.ok(b > 45 && b < 90, `expected NE-ish, got ${b}`);
});

test('compassPoint maps degrees to eight points', () => {
  assert.equal(compassPoint(0), 'N');
  assert.equal(compassPoint(22), 'N');    // N sector runs 337.5 to 22.5
  assert.equal(compassPoint(23), 'NE');   // boundary into NE
  assert.equal(compassPoint(46), 'NE');
  assert.equal(compassPoint(180), 'S');
  assert.equal(compassPoint(359), 'N');   // wraps past 360 back to N
});

test('pointInPolygon detects inside and outside', () => {
  // Unit square, [lon, lat] pairs.
  const square = [[0, 0], [0, 2], [2, 2], [2, 0]];
  assert.equal(pointInPolygon({ lat: 1, lon: 1 }, square), true);
  assert.equal(pointInPolygon({ lat: 3, lon: 1 }, square), false);
});

test('pointInMultiPolygon handles holes and multiple rings', () => {
  // One polygon with an outer ring and a hole in the middle.
  const withHole = [[
    [[0, 0], [0, 4], [4, 4], [4, 0]],
    [[1, 1], [1, 3], [3, 3], [3, 1]],
  ]];
  assert.equal(pointInMultiPolygon({ lat: 0.5, lon: 0.5 }, withHole), true);
  assert.equal(pointInMultiPolygon({ lat: 2, lon: 2 }, withHole), false, 'point in hole is outside');
});

test('nearest returns the closest item and its distance', () => {
  const items = [
    { id: 'far', lat: 60, lon: -120 },
    { id: 'near', lat: 49.3, lon: -123.1 },
  ];
  const result = nearest(VANCOUVER, items);
  assert.equal(result.item.id, 'near');
  assert.ok(result.km < 5);
});

test('nearest returns null for an empty list', () => {
  assert.equal(nearest(VANCOUVER, []), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests-js/test_geo.js`
Expected: FAIL — `Cannot find module .../public/js/geo.js`

- [ ] **Step 3: Write the implementation**

`public/js/geo.js`:

```js
const R_KM = 6371;
const toRad = (d) => (d * Math.PI) / 180;

export function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDeg(a, b) {
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function compassPoint(deg) {
  return POINTS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

// Ray casting. `ring` is an array of [lon, lat] pairs.
export function pointInPolygon(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const straddles = (yi > point.lat) !== (yj > point.lat);
    if (straddles) {
      const xCross = ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
      if (point.lon < xCross) inside = !inside;
    }
  }
  return inside;
}

// GeoJSON MultiPolygon coordinates: [ polygon ][ ring ][ position ].
// Ring 0 of each polygon is the outer boundary; later rings are holes.
export function pointInMultiPolygon(point, polygons) {
  for (const rings of polygons) {
    if (!rings.length) continue;
    if (!pointInPolygon(point, rings[0])) continue;
    const inHole = rings.slice(1).some((hole) => pointInPolygon(point, hole));
    if (!inHole) return true;
  }
  return false;
}

export function nearest(point, items) {
  let best = null;
  for (const item of items) {
    const km = haversineKm(point, item);
    if (best === null || km < best.km) best = { item, km };
  }
  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests-js/test_geo.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add public/js/geo.js tests-js/test_geo.js
git commit -m "Add geo primitives for distance, bearing, and containment"
```

---

## Task 3: AQHI banding

**Files:**
- Create: `public/js/status.js`
- Test: `tests-js/test_status.js`

- [ ] **Step 1: Write the failing test**

`tests-js/test_status.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { aqhiBand } from '../public/js/status.js';

test('aqhiBand uses the official Canadian bands', () => {
  assert.equal(aqhiBand(1), 'low');
  assert.equal(aqhiBand(3), 'low');
  assert.equal(aqhiBand(4), 'moderate');
  assert.equal(aqhiBand(6), 'moderate');
  assert.equal(aqhiBand(7), 'high');
  assert.equal(aqhiBand(10), 'high');
  assert.equal(aqhiBand(11), 'very_high');
});

test('aqhiBand rounds to the nearest integer like ECCC does', () => {
  assert.equal(aqhiBand(1.48), 'low');   // real observed value from the API
  assert.equal(aqhiBand(3.6), 'moderate');
  assert.equal(aqhiBand(6.5), 'high');
});

test('aqhiBand clamps values below 1 to the lowest band', () => {
  assert.equal(aqhiBand(0.2), 'low');
});

test('aqhiBand returns null for missing or unusable values', () => {
  assert.equal(aqhiBand(null), null);
  assert.equal(aqhiBand(undefined), null);
  assert.equal(aqhiBand(NaN), null);
  assert.equal(aqhiBand('7'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests-js/test_status.js`
Expected: FAIL — cannot find `status.js`

- [ ] **Step 3: Write the implementation**

`public/js/status.js`:

```js
// AQHI is published on a 1-10+ scale. ECCC reports fractional values; the
// public-facing index is the rounded value, with anything under 1 shown as 1.
export function aqhiBand(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  const v = Math.max(1, Math.round(value));
  if (v <= 3) return 'low';
  if (v <= 6) return 'moderate';
  if (v <= 10) return 'high';
  return 'very_high';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests-js/test_status.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add public/js/status.js tests-js/test_status.js
git commit -m "Add AQHI banding using official Canadian thresholds"
```

---

## Task 4: Fire state

**Files:**
- Modify: `public/js/status.js`
- Modify: `tests-js/test_status.js`

- [ ] **Step 1: Write the failing test**

Append to `tests-js/test_status.js`:

```js
import { fireState } from '../public/js/status.js';

const HERE = { lat: 50.0, lon: -120.0 };

test('fireState reports the nearest fire within the threshold', () => {
  const fires = [
    { id: 'a', lat: 50.09, lon: -120.0, named: true, name: 'Smith Creek' }, // ~10 km N
    { id: 'b', lat: 52.0, lon: -120.0, named: false },                      // ~222 km N
  ];
  const s = fireState({ point: HERE, fires, nearKm: 25 });
  assert.equal(s.level, 'amber');
  assert.equal(s.fire.id, 'a');
  assert.equal(s.direction, 'N');
  assert.equal(s.km, 10);
});

test('fireState is green when the nearest fire is beyond the threshold', () => {
  const fires = [{ id: 'b', lat: 52.0, lon: -120.0, named: false }];
  const s = fireState({ point: HERE, fires, nearKm: 25 });
  assert.equal(s.level, 'green');
  assert.equal(s.fire, null);
});

test('fireState is green when there are no fires at all', () => {
  const s = fireState({ point: HERE, fires: [], nearKm: 25 });
  assert.equal(s.level, 'green');
  assert.equal(s.fire, null);
});

test('fireState rounds distance to whole kilometres', () => {
  const fires = [{ id: 'a', lat: 50.045, lon: -120.0, named: false }];
  const s = fireState({ point: HERE, fires, nearKm: 25 });
  assert.equal(Number.isInteger(s.km), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests-js/test_status.js`
Expected: FAIL — `fireState is not a function`

- [ ] **Step 3: Write the implementation**

Append to `public/js/status.js`:

```js
import { bearingDeg, compassPoint, nearest } from './geo.js';

export const NEAR_KM = 25;

export function fireState({ point, fires, nearKm = NEAR_KM }) {
  const best = nearest(point, fires);
  if (best === null || best.km > nearKm) {
    return { level: 'green', fire: null, km: null, direction: null };
  }
  return {
    level: 'amber',
    fire: best.item,
    km: Math.round(best.km),
    direction: compassPoint(bearingDeg(point, best.item)),
  };
}
```

Move the `import` line to the top of the file — ES module imports must precede other statements.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests-js/test_status.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add public/js/status.js tests-js/test_status.js
git commit -m "Add nearest-fire state with distance and compass direction"
```

---

## Task 5: Evacuation state — the safety rule

This is the task that implements §3 of the spec. Absence of data must never render as absence of danger.

**Files:**
- Modify: `public/js/status.js`
- Modify: `tests-js/test_status.js`

- [ ] **Step 1: Write the failing test**

Append to `tests-js/test_status.js`:

```js
import { evacuationState } from '../public/js/status.js';

// A square evacuation zone around HERE, as GeoJSON MultiPolygon coordinates.
const ZONE = [[[[-120.1, 49.9], [-120.1, 50.1], [-119.9, 50.1], [-119.9, 49.9]]]];
const ORDER = { id: 1, kind: 'order', name: 'Highway 3', polygons: ZONE };
const ALERT = { id: 2, kind: 'alert', name: 'Highway 3 north', polygons: ZONE };

test('evacuationState reports an order when the point is inside one', () => {
  const s = evacuationState({ point: HERE, evacuations: [ORDER], covered: true, stale: false });
  assert.equal(s.state, 'order');
  assert.equal(s.zone.name, 'Highway 3');
});

test('evacuationState prefers an order over an alert when both contain the point', () => {
  const s = evacuationState({ point: HERE, evacuations: [ALERT, ORDER], covered: true, stale: false });
  assert.equal(s.state, 'order');
});

test('evacuationState reports none_found only where we actually have coverage', () => {
  const far = { lat: 55, lon: -125 };
  const s = evacuationState({ point: far, evacuations: [ORDER], covered: true, stale: false });
  assert.equal(s.state, 'none_found');
});

test('SAFETY RULE: outside coverage it must never say none_found', () => {
  const alberta = { lat: 53.5, lon: -113.5 };
  const s = evacuationState({ point: alberta, evacuations: [ORDER], covered: false, stale: false });
  assert.equal(s.state, 'cannot_check');
});

test('SAFETY RULE: stale evacuation data degrades to cannot_check, never to none_found', () => {
  const far = { lat: 55, lon: -125 };
  const s = evacuationState({ point: far, evacuations: [], covered: true, stale: true });
  assert.equal(s.state, 'cannot_check');
});

test('SAFETY RULE: a stale feed still reports a zone the user is inside', () => {
  // Degrading a positive hit to "cannot check" would hide a real danger.
  const s = evacuationState({ point: HERE, evacuations: [ORDER], covered: true, stale: true });
  assert.equal(s.state, 'order');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests-js/test_status.js`
Expected: FAIL — `evacuationState is not a function`

- [ ] **Step 3: Write the implementation**

Append to `public/js/status.js`, and add `pointInMultiPolygon` to the existing `geo.js` import:

```js
// Order of evaluation matters. A containing zone is always reported, even from a
// stale feed, because hiding a known danger is worse than reporting an old one.
// Only the *negative* answer depends on coverage and freshness: we may say
// "nothing found" only when we genuinely checked a live feed that covers here.
export function evacuationState({ point, evacuations, covered, stale }) {
  const containing = evacuations.filter((e) => pointInMultiPolygon(point, e.polygons));
  const order = containing.find((e) => e.kind === 'order');
  if (order) return { state: 'order', zone: order };
  const alert = containing.find((e) => e.kind === 'alert');
  if (alert) return { state: 'alert', zone: alert };
  if (!covered || stale) return { state: 'cannot_check', zone: null };
  return { state: 'none_found', zone: null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests-js/test_status.js`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add public/js/status.js tests-js/test_status.js
git commit -m "Add evacuation state, enforcing that silence never reads as safety

Absence of evacuation data and stale evacuation data both resolve to
cannot_check rather than none_found. A containing zone is reported even when
the feed is stale, because suppressing a known danger is the worse failure."
```

---

## Task 6: Bounded HTTP session

Every network call in the build goes through this one module: one timeout policy, one retry policy, one feature cap.

**Files:**
- Create: `build/http.py`
- Test: `tests/test_http.py`

- [ ] **Step 1: Write the failing test**

`tests/test_http.py`:

```python
import pytest
from build.http import get_json, FetchError


class FakeResponse:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeSession:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def get(self, url, params=None, timeout=None):
        self.calls.append({"url": url, "params": params, "timeout": timeout})
        result = self._responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def test_get_json_returns_payload():
    session = FakeSession([FakeResponse({"ok": True})])
    assert get_json(session, "https://example.test/a") == {"ok": True}


def test_get_json_always_passes_a_timeout():
    session = FakeSession([FakeResponse({})])
    get_json(session, "https://example.test/a")
    assert session.calls[0]["timeout"] is not None


def test_get_json_raises_fetch_error_after_bounded_attempts():
    session = FakeSession([RuntimeError("boom")] * 5)
    with pytest.raises(FetchError):
        get_json(session, "https://example.test/a", attempts=3)
    assert len(session.calls) == 3


def test_get_json_recovers_if_a_later_attempt_succeeds():
    session = FakeSession([RuntimeError("boom"), FakeResponse({"ok": True})])
    assert get_json(session, "https://example.test/a", attempts=3) == {"ok": True}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_http.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'build.http'`

- [ ] **Step 3: Write the implementation**

`build/http.py`:

```python
"""The only module that touches the network.

Timeouts, retries, and backoff live here so no source module can quietly
invent its own policy.
"""
import time

import requests

TIMEOUT_SECONDS = 30
ATTEMPTS = 3
BACKOFF_SECONDS = 2
USER_AGENT = "fire-near-me/1.0 (+https://github.com/Gautier242/fire-near-me)"


class FetchError(Exception):
    """Raised when a source could not be fetched within its attempt budget."""


def make_session():
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    return session


def get_json(session, url, params=None, attempts=ATTEMPTS, timeout=TIMEOUT_SECONDS,
             sleep=time.sleep):
    last = None
    for attempt in range(attempts):
        try:
            response = session.get(url, params=params, timeout=timeout)
            response.raise_for_status()
            return response.json()
        except Exception as exc:  # noqa: BLE001 - any failure is retryable here
            last = exc
            if attempt < attempts - 1:
                sleep(BACKOFF_SECONDS * (attempt + 1))
    raise FetchError(f"{url} failed after {attempts} attempts: {last}") from last
```

`sleep` is injected so tests never actually wait.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_http.py -q`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add build/http.py tests/test_http.py
git commit -m "Add shared bounded HTTP session for all source fetches"
```

---

## Task 7: Source registry

**Files:**
- Create: `build/registry.py`
- Test: `tests/test_registry.py`

- [ ] **Step 1: Write the failing test**

`tests/test_registry.py`:

```python
from build.registry import PROVINCES, SOURCES, coverage_payload


def test_every_province_and_territory_is_declared():
    assert len(PROVINCES) == 13


def test_bc_has_both_named_fires_and_evacuations():
    bc = next(p for p in PROVINCES if p["province"] == "BC")
    assert bc["named_fires"] is True
    assert bc["evacuations"] is True


def test_provinces_without_a_feed_declare_no_evacuation_coverage():
    ab = next(p for p in PROVINCES if p["province"] == "AB")
    assert ab["evacuations"] is False


def test_every_province_has_an_official_url():
    assert all(p["official_url"].startswith("https://") for p in PROVINCES)


def test_coverage_payload_is_serialisable_and_complete():
    payload = coverage_payload()
    assert len(payload) == 13
    assert set(payload[0]) == {"province", "named_fires", "evacuations", "official_url"}


def test_sources_declare_stable_ids():
    ids = [s["id"] for s in SOURCES]
    assert ids == sorted(set(ids)), "source ids must be unique"
    assert "bc_evac" in ids
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_registry.py -q`
Expected: FAIL — `No module named 'build.registry'`

- [ ] **Step 3: Write the implementation**

`build/registry.py`:

```python
"""Declares what we ingest and, crucially, what we do not cover.

The frontend reads `coverage` from summary.json to decide whether it is allowed
to say "no evacuation near you". Adding a province means adding a source module
and flipping a flag here — no UI change.
"""

SOURCES = [
    {"id": "aqhi", "label": "Environment and Climate Change Canada — Air Quality Health Index"},
    {"id": "bc_evac", "label": "BC Evacuation Orders and Alerts"},
    {"id": "bc_fires", "label": "BC Wildfire Service — Active Fires"},
    {"id": "cwfis_perimeters", "label": "CWFIS — Estimated Fire Perimeters"},
]

PROVINCES = [
    {"province": "AB", "named_fires": False, "evacuations": False,
     "official_url": "https://www.alberta.ca/wildfire-status"},
    {"province": "BC", "named_fires": True, "evacuations": True,
     "official_url": "https://wildfiresituation.nrs.gov.bc.ca/"},
    {"province": "MB", "named_fires": False, "evacuations": False,
     "official_url": "https://www.gov.mb.ca/wildfire/"},
    {"province": "NB", "named_fires": False, "evacuations": False,
     "official_url": "https://www2.gnb.ca/content/gnb/en/departments/erd/natural_resources/content/ForestsCrownLands/content/ForestProtection.html"},
    {"province": "NL", "named_fires": False, "evacuations": False,
     "official_url": "https://www.gov.nl.ca/ffa/public-education/forestry/forest-fires/"},
    {"province": "NS", "named_fires": False, "evacuations": False,
     "official_url": "https://novascotia.ca/burnsafe/"},
    {"province": "NT", "named_fires": False, "evacuations": False,
     "official_url": "https://www.nwtfire.com/"},
    {"province": "NU", "named_fires": False, "evacuations": False,
     "official_url": "https://www.gov.nu.ca/"},
    {"province": "ON", "named_fires": False, "evacuations": False,
     "official_url": "https://www.ontario.ca/page/forest-fires"},
    {"province": "PE", "named_fires": False, "evacuations": False,
     "official_url": "https://www.princeedwardisland.ca/en/topic/emergency-measures"},
    {"province": "QC", "named_fires": False, "evacuations": False,
     "official_url": "https://sopfeu.qc.ca/"},
    {"province": "SK", "named_fires": False, "evacuations": False,
     "official_url": "https://www.saskpublicsafety.ca/emergencies-and-response/active-wildfires"},
    {"province": "YT", "named_fires": False, "evacuations": False,
     "official_url": "https://yukon.ca/en/wildfire-information"},
]


def coverage_payload():
    return [dict(p) for p in PROVINCES]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_registry.py -q`
Expected: PASS, 6 tests.

- [ ] **Step 5: Verify every official URL actually resolves**

```bash
.venv/bin/python -c "
from build.registry import PROVINCES
import urllib.request
for p in PROVINCES:
    req = urllib.request.Request(p['official_url'], method='HEAD',
                                 headers={'User-Agent': 'fire-near-me/1.0'})
    try:
        code = urllib.request.urlopen(req, timeout=20).status
    except Exception as e:
        code = repr(e)[:70]
    print(p['province'], code)
"
```
Expected: every line shows `200`. Any line showing an error or a 404 means that
province's link is wrong — fix the URL before committing. A dead link on the
"cannot check" card sends a worried person nowhere.

- [ ] **Step 6: Commit**

```bash
git add build/registry.py tests/test_registry.py
git commit -m "Add source and per-province coverage registry"
```

---

## Task 8: CWFIS perimeter source

**Files:**
- Create: `build/sources/cwfis.py`
- Create: `tests/fixtures/cwfis_perimeters.json`
- Test: `tests/test_cwfis.py`

- [ ] **Step 1: Capture a real fixture**

```bash
curl -s "https://cwfis.cfs.nrcan.gc.ca/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=public:m3_polygons_current&count=3&outputFormat=application/json" \
  > tests/fixtures/cwfis_perimeters.json
python3 -c "import json;d=json.load(open('tests/fixtures/cwfis_perimeters.json'));print(len(d['features']),'features')"
```
Expected: `3 features`

- [ ] **Step 2: Write the failing test**

`tests/test_cwfis.py`:

```python
import json
from pathlib import Path

from build.sources.cwfis import normalize

FIXTURE = json.loads(Path("tests/fixtures/cwfis_perimeters.json").read_text())


def test_normalize_produces_one_fire_per_feature():
    assert len(normalize(FIXTURE)) == 3


def test_fires_are_unnamed_because_cwfis_has_no_names():
    for fire in normalize(FIXTURE):
        assert fire["named"] is False
        assert "name" not in fire


def test_fires_carry_a_run_scoped_id():
    ids = [f["id"] for f in normalize(FIXTURE)]
    assert ids == ["cwfis:idx:0", "cwfis:idx:1", "cwfis:idx:2"]


def test_fires_have_a_centroid_within_canada():
    for fire in normalize(FIXTURE):
        assert -141.0 <= fire["lon"] <= -52.0
        assert 41.0 <= fire["lat"] <= 84.0


def test_size_is_omitted_because_the_area_unit_is_unconfirmed():
    # See the spec: displaying a size that is wrong by 100x is worse than none.
    for fire in normalize(FIXTURE):
        assert "size_ha" not in fire


def test_normalize_tolerates_an_empty_feature_collection():
    assert normalize({"type": "FeatureCollection", "features": []}) == []


def test_normalize_skips_features_with_unusable_geometry():
    broken = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {}, "geometry": None},
        {"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": []}},
    ]}
    assert normalize(broken) == []
```

- [ ] **Step 3: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_cwfis.py -q`
Expected: FAIL — `No module named 'build.sources.cwfis'`

- [ ] **Step 4: Write the implementation**

`build/sources/cwfis.py`:

```python
"""National estimated fire perimeters from the Canadian Wildland Fire
Information System.

These polygons are derived from satellite hotspots and carry no name and no
stable identifier — they are re-derived on every CWFIS run as hotspots
accumulate and merge. Identifiers here are therefore explicitly run-scoped and
must never be persisted or linked to.
"""
from build.http import get_json

WFS_URL = "https://cwfis.cfs.nrcan.gc.ca/geoserver/ows"
LAYER = "public:m3_polygons_current"
MAX_FEATURES = 5000


def fetch(session):
    return get_json(session, WFS_URL, params={
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": LAYER,
        "outputFormat": "application/json",
        "count": MAX_FEATURES,
    })


def _centroid(geometry):
    """Mean of the outer-ring vertices. Good enough to answer "how far away".

    ponytail: vertex mean, not a true area centroid. Upgrade to a proper
    polygon centroid only if a fire's reported distance is visibly wrong.
    """
    if not geometry:
        return None
    kind = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if kind == "Polygon":
        rings = [coords]
    elif kind == "MultiPolygon":
        rings = coords
    else:
        return None
    points = [pt for polygon in rings if polygon for pt in polygon[0]]
    if not points:
        return None
    return (
        sum(p[0] for p in points) / len(points),
        sum(p[1] for p in points) / len(points),
    )


def normalize(payload):
    fires = []
    for index, feature in enumerate(payload.get("features", [])):
        centre = _centroid(feature.get("geometry"))
        if centre is None:
            continue
        lon, lat = centre
        fires.append({
            "id": f"cwfis:idx:{index}",
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            "named": False,
            "source": "cwfis_perimeters",
        })
    return fires
```

Note the ids are assigned before skipping, so the test expects `0,1,2` on a
clean fixture. If a feature is skipped the sequence has a gap — that is fine,
since the ids are run-scoped and only need to be unique.

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_cwfis.py -q`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add build/sources/cwfis.py tests/test_cwfis.py tests/fixtures/cwfis_perimeters.json
git commit -m "Add CWFIS national perimeter source with run-scoped ids"
```

---

## Task 9: BC named fires source

**Files:**
- Create: `build/sources/bc_fires.py`
- Create: `tests/fixtures/bc_fires.json`
- Test: `tests/test_bc_fires.py`

- [ ] **Step 1: Capture a real fixture**

```bash
curl -s "https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/BCWS_ActiveFires_PublicView/FeatureServer/0/query?where=1%3D1&outFields=*&resultRecordCount=5&f=geojson&outSR=4326" \
  > tests/fixtures/bc_fires.json
python3 -c "import json;d=json.load(open('tests/fixtures/bc_fires.json'));print(len(d['features']),'features');print(d['features'][0]['properties'])"
```
Expected: `5 features` and a properties dict containing `FIRE_NUMBER`, `FIRE_STATUS`, `CURRENT_SIZE`.

`f=geojson&outSR=4326` matters: the service stores geometry in Web Mercator
(`wkid: 102100`), and we want plain longitude/latitude.

- [ ] **Step 2: Write the failing test**

`tests/test_bc_fires.py`:

```python
import json
from pathlib import Path

from build.sources.bc_fires import normalize

FIXTURE = json.loads(Path("tests/fixtures/bc_fires.json").read_text())


def test_normalize_produces_one_fire_per_feature():
    assert len(normalize(FIXTURE)) == 5


def test_bc_fires_are_named_and_stably_identified():
    for fire in normalize(FIXTURE):
        assert fire["named"] is True
        assert fire["id"].startswith("bc:")
        assert fire["name"]


def test_bc_fires_carry_status_and_official_url():
    for fire in normalize(FIXTURE):
        assert fire["status"]
        assert fire["url"].startswith("https://")


def test_coordinates_are_longitude_latitude_not_web_mercator():
    for fire in normalize(FIXTURE):
        assert -141.0 <= fire["lon"] <= -114.0
        assert 48.0 <= fire["lat"] <= 60.0


def test_size_is_included_only_when_positive():
    fires = normalize({"type": "FeatureCollection", "features": [
        {"type": "Feature",
         "geometry": {"type": "Point", "coordinates": [-120.0, 50.0]},
         "properties": {"FIRE_NUMBER": "V1", "INCIDENT_NAME": "A",
                        "FIRE_STATUS": "Out of Control", "CURRENT_SIZE": 0,
                        "FIRE_URL": "https://example.test/1"}},
        {"type": "Feature",
         "geometry": {"type": "Point", "coordinates": [-120.0, 50.0]},
         "properties": {"FIRE_NUMBER": "V2", "INCIDENT_NAME": "B",
                        "FIRE_STATUS": "Under Control", "CURRENT_SIZE": 12.5,
                        "FIRE_URL": "https://example.test/2"}},
    ]})
    assert "size_ha" not in fires[0]
    assert fires[1]["size_ha"] == 12.5


def test_normalize_falls_back_to_the_fire_number_when_the_name_is_blank():
    fires = normalize({"type": "FeatureCollection", "features": [
        {"type": "Feature",
         "geometry": {"type": "Point", "coordinates": [-120.0, 50.0]},
         "properties": {"FIRE_NUMBER": "V70397", "INCIDENT_NAME": None,
                        "FIRE_STATUS": "Active", "CURRENT_SIZE": 1,
                        "FIRE_URL": "https://example.test/3"}},
    ]})
    assert fires[0]["name"] == "V70397"


def test_normalize_skips_features_without_geometry():
    assert normalize({"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": None, "properties": {"FIRE_NUMBER": "V9"}},
    ]}) == []
```

- [ ] **Step 3: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_bc_fires.py -q`
Expected: FAIL — `No module named 'build.sources.bc_fires'`

- [ ] **Step 4: Write the implementation**

`build/sources/bc_fires.py`:

```python
"""Named active fires from the BC Wildfire Service.

Unlike the national CWFIS perimeters these have real names, a stage of
control, a size, and an official page — everything the incident copy needs.
"""
from build.http import get_json

URL = ("https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/"
       "BCWS_ActiveFires_PublicView/FeatureServer/0/query")
MAX_FEATURES = 3000
FALLBACK_URL = "https://wildfiresituation.nrs.gov.bc.ca/"


def fetch(session):
    return get_json(session, URL, params={
        "where": "1=1",
        "outFields": "FIRE_NUMBER,INCIDENT_NAME,FIRE_STATUS,CURRENT_SIZE,FIRE_URL",
        "f": "geojson",
        "outSR": 4326,
        "resultRecordCount": MAX_FEATURES,
    })


def normalize(payload):
    fires = []
    for feature in payload.get("features", []):
        geometry = feature.get("geometry") or {}
        coords = geometry.get("coordinates")
        if geometry.get("type") != "Point" or not coords:
            continue
        props = feature.get("properties") or {}
        number = props.get("FIRE_NUMBER")
        if not number:
            continue
        fire = {
            "id": f"bc:{number}",
            "lat": round(coords[1], 5),
            "lon": round(coords[0], 5),
            "named": True,
            "name": props.get("INCIDENT_NAME") or number,
            "status": props.get("FIRE_STATUS") or "Unknown",
            "url": props.get("FIRE_URL") or FALLBACK_URL,
            "source": "bc_fires",
        }
        size = props.get("CURRENT_SIZE")
        if isinstance(size, (int, float)) and size > 0:
            fire["size_ha"] = size
        fires.append(fire)
    return fires
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_bc_fires.py -q`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add build/sources/bc_fires.py tests/test_bc_fires.py tests/fixtures/bc_fires.json
git commit -m "Add BC Wildfire Service named-fire source"
```

---

## Task 10: BC evacuation source

**Files:**
- Create: `build/sources/bc_evac.py`
- Create: `tests/fixtures/bc_evac.json`
- Test: `tests/test_bc_evac.py`

- [ ] **Step 1: Capture a real fixture and inspect the status values**

```bash
curl -s "https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/Evacuation_Orders_and_Alerts/FeatureServer/0/query?where=1%3D1&outFields=*&resultRecordCount=5&f=geojson&outSR=4326" \
  > tests/fixtures/bc_evac.json
curl -s "https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/Evacuation_Orders_and_Alerts/FeatureServer/0/query?where=1%3D1&outFields=ORDER_ALERT_STATUS&returnDistinctValues=true&returnGeometry=false&f=json" \
  | python3 -m json.tool
```
Record the exact distinct `ORDER_ALERT_STATUS` strings. The classifier below
matches case-insensitively on the word "order"; confirm that holds for the real
values and adjust the test if the service uses different wording.

- [ ] **Step 2: Write the failing test**

`tests/test_bc_evac.py`:

```python
import json
from pathlib import Path

from build.sources.bc_evac import classify, normalize

FIXTURE = json.loads(Path("tests/fixtures/bc_evac.json").read_text())


def test_classify_maps_status_strings_to_order_or_alert():
    assert classify("Evacuation Order") == "order"
    assert classify("ORDER") == "order"
    assert classify("Evacuation Alert") == "alert"
    assert classify("Alert") == "alert"


def test_classify_defaults_unknown_wording_to_order():
    # Fail towards the more urgent reading, never towards the calmer one.
    assert classify("Something unexpected") == "order"
    assert classify(None) == "order"


def test_normalize_produces_one_zone_per_feature():
    assert len(normalize(FIXTURE)) == 5


def test_zones_carry_polygons_kind_name_and_agency():
    for zone in normalize(FIXTURE):
        assert zone["kind"] in {"order", "alert"}
        assert zone["polygons"], "a zone with no polygon can never match a point"
        assert zone["name"]
        assert "agency" in zone


def test_polygon_coordinates_are_longitude_latitude():
    for zone in normalize(FIXTURE):
        lon, lat = zone["polygons"][0][0][0]
        assert -141.0 <= lon <= -114.0
        assert 48.0 <= lat <= 60.0


def test_normalize_skips_zones_without_geometry():
    assert normalize({"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": None,
         "properties": {"ORDER_ALERT_STATUS": "Evacuation Order"}},
    ]}) == []
```

- [ ] **Step 3: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_bc_evac.py -q`
Expected: FAIL — `No module named 'build.sources.bc_evac'`

- [ ] **Step 4: Write the implementation**

`build/sources/bc_evac.py`:

```python
"""Evacuation orders and alerts aggregated by the Province of BC.

Covers orders issued by local governments and First Nations. This is the only
evacuation feed in v1, which is why `registry.PROVINCES` marks BC as the only
province where the app may say "no evacuation near you".
"""
from build.http import get_json

URL = ("https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/"
       "Evacuation_Orders_and_Alerts/FeatureServer/0/query")
MAX_FEATURES = 2000


def fetch(session):
    return get_json(session, URL, params={
        "where": "1=1",
        "outFields": "OBJECTID,EVENT_NAME,ORDER_ALERT_NAME,ORDER_ALERT_STATUS,ISSUING_AGENCY",
        "f": "geojson",
        "outSR": 4326,
        "resultRecordCount": MAX_FEATURES,
    })


def classify(status):
    """Map the feed's status wording to 'order' or 'alert'.

    Anything we do not recognise is treated as an order. An alert asks people to
    be ready; an order tells them to leave. Guessing the calmer of the two on
    unfamiliar wording is the dangerous direction to be wrong in.
    """
    text = (status or "").strip().lower()
    if "alert" in text:
        return "alert"
    return "order"


def _polygons(geometry):
    if not geometry:
        return []
    kind = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if kind == "Polygon":
        return [coords]
    if kind == "MultiPolygon":
        return coords
    return []


def normalize(payload):
    zones = []
    for feature in payload.get("features", []):
        polygons = _polygons(feature.get("geometry"))
        if not polygons:
            continue
        props = feature.get("properties") or {}
        zones.append({
            "id": props.get("OBJECTID"),
            "kind": classify(props.get("ORDER_ALERT_STATUS")),
            "name": (props.get("ORDER_ALERT_NAME")
                     or props.get("EVENT_NAME")
                     or "Evacuation area"),
            "agency": props.get("ISSUING_AGENCY") or "",
            "polygons": polygons,
            "source": "bc_evac",
        })
    return zones
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_bc_evac.py -q`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add build/sources/bc_evac.py tests/test_bc_evac.py tests/fixtures/bc_evac.json
git commit -m "Add BC evacuation orders and alerts source

Unrecognised status wording classifies as an order rather than an alert, so an
unexpected value can never downgrade an evacuation to the calmer reading."
```

---

## Task 11: AQHI source

**Files:**
- Create: `build/sources/aqhi.py`
- Create: `tests/fixtures/aqhi.json`
- Test: `tests/test_aqhi.py`

- [ ] **Step 1: Capture a real fixture**

```bash
curl -s "https://api.weather.gc.ca/collections/aqhi-observations-realtime/items?latest=true&limit=5&f=json" \
  > tests/fixtures/aqhi.json
python3 -c "import json;d=json.load(open('tests/fixtures/aqhi.json'));print(len(d['features']),'of',d['numberMatched'])"
```
Expected: `5 of 126` (the national total varies).

- [ ] **Step 2: Write the failing test**

`tests/test_aqhi.py`:

```python
import json
from pathlib import Path

from build.sources.aqhi import normalize

FIXTURE = json.loads(Path("tests/fixtures/aqhi.json").read_text())


def test_normalize_produces_one_reading_per_station():
    assert len(normalize(FIXTURE)) == 5


def test_readings_carry_bilingual_names():
    for reading in normalize(FIXTURE):
        assert reading["name"]["en"]
        assert reading["name"]["fr"]


def test_readings_carry_a_numeric_value_and_timestamp():
    for reading in normalize(FIXTURE):
        assert isinstance(reading["value"], float)
        assert reading["observed_at"].endswith("Z")


def test_readings_are_located():
    for reading in normalize(FIXTURE):
        assert -141.0 <= reading["lon"] <= -52.0
        assert 41.0 <= reading["lat"] <= 84.0


def test_normalize_drops_stations_with_no_reading():
    assert normalize({"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [-120.0, 50.0]},
         "properties": {"location_id": "X", "aqhi": None,
                        "location_name_en": "X", "location_name_fr": "X",
                        "observation_datetime": "2026-07-28T11:00:00Z"}},
    ]}) == []


def test_normalize_keeps_only_the_newest_reading_per_station():
    def obs(station, when, value):
        return {"type": "Feature",
                "geometry": {"type": "Point", "coordinates": [-120.0, 50.0]},
                "properties": {"location_id": station, "aqhi": value,
                               "location_name_en": station, "location_name_fr": station,
                               "observation_datetime": when}}

    readings = normalize({"type": "FeatureCollection", "features": [
        obs("A", "2026-07-28T10:00:00Z", 2.0),
        obs("A", "2026-07-28T11:00:00Z", 5.0),
    ]})
    assert len(readings) == 1
    assert readings[0]["value"] == 5.0
```

- [ ] **Step 3: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_aqhi.py -q`
Expected: FAIL — `No module named 'build.sources.aqhi'`

- [ ] **Step 4: Write the implementation**

`build/sources/aqhi.py`:

```python
"""Air Quality Health Index observations from Environment and Climate Change
Canada.

The feed is already bilingual, which is why no translation step exists anywhere
in this project for air quality text.
"""
from build.http import get_json

URL = "https://api.weather.gc.ca/collections/aqhi-observations-realtime/items"
MAX_FEATURES = 500


def fetch(session):
    return get_json(session, URL, params={
        "latest": "true",
        "limit": MAX_FEATURES,
        "f": "json",
    })


def normalize(payload):
    newest = {}
    for feature in payload.get("features", []):
        props = feature.get("properties") or {}
        value = props.get("aqhi")
        station = props.get("location_id")
        coords = (feature.get("geometry") or {}).get("coordinates")
        if value is None or not station or not coords:
            continue
        observed_at = props.get("observation_datetime") or ""
        existing = newest.get(station)
        if existing and existing["observed_at"] >= observed_at:
            continue
        newest[station] = {
            "id": station,
            "lat": round(coords[1], 5),
            "lon": round(coords[0], 5),
            "name": {
                "en": props.get("location_name_en") or station,
                "fr": props.get("location_name_fr") or station,
            },
            "value": float(value),
            "observed_at": observed_at,
            "source": "aqhi",
        }
    return sorted(newest.values(), key=lambda r: r["id"])
```

ISO-8601 UTC timestamps compare correctly as strings, so no date parsing is needed.

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_aqhi.py -q`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add build/sources/aqhi.py tests/test_aqhi.py tests/fixtures/aqhi.json
git commit -m "Add ECCC AQHI observation source"
```

---

## Task 12: Build orchestrator with stale-data handling

**Files:**
- Create: `build/main.py`
- Test: `tests/test_main.py`

- [ ] **Step 1: Write the failing test**

`tests/test_main.py`:

```python
import pytest

from build.http import FetchError
from build.main import build

NOW = "2026-07-28T12:00:00Z"


def ok(value):
    return lambda: value


def boom():
    raise FetchError("source down")


def test_build_collects_all_sources():
    summary = build(now=NOW, previous=None, fetchers={
        "cwfis_perimeters": ok([{"id": "cwfis:idx:0", "lat": 50.0, "lon": -120.0, "named": False}]),
        "bc_fires": ok([{"id": "bc:V1", "lat": 50.1, "lon": -120.1, "named": True, "name": "A"}]),
        "bc_evac": ok([{"id": 1, "kind": "order", "name": "Z", "polygons": [[[[0, 0]]]]}]),
        "aqhi": ok([{"id": "S1", "lat": 50.0, "lon": -120.0, "value": 3.0}]),
    })
    assert summary["generated_at"] == NOW
    assert len(summary["fires"]) == 2
    assert len(summary["evacuations"]) == 1
    assert len(summary["aqhi"]) == 1


def test_build_includes_the_coverage_registry():
    summary = build(now=NOW, previous=None, fetchers={
        "cwfis_perimeters": ok([]), "bc_fires": ok([]),
        "bc_evac": ok([]), "aqhi": ok([]),
    })
    assert len(summary["coverage"]) == 13


def test_a_failing_source_reuses_previous_data_and_is_marked_stale():
    previous = {
        "evacuations": [{"id": 1, "kind": "order", "name": "Old zone", "polygons": [[[[0, 0]]]]}],
        "sources": [{"id": "bc_evac", "ok": True, "fetched_at": "2026-07-28T11:00:00Z", "stale": False}],
    }
    summary = build(now=NOW, previous=previous, fetchers={
        "cwfis_perimeters": ok([]), "bc_fires": ok([]),
        "bc_evac": boom, "aqhi": ok([]),
    })
    evac_source = next(s for s in summary["sources"] if s["id"] == "bc_evac")
    assert evac_source["ok"] is False
    assert evac_source["stale"] is True
    assert evac_source["fetched_at"] == "2026-07-28T11:00:00Z", "keeps the real age, not now"
    assert summary["evacuations"] == previous["evacuations"], "keeps the last good data"


def test_a_failing_source_with_no_previous_data_yields_an_empty_stale_section():
    summary = build(now=NOW, previous=None, fetchers={
        "cwfis_perimeters": ok([]), "bc_fires": ok([]),
        "bc_evac": boom, "aqhi": ok([]),
    })
    evac_source = next(s for s in summary["sources"] if s["id"] == "bc_evac")
    assert evac_source["stale"] is True
    assert evac_source["fetched_at"] is None
    assert summary["evacuations"] == []


def test_a_successful_source_is_never_stale():
    summary = build(now=NOW, previous=None, fetchers={
        "cwfis_perimeters": ok([]), "bc_fires": ok([]),
        "bc_evac": ok([]), "aqhi": ok([]),
    })
    for source in summary["sources"]:
        assert source["ok"] is True
        assert source["stale"] is False
        assert source["fetched_at"] == NOW


def test_build_raises_if_every_source_fails():
    # Writing an all-empty summary would render as "no fires anywhere in Canada".
    with pytest.raises(RuntimeError, match="every source failed"):
        build(now=NOW, previous=None, fetchers={
            "cwfis_perimeters": boom, "bc_fires": boom,
            "bc_evac": boom, "aqhi": boom,
        })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_main.py -q`
Expected: FAIL — `No module named 'build.main'`

- [ ] **Step 3: Write the implementation**

`build/main.py`:

```python
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
from build.sources import aqhi, bc_evac, bc_fires, cwfis

# Which summary section each source populates.
SECTIONS = {
    "cwfis_perimeters": "fires",
    "bc_fires": "fires",
    "bc_evac": "evacuations",
    "aqhi": "aqhi",
}


def default_fetchers(session):
    return {
        "cwfis_perimeters": lambda: cwfis.normalize(cwfis.fetch(session)),
        "bc_fires": lambda: bc_fires.normalize(bc_fires.fetch(session)),
        "bc_evac": lambda: bc_evac.normalize(bc_evac.fetch(session)),
        "aqhi": lambda: aqhi.normalize(aqhi.fetch(session)),
    }


def _previous_items(previous, source_id):
    """Last good items for one source, recovered from the previous summary."""
    if not previous:
        return []
    section = previous.get(SECTIONS[source_id], [])
    return [item for item in section if item.get("source") == source_id]


def _previous_fetched_at(previous, source_id):
    if not previous:
        return None
    for source in previous.get("sources", []):
        if source["id"] == source_id:
            return source.get("fetched_at")
    return None


def build(now, previous, fetchers):
    sections = {"fires": [], "evacuations": [], "aqhi": []}
    sources = []
    succeeded = 0

    for source_id in sorted(fetchers):
        try:
            items = fetchers[source_id]()
            for item in items:
                item.setdefault("source", source_id)
            sections[SECTIONS[source_id]].extend(items)
            sources.append({"id": source_id, "ok": True, "fetched_at": now, "stale": False})
            succeeded += 1
        except Exception:  # noqa: BLE001 - one bad source must not sink the build
            sections[SECTIONS[source_id]].extend(_previous_items(previous, source_id))
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
        "sources": sources,
        "coverage": registry.coverage_payload(),
        **sections,
    }


def _write_atomically(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(payload, separators=(",", ":")))
    temp.replace(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="public/data")
    args = parser.parse_args()

    out = Path(args.out)
    summary_path = out / "summary.json"
    previous = json.loads(summary_path.read_text()) if summary_path.exists() else None

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    summary = build(now=now, previous=previous, fetchers=default_fetchers(make_session()))
    _write_atomically(summary_path, summary)

    failed = [s["id"] for s in summary["sources"] if not s["ok"]]
    print(f"wrote {summary_path} "
          f"({len(summary['fires'])} fires, "
          f"{len(summary['evacuations'])} evacuation zones, "
          f"{len(summary['aqhi'])} air quality readings)")
    if failed:
        print(f"WARNING: stale sources: {', '.join(failed)}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_main.py -q`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the real build once**

```bash
.venv/bin/python -m build.main --out public/data
```
Expected: a line reporting roughly 1400 fires, ~67 evacuation zones, ~126 air quality readings, and no WARNING.

- [ ] **Step 6: Commit**

```bash
git add build/main.py tests/test_main.py
git commit -m "Add build orchestrator with per-source staleness

A failing source keeps its last good data and reports its real age rather than
pretending to be fresh. If every source fails the build aborts, because an
empty summary would render as 'no fires anywhere in Canada'."
```

---

## Task 13: Size budget guard

The static-first architecture only works if `summary.json` stays small. This makes that a test rather than an intention.

**Files:**
- Test: `tests/test_budget.py`

- [ ] **Step 1: Write the failing test**

`tests/test_budget.py`:

```python
import gzip
import json
from pathlib import Path

import pytest

SUMMARY = Path("public/data/summary.json")
BUDGET_KB = 150


@pytest.mark.skipif(not SUMMARY.exists(), reason="run `python -m build.main` first")
def test_summary_stays_within_the_gzipped_size_budget():
    raw = SUMMARY.read_bytes()
    gzipped_kb = len(gzip.compress(raw, 9)) / 1024
    assert gzipped_kb < BUDGET_KB, (
        f"summary.json is {gzipped_kb:.1f} KB gzipped, over the {BUDGET_KB} KB budget. "
        "Simplify evacuation polygons or move data out of the near-me payload."
    )


@pytest.mark.skipif(not SUMMARY.exists(), reason="run `python -m build.main` first")
def test_summary_has_no_geometry_in_the_fires_section():
    # Fire polygons belong in perimeters.geojson, which is lazy-loaded.
    summary = json.loads(SUMMARY.read_text())
    for fire in summary["fires"]:
        assert "polygons" not in fire and "geometry" not in fire
```

- [ ] **Step 2: Run the test**

Run: `.venv/bin/pytest tests/test_budget.py -q`
Expected: PASS, 2 tests. Print the actual size for the record:

```bash
.venv/bin/python -c "
import gzip, pathlib
raw = pathlib.Path('public/data/summary.json').read_bytes()
print(f'{len(raw)/1024:.1f} KB raw, {len(gzip.compress(raw,9))/1024:.1f} KB gzipped')
"
```

If this already exceeds 150 KB, the evacuation polygons are the cause. Add
Ramer–Douglas–Peucker simplification in `build/simplify.py` and apply it in
`bc_evac.normalize` at a tolerance of 0.001 degrees before continuing. If the
budget passes, skip `build/simplify.py` entirely — it is not needed.

- [ ] **Step 3: Commit**

```bash
git add tests/test_budget.py
git commit -m "Add gzipped size budget guard for summary.json"
```

---

## Task 14: Coverage and place data (build-once)

**Files:**
- Create: `tools/build_coverage.py`
- Create: `tools/build_places.py`
- Create: `public/static/coverage.geojson`, `public/static/places.json` (generated, **committed**)

These are committed, unlike `public/data/`, because province boundaries and
community names change rarely and should not be a per-run dependency.

- [ ] **Step 1: Write `tools/build_coverage.py`**

```python
"""Build province polygons used to decide which coverage rules apply.

Source is the CWFIS basemap we already depend on, filtered to Canada. Features
are tagged CA-BC, CA-AB and so on. Run manually; boundaries do not change.
"""
import json
from pathlib import Path

from build.http import get_json, make_session

URL = "https://cwfis.cfs.nrcan.gc.ca/geoserver/ows"
OUT = Path("public/static/coverage.geojson")


def main():
    payload = get_json(make_session(), URL, params={
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": "public:basemap_land",
        "outputFormat": "application/json",
        "propertyName": "NAME,COUNTRY,STATEABB",
        "CQL_FILTER": "COUNTRY='CAN'",
    }, timeout=120)

    features = []
    for feature in payload["features"]:
        abbreviation = (feature["properties"].get("STATEABB") or "")
        if not abbreviation.startswith("CA-"):
            continue
        features.append({
            "type": "Feature",
            "properties": {"province": abbreviation[3:]},
            "geometry": feature["geometry"],
        })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(
        {"type": "FeatureCollection", "features": features}, separators=(",", ":")))
    print(f"wrote {OUT} with {len(features)} features")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it and check the size**

```bash
.venv/bin/python -m tools.build_coverage
ls -lh public/static/coverage.geojson
.venv/bin/python -c "
import collections, json
d = json.load(open('public/static/coverage.geojson'))
print(collections.Counter(f['properties']['province'] for f in d['features']))
"
```
Expected: 712 features, with BC appearing 95 times (islands are separate polygons).

If the file exceeds ~2 MB, reduce it by dropping polygons smaller than
0.01 square degrees — they are uninhabited islets and cannot change which
province a user is in:

```bash
.venv/bin/python -c "
import json, pathlib
p = pathlib.Path('public/static/coverage.geojson')
d = json.loads(p.read_text())
def big(f):
    rings = f['geometry']['coordinates']
    rings = rings if f['geometry']['type'] == 'MultiPolygon' else [rings]
    pts = [pt for poly in rings for pt in poly[0]]
    lons = [x for x, _ in pts]; lats = [y for _, y in pts]
    return (max(lons)-min(lons)) * (max(lats)-min(lats)) > 0.01
d['features'] = [f for f in d['features'] if big(f)]
p.write_text(json.dumps(d, separators=(',', ':')))
print(len(d['features']), 'features kept')
"
```

- [ ] **Step 3: Write `tools/build_places.py`**

```python
"""Build the community list used when a user declines browser geolocation.

Source is the Canadian Geographical Names database, filtered to populated
places. Run manually; the upstream file is regenerated weekly but names change
slowly.
"""
import csv
import io
import json
import zipfile
from pathlib import Path

from build.http import make_session

URL = ("https://ftp.maps.canada.ca/pub/nrcan_rncan/vector/geobase_cgn_toponyme/"
       "prov_csv_eng/cgn_canada_csv_eng.zip")
OUT = Path("public/static/places.json")
WANTED = {"City", "Town", "Village", "Hamlet", "Municipality",
          "Unincorporated area", "Community", "Indian Reserve"}


def main():
    response = make_session().get(URL, timeout=180)
    response.raise_for_status()

    archive = zipfile.ZipFile(io.BytesIO(response.content))
    name = next(n for n in archive.namelist() if n.lower().endswith(".csv"))
    rows = csv.DictReader(io.TextIOWrapper(archive.open(name), encoding="utf-8-sig"))

    places = []
    for row in rows:
        if row.get("Generic Category") != "Populated Place":
            continue
        if row.get("Generic Term") not in WANTED:
            continue
        try:
            lat, lon = float(row["Latitude"]), float(row["Longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        places.append({
            "n": row["Geographical Name"],
            "p": row.get("Province - Territory", "")[:2].upper(),
            "lat": round(lat, 4),
            "lon": round(lon, 4),
        })

    places.sort(key=lambda p: (p["n"], p["p"]))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(places, separators=(",", ":"), ensure_ascii=False))
    print(f"wrote {OUT} with {len(places)} places")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run it and inspect the real column names**

```bash
.venv/bin/python -m tools.build_places
```

If this prints `0 places`, the CSV column names differ from those assumed
above. Inspect them and correct the field names in the script:

```bash
.venv/bin/python -c "
import io, zipfile, csv, requests
z = zipfile.ZipFile(io.BytesIO(requests.get('$URL', timeout=180).content))
n = next(x for x in z.namelist() if x.lower().endswith('.csv'))
r = csv.DictReader(io.TextIOWrapper(z.open(n), encoding='utf-8-sig'))
print(r.fieldnames)
print(next(r))
"
```
Expected after correction: several thousand places, and `ls -lh` under ~2 MB.

- [ ] **Step 5: Commit**

```bash
git add tools/build_coverage.py tools/build_places.py public/static/
git commit -m "Add build-once province coverage polygons and community list"
```

---

## Task 15: Bilingual strings

**Files:**
- Create: `public/js/i18n.js`
- Test: `tests-js/test_i18n.js`

- [ ] **Step 1: Write the failing test**

`tests-js/test_i18n.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, t } from '../public/js/i18n.js';

test('every English key has a French counterpart', () => {
  const en = Object.keys(STRINGS.en).sort();
  const fr = Object.keys(STRINGS.fr).sort();
  assert.deepEqual(en, fr, 'EN and FR key sets must match exactly');
});

test('t substitutes variables', () => {
  assert.equal(t('en', 'fire_near', { km: 12, direction: 'north' }),
    'There is a wildfire 12 km north of you.');
  assert.equal(t('fr', 'fire_near', { km: 12, direction: 'nord' }),
    'Il y a un feu de forêt à 12 km au nord de vous.');
});

test('t returns the key itself when a string is missing, never blank', () => {
  assert.equal(t('en', 'no_such_key'), 'no_such_key');
});

test('compass points are translated', () => {
  assert.equal(t('en', 'dir_NE'), 'northeast');
  assert.equal(t('fr', 'dir_NE'), 'nord-est');
});

test('every AQHI band has advice in both languages', () => {
  for (const band of ['low', 'moderate', 'high', 'very_high']) {
    assert.ok(STRINGS.en[`aqhi_${band}_advice`]);
    assert.ok(STRINGS.fr[`aqhi_${band}_advice`]);
  }
});

test('every evacuation state has copy in both languages', () => {
  for (const state of ['order', 'alert', 'none_found', 'cannot_check']) {
    assert.ok(STRINGS.en[`evac_${state}`]);
    assert.ok(STRINGS.fr[`evac_${state}`]);
  }
});

test('status badges are distinct from air quality wording', () => {
  // A fire card must not be labelled "Good" — that word belongs to air quality.
  for (const lang of ['en', 'fr']) {
    for (const level of ['safe', 'caution', 'danger']) {
      assert.ok(STRINGS[lang][`badge_${level}`]);
    }
    assert.notEqual(STRINGS[lang].badge_safe, STRINGS[lang].aqhi_low);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests-js/test_i18n.js`
Expected: FAIL — cannot find `i18n.js`

- [ ] **Step 3: Write the implementation**

`public/js/i18n.js`:

```js
// AQHI advice paraphrases Environment and Climate Change Canada's published
// health messages for the general population, in plain language.
export const STRINGS = {
  en: {
    title: 'Fire Near Me',
    check_button: 'Check fires near me',
    checking: 'Checking…',
    locate_failed: 'We could not find your location. Please choose your community.',
    choose_place: 'Choose your community',

    badge_safe: 'All clear',
    badge_caution: 'Take care',
    badge_danger: 'Danger',

    fire_heading: 'Wildfires',
    evac_heading: 'Evacuations',
    fire_none: 'No wildfires within {km} km of you.',
    fire_near: 'There is a wildfire {km} km {direction} of you.',
    fire_near_named: '{name} is burning {km} km {direction} of you.',
    fire_status: 'Status: {status}',
    fire_estimate_note: 'Fire areas outside British Columbia are estimated from satellite images and may be a few hours old.',

    evac_order: 'You are inside an evacuation ORDER area. Leave now and follow instructions from local officials.',
    evac_alert: 'You are inside an evacuation ALERT area. Be ready to leave quickly.',
    evac_none_found: 'No evacuation order or alert covers your location right now.',
    evac_cannot_check: 'We cannot check evacuation orders in {province}. Please check the official page.',
    evac_issued_by: 'Issued by {agency}',

    aqhi_heading: 'Air quality',
    aqhi_low: 'Good',
    aqhi_moderate: 'Moderate',
    aqhi_high: 'Unhealthy',
    aqhi_very_high: 'Very unhealthy',
    aqhi_low_advice: 'The air is fine. Enjoy your usual outdoor activities.',
    aqhi_moderate_advice: 'Most people can go outside as usual. If you have heart or breathing problems, take it easy.',
    aqhi_high_advice: 'Try to stay indoors and keep windows closed. Avoid hard work outside.',
    aqhi_very_high_advice: 'Stay indoors with windows closed. Avoid going outside if you can.',
    aqhi_unavailable: 'We do not have an air quality reading near you right now.',
    aqhi_distant: 'Nearest reading is from {name}, about {km} km away.',

    updated: 'Updated {minutes} minutes ago',
    stale_warning: 'This information is more than an hour old.',
    official_link: 'Official wildfire information for {province}',
    sources_link: 'Where this information comes from',
    map_link: 'See the map',

    dir_N: 'north', dir_NE: 'northeast', dir_E: 'east', dir_SE: 'southeast',
    dir_S: 'south', dir_SW: 'southwest', dir_W: 'west', dir_NW: 'northwest',
  },
  fr: {
    title: 'Feux près de moi',
    check_button: 'Vérifier les feux près de moi',
    checking: 'Vérification…',
    locate_failed: "Nous n'avons pas pu trouver votre position. Veuillez choisir votre municipalité.",
    choose_place: 'Choisissez votre municipalité',

    badge_safe: 'Rien à signaler',
    badge_caution: 'Prudence',
    badge_danger: 'Danger',

    fire_heading: 'Feux de forêt',
    evac_heading: 'Évacuations',
    fire_none: "Aucun feu de forêt à moins de {km} km de vous.",
    fire_near: 'Il y a un feu de forêt à {km} km au {direction} de vous.',
    fire_near_named: '{name} brûle à {km} km au {direction} de vous.',
    fire_status: 'État : {status}',
    fire_estimate_note: "Hors de la Colombie-Britannique, les zones de feu sont estimées par satellite et peuvent avoir quelques heures de retard.",

    evac_order: "Vous êtes dans une zone visée par un ORDRE d'évacuation. Partez maintenant et suivez les consignes des autorités locales.",
    evac_alert: "Vous êtes dans une zone visée par une ALERTE d'évacuation. Soyez prêt à partir rapidement.",
    evac_none_found: "Aucun ordre ni alerte d'évacuation ne vise votre position en ce moment.",
    evac_cannot_check: "Nous ne pouvons pas vérifier les ordres d'évacuation en {province}. Veuillez consulter la page officielle.",
    evac_issued_by: 'Émis par {agency}',

    aqhi_heading: "Qualité de l'air",
    aqhi_low: 'Bonne',
    aqhi_moderate: 'Modérée',
    aqhi_high: 'Mauvaise',
    aqhi_very_high: 'Très mauvaise',
    aqhi_low_advice: "L'air est bon. Profitez de vos activités habituelles à l'extérieur.",
    aqhi_moderate_advice: "La plupart des gens peuvent sortir normalement. Si vous avez des problèmes cardiaques ou respiratoires, allez-y doucement.",
    aqhi_high_advice: "Essayez de rester à l'intérieur et gardez les fenêtres fermées. Évitez les efforts à l'extérieur.",
    aqhi_very_high_advice: "Restez à l'intérieur, fenêtres fermées. Évitez de sortir si possible.",
    aqhi_unavailable: "Nous n'avons pas de mesure de la qualité de l'air près de vous en ce moment.",
    aqhi_distant: 'La mesure la plus proche vient de {name}, à environ {km} km.',

    updated: 'Mis à jour il y a {minutes} minutes',
    stale_warning: "Cette information date de plus d'une heure.",
    official_link: 'Information officielle sur les feux — {province}',
    sources_link: "D'où vient cette information",
    map_link: 'Voir la carte',

    dir_N: 'nord', dir_NE: 'nord-est', dir_E: 'est', dir_SE: 'sud-est',
    dir_S: 'sud', dir_SW: 'sud-ouest', dir_W: 'ouest', dir_NW: 'nord-ouest',
  },
};

export function t(lang, key, vars = {}) {
  const template = (STRINGS[lang] || STRINGS.en)[key];
  if (template === undefined) return key;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests-js/test_i18n.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add public/js/i18n.js tests-js/test_i18n.js
git commit -m "Add bilingual strings with matched EN/FR key sets"
```

---

## Task 16: Location handling

**Files:**
- Create: `public/js/location.js`
- Test: `tests-js/test_location.js`

- [ ] **Step 1: Write the failing test**

`tests-js/test_location.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { provinceAt, searchPlaces } from '../public/js/location.js';

const COVERAGE = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { province: 'BC' },
      geometry: { type: 'Polygon', coordinates: [[[-121, 49], [-121, 51], [-119, 51], [-119, 49]]] } },
    { type: 'Feature', properties: { province: 'AB' },
      geometry: { type: 'Polygon', coordinates: [[[-115, 49], [-115, 51], [-113, 51], [-113, 49]]] } },
  ],
};

test('provinceAt finds the containing province', () => {
  assert.equal(provinceAt({ lat: 50, lon: -120 }, COVERAGE), 'BC');
  assert.equal(provinceAt({ lat: 50, lon: -114 }, COVERAGE), 'AB');
});

test('provinceAt returns null outside every polygon', () => {
  // Fail-safe: an unknown province means the caller must say "cannot check".
  assert.equal(provinceAt({ lat: 10, lon: -60 }, COVERAGE), null);
});

const PLACES = [
  { n: 'Kamloops', p: 'BC', lat: 50.67, lon: -120.33 },
  { n: 'Kamsack', p: 'SK', lat: 51.56, lon: -101.9 },
  { n: 'Vancouver', p: 'BC', lat: 49.28, lon: -123.12 },
];

test('searchPlaces matches a name prefix, case-insensitively', () => {
  const results = searchPlaces('kam', PLACES);
  assert.deepEqual(results.map((p) => p.n), ['Kamloops', 'Kamsack']);
});

test('searchPlaces caps the number of results', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ n: `Ax${i}`, p: 'ON', lat: 45, lon: -75 }));
  assert.equal(searchPlaces('ax', many, 10).length, 10);
});

test('searchPlaces returns nothing for a query that is too short', () => {
  assert.deepEqual(searchPlaces('k', PLACES), []);
  assert.deepEqual(searchPlaces('', PLACES), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests-js/test_location.js`
Expected: FAIL — cannot find `location.js`

- [ ] **Step 3: Write the implementation**

`public/js/location.js`:

```js
import { pointInMultiPolygon } from './geo.js';

const STORAGE_KEY = 'fire-near-me.place';
const MIN_QUERY = 2;

// Returns the province code containing the point, or null. Null is meaningful:
// the caller must treat an unknown province as "we cannot check here".
export function provinceAt(point, coverage) {
  for (const feature of coverage.features) {
    const { type, coordinates } = feature.geometry;
    const polygons = type === 'MultiPolygon' ? coordinates : [coordinates];
    if (pointInMultiPolygon(point, polygons)) return feature.properties.province;
  }
  return null;
}

export function searchPlaces(query, places, limit = 20) {
  const needle = query.trim().toLowerCase();
  if (needle.length < MIN_QUERY) return [];
  const results = [];
  for (const place of places) {
    if (place.n.toLowerCase().startsWith(needle)) {
      results.push(place);
      if (results.length >= limit) break;
    }
  }
  return results;
}

export function savedPlace() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function savePlace(place) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(place));
  } catch {
    // Private browsing can refuse storage. Losing the saved place is harmless.
  }
}

// Resolves to {lat, lon} or rejects. The caller falls back to the place picker.
export function locateBrowser({ timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('geolocation unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(err),
      { timeout: timeoutMs, maximumAge: 300000, enableHighAccuracy: false },
    );
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests-js/test_location.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add public/js/location.js tests-js/test_location.js
git commit -m "Add location resolution with province lookup and place search"
```

---

## Task 17: Near-me page

**Files:**
- Create: `public/index.html`, `public/css/app.css`, `public/js/near-me.js`

- [ ] **Step 1: Write `public/css/app.css`**

```css
:root {
  --fg: #16181d;
  --bg: #ffffff;
  --muted: #4a4f57;
  --line: #c9ced6;
  --green: #12633a;
  --amber: #8a5300;
  --red: #a2151b;
  --green-bg: #e7f5ec;
  --amber-bg: #fdf3e2;
  --red-bg: #fdeaea;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 1rem;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 1.25rem;
  line-height: 1.6;
  color: var(--fg);
  background: var(--bg);
  max-width: 40rem;
  margin-inline: auto;
}

h1 { font-size: 1.9rem; margin: 0 0 1rem; }

button, .button {
  font: inherit;
  font-size: 1.4rem;
  font-weight: 600;
  min-height: 4rem;
  width: 100%;
  padding: 1rem;
  border: 2px solid var(--fg);
  border-radius: 0.5rem;
  background: var(--fg);
  color: var(--bg);
  cursor: pointer;
}

button:focus-visible, a:focus-visible {
  outline: 4px solid #0b57d0;
  outline-offset: 3px;
}

.card {
  border: 2px solid var(--line);
  border-left-width: 0.75rem;
  border-radius: 0.5rem;
  padding: 1rem 1.25rem;
  margin: 1.25rem 0;
}

.card h2 { font-size: 1.3rem; margin: 0 0 0.5rem; }
.card p { margin: 0.5rem 0; }

.card.green { border-color: var(--green); background: var(--green-bg); }
.card.amber { border-color: var(--amber); background: var(--amber-bg); }
.card.red   { border-color: var(--red);   background: var(--red-bg); }

/* Colour is never the only signal: each card also carries a text label. */
.badge { font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; font-size: 1rem; }
.green .badge { color: var(--green); }
.amber .badge { color: var(--amber); }
.red   .badge { color: var(--red); }

.meta { color: var(--muted); font-size: 1rem; }
.hidden { display: none; }

input[type="search"] {
  font: inherit;
  width: 100%;
  min-height: 3.5rem;
  padding: 0.75rem;
  border: 2px solid var(--line);
  border-radius: 0.5rem;
}

ul.places { list-style: none; padding: 0; margin: 0.5rem 0; }
ul.places button { text-align: left; background: var(--bg); color: var(--fg); margin: 0.25rem 0; }

nav a { display: inline-block; margin-right: 1.5rem; padding: 0.5rem 0; color: #0b57d0; }

@media (prefers-contrast: more) {
  :root { --line: #000000; --muted: #000000; }
}
```

- [ ] **Step 2: Write `public/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fire Near Me</title>
  <link rel="stylesheet" href="/css/app.css">
</head>
<body>
  <h1 id="title">Fire Near Me</h1>

  <p><button id="lang-toggle" style="width:auto;min-height:3rem;font-size:1.1rem">Français</button></p>

  <button id="check">Check fires near me</button>

  <div id="picker" class="hidden">
    <p id="picker-label">Choose your community</p>
    <input type="search" id="place-search" autocomplete="off" aria-label="Search for your community">
    <ul class="places" id="place-results"></ul>
  </div>

  <div id="cards" aria-live="polite"></div>

  <nav>
    <a href="/map.html" id="map-link">See the map</a>
    <a href="/sources.html" id="sources-link">Where this information comes from</a>
  </nav>

  <script type="module" src="/js/near-me.js"></script>
</body>
</html>
```

- [ ] **Step 3: Write `public/js/near-me.js`**

```js
import { haversineKm, nearest } from './geo.js';
import { t } from './i18n.js';
import { locateBrowser, provinceAt, savePlace, savedPlace, searchPlaces } from './location.js';
import { aqhiBand, evacuationState, fireState, NEAR_KM } from './status.js';

const STALE_MINUTES = 60;
const DISTANT_STATION_KM = 100;

let lang = (navigator.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en';
let summary = null;
let coverage = null;
let places = null;

const $ = (id) => document.getElementById(id);

async function loadJSON(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

function minutesSince(iso) {
  if (!iso) return null;
  return Math.round((Date.now() - new Date(iso).getTime()) / 60000);
}

function sourceInfo(id) {
  return (summary.sources || []).find((s) => s.id === id) || { stale: true, fetched_at: null };
}

function card(level, heading, badge, lines, meta) {
  const el = document.createElement('div');
  el.className = `card ${level}`;
  const parts = [`<h2>${heading}</h2>`, `<p class="badge">${badge}</p>`];
  for (const line of lines.filter(Boolean)) parts.push(`<p>${line}</p>`);
  if (meta) parts.push(`<p class="meta">${meta}</p>`);
  el.innerHTML = parts.join('');
  return el;
}

function ageMeta(sourceIds) {
  const ages = sourceIds.map((id) => minutesSince(sourceInfo(id).fetched_at)).filter((m) => m !== null);
  if (!ages.length) return t(lang, 'stale_warning');
  const oldest = Math.max(...ages);
  return oldest > STALE_MINUTES
    ? `${t(lang, 'updated', { minutes: oldest })} — ${t(lang, 'stale_warning')}`
    : t(lang, 'updated', { minutes: oldest });
}

function fireCard(point) {
  const state = fireState({ point, fires: summary.fires, nearKm: NEAR_KM });
  if (state.level === 'green') {
    return card('green', t(lang, 'fire_heading'), t(lang, 'badge_safe'),
      [t(lang, 'fire_none', { km: NEAR_KM })], ageMeta(['cwfis_perimeters', 'bc_fires']));
  }
  const direction = t(lang, `dir_${state.direction}`);
  const line = state.fire.named
    ? t(lang, 'fire_near_named', { name: state.fire.name, km: state.km, direction })
    : t(lang, 'fire_near', { km: state.km, direction });
  const status = state.fire.status ? t(lang, 'fire_status', { status: state.fire.status }) : null;
  const note = state.fire.named ? null : t(lang, 'fire_estimate_note');
  return card('amber', t(lang, 'fire_heading'), t(lang, 'badge_caution'),
    [line, status, note], ageMeta(['cwfis_perimeters', 'bc_fires']));
}

function evacCard(point, province) {
  const evacSource = sourceInfo('bc_evac');
  const provinceRow = (summary.coverage || []).find((c) => c.province === province);
  const covered = Boolean(provinceRow && provinceRow.evacuations);
  const state = evacuationState({
    point,
    evacuations: summary.evacuations,
    covered,
    stale: evacSource.stale,
  });

  if (state.state === 'order' || state.state === 'alert') {
    const level = state.state === 'order' ? 'red' : 'amber';
    const badge = state.state === 'order' ? t(lang, 'badge_danger') : t(lang, 'badge_caution');
    const agency = state.zone.agency ? t(lang, 'evac_issued_by', { agency: state.zone.agency }) : null;
    return card(level, `${t(lang, 'evac_heading')} — ${state.zone.name}`, badge,
      [t(lang, `evac_${state.state}`), agency], ageMeta(['bc_evac']));
  }
  if (state.state === 'none_found') {
    return card('green', t(lang, 'evac_heading'), t(lang, 'badge_safe'),
      [t(lang, 'evac_none_found')], ageMeta(['bc_evac']));
  }
  const name = province || '—';
  const link = provinceRow
    ? `<a href="${provinceRow.official_url}">${t(lang, 'official_link', { province: name })}</a>`
    : null;
  return card('amber', t(lang, 'evac_heading'), t(lang, 'badge_caution'),
    [t(lang, 'evac_cannot_check', { province: name }), link], null);
}

function aqhiCard(point) {
  const best = nearest(point, summary.aqhi);
  if (!best) return card('green', t(lang, 'aqhi_heading'), '—', [t(lang, 'aqhi_unavailable')], null);
  const band = aqhiBand(best.item.value);
  if (!band) return card('green', t(lang, 'aqhi_heading'), '—', [t(lang, 'aqhi_unavailable')], null);
  const level = band === 'low' ? 'green' : band === 'very_high' ? 'red' : 'amber';
  const distant = best.km > DISTANT_STATION_KM
    ? t(lang, 'aqhi_distant', { name: best.item.name[lang], km: Math.round(best.km) })
    : null;
  return card(level, t(lang, 'aqhi_heading'), t(lang, `aqhi_${band}`),
    [t(lang, `aqhi_${band}_advice`), distant], ageMeta(['aqhi']));
}

function render(point) {
  const province = provinceAt(point, coverage);
  const cards = $('cards');
  cards.innerHTML = '';
  cards.append(evacCard(point, province), fireCard(point), aqhiCard(point));
}

async function showPicker() {
  $('picker').classList.remove('hidden');
  if (!places) places = await loadJSON('/static/places.json');
  const input = $('place-search');
  const results = $('place-results');
  input.oninput = () => {
    results.innerHTML = '';
    for (const place of searchPlaces(input.value, places, 8)) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.textContent = `${place.n}, ${place.p}`;
      button.onclick = () => {
        savePlace(place);
        $('picker').classList.add('hidden');
        render(place);
      };
      li.append(button);
      results.append(li);
    }
  };
  input.focus();
}

async function check() {
  $('check').textContent = t(lang, 'checking');
  try {
    if (!summary) [summary, coverage] = await Promise.all([
      loadJSON('/data/summary.json'),
      loadJSON('/static/coverage.geojson'),
    ]);
    const point = await locateBrowser();
    render(point);
  } catch {
    const saved = savedPlace();
    if (saved && summary) render(saved);
    else await showPicker();
  } finally {
    $('check').textContent = t(lang, 'check_button');
  }
}

function applyLanguage() {
  document.documentElement.lang = lang;
  $('title').textContent = t(lang, 'title');
  $('check').textContent = t(lang, 'check_button');
  $('picker-label').textContent = t(lang, 'choose_place');
  $('map-link').textContent = t(lang, 'map_link');
  $('sources-link').textContent = t(lang, 'sources_link');
  $('lang-toggle').textContent = lang === 'en' ? 'Français' : 'English';
}

$('lang-toggle').onclick = () => {
  lang = lang === 'en' ? 'fr' : 'en';
  applyLanguage();
  const saved = savedPlace();
  if (summary && saved) render(saved);
};
$('check').onclick = check;
applyLanguage();
```

- [ ] **Step 4: Verify all tests still pass and serve the page**

```bash
node --test tests-js/ && .venv/bin/pytest -q
python3 -m http.server -d public 8000
```
Open `http://localhost:8000`. Press the button, allow location. Expected: three
cards render, evacuation first. Press **Français** — every string switches.
Decline location in a fresh private window: the community picker appears.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/css/app.css public/js/near-me.js
git commit -m "Add near-me page with evacuation, fire, and air quality cards"
```

---

## Task 18: Map and sources pages

**Files:**
- Create: `public/map.html`, `public/js/map-page.js`, `public/sources.html`, `public/js/sources-page.js`
- Modify: `build/main.py` (write `perimeters.geojson`)

- [ ] **Step 1: Add perimeter output to `build/main.py`**

In `build/sources/cwfis.py`, add a passthrough that keeps the raw geometry for the map:

```python
def perimeters_geojson(payload):
    """Raw perimeter polygons for the map layer, which is lazy-loaded."""
    return {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": {}, "geometry": f["geometry"]}
            for f in payload.get("features", [])
            if f.get("geometry")
        ],
    }
```

In `build/main.py`, inside `main()`, after writing the summary:

```python
    from build.sources import cwfis as _cwfis
    try:
        raw = _cwfis.fetch(make_session())
        _write_atomically(out / "perimeters.geojson", _cwfis.perimeters_geojson(raw))
    except Exception as exc:  # noqa: BLE001 - the map layer is not safety critical
        print(f"WARNING: perimeters.geojson not refreshed: {exc}")
```

The map layer failing must never fail the build — the near-me answer does not depend on it.

- [ ] **Step 2: Write `public/map.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fire Near Me — Map</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <link rel="stylesheet" href="/css/app.css">
  <style>#map { height: 70vh; border: 2px solid var(--line); border-radius: 0.5rem; }</style>
</head>
<body>
  <h1>Map</h1>
  <p><a href="/">&larr; Back</a></p>
  <p>
    <label><input type="checkbox" id="t-fires" checked> Fires</label>
    <label><input type="checkbox" id="t-evac" checked> Evacuation areas</label>
    <label><input type="checkbox" id="t-perim"> Fire areas</label>
  </p>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script type="module" src="/js/map-page.js"></script>
</body>
</html>
```

- [ ] **Step 3: Write `public/js/map-page.js`**

```js
const map = L.map('map').setView([56, -96], 4);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 12,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

const fires = L.layerGroup().addTo(map);
const evac = L.layerGroup().addTo(map);
const perimeters = L.layerGroup();

fetch('/data/summary.json').then((r) => r.json()).then((summary) => {
  for (const fire of summary.fires) {
    L.circleMarker([fire.lat, fire.lon], {
      radius: fire.named ? 8 : 5,
      color: '#a2151b',
      fillColor: '#a2151b',
      fillOpacity: 0.7,
    }).bindPopup(fire.named ? `${fire.name} — ${fire.status}` : 'Estimated fire area')
      .addTo(fires);
  }
  for (const zone of summary.evacuations) {
    L.geoJSON({ type: 'MultiPolygon', coordinates: zone.polygons }, {
      color: zone.kind === 'order' ? '#a2151b' : '#8a5300',
      weight: 2,
      fillOpacity: 0.25,
    }).bindPopup(`${zone.name} — ${zone.kind}`).addTo(evac);
  }
});

// Perimeters are megabytes, so they load only when the user asks for them.
let perimetersLoaded = false;
document.getElementById('t-perim').onchange = async (e) => {
  if (e.target.checked) {
    if (!perimetersLoaded) {
      perimetersLoaded = true;
      const data = await fetch('/data/perimeters.geojson').then((r) => r.json());
      L.geoJSON(data, { color: '#a2151b', weight: 1, fillOpacity: 0.2 }).addTo(perimeters);
    }
    perimeters.addTo(map);
  } else {
    map.removeLayer(perimeters);
  }
};
document.getElementById('t-fires').onchange = (e) =>
  e.target.checked ? fires.addTo(map) : map.removeLayer(fires);
document.getElementById('t-evac').onchange = (e) =>
  e.target.checked ? evac.addTo(map) : map.removeLayer(evac);
```

- [ ] **Step 4: Write `public/sources.html` and `public/js/sources-page.js`**

`public/sources.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fire Near Me — Sources</title>
  <link rel="stylesheet" href="/css/app.css">
</head>
<body>
  <h1>Where this information comes from</h1>
  <p><a href="/">&larr; Back</a></p>
  <div id="sources"></div>
  <h2>Coverage by province</h2>
  <div id="coverage"></div>
  <script type="module" src="/js/sources-page.js"></script>
</body>
</html>
```

`public/js/sources-page.js`:

```js
const LABELS = {
  aqhi: 'Environment and Climate Change Canada — Air Quality Health Index',
  bc_evac: 'BC Evacuation Orders and Alerts',
  bc_fires: 'BC Wildfire Service — Active Fires',
  cwfis_perimeters: 'Canadian Wildland Fire Information System — Estimated Fire Perimeters',
};

fetch('/data/summary.json').then((r) => r.json()).then((summary) => {
  document.getElementById('sources').innerHTML = summary.sources.map((s) => `
    <div class="card ${s.ok ? 'green' : 'amber'}">
      <h2>${LABELS[s.id] || s.id}</h2>
      <p class="badge">${s.ok ? 'Up to date' : 'Not updating'}</p>
      <p class="meta">Last updated: ${s.fetched_at || 'never'}</p>
    </div>`).join('');

  document.getElementById('coverage').innerHTML = summary.coverage.map((c) => `
    <div class="card ${c.evacuations ? 'green' : 'amber'}">
      <h2>${c.province}</h2>
      <p>Named fires: ${c.named_fires ? 'yes' : 'no'} &middot;
         Evacuation orders: ${c.evacuations ? 'yes' : 'no — check the official page'}</p>
      <p><a href="${c.official_url}">Official wildfire information</a></p>
    </div>`).join('');
});
```

- [ ] **Step 5: Rebuild and check both pages**

```bash
.venv/bin/python -m build.main --out public/data
ls -lh public/data/
python3 -m http.server -d public 8000
```
Open `/map.html` — fires and evacuation zones render, the "Fire areas" toggle
loads perimeters on demand. Open `/sources.html` — four sources and thirteen
provinces render, BC green, the rest amber.

- [ ] **Step 6: Commit**

```bash
git add public/map.html public/sources.html public/js/map-page.js public/js/sources-page.js build/main.py build/sources/cwfis.py
git commit -m "Add map and sources pages with lazy-loaded perimeters"
```

---

## Task 19: CI build and deploy

**Files:**
- Create: `.github/workflows/test.yml`, `.github/workflows/build-and-deploy.yml`

- [ ] **Step 1: Write `.github/workflows/test.yml`**

```yaml
name: test
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: pip install -r requirements.txt
      - run: pytest -q
      - run: node --test tests-js/
```

- [ ] **Step 2: Write `.github/workflows/build-and-deploy.yml`**

```yaml
name: build-and-deploy
on:
  schedule:
    - cron: '*/10 * * * *'
  workflow_dispatch:
  push:
    branches: [main]

concurrency:
  group: deploy
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install -r requirements.txt

      # Recover the previous summary so a failing source can keep its last
      # good data instead of disappearing.
      - name: Fetch previous data
        continue-on-error: true
        run: |
          mkdir -p public/data
          curl -sf "${{ vars.SITE_URL }}/data/summary.json" -o public/data/summary.json || true

      - run: python -m build.main --out public/data

      - name: Check size budget
        run: pytest tests/test_budget.py -q

      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy public --project-name=fire-near-me --branch=main
```

- [ ] **Step 3: Note the required repository configuration**

Before the workflow can deploy, set in the GitHub repository:
- Secret `CLOUDFLARE_API_TOKEN` — a token with the **Cloudflare Pages: Edit** permission.
- Secret `CLOUDFLARE_ACCOUNT_ID` — from the Cloudflare dashboard sidebar.
- Variable `SITE_URL` — the deployed site origin, e.g. `https://fire-near-me.pages.dev`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/
git commit -m "Add test and scheduled build-and-deploy workflows"
```

---

## Task 20: Publish to GitHub

- [ ] **Step 1: Confirm the working tree is clean and only contains our files**

```bash
git status --short
```
Expected: empty output. If anything unexpected appears, inspect it before continuing — never sweep unknown files into a commit.

- [ ] **Step 2: Authenticate if needed**

```bash
gh auth status || gh auth login
```

- [ ] **Step 3: Create the repository and push**

```bash
git branch -M main
gh repo create fire-near-me \
  --public \
  --source=. \
  --remote=origin \
  --description "Is there a fire near me? Plain-language wildfire, evacuation, and air quality information for Canada, in English and French." \
  --push
```

This creates `https://github.com/Gautier242/fire-near-me` and pushes `main`.
No `dev` branch: at this size, short-lived branches off `main` are enough.

- [ ] **Step 4: Verify CI ran**

```bash
gh run list --limit 5
```
Expected: a `test` run, and a `build-and-deploy` run that will fail at the
Cloudflare step until the secrets from Task 19 Step 3 are set. Set them:

```bash
gh secret set CLOUDFLARE_API_TOKEN
gh secret set CLOUDFLARE_ACCOUNT_ID
gh variable set SITE_URL --body "https://fire-near-me.pages.dev"
gh workflow run build-and-deploy
```

- [ ] **Step 5: Verify the deployed site**

```bash
curl -sI "$(gh variable get SITE_URL)/data/summary.json" | head -3
curl -s "$(gh variable get SITE_URL)/data/summary.json" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('generated:', d['generated_at'])
print('fires:', len(d['fires']), 'evac:', len(d['evacuations']), 'aqhi:', len(d['aqhi']))
print('stale:', [s['id'] for s in d['sources'] if s['stale']] or 'none')
"
```
Expected: HTTP 200, a recent `generated_at`, non-zero counts, and no stale sources.

---

## Verification checklist

Run before calling this done. Report actual output, not recollection.

```bash
.venv/bin/pytest -q                 # all Python tests
node --test tests-js/               # all frontend tests
.venv/bin/python -m build.main --out public/data
.venv/bin/pytest tests/test_budget.py -q
```

Manual checks that automated tests cannot cover:

- [ ] In BC with no evacuation nearby, the evacuation card reads "No evacuation order or alert covers your location right now."
- [ ] In Alberta, the evacuation card reads "We cannot check evacuation orders in AB" and links to the Alberta page. **It must never read "none found."**
- [ ] The Français toggle changes every visible string, including card bodies.
- [ ] Keyboard alone can reach and operate the check button, the language toggle, the place search, and every card link.
- [ ] At 200% browser zoom nothing is clipped or overlapping.
- [ ] Every card states its data age; a source older than 60 minutes shows the stale warning.
