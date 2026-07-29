# France Hyper-Local Fire View — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A third view at `/fr/zone.html` that answers, for one address and the ~50 km around it: where the fire is, how bad, where it is going, who is fighting it, and what a person with a given skill can usefully do.

**Architecture:** Per-layer radii instead of one global radius, because a building 40 km away carries no information while a fire does. Wide layers (fire, wind, aircraft, imagery, closures) load to 50 km; terrain and water to 20 km; buildings and street detail load for the visible viewport past zoom 13. Hot zones listed in a committed config file are pre-built on the existing 30-minute cron; anywhere else fetches live from the browser. One repo, one code path per layer — a région is a data entry, never a fork.

**Tech Stack:** Python 3.11 stdlib + requests (build side), vanilla ES modules + Leaflet 1.9.4 (browser). No new dependencies on either side.

## Global Constraints

- **No new dependencies.** stdlib only on the Python side (`json`, `csv`, `math`, `sqlite3`, `struct`, `zoneinfo`); no npm, no framework, no build step in the browser.
- **Paths must be page-relative.** The site is served from `/fire-app/`. `href="/css/app.css"` 404s. Use `../css/app.css`.
- **Bilingual.** Every user-facing string needs `fr` and `en`. The French map uses the `COPY` object in `public/js/app-fr.js`, **not** `public/js/i18n.js` — `tests-js/test_i18n.js` asserts that table's two key sets are exactly equal and adding French-only keys there breaks it.
- **`public/data/` and `public/fr/data/` are gitignored.** Generated data is built in CI, never committed.
- **`summary.json` must stay under 150 KB gzipped** (`tests/test_budget.py`). Anything larger is a lazy-loaded side file.
- **Absence is never safety.** No detected fire means our satellites saw nothing in the last 24 h, not that anyone is safe. Cloud blocks detection; VIIRS passes a few times a day.
- **Observed and modelled data must be visually distinct.** Forecast danger already uses Météo-France colours deliberately kept off the fire heat ramp. Modelled spread follows the same rule.
- **Commit messages are plain engineering prose.** No AI or tooling mentions, no Co-Authored-By trailers, no emoji.
- **Never `git add .`** — stage explicit paths. Other agents may have work staged in the shared index.
- Current test baseline: **335 Python** (`.venv/bin/pytest -q`) and **79 JS** (`node --test tests-js/*.js`). Both must stay green.

---

## File Structure

| File | Responsibility |
|---|---|
| `public/static/fr/zones.json` | Committed config: which départements/cities are always pre-built, the auto-selection danger threshold, radii |
| `build/zones.py` | Reads the config, decides today's hot zones, writes one file per zone |
| `build/sources/fr/arome.py` | AROME 1.3 km wind, gusts, temperature, humidity for a zone |
| `build/sources/fr/terrain.py` | IGN elevation → slope and aspect on a coarse grid |
| `build/fire_spread.py` | Rothermel surface spread model + projected footprint |
| `public/js/imagery.js` | Satellite layer catalogue and date selection |
| `public/js/local.js` | Local-view state: which zone, which layers, viewport loading |
| `public/js/overpass.js` | Viewport-driven buildings and streets |
| `public/js/helping.js` | Skill → useful action mapping, static |
| `public/fr/zone.html` | The local page |

Task order matters: 1 and 2 give a working page with existing data, so every later task lands on something already useful. The spread model is task 7 — last of the data work — because it is the one component that could be wrong, and everything under it stays true if it is.

---

## Task 1: Zone configuration

**Files:**
- Create: `public/static/fr/zones.json`
- Create: `build/zones.py`
- Test: `tests/test_zones.py`

**Interfaces:**
- Consumes: `build.sources.fr.mdf.normalize()` output — a list of `{"dep", "name", "level_today", "level_tomorrow"}`
- Produces: `load_config(path) -> dict`, `active_zones(config, danger_rows) -> list[dict]` where each zone is `{"id": str, "label": str, "lat": float, "lon": float, "radius_km": int, "reason": "config"|"danger"}`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_zones.py
"""Which places get pre-built detail.

The config exists so the site owner can pin a région they care about without
waiting for it to catch fire, and the danger threshold exists so somewhere
nobody pinned still gets detail on the day it matters.
"""
import json

from build.zones import active_zones, load_config


def test_a_pinned_zone_is_always_active(tmp_path):
    path = tmp_path / "zones.json"
    path.write_text(json.dumps({
        "auto_danger_min": 3,
        "radius_km": 50,
        "always": [{"id": "gironde", "label": "Gironde", "lat": 44.84, "lon": -0.58}],
    }))

    zones = active_zones(load_config(path), danger_rows=[])

    assert len(zones) == 1
    assert zones[0]["id"] == "gironde"
    assert zones[0]["reason"] == "config"
    assert zones[0]["radius_km"] == 50


def test_a_departement_at_high_danger_becomes_active_without_being_pinned(tmp_path):
    path = tmp_path / "zones.json"
    path.write_text(json.dumps({"auto_danger_min": 3, "radius_km": 50, "always": []}))
    rows = [
        {"dep": "83", "name": "Var", "level_today": 4, "lat": 43.4, "lon": 6.2},
        {"dep": "29", "name": "Finistère", "level_today": 1, "lat": 48.2, "lon": -4.1},
    ]

    zones = active_zones(load_config(path), rows)

    assert [z["id"] for z in zones] == ["dep-83"]
    assert zones[0]["reason"] == "danger"


def test_tomorrow_counts_too_because_detail_must_exist_before_the_fire(tmp_path):
    path = tmp_path / "zones.json"
    path.write_text(json.dumps({"auto_danger_min": 3, "radius_km": 50, "always": []}))
    rows = [{"dep": "33", "name": "Gironde", "level_today": 2, "level_tomorrow": 4,
             "lat": 44.84, "lon": -0.58}]

    assert [z["id"] for z in active_zones(load_config(path), rows)] == ["dep-33"]


def test_a_pinned_zone_is_not_duplicated_when_it_also_hits_the_threshold(tmp_path):
    path = tmp_path / "zones.json"
    path.write_text(json.dumps({
        "auto_danger_min": 3, "radius_km": 50,
        "always": [{"id": "dep-33", "label": "Gironde", "lat": 44.84, "lon": -0.58}],
    }))
    rows = [{"dep": "33", "name": "Gironde", "level_today": 4, "lat": 44.84, "lon": -0.58}]

    zones = active_zones(load_config(path), rows)

    assert len(zones) == 1
    assert zones[0]["reason"] == "config"


def test_a_departement_row_with_no_coordinates_is_skipped_not_crashed_on(tmp_path):
    path = tmp_path / "zones.json"
    path.write_text(json.dumps({"auto_danger_min": 3, "radius_km": 50, "always": []}))
    rows = [{"dep": "83", "name": "Var", "level_today": 4}]

    assert active_zones(load_config(path), rows) == []


def test_a_missing_config_still_yields_danger_zones(tmp_path):
    # The config is a convenience. Losing it must not stop the map from building
    # detail where it is actually burning.
    config = load_config(tmp_path / "absent.json")
    rows = [{"dep": "83", "name": "Var", "level_today": 4, "lat": 43.4, "lon": 6.2}]

    assert [z["id"] for z in active_zones(config, rows)] == ["dep-83"]


def test_the_number_of_zones_is_capped(tmp_path):
    # Every zone is a full set of fetches on a 30-minute cron. An August day with
    # 60 departements at level 3 must not turn into 60 zone builds.
    path = tmp_path / "zones.json"
    path.write_text(json.dumps({"auto_danger_min": 3, "radius_km": 50,
                                "max_zones": 6, "always": []}))
    rows = [{"dep": f"{n:02d}", "name": str(n), "level_today": 4,
             "lat": 44.0 + n / 100, "lon": 2.0} for n in range(1, 20)]

    assert len(active_zones(load_config(path), rows)) == 6
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_zones.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'build.zones'`

- [ ] **Step 3: Write the config file**

```json
{
  "_readme": "Which places get pre-built hyper-local detail. Anything not listed here still works — the browser fetches it live on demand — but a listed zone is instant and available offline. Add a departement or a city you care about to `always`. `auto_danger_min` picks up anywhere at that Meteo des forets level or above, today or tomorrow, so somewhere nobody pinned still gets detail on the day it matters.",
  "auto_danger_min": 3,
  "radius_km": 50,
  "max_zones": 6,
  "always": [
    { "id": "gironde", "label": "Bordeaux et Gironde", "lat": 44.8378, "lon": -0.5792 },
    { "id": "landes", "label": "Landes", "lat": 44.0000, "lon": -0.7667 }
  ]
}
```

- [ ] **Step 4: Write minimal implementation**

```python
# build/zones.py
"""Which places get pre-built hyper-local detail.

Two ways in. The site owner pins a region in zones.json because they care about
it whether or not it is burning today, and anywhere reaching a high Meteo des
forets level is picked up automatically so a fire somewhere nobody thought about
still gets detail.

Everywhere else still works: the browser fetches its own area live. A zone is an
optimisation, never a precondition for coverage.
"""
import json

DEFAULTS = {"auto_danger_min": 3, "radius_km": 50, "max_zones": 6, "always": []}


def load_config(path):
    """Read the config, falling back to defaults it cannot be read.

    A missing or broken config must not stop detail being built where it is
    burning, so the danger threshold survives on its own.
    """
    config = dict(DEFAULTS)
    try:
        loaded = json.loads(path.read_text())
    except (OSError, ValueError):
        return config
    if isinstance(loaded, dict):
        for key in DEFAULTS:
            if key in loaded:
                config[key] = loaded[key]
    return config


def active_zones(config, danger_rows):
    """Today's pre-build list: pinned zones first, then high-danger departements."""
    radius = int(config.get("radius_km") or DEFAULTS["radius_km"])
    zones, seen = [], set()

    for entry in config.get("always") or []:
        if entry.get("lat") is None or entry.get("lon") is None:
            continue
        zone_id = str(entry.get("id") or "").strip()
        if not zone_id or zone_id in seen:
            continue
        seen.add(zone_id)
        zones.append({"id": zone_id, "label": entry.get("label") or zone_id,
                      "lat": float(entry["lat"]), "lon": float(entry["lon"]),
                      "radius_km": int(entry.get("radius_km") or radius),
                      "reason": "config"})

    threshold = int(config.get("auto_danger_min") or DEFAULTS["auto_danger_min"])
    for row in danger_rows or []:
        # Tomorrow counts as well as today: detail has to exist before the fire,
        # not after it.
        levels = [row.get("level_today"), row.get("level_tomorrow")]
        if not any(isinstance(v, int) and v >= threshold for v in levels):
            continue
        if row.get("lat") is None or row.get("lon") is None:
            continue  # a departement we cannot place cannot be a zone
        zone_id = f"dep-{row['dep']}"
        if zone_id in seen:
            continue
        seen.add(zone_id)
        zones.append({"id": zone_id, "label": row.get("name") or zone_id,
                      "lat": float(row["lat"]), "lon": float(row["lon"]),
                      "radius_km": radius, "reason": "danger"})

    # Every zone is a full set of fetches on a 30-minute cron. Cap it.
    return zones[:int(config.get("max_zones") or DEFAULTS["max_zones"])]
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_zones.py -q`
Expected: PASS, 7 tests

- [ ] **Step 6: Commit**

```bash
git add build/zones.py tests/test_zones.py public/static/fr/zones.json
git commit -m "Choose which places get pre-built local detail

Two ways in. A region pinned in zones.json is always built, because the site
owner may care about somewhere before it burns. Anywhere reaching Meteo des
forets level 3 today or tomorrow is picked up automatically, so a fire nowhere
anybody pinned still gets detail.

Tomorrow counts as well as today: the detail has to exist before the fire.

Capped at six zones. Every zone is a full set of fetches on a thirty-minute
cron, and an August day can put sixty departements at level 3."
```

---

## Task 2: Département centroids for zone placement

**Files:**
- Modify: `build/sources/fr/mdf.py` (add coordinates to normalized rows)
- Test: `tests/test_mdf.py` (extend)

**Interfaces:**
- Consumes: `public/static/fr/departements.geojson` (already in repo, 96 features with `code` and `nom`)
- Produces: `mdf.normalize()` rows gain `"lat"` and `"lon"` — the values `build.zones.active_zones` needs

- [ ] **Step 1: Write the failing test**

```python
# append to tests/test_mdf.py
def test_normalized_rows_carry_a_centroid_for_zone_placement():
    # build.zones needs somewhere to centre a zone. Without coordinates a
    # high-danger departement is silently skipped.
    import json
    from pathlib import Path
    from build.sources.fr import mdf

    shapes = json.loads(Path("public/static/fr/departements.geojson").read_text())
    rows = mdf.normalize(Path("tests/fixtures/mdf.csv").read_bytes(), shapes=shapes)

    var = [r for r in rows if r["dep"] == "83"][0]
    assert 42.0 < var["lat"] < 44.5
    assert 5.0 < var["lon"] < 7.5


def test_coordinates_are_omitted_rather_than_guessed_when_shapes_are_absent():
    from pathlib import Path
    from build.sources.fr import mdf

    rows = mdf.normalize(Path("tests/fixtures/mdf.csv").read_bytes())
    assert rows[0].get("lat") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_mdf.py -q`
Expected: FAIL — `normalize()` does not accept a `shapes` keyword

- [ ] **Step 3: Write minimal implementation**

Add to `build/sources/fr/mdf.py`:

```python
def _centroid(feature):
    """Mean vertex of the largest ring. Good enough to centre a 50 km zone.

    Not a true centroid — a polygon's vertex mean drifts toward whichever edge
    has more detail. At this radius that error is irrelevant, and a real
    centroid would need shapely.
    """
    geom = feature.get("geometry") or {}
    coords = geom.get("coordinates") or []
    if geom.get("type") == "Polygon":
        coords = [coords]
    rings = [poly[0] for poly in coords if poly and poly[0]]
    if not rings:
        return None, None
    ring = max(rings, key=len)
    return (sum(p[1] for p in ring) / len(ring),
            sum(p[0] for p in ring) / len(ring))


def centroids(shapes):
    """Map departement code to (lat, lon)."""
    out = {}
    for feature in (shapes or {}).get("features", []):
        code = (feature.get("properties") or {}).get("code")
        if not code:
            continue
        lat, lon = _centroid(feature)
        if lat is not None:
            out[str(code)] = (lat, lon)
    return out
```

Then in `normalize()`, accept `shapes=None`, build `points = centroids(shapes)` once, and when appending each record add:

```python
            lat, lon = points.get(dep, (None, None))
            record["lat"] = lat
            record["lon"] = lon
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_mdf.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add build/sources/fr/mdf.py tests/test_mdf.py
git commit -m "Give each departement a centroid so a zone can be placed on it

build.zones centres a fifty-kilometre zone on a departement, and without
coordinates a high-danger departement was silently skipped.

The value is a vertex mean rather than a true centroid, which drifts toward
whichever edge carries more detail. At this radius that error does not matter and
a real centroid would need shapely."
```

---

## Task 3: AROME high-resolution wind

**Files:**
- Create: `build/sources/fr/arome.py`
- Test: `tests/test_arome.py`
- Create: `tests/fixtures/arome.json`

**Interfaces:**
- Produces: `fetch(session, lat, lon, hours=24) -> dict`, `normalize(payload, now=None) -> list[dict]` where each entry is `{"time": ISO, "wind_kmh": float|None, "gust_kmh": float|None, "wind_dir": int|None, "wind_toward": str|None, "temp_c": float|None, "humidity_pct": int|None}`

**Why this exists when `build/sources/fr/wind.py` already fetches wind:** `wind.py` uses Open-Meteo's default blend at ~11 km and returns one reading per fire for right now. The spread model needs the *next several hours* at the resolution a fire actually responds to, and it needs **gusts** — verified at Lacanau, mean 8.8 km/h against gusts of 32.0 km/h. Gusts drive fire runs; the mean does not. Keep both modules: `wind.py` stays the national per-fire reading, this is the zone forecast.

- [ ] **Step 1: Capture the fixture**

```bash
curl -s "https://api.open-meteo.com/v1/meteofrance?latitude=44.98&longitude=-1.08&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m,relative_humidity_2m&models=arome_france_hd&forecast_days=2&timezone=Europe%2FParis" \
  -o tests/fixtures/arome.json
```

Confirm the file has 48 hourly values and a `wind_gusts_10m` array.

- [ ] **Step 2: Write the failing test**

```python
# tests/test_arome.py
"""AROME 1.3 km wind for a zone.

Meteo-France's high-resolution model, reached through Open-Meteo. Gusts matter
more than mean wind: measured at Lacanau, mean 8.8 km/h against gusts of 32.0.
A fire run happens on the gust.
"""
import json
from pathlib import Path

from build.sources.fr import arome

PAYLOAD = json.loads(Path("tests/fixtures/arome.json").read_text())


def test_hours_are_returned_in_order_with_gusts():
    rows = arome.normalize(PAYLOAD)

    assert len(rows) >= 24
    assert rows[0]["time"] < rows[-1]["time"]
    assert any(r["gust_kmh"] is not None for r in rows)


def test_wind_toward_is_the_reciprocal_of_the_reported_direction():
    # Meteorology reports where wind comes FROM. For a fire the useful half is
    # where it is going. public/js/history.js holds the same convention for
    # Canada and the two must never disagree.
    rows = arome.normalize({"hourly": {
        "time": ["2026-07-29T14:00"], "wind_speed_10m": [10.0],
        "wind_gusts_10m": [25.0], "wind_direction_10m": [270],
        "temperature_2m": [30.0], "relative_humidity_2m": [25],
    }})

    assert rows[0]["wind_dir"] == 270
    assert rows[0]["wind_toward"] == "E"


def test_a_null_reading_stays_null_and_never_becomes_zero():
    # Calm and unknown are different. A fabricated 0 km/h reads as "no wind" when
    # we simply do not know, and the spread model would treat it as fact.
    rows = arome.normalize({"hourly": {
        "time": ["2026-07-29T14:00"], "wind_speed_10m": [None],
        "wind_gusts_10m": [None], "wind_direction_10m": [None],
        "temperature_2m": [None], "relative_humidity_2m": [None],
    }})

    assert rows[0]["wind_kmh"] is None
    assert rows[0]["gust_kmh"] is None
    assert rows[0]["wind_toward"] is None


def test_a_malformed_payload_returns_no_rows_rather_than_raising():
    for payload in (None, {}, {"hourly": None}, {"hourly": {"time": None}}):
        assert arome.normalize(payload) == []


def test_the_requested_hour_count_is_bounded():
    rows = arome.normalize(PAYLOAD, hours=6)
    assert len(rows) == 6
```

- [ ] **Step 3: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_arome.py -q`
Expected: FAIL with `ImportError: cannot import name 'arome'`

- [ ] **Step 4: Write minimal implementation**

```python
# build/sources/fr/arome.py
"""AROME 1.3 km wind, gusts, temperature and humidity for one point.

Meteo-France's high-resolution model, reached through Open-Meteo's free
endpoint. build/sources/fr/wind.py already fetches wind nationally at ~11 km for
one hour per fire; this is the zone forecast at the resolution a fire responds
to, over the next hours, and it carries gusts.

Gusts are the point. Measured at Lacanau on 2026-07-29: mean 8.8 km/h against
gusts of 32.0. A fire run happens on the gust, not the average.
"""
URL = "https://api.open-meteo.com/v1/meteofrance"
MAX_HOURS = 48

FIELDS = ("wind_speed_10m", "wind_gusts_10m", "wind_direction_10m",
          "temperature_2m", "relative_humidity_2m")

_COMPASS = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")


def wind_toward(direction):
    """The compass point the wind is blowing toward.

    int(x + 0.5) rather than round(), matching public/js/history.js: Python
    rounds halves to even and JavaScript rounds them up, and they disagree on
    exactly the eight boundary bearings.
    """
    if direction is None:
        return None
    return _COMPASS[int(((direction + 180) % 360) / 45 + 0.5) % 8]


def fetch(session, lat, lon, hours=24):
    hours = max(1, min(int(hours), MAX_HOURS))
    response = session.get(URL, timeout=30, params={
        "latitude": round(float(lat), 4),
        "longitude": round(float(lon), 4),
        "hourly": ",".join(FIELDS),
        "models": "arome_france_hd",
        "forecast_days": 2,
        # French civil time, matching atmo.py. UTC would read two hours stale to
        # every French user through the summer.
        "timezone": "Europe/Paris",
    })
    response.raise_for_status()
    return response.json()


def normalize(payload, now=None, hours=MAX_HOURS):
    hourly = (payload or {}).get("hourly") or {}
    times = hourly.get("time")
    if not isinstance(times, list):
        return []

    def col(name):
        values = hourly.get(name)
        return values if isinstance(values, list) else []

    speed, gust = col("wind_speed_10m"), col("wind_gusts_10m")
    direction = col("wind_direction_10m")
    temp, humidity = col("temperature_2m"), col("relative_humidity_2m")

    def at(values, i):
        return values[i] if i < len(values) else None

    rows = []
    for i, stamp in enumerate(times[:max(1, min(int(hours), MAX_HOURS))]):
        bearing = at(direction, i)
        rows.append({
            "time": stamp,
            "wind_kmh": at(speed, i),
            "gust_kmh": at(gust, i),
            "wind_dir": bearing,
            "wind_toward": wind_toward(bearing),
            "temp_c": at(temp, i),
            "humidity_pct": at(humidity, i),
        })
    return rows
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_arome.py -q`
Expected: PASS, 5 tests

- [ ] **Step 6: Verify against the live API**

Run:
```bash
.venv/bin/python -c "
from build.http import make_session
from build.sources.fr import arome
rows = arome.normalize(arome.fetch(make_session(), 44.98, -1.08), hours=6)
for r in rows: print(r['time'], r['wind_kmh'], 'gust', r['gust_kmh'], '->', r['wind_toward'])
"
```
Expected: 6 hourly rows with real numbers. Report the peak gust.

- [ ] **Step 7: Commit**

```bash
git add build/sources/fr/arome.py tests/test_arome.py tests/fixtures/arome.json
git commit -m "Fetch AROME 1.3 km wind and gusts for a zone

Meteo-France's high-resolution model through Open-Meteo. wind.py already covers
the national per-fire reading at about eleven kilometres for the current hour;
the spread model needs the next hours at the resolution a fire responds to.

Gusts are the reason. Measured at Lacanau: mean 8.8 km/h against gusts of 32.0.
A fire run happens on the gust and not on the average.

Null stays null. Calm and unknown are different, and a fabricated zero would be
fed to the spread model as fact."
```

---

## Task 4: Terrain slope and aspect

**Files:**
- Create: `build/sources/fr/terrain.py`
- Test: `tests/test_terrain.py`
- Create: `tests/fixtures/terrain.json`

**Interfaces:**
- Produces: `fetch(session, lat, lon, radius_km=20, step=8) -> dict`, `normalize(payload, step) -> dict` shaped `{"grid": [[{"lat","lon","elev_m","slope_deg","aspect_deg","uphill"}]], "step": int}`

**Why:** fire runs uphill far faster than on the flat, and the Rothermel slope factor in Task 7 needs `tan(slope)`. IGN's elevation service is free and needs no key — verified HTTP 200 at `data.geopf.fr/altimetrie`.

- [ ] **Step 1: Establish the API shape before designing around it**

Run:
```bash
curl -s "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json?lon=-1.08|-1.00&lat=44.98|45.02&resource=ign_rge_alti_wld&delimiter=|&indent=true"
```

Report the exact response shape — whether elevations come back as a list under `elevations`, what the per-point keys are, and what a point outside coverage returns. **Do not guess this.** Save the response as `tests/fixtures/terrain.json`.

- [ ] **Step 2: Write the failing test**

```python
# tests/test_terrain.py
"""Slope and aspect, because fire runs uphill.

The Rothermel slope factor needs tan(slope), and a resident needs to know that
the fire below them will reach them faster than the distance suggests.
"""
import json
from pathlib import Path

from build.sources.fr import terrain

PAYLOAD = json.loads(Path("tests/fixtures/terrain.json").read_text())


def test_a_flat_grid_has_no_slope_and_no_uphill_direction():
    flat = [[100.0, 100.0, 100.0], [100.0, 100.0, 100.0], [100.0, 100.0, 100.0]]

    cell = terrain.slope_at(flat, 1, 1, spacing_m=100.0)

    assert cell["slope_deg"] == 0.0
    # On the flat there is no uphill, and inventing one would send the spread
    # model a direction it should not have.
    assert cell["uphill"] is None


def test_slope_and_uphill_are_computed_from_the_neighbourhood():
    # Rising toward the north: row 0 is high, row 2 is low.
    grid = [[200.0, 200.0, 200.0], [150.0, 150.0, 150.0], [100.0, 100.0, 100.0]]

    cell = terrain.slope_at(grid, 1, 1, spacing_m=100.0)

    assert 25.0 < cell["slope_deg"] < 30.0
    assert cell["uphill"] == "N"


def test_a_45_degree_rise_reads_as_45_degrees():
    grid = [[200.0, 200.0, 200.0], [100.0, 100.0, 100.0], [0.0, 0.0, 0.0]]

    cell = terrain.slope_at(grid, 1, 1, spacing_m=100.0)

    assert 44.0 < cell["slope_deg"] < 46.0


def test_a_missing_neighbour_yields_no_slope_rather_than_a_wrong_one():
    grid = [[None, 100.0, 100.0], [100.0, 100.0, 100.0], [100.0, 100.0, None]]

    assert terrain.slope_at(grid, 1, 1, spacing_m=100.0)["slope_deg"] is None


def test_a_live_payload_normalizes_into_a_grid():
    out = terrain.normalize(PAYLOAD, step=3)

    assert out["step"] == 3
    assert out["grid"]
    assert all("elev_m" in cell for row in out["grid"] for cell in row)


def test_an_empty_payload_returns_an_empty_grid():
    assert terrain.normalize(None, step=3)["grid"] == []
```

- [ ] **Step 3: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_terrain.py -q`
Expected: FAIL with `ImportError: cannot import name 'terrain'`

- [ ] **Step 4: Write minimal implementation**

```python
# build/sources/fr/terrain.py
"""Slope and aspect from IGN elevation.

Fire runs uphill much faster than on the flat — the Rothermel slope factor needs
tan(slope) — and a resident needs to know that a fire below them arrives sooner
than the map distance suggests.

IGN's RGE ALTI service is free and needs no key. It is sampled on a coarse grid
rather than at full 1 m resolution: a 50 km zone at 1 m would be billions of
points, and the spread model works at the scale of a fire front, not a footpath.
"""
import math

_COMPASS = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")

URL = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json"
RESOURCE = "ign_rge_alti_wld"

# Points per request. IGN accepts pipe-delimited batches; keep well under any
# URL-length ceiling, the trap that bit the Open-Meteo fetch at 8192 bytes.
BATCH = 50


def _compass(deg):
    return _COMPASS[int((deg % 360) / 45 + 0.5) % 8]


def slope_at(grid, row, col, spacing_m):
    """Slope in degrees and the uphill compass point, by finite difference.

    Returns None for both when any neighbour is missing: a slope computed from a
    hole is a wrong number, and a wrong slope feeds the spread model a wrong
    rate.
    """
    try:
        north, south = grid[row - 1][col], grid[row + 1][col]
        west, east = grid[row][col - 1], grid[row][col + 1]
    except IndexError:
        return {"slope_deg": None, "aspect_deg": None, "uphill": None}
    if None in (north, south, west, east):
        return {"slope_deg": None, "aspect_deg": None, "uphill": None}

    # Rows run north to south, so a positive dz_dy means the ground rises north.
    dz_dy = (north - south) / (2 * spacing_m)
    dz_dx = (east - west) / (2 * spacing_m)
    magnitude = math.hypot(dz_dx, dz_dy)
    slope_deg = math.degrees(math.atan(magnitude))
    if magnitude == 0:
        # No uphill exists on the flat, and inventing one would hand the spread
        # model a direction it must not have.
        return {"slope_deg": 0.0, "aspect_deg": None, "uphill": None}

    aspect = (math.degrees(math.atan2(dz_dx, dz_dy)) + 360) % 360
    return {"slope_deg": round(slope_deg, 2), "aspect_deg": round(aspect, 1),
            "uphill": _compass(aspect)}
```

Complete `fetch()` and `normalize()` against the real response shape established in Step 1. `fetch()` builds a `step x step` lat/lon grid spanning `radius_km`, batches the points `BATCH` at a time, and returns `{"points": [...], "step": step, "spacing_m": ...}`. `normalize()` walks the grid calling `slope_at`.

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_terrain.py -q`
Expected: PASS, 6 tests

- [ ] **Step 6: Verify against live data at a place with real relief**

Run:
```bash
.venv/bin/python -c "
from build.http import make_session
from build.sources.fr import terrain
# Massif des Maures, Var - real slope, unlike the Landes pine flats
out = terrain.normalize(terrain.fetch(make_session(), 43.30, 6.40, radius_km=20, step=8), step=8)
cells = [c for row in out['grid'] for c in row if c.get('slope_deg') is not None]
print('cells:', len(cells))
print('max slope:', max(c['slope_deg'] for c in cells))
print('uphill directions:', {c['uphill'] for c in cells})
"
```
Expected: real slopes above zero. Report the maximum. A flat result over the Maures means the grid or the response parsing is wrong.

- [ ] **Step 7: Commit**

```bash
git add build/sources/fr/terrain.py tests/test_terrain.py tests/fixtures/terrain.json
git commit -m "Compute slope and aspect from IGN elevation

Fire runs uphill much faster than on the flat, so the Rothermel slope factor
needs tan(slope), and a resident needs to know a fire below them arrives sooner
than the map distance suggests.

Sampled on a coarse grid rather than at full one-metre resolution. A fifty
kilometre zone at one metre would be billions of points, and the spread model
works at the scale of a fire front.

A cell with any missing neighbour reports no slope rather than a slope computed
from a hole, because a wrong slope becomes a wrong rate of spread."
```

---

## Task 5: Satellite imagery catalogue and date picker

**Files:**
- Create: `public/js/imagery.js`
- Test: `tests-js/test_imagery.js`

**Interfaces:**
- Produces: `LAYERS` (array of `{id, label: {fr, en}, kind: "gibs"|"static", template, maxNativeZoom, attribution, dated}`), `tileUrl(layer, date) -> string`, `availableDates(today, count) -> string[]`

- [ ] **Step 1: Write the failing test**

```javascript
// tests-js/test_imagery.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LAYERS, availableDates, tileUrl } from '../public/js/imagery.js';

test('every layer declares what it is and whether it can be dated', () => {
  assert.ok(LAYERS.length >= 4);
  for (const layer of LAYERS) {
    assert.ok(layer.id, 'layer needs an id');
    assert.ok(layer.label.fr && layer.label.en, `${layer.id} needs both languages`);
    assert.ok(layer.template.includes('{z}'), `${layer.id} needs a tile template`);
    assert.equal(typeof layer.dated, 'boolean');
  }
});

test('a dated layer gets the date substituted into its template', () => {
  const viirs = LAYERS.find((l) => l.id === 'viirs_noaa20');
  const url = tileUrl(viirs, '2026-07-27');
  assert.ok(url.includes('2026-07-27'));
  assert.ok(!url.includes('{date}'));
});

test('an undated layer ignores the date rather than corrupting its url', () => {
  // EOX Sentinel-2 cloudless is an annual composite. Passing it a date must not
  // produce a URL with a stray date in it.
  const s2 = LAYERS.find((l) => l.id === 's2cloudless');
  const url = tileUrl(s2, '2026-07-27');
  assert.ok(!url.includes('2026-07-27'));
  assert.ok(url.includes('{z}'));
});

test('available dates run backwards from today and cover three weeks', () => {
  const dates = availableDates('2026-07-29', 22);
  assert.equal(dates[0], '2026-07-29');
  assert.equal(dates.length, 22);
  assert.equal(dates.at(-1), '2026-07-08');
  // Strictly descending, no duplicates, no gaps.
  for (let i = 1; i < dates.length; i++) assert.ok(dates[i] < dates[i - 1]);
});

test('dates cross a month boundary correctly', () => {
  const dates = availableDates('2026-08-02', 4);
  assert.deepEqual(dates, ['2026-08-02', '2026-08-01', '2026-07-31', '2026-07-30']);
});

test('a thermal anomaly layer exists so past fire activity can be seen', () => {
  const thermal = LAYERS.find((l) => l.id === 'thermal');
  assert.ok(thermal, 'MODIS thermal anomalies must be selectable');
  assert.equal(thermal.dated, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests-js/test_imagery.js`
Expected: FAIL with `Cannot find module .../public/js/imagery.js`

- [ ] **Step 3: Write minimal implementation**

```javascript
// public/js/imagery.js
// The satellite layers a reader can choose, and the dates they can choose from.
//
// Resolution and cadence trade against each other. VIIRS and MODIS are daily but
// coarse; Landsat is 30 m but monthly; Sentinel-2 at 10 m is the sharpest
// available without an account, but only as an annual cloudless composite — the
// anonymous Copernicus endpoint 404s, so genuinely dated 10 m imagery needs a
// key we do not have. The label says so rather than implying it is current.

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

export const LAYERS = [
  {
    id: 'viirs_noaa20',
    label: { fr: 'VIIRS NOAA-20 · 375 m · quotidien', en: 'VIIRS NOAA-20 · 375 m · daily' },
    kind: 'gibs', dated: true, maxNativeZoom: 9,
    template: `${GIBS}/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/{date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
    attribution: 'NASA EOSDIS GIBS',
  },
  {
    id: 'viirs_snpp',
    label: { fr: 'VIIRS SNPP · 375 m · quotidien', en: 'VIIRS SNPP · 375 m · daily' },
    kind: 'gibs', dated: true, maxNativeZoom: 9,
    template: `${GIBS}/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/{date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
    attribution: 'NASA EOSDIS GIBS',
  },
  {
    id: 'modis_terra',
    label: { fr: 'MODIS Terra · 250 m · quotidien', en: 'MODIS Terra · 250 m · daily' },
    kind: 'gibs', dated: true, maxNativeZoom: 9,
    template: `${GIBS}/MODIS_Terra_CorrectedReflectance_TrueColor/default/{date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
    attribution: 'NASA EOSDIS GIBS',
  },
  {
    id: 'thermal',
    // Not imagery: the satellite's own fire detections, as a tile layer. Scrub
    // the date back and the burn's progress becomes visible.
    label: { fr: 'Points chauds MODIS · quotidien', en: 'MODIS hotspots · daily' },
    kind: 'gibs', dated: true, maxNativeZoom: 9,
    template: `${GIBS}/MODIS_Combined_Thermal_Anomalies_All/default/{date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`,
    attribution: 'NASA EOSDIS GIBS',
  },
  {
    id: 'landsat',
    label: { fr: 'Landsat · 30 m · mensuel', en: 'Landsat · 30 m · monthly' },
    kind: 'gibs', dated: true, maxNativeZoom: 12,
    template: `${GIBS}/Landsat_WELD_CorrectedReflectance_TrueColor_Global_Monthly/default/{date}/GoogleMapsCompatible_Level12/{z}/{y}/{x}.png`,
    attribution: 'NASA EOSDIS GIBS',
  },
  {
    id: 's2cloudless',
    label: {
      fr: 'Sentinel-2 · 10 m · composite annuel (pas du jour)',
      en: 'Sentinel-2 · 10 m · annual composite (not today)',
    },
    kind: 'static', dated: false, maxNativeZoom: 14,
    template: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg',
    attribution: 'Sentinel-2 cloudless by EOX',
  },
  {
    id: 'ign_ortho',
    label: { fr: 'Photo aérienne IGN · 20 cm', en: 'IGN aerial · 20 cm' },
    kind: 'static', dated: false, maxNativeZoom: 19,
    template: 'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile'
      + '&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM'
      + '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg',
    attribution: 'IGN — data.geopf.fr',
  },
];

export function tileUrl(layer, date) {
  if (!layer) return '';
  // An undated layer must not end up with a stray date in its URL.
  return layer.dated ? layer.template.replace('{date}', date) : layer.template;
}

export function availableDates(today, count = 22) {
  const out = [];
  const start = new Date(`${today}T00:00:00Z`);
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests-js/test_imagery.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Verify the tile URLs actually serve**

Run:
```bash
node -e "
import('./public/js/imagery.js').then(async ({LAYERS, tileUrl, availableDates}) => {
  const date = availableDates('$(date -u -v-2d +%Y-%m-%d 2>/dev/null || date -u -d "2 days ago" +%Y-%m-%d)', 1)[0];
  for (const l of LAYERS) {
    const url = tileUrl(l, date).replace('{z}','8').replace('{y}','90').replace('{x}','127');
    const r = await fetch(url).catch(() => null);
    console.log((r ? r.status : 'ERR').toString().padEnd(4), l.id);
  }
});
"
```
Expected: every layer returns 200. Report any that do not — a layer that 404s must be removed from `LAYERS` rather than left to fail silently in the browser.

- [ ] **Step 6: Commit**

```bash
git add public/js/imagery.js tests-js/test_imagery.js
git commit -m "Add a selectable satellite imagery catalogue with dates

Seven layers spanning the resolution and cadence trade: VIIRS and MODIS daily at
375 and 250 metres, Landsat monthly at 30, Sentinel-2 at 10 as an annual
composite, IGN aerial at 20 centimetres, and MODIS thermal anomalies so scrubbing
the date back shows a burn's progress.

Genuinely dated ten-metre Sentinel-2 needs a Copernicus account: the anonymous
endpoint returns 404. The label says annual composite rather than implying the
image is current.

An undated layer ignores the date instead of taking a stray one into its URL."
```

---

## Task 6: Viewport-driven buildings and streets

**Files:**
- Create: `public/js/overpass.js`
- Test: `tests-js/test_overpass.js`

**Interfaces:**
- Produces: `buildQuery(bounds, kinds) -> string`, `parse(payload) -> {buildings: [...], roads: [...]}`, `MIN_ZOOM`

**Why viewport rather than radius — the arithmetic that decides it.** Measured density near Lacanau is 123 buildings/km². At a 50 km radius that is 7,854 km² and ~966,000 buildings; at 100 km, ~3.85 million. Neither is loadable by Overpass or survivable by a browser. The same data by viewport is ~7,400 buildings at zoom 13 and ~490 at zoom 15. So buildings are bound to what is on screen, and the 50 km radius applies only to layers that scale — fire, wind, aircraft, imagery, closures.

- [ ] **Step 1: Write the failing test**

```javascript
// tests-js/test_overpass.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MIN_ZOOM, buildQuery, parse } from '../public/js/overpass.js';

const BOUNDS = { south: 44.95, west: -1.12, north: 45.01, east: -1.04 };

test('the query is bounded by the viewport and asks only for what was requested', () => {
  const q = buildQuery(BOUNDS, ['building']);
  assert.ok(q.includes('44.95,-1.12,45.01,-1.04'));
  assert.ok(q.includes('building'));
  assert.ok(!q.includes('highway'), 'must not fetch roads when only buildings asked');
  assert.ok(/timeout:\d+/.test(q), 'an unbounded Overpass query is rude and slow');
});

test('buildings and roads are separated with usable geometry', () => {
  const payload = { elements: [
    { type: 'way', id: 1, tags: { building: 'house' },
      geometry: [{ lat: 44.96, lon: -1.10 }, { lat: 44.961, lon: -1.10 }, { lat: 44.961, lon: -1.101 }] },
    { type: 'way', id: 2, tags: { highway: 'residential', name: 'Rue des Pins' },
      geometry: [{ lat: 44.97, lon: -1.09 }, { lat: 44.975, lon: -1.088 }] },
  ] };

  const { buildings, roads } = parse(payload);

  assert.equal(buildings.length, 1);
  assert.equal(roads.length, 1);
  assert.equal(roads[0].name, 'Rue des Pins');
  assert.deepEqual(buildings[0].points[0], [44.96, -1.10]);
});

test('a way with no geometry is dropped rather than drawn at null', () => {
  const payload = { elements: [{ type: 'way', id: 3, tags: { building: 'yes' } }] };
  assert.equal(parse(payload).buildings.length, 0);
});

test('an unnamed road is kept, because an unnamed track is still an escape route', () => {
  const payload = { elements: [
    { type: 'way', id: 4, tags: { highway: 'track' },
      geometry: [{ lat: 44.97, lon: -1.09 }, { lat: 44.975, lon: -1.088 }] },
  ] };
  const { roads } = parse(payload);
  assert.equal(roads.length, 1);
  assert.equal(roads[0].name, null);
});

test('a malformed or empty payload returns empty lists rather than throwing', () => {
  for (const payload of [null, {}, { elements: null }, { elements: [{}] }]) {
    const out = parse(payload);
    assert.deepEqual(out.buildings, []);
    assert.deepEqual(out.roads, []);
  }
});

test('a minimum zoom is declared so a whole-country query is impossible', () => {
  // 123 buildings/km2 measured near Lacanau: a 50 km radius is ~966,000
  // buildings and a 100 km radius ~3.85 million. Neither can be loaded, so
  // buildings are bound to the viewport and gated on zoom.
  assert.ok(MIN_ZOOM >= 12);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests-js/test_overpass.js`
Expected: FAIL with `Cannot find module .../public/js/overpass.js`

- [ ] **Step 3: Write minimal implementation**

```javascript
// public/js/overpass.js
// Buildings and streets for what is on screen.
//
// Bound to the viewport rather than to a radius, and that is arithmetic rather
// than preference. Measured density near Lacanau is 123 buildings/km2, so a
// 50 km radius is about 966,000 buildings and a 100 km radius about 3.85
// million — neither loadable by Overpass nor survivable by a browser. The same
// data by viewport is roughly 7,400 buildings at zoom 13 and 490 at zoom 15.
//
// Overpass is a free volunteer-run service. One query per viewport change, a
// timeout on every query, and never a query without a bounding box.

const ENDPOINT = 'https://overpass-api.de/api/interpreter';

// Below this, a viewport covers more ground than Overpass will return.
export const MIN_ZOOM = 13;

const SELECTORS = {
  building: 'way["building"]',
  road: 'way["highway"]',
};

export function buildQuery(bounds, kinds = ['building', 'road']) {
  const box = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  const parts = kinds
    .map((kind) => SELECTORS[kind])
    .filter(Boolean)
    .map((selector) => `${selector}(${box});`)
    .join('');
  // `out geom` returns coordinates inline, so no second lookup is needed.
  return `[out:json][timeout:25];(${parts});out geom;`;
}

export async function fetchViewport(bounds, { kinds, signal } = {}) {
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST', signal,
      body: `data=${encodeURIComponent(buildQuery(bounds, kinds))}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!response.ok) return { buildings: [], roads: [] };
    return parse(await response.json());
  } catch {
    // A failed detail fetch must never break the page. The fire, wind and
    // danger layers are what matter and they are already drawn.
    return { buildings: [], roads: [] };
  }
}

export function parse(payload) {
  const buildings = [];
  const roads = [];
  for (const el of (payload && payload.elements) || []) {
    const geometry = el && el.geometry;
    if (!Array.isArray(geometry) || geometry.length < 2) continue;
    const points = geometry
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
      .map((p) => [p.lat, p.lon]);
    if (points.length < 2) continue;
    const tags = el.tags || {};
    // An unnamed track is still an escape route, so a missing name is not a
    // reason to drop a road.
    const record = { id: el.id, name: tags.name || null, points };
    if (tags.building) buildings.push(record);
    else if (tags.highway) roads.push({ ...record, kind: tags.highway });
  }
  return { buildings, roads };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests-js/test_overpass.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Verify against live Overpass at a real viewport**

Run:
```bash
node -e "
import('./public/js/overpass.js').then(async ({fetchViewport}) => {
  const out = await fetchViewport({south:44.95,west:-1.12,north:45.01,east:-1.04});
  console.log('buildings', out.buildings.length, 'roads', out.roads.length);
  console.log('named roads sample:', out.roads.filter(r=>r.name).slice(0,5).map(r=>r.name));
});
"
```
Expected: thousands of buildings and real street names. Report the counts and a few names.

- [ ] **Step 6: Commit**

```bash
git add public/js/overpass.js tests-js/test_overpass.js
git commit -m "Load buildings and streets for the visible viewport

Bound to the viewport rather than a radius, which is arithmetic and not
preference. Measured density near Lacanau is 123 buildings per square
kilometre, so a fifty kilometre radius is about 966,000 buildings and a hundred
kilometre radius about 3.85 million. Neither is loadable. The same data by
viewport is roughly 7,400 buildings at zoom 13 and 490 at zoom 15.

So the fifty kilometre radius applies to layers that scale -- fire, wind,
aircraft, imagery, closures -- and detail follows the screen.

A failed fetch returns empty rather than throwing. The fire and wind layers are
what matter and they are already drawn."
```

---

## Task 7: Rothermel surface spread model

**Files:**
- Create: `build/fire_spread.py`
- Test: `tests/test_fire_spread.py`

**Interfaces:**
- Produces: `FUEL_MODELS` (dict keyed by `"FM1"`…`"FM10"`), `rate_of_spread(fuel, moisture, wind_kmh, slope_deg) -> float` (metres/minute), `project(incident, wind_rows, slope_deg, fuel, hours) -> dict`

**Read this before implementing.** The site owner approved this model after being told plainly that a wrong spread prediction can send someone into a fire and that nobody on this project can validate output against real fire behaviour. The agreed mitigation is that the implementation is verified against **published** Rothermel outputs, making the claim "a correct implementation of a peer-reviewed model" rather than "validated for your fire" — and the UI must say exactly that.

**Do not pin an absolute expected value from this plan.** The invariant tests below are certainly true and depend on no external number. For the single absolute-value regression test, you must obtain a reference figure from a published source — Andrews 2018 (*The Rothermel surface fire spread model and associated developments: A comparison with the FIRETEC model*, RMRS-GTR-371), Rothermel 1972 (INT-115), or the BehavePlus documentation — and cite the source in a comment beside the assertion. If you cannot obtain one, say so in your report and leave that test out rather than inventing a baseline.

- [ ] **Step 1: Write the failing invariant tests**

```python
# tests/test_fire_spread.py
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
import math

import pytest

from build.fire_spread import FUEL_MODELS, project, rate_of_spread


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
    assert out["arcs"][0]["bearing"] == 90  # from 270 means blowing toward 090


def test_a_projection_without_wind_yields_no_arcs_rather_than_a_still_fire():
    incident = {"id": "x", "lat": 44.0, "lon": -1.0}
    out = project(incident, [], slope_deg=5.0, fuel=FUEL_MODELS["FM1"], hours=2)

    # No wind data means we cannot say where it is going. A zero-wind projection
    # would draw a neat circle and imply the fire is going nowhere.
    assert out["arcs"] == []
    assert out["reason"] == "no wind data"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/pytest tests/test_fire_spread.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'build.fire_spread'`

- [ ] **Step 3: Write the implementation**

```python
# build/fire_spread.py
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_fire_spread.py -q`
Expected: PASS, 10 tests

- [ ] **Step 5: Obtain and pin one published reference value**

Find a published no-wind, no-slope rate of spread for at least one standard fuel model at a stated moisture, from Andrews 2018 (RMRS-GTR-371), Rothermel 1972 (INT-115), or BehavePlus documentation. Add one test asserting the implementation lands within 10% of it, with the source cited in a comment:

```python
def test_matches_a_published_reference_value():
    # Source: <exact publication, table/page, fuel model, moisture>
    # Published: <value> ft/min at <moisture> moisture, no wind, no slope.
    published_m_min = ...  # converted from the published figure
    got = rate_of_spread(FUEL_MODELS["FM1"], moisture=..., wind_kmh=0, slope_deg=0)
    assert abs(got - published_m_min) / published_m_min < 0.10
```

**If you cannot obtain a published figure, do not invent one.** Report that you could not, leave this test out, and say so explicitly — the invariant tests still stand and the shortfall must be visible rather than papered over.

- [ ] **Step 6: Run the full suite**

Run: `.venv/bin/pytest -q`
Expected: all green, no regressions

- [ ] **Step 7: Commit**

```bash
git add build/fire_spread.py tests/test_fire_spread.py
git commit -m "Add the Rothermel surface fire spread model

Approved after the concern was stated plainly: a wrong spread prediction can
send somebody into a fire, and nobody on this project can validate output
against real fire behaviour. What is claimed is narrower and checkable, a
correct implementation of a published peer-reviewed model, and every payload
carries validated=false so the interface can say so.

Equation numbering follows Andrews 2018, which restates Rothermel 1972 in
consistent notation. The model computes in imperial units because its
coefficients are empirical and unit-bound; converting coefficients rather than
inputs is how scale errors get introduced. Conversion happens at the boundary.

Tests are mostly invariants -- monotonic in wind and slope, zero at the moisture
of extinction, grass faster than closed timber litter -- because those catch the
errors that actually happen without depending on a figure nobody here can
independently source.

A projection is two arcs, mean wind and gust. One crisp line would imply a
precision this model does not have, and a reader under stress reads the shape
rather than the caveat beside it. No wind data yields no arcs at all: a zero-wind
projection draws a tidy circle and implies the fire is going nowhere."
```

---

## Task 8: How I can help, by skill

**Files:**
- Create: `public/js/helping.js`
- Test: `tests-js/test_helping.js`

**Interfaces:**
- Produces: `SKILLS` (array of `{id, label: {fr, en}}`), `actionsFor(skillIds, situation) -> [{do, why, channel}]`, `OFFICIAL_CHANNELS`

**Scope, explicitly.** This is the *static* half of "how I can help depending on my skills": given a declared skill and the situation nearby, what is genuinely useful and which official channel to contact. It needs no accounts, no backend and no moderation. The *live* half — matching neighbours to each other in real time — needs all three and is deliberately not in this plan.

The content rule: **never invent a way to help that puts an untrained person near a fire.** Every action must be either away from the fire, before the fire, or through an official channel. The most useful thing most people can do is not be an extra casualty.

- [ ] **Step 1: Write the failing test**

```javascript
// tests-js/test_helping.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OFFICIAL_CHANNELS, SKILLS, actionsFor } from '../public/js/helping.js';

const CALM = { level: 2, nearestFireKm: null, underOrder: false };
const CLOSE = { level: 4, nearestFireKm: 6, underOrder: false };
const ORDERED = { level: 4, nearestFireKm: 2, underOrder: true };

test('every skill is offered in both languages', () => {
  assert.ok(SKILLS.length >= 6);
  for (const s of SKILLS) {
    assert.ok(s.id && s.label.fr && s.label.en, `${s.id} incomplete`);
  }
});

test('someone under an evacuation order is told to leave, whatever their skills', () => {
  const actions = actionsFor(['medical', 'vehicle_4x4', 'chainsaw'], ORDERED);
  assert.ok(actions.length >= 1);
  // The first thing said must be to go. A trained person under an order is
  // still a civilian under an order.
  assert.match(actions[0].do, /partez|quittez/i);
});

test('no action ever sends an untrained person toward the fire', () => {
  for (const situation of [CALM, CLOSE, ORDERED]) {
    for (const skill of SKILLS) {
      for (const action of actionsFor([skill.id], situation)) {
        assert.doesNotMatch(action.do, /approchez|allez vers le feu|éteignez le feu/i,
          `${skill.id} produced an action sending someone at the fire`);
      }
    }
  }
});

test('every action names why it helps and who to contact', () => {
  for (const action of actionsFor(['vehicle_4x4', 'local_knowledge'], CLOSE)) {
    assert.ok(action.why, 'an action without a reason is an order');
    assert.ok(action.channel, 'an action with no channel is a dead end');
  }
});

test('calm conditions produce preparation actions, not emergency ones', () => {
  const actions = actionsFor(['property_owner'], CALM);
  assert.ok(actions.some((a) => /débroussaill/i.test(a.do)),
    'the legal obligation is the single most useful calm-weather action');
});

test('declaring no skill still returns what anyone can do', () => {
  const actions = actionsFor([], CLOSE);
  assert.ok(actions.length >= 1, 'everyone can do something');
});

test('an unknown skill id is ignored rather than crashing', () => {
  assert.doesNotThrow(() => actionsFor(['not_a_skill'], CLOSE));
});

test('the official channels are real and named', () => {
  assert.ok(OFFICIAL_CHANNELS.emergency.includes('112'));
  assert.ok(OFFICIAL_CHANNELS.emergency.includes('18'));
  // Reserve communale de securite civile is the actual legal route for a
  // civilian volunteer in France. Anything else is freelancing.
  assert.ok(/réserve communale/i.test(OFFICIAL_CHANNELS.volunteer.fr));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests-js/test_helping.js`
Expected: FAIL with `Cannot find module .../public/js/helping.js`

- [ ] **Step 3: Write minimal implementation**

```javascript
// public/js/helping.js
// What a person can actually do, given what they can do and what is happening.
//
// Static: no accounts, no backend, no moderation. Live neighbour-to-neighbour
// coordination needs all three and is deliberately elsewhere.
//
// The rule every entry obeys: never send an untrained person toward a fire.
// Every action is away from it, before it, or through an official channel. The
// most useful thing most people can do is not become a second casualty.

export const OFFICIAL_CHANNELS = {
  emergency: '112 / 18',
  volunteer: {
    fr: 'Réserve communale de sécurité civile — inscrivez-vous en mairie, hors période de crise',
    en: 'Réserve communale de sécurité civile — sign up at your mairie, outside a crisis',
  },
  firefighter: {
    fr: 'Sapeur-pompier volontaire — dossier auprès du SDIS de votre département',
    en: 'Volunteer firefighter — apply to your département SDIS',
  },
  prefecture: {
    fr: 'Consignes officielles : préfecture de votre département',
    en: 'Official instructions: your département préfecture',
  },
};

export const SKILLS = [
  { id: 'property_owner', label: { fr: 'Je suis propriétaire ou locataire', en: 'I own or rent property' } },
  { id: 'vehicle_4x4', label: { fr: "J'ai un véhicule tout-terrain", en: 'I have an off-road vehicle' } },
  { id: 'medical', label: { fr: 'Je suis soignant', en: 'I have medical training' } },
  { id: 'water_source', label: { fr: "J'ai une piscine ou une réserve d'eau", en: 'I have a pool or water tank' } },
  { id: 'local_knowledge', label: { fr: 'Je connais bien le terrain', en: 'I know the terrain well' } },
  { id: 'languages', label: { fr: 'Je parle plusieurs langues', en: 'I speak several languages' } },
  { id: 'shelter', label: { fr: 'Je peux héberger quelqu’un', en: 'I can host someone' } },
  { id: 'trained', label: { fr: 'Je suis pompier ou réserviste', en: 'I am a firefighter or reservist' } },
];

// Actions available to anyone, whatever they declared.
const UNIVERSAL = {
  ordered: [
    { do: { fr: 'Partez maintenant, par la route indiquée par les autorités.',
            en: 'Leave now, by the route the authorities give.' },
      why: { fr: "Un ordre d'évacuation n'attend pas votre avis sur le risque.",
             en: 'An evacuation order does not wait for your own risk assessment.' },
      channel: 'prefecture' },
    { do: { fr: 'Prévenez vos voisins, en particulier les personnes âgées ou isolées.',
            en: 'Warn your neighbours, especially anyone elderly or isolated.' },
      why: { fr: "FR-Alert n'atteint pas un téléphone éteint ni quelqu'un sans téléphone.",
             en: 'FR-Alert reaches neither a switched-off phone nor someone without one.' },
      channel: null },
  ],
  close: [
    { do: { fr: 'Ne téléphonez au 18 ou au 112 que pour signaler un fait nouveau.',
            en: 'Call 18 or 112 only to report something new.' },
      why: { fr: 'Les lignes de secours saturent, et une ligne saturée coûte des vies.',
             en: 'Emergency lines saturate, and a saturated line costs lives.' },
      channel: 'emergency' },
    { do: { fr: 'Fermez volets et fenêtres, rentrez le mobilier de jardin, gardez vos papiers sur vous.',
            en: 'Close shutters and windows, bring in garden furniture, keep your papers on you.' },
      why: { fr: "Les braises portent loin devant le front et allument ce qui traîne.",
             en: 'Embers travel far ahead of the front and light whatever is loose.' },
      channel: null },
  ],
  calm: [
    { do: { fr: 'Vérifiez votre itinéraire de sortie et une solution de repli.',
            en: 'Check your way out, and a second one.' },
      why: { fr: 'Une route peut être coupée par le feu ou par les secours.',
             en: 'A road can be cut by the fire or by the response.' },
      channel: null },
  ],
};

const BY_SKILL = {
  property_owner: {
    calm: [{ do: { fr: 'Débroussaillez autour de votre habitation — c’est une obligation légale en zone exposée.',
                   en: 'Clear vegetation around your home — a legal duty in exposed areas.' },
             why: { fr: 'Le débroussaillement décide si une maison survit sans que personne la défende.',
                    en: 'Clearance decides whether a house survives with nobody defending it.' },
             channel: 'prefecture' }],
  },
  water_source: {
    calm: [{ do: { fr: 'Signalez votre piscine ou réserve à votre mairie comme point d’eau utilisable.',
                   en: 'Register your pool or tank with your mairie as a usable water point.' },
             why: { fr: 'Les pompiers ne peuvent utiliser qu’un point d’eau qu’ils connaissent et peuvent atteindre.',
                    en: 'Firefighters can only use a water point they know about and can reach.' },
             channel: 'volunteer' }],
  },
  vehicle_4x4: {
    calm: [{ do: { fr: 'Proposez votre véhicule à la réserve communale, pas au front.',
                   en: 'Offer your vehicle to the réserve communale, not to the fireground.' },
             why: { fr: 'Un véhicule non coordonné bloque les accès dont les secours ont besoin.',
                    en: 'An uncoordinated vehicle blocks the access the response needs.' },
             channel: 'volunteer' }],
    close: [{ do: { fr: 'Proposez de conduire un voisin sans voiture vers un point sûr.',
                    en: 'Offer to drive a neighbour without a car to somewhere safe.' },
              why: { fr: "L'absence de véhicule est la première raison pour laquelle on n'évacue pas.",
                     en: 'Having no vehicle is the main reason people fail to evacuate.' },
              channel: null }],
  },
  medical: {
    close: [{ do: { fr: 'Signalez-vous à la mairie ou au centre d’accueil, pas sur le terrain.',
                    en: 'Report to the mairie or reception centre, not to the fireground.' },
              why: { fr: 'Les besoins sont aux points de rassemblement : fumée, stress, traitements oubliés.',
                     en: 'The need is at the assembly points: smoke, stress, forgotten medication.' },
              channel: 'prefecture' }],
  },
  local_knowledge: {
    close: [{ do: { fr: 'Transmettez ce que vous savez des accès et points d’eau à la mairie.',
                    en: 'Tell the mairie what you know about access and water points.' },
              why: { fr: 'Une équipe venue d’un autre département ne connaît pas vos pistes.',
                     en: 'A crew from another département does not know your tracks.' },
              channel: 'volunteer' }],
  },
  languages: {
    close: [{ do: { fr: 'Aidez à traduire les consignes officielles pour vos voisins et les touristes.',
                    en: 'Help translate official instructions for neighbours and visitors.' },
              why: { fr: 'FR-Alert diffuse en français, et une zone touristique en août ne l’est pas.',
                     en: 'FR-Alert broadcasts in French, and a tourist area in August is not.' },
              channel: null }],
  },
  shelter: {
    close: [{ do: { fr: 'Proposez votre hébergement via la mairie, pas sur les réseaux sociaux.',
                    en: 'Offer accommodation through the mairie, not on social media.' },
              why: { fr: 'Une offre coordonnée protège aussi la personne accueillie.',
                     en: 'A coordinated offer also protects the person being taken in.' },
              channel: 'prefecture' }],
  },
  trained: {
    close: [{ do: { fr: 'Passez par votre chaîne de commandement habituelle.',
                    en: 'Go through your normal chain of command.' },
              why: { fr: 'Un renfort spontané n’est pas assuré, pas tracé et pas attendu.',
                     en: 'A spontaneous volunteer is uninsured, untracked and unexpected.' },
              channel: 'firefighter' }],
  },
};

function phase(situation) {
  if (situation && situation.underOrder) return 'ordered';
  if (situation && situation.nearestFireKm !== null
      && situation.nearestFireKm !== undefined && situation.nearestFireKm <= 30) return 'close';
  return 'calm';
}

export function actionsFor(skillIds, situation, lang = 'fr') {
  const L = lang === 'en' ? 'en' : 'fr';
  const stage = phase(situation);
  const pick = (entry) => ({
    do: entry.do[L],
    why: entry.why[L],
    channel: entry.channel
      ? (typeof OFFICIAL_CHANNELS[entry.channel] === 'string'
          ? OFFICIAL_CHANNELS[entry.channel]
          : OFFICIAL_CHANNELS[entry.channel][L])
      : null,
  });

  // Under an order, leaving comes before anything a skill could contribute.
  const out = (UNIVERSAL[stage] || []).map(pick);
  if (stage === 'ordered') return out;

  for (const id of skillIds || []) {
    const table = BY_SKILL[id];
    if (!table) continue;  // an unknown id is ignored, never fatal
    for (const entry of table[stage] || []) out.push(pick(entry));
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests-js/test_helping.js`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add public/js/helping.js tests-js/test_helping.js
git commit -m "Map a declared skill to something actually useful

The static half of how can I help: given what somebody can do and what is
happening near them, what is genuinely useful and which official channel to use.
No accounts, no backend, no moderation. Live neighbour matching needs all three
and is not here.

Every entry obeys one rule -- never send an untrained person toward a fire.
Actions are away from it, before it, or through an official channel, because the
most useful thing most people can do is not become a second casualty. A test
asserts no action anywhere tells somebody to approach or fight a fire.

Under an evacuation order, leaving is the only advice given, whatever skills were
declared. A trained person under an order is still a civilian under an order.

Channels are the real French ones: 112 and 18, reserve communale de securite
civile for volunteers, SDIS for firefighters."
```

---

## Task 9: Zone pre-build orchestration

**Files:**
- Modify: `build/main.py` (add a `--zones` step for France)
- Test: `tests/test_zone_build.py`

**Interfaces:**
- Consumes: `build.zones.active_zones`, `build.sources.fr.arome`, `build.sources.fr.terrain`, `build.fire_spread`, and the already-built `summary["fires"]`
- Produces: one file per zone at `public/fr/data/zones/<id>.json`, plus `public/fr/data/zones/index.json` listing them

- [ ] **Step 1: Write the failing test**

```python
# tests/test_zone_build.py
"""Writing one detail file per hot zone.

A zone file is what makes the local view instant. Its absence is not an error:
the browser fetches the same data live. So a failed zone must never fail the
build.
"""
import json

from build.zone_build import write_zone, write_zone_index


def test_a_zone_file_carries_only_what_is_near_it(tmp_path):
    zone = {"id": "gironde", "label": "Gironde", "lat": 44.84, "lon": -0.58,
            "radius_km": 50, "reason": "config"}
    fires = [
        {"id": "near", "lat": 44.86, "lon": -0.88, "frp_total": 100.0,
         "industrial": False, "in_country": True},
        {"id": "far", "lat": 43.12, "lon": 5.93, "frp_total": 500.0,
         "industrial": False, "in_country": True},
    ]

    payload = write_zone(tmp_path, zone, fires, wind_rows=[], terrain=None)

    assert [f["id"] for f in payload["fires"]] == ["near"]
    written = json.loads((tmp_path / "gironde.json").read_text())
    assert written["id"] == "gironde"


def test_industrial_and_foreign_heat_are_excluded_from_a_zone(tmp_path):
    zone = {"id": "z", "label": "z", "lat": 44.84, "lon": -0.58, "radius_km": 50}
    fires = [
        {"id": "flare", "lat": 44.85, "lon": -0.59, "industrial": True, "in_country": True},
        {"id": "spain", "lat": 44.85, "lon": -0.60, "industrial": False, "in_country": False},
        {"id": "real", "lat": 44.86, "lon": -0.61, "industrial": False, "in_country": True},
    ]

    payload = write_zone(tmp_path, zone, fires, wind_rows=[], terrain=None)

    assert [f["id"] for f in payload["fires"]] == ["real"]


def test_a_zone_with_no_fires_is_still_written(tmp_path):
    # The zone file carries wind, terrain and the danger level too. A quiet day
    # is exactly when somebody checks their evacuation route.
    zone = {"id": "quiet", "label": "Quiet", "lat": 48.0, "lon": 2.0, "radius_km": 50}

    payload = write_zone(tmp_path, zone, [], wind_rows=[], terrain=None)

    assert payload["fires"] == []
    assert (tmp_path / "quiet.json").exists()


def test_the_index_lists_every_written_zone(tmp_path):
    zones = [{"id": "a", "label": "A", "lat": 44.0, "lon": -1.0, "radius_km": 50,
              "reason": "config"},
             {"id": "b", "label": "B", "lat": 43.0, "lon": 6.0, "radius_km": 50,
              "reason": "danger"}]

    index = write_zone_index(tmp_path, zones)

    assert [z["id"] for z in index["zones"]] == ["a", "b"]
    assert json.loads((tmp_path / "index.json").read_text())["zones"]
    # The browser needs the reason to explain why a zone exists at all.
    assert index["zones"][1]["reason"] == "danger"


def test_an_empty_zone_list_writes_an_empty_index_rather_than_nothing(tmp_path):
    # An absent index is indistinguishable from a failed deploy. An empty one
    # says clearly that no zone was pre-built.
    index = write_zone_index(tmp_path, [])

    assert index["zones"] == []
    assert (tmp_path / "index.json").exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_zone_build.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'build.zone_build'`

- [ ] **Step 3: Write minimal implementation**

```python
# build/zone_build.py
"""One detail file per hot zone.

A zone file makes the local view instant and available offline. Its absence is
not an error -- the browser fetches the same data live -- so a zone that fails
must never fail the build.
"""
import json
import math
from pathlib import Path

EARTH_KM = 6371.0


def _km_between(a_lat, a_lon, b_lat, b_lon):
    phi1, phi2 = math.radians(a_lat), math.radians(b_lat)
    d_phi = math.radians(b_lat - a_lat)
    d_lambda = math.radians(b_lon - a_lon)
    h = (math.sin(d_phi / 2) ** 2
         + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2)
    return 2 * EARTH_KM * math.asin(math.sqrt(h))


def _write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(payload, separators=(",", ":")))
    temp.replace(path)


def write_zone(out, zone, fires, wind_rows, terrain, spread=None):
    """Write one zone's detail file and return the payload."""
    radius = zone.get("radius_km") or 50
    near = []
    for fire in fires or []:
        # Industrial heat and fires across the border are drawn on the national
        # map but are never the fire near a reader.
        if fire.get("industrial") or fire.get("in_country") is False:
            continue
        if fire.get("lat") is None or fire.get("lon") is None:
            continue
        if _km_between(zone["lat"], zone["lon"], fire["lat"], fire["lon"]) <= radius:
            near.append(fire)

    payload = {
        "id": zone["id"],
        "label": zone.get("label") or zone["id"],
        "lat": zone["lat"],
        "lon": zone["lon"],
        "radius_km": radius,
        "reason": zone.get("reason"),
        "fires": near,
        "wind": wind_rows or [],
        "terrain": terrain or None,
        "spread": spread or [],
    }
    _write(Path(out) / f"{zone['id']}.json", payload)
    return payload


def write_zone_index(out, zones):
    """List the pre-built zones so the browser knows what is instant.

    An absent index is indistinguishable from a failed deploy, so an empty list
    is written rather than no file.
    """
    index = {"zones": [
        {"id": z["id"], "label": z.get("label") or z["id"],
         "lat": z["lat"], "lon": z["lon"],
         "radius_km": z.get("radius_km") or 50,
         "reason": z.get("reason")}
        for z in zones or []
    ]}
    _write(Path(out) / "index.json", index)
    return index
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_zone_build.py -q`
Expected: PASS, 5 tests

- [ ] **Step 5: Wire into `build/main.py`**

In `apply_france_extras`, after `wildfires` is computed, add:

```python
    # Pre-built zone detail. Each zone is independent and its failure is
    # contained: the browser can fetch the same data live, so a zone must never
    # take down the summary.
    zone_dir = Path(out) / "zones"
    config = zones.load_config(Path("public/static/fr/zones.json"))
    active = zones.active_zones(config, summary.get("danger", []))
    built = []
    for zone in active:
        try:
            wind_rows = arome.normalize(
                arome.fetch(session, zone["lat"], zone["lon"], hours=12), hours=12)
        except Exception:  # noqa: BLE001 - a zone without wind is still useful
            wind_rows = []
        try:
            grid = terrain.normalize(
                terrain.fetch(session, zone["lat"], zone["lon"], radius_km=20, step=8),
                step=8)
        except Exception:  # noqa: BLE001
            grid = None
        projections = []
        slope = _representative_slope(grid)
        for fire in _fires_in_zone(zone, wildfires):
            projections.append(fire_spread.project(
                fire, wind_rows, slope_deg=slope,
                fuel=fire_spread.FUEL_MODELS["FM5"], hours=3,
                fuel_model_name="FM5"))
        zone_build.write_zone(zone_dir, zone, wildfires, wind_rows, grid, projections)
        built.append(zone)
    zone_build.write_zone_index(zone_dir, built)
    print(f"wrote {len(built)} zone files to {zone_dir}")
```

Add the two helpers beside it:

```python
def _representative_slope(grid):
    """Median slope across the zone grid, or zero when unknown.

    A single number for a 50 km zone is coarse, and the ponytail note in
    fire_spread says so. Using the median rather than the max avoids one cliff
    face setting the rate for a whole plain.
    """
    if not grid:
        return 0.0
    values = sorted(cell["slope_deg"] for row in grid.get("grid", [])
                    for cell in row if cell.get("slope_deg") is not None)
    return values[len(values) // 2] if values else 0.0


def _fires_in_zone(zone, fires):
    radius = zone.get("radius_km") or 50
    return [f for f in fires
            if f.get("lat") is not None
            and zone_build._km_between(zone["lat"], zone["lon"], f["lat"], f["lon"]) <= radius]
```

Add to the import block at the top of `build/main.py`:

```python
from build import fire_spread, flares, zone_build, zones
from build.sources.fr import arome, atmo, evac, firms, mdf, terrain, water, wind
```

`FM5` (garrigue basse) is the default fuel model because it is the most common Mediterranean fire fuel and the map's centre of gravity is the south. Per-polygon fuel from BD Forêt is a later refinement; note it as a `ponytail:` comment at the call site.

- [ ] **Step 6: Run the full suite and a live France build**

Run:
```bash
.venv/bin/pytest -q
.venv/bin/python -m build.main --out public/fr/data --country fr
ls -la public/fr/data/zones/
```
Expected: all tests green; zone files written; the printed count matches the number of directories listed. Report the zone ids built and today's reason for each.

- [ ] **Step 7: Commit**

```bash
git add build/zone_build.py tests/test_zone_build.py build/main.py
git commit -m "Pre-build detail files for today's hot zones

One file per zone, holding the fires within its radius, the AROME wind forecast,
the terrain grid and a spread projection per fire. That is what makes the local
view instant and available offline.

Each zone is independent and its failure is contained. A zone file's absence is
not an error, because the browser fetches the same data live, so a failing zone
must never take down the summary or the danger level.

An empty index is written rather than no index: an absent file is
indistinguishable from a failed deploy, while an empty one says clearly that
nothing was pre-built.

Industrial heat and fires across the border are excluded from a zone. They belong
on the national map but are never the fire near a reader."
```

---

## Task 10: The local view page

**Files:**
- Create: `public/fr/zone.html`
- Create: `public/js/local.js`
- Modify: `public/js/mapview.js` (add `drawLocal`, IGN basemaps, imagery layer swap)
- Modify: `public/fr/index.html` (link to the local view)
- Test: `tests-js/test_local.js`

**Interfaces:**
- Consumes: `imagery.LAYERS`/`tileUrl`/`availableDates`, `overpass.fetchViewport`/`MIN_ZOOM`, `helping.actionsFor`/`SKILLS`, `rail-fr.describeFr`
- Produces: `describeLocal({zone, point, lang}) -> {urgency, headline, spread, forces, facts}`

- [ ] **Step 1: Write the failing test**

```javascript
// tests-js/test_local.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeLocal } from '../public/js/local.js';

const ZONE = {
  id: 'gironde', label: 'Gironde', lat: 44.84, lon: -0.58, radius_km: 50,
  fires: [{ id: 'f1', lat: 44.86, lon: -0.88, frp_total: 3265, frp_max: 290,
            detections: 79, aircraft: 3,
            wind: { wind_kmh: 12.9, wind_toward: 'E' } }],
  wind: [{ time: '2026-07-29T18:00', wind_kmh: 12.9, gust_kmh: 32.0,
           wind_dir: 273, wind_toward: 'E', humidity_pct: 27, temp_c: 36.5 }],
  spread: [{ id: 'f1', model: 'rothermel-1972', validated: false, fuel_model: 'FM5',
             arcs: [{ basis: 'mean', bearing: 93, ros_m_min: 4.2, distance_m: 756 },
                    { basis: 'gust', bearing: 93, ros_m_min: 11.8, distance_m: 2124 }] }],
  terrain: null,
};

const NEAR = { lat: 44.87, lon: -0.85 };
const FAR = { lat: 44.40, lon: -0.20 };

test('a fire a few km away produces an urgent headline with distance and direction', () => {
  const d = describeLocal({ zone: ZONE, point: NEAR, lang: 'fr' });
  assert.equal(d.urgency, 'high');
  assert.match(d.headline, /\d+\s*km/);
});

test('the spread projection is labelled as a model and never as a measurement', () => {
  const d = describeLocal({ zone: ZONE, point: NEAR, lang: 'fr' });
  assert.ok(d.spread);
  assert.equal(d.spread.validated, false);
  assert.match(d.spread.caveat, /mod[eè]l|estimation/i);
  // Both arcs must survive to the UI: one number would imply a precision the
  // model does not have.
  assert.equal(d.spread.arcs.length, 2);
});

test('the reader is told whether the fire is coming toward them', () => {
  const d = describeLocal({ zone: ZONE, point: NEAR, lang: 'fr' });
  assert.equal(typeof d.spread.towardYou, 'boolean');
});

test('aircraft are reported as observed, never as a claim about the response', () => {
  const d = describeLocal({ zone: ZONE, point: NEAR, lang: 'fr' });
  assert.equal(d.forces.aircraft, 3);
  assert.match(d.forces.caveat, /confirm|observ/i);
  // Ground crews are not public data and the UI must say so rather than let an
  // empty count read as nobody being there.
  assert.ok(d.forces.groundUnknown);
});

test('a distant point in the same zone is not made urgent', () => {
  const d = describeLocal({ zone: ZONE, point: FAR, lang: 'fr' });
  assert.notEqual(d.urgency, 'high');
});

test('a zone with no fires still reports wind and says detection can lag', () => {
  const quiet = { ...ZONE, fires: [], spread: [] };
  const d = describeLocal({ zone: quiet, point: NEAR, lang: 'fr' });
  assert.equal(d.spread, null);
  assert.match(d.facts.map((f) => f.value).join(' '), /km\/h/);
  const all = [d.headline, ...d.facts.map((f) => `${f.label} ${f.value}`)].join(' ');
  assert.doesNotMatch(all, /en sécurité|aucun danger/i);
});

test('a missing zone degrades instead of throwing', () => {
  for (const zone of [null, {}, { fires: null }]) {
    assert.doesNotThrow(() => describeLocal({ zone, point: NEAR, lang: 'fr' }));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests-js/test_local.js`
Expected: FAIL with `Cannot find module .../public/js/local.js`

- [ ] **Step 3: Write `public/js/local.js`**

```javascript
// public/js/local.js
// The local view: one address and the fifty kilometres around it.
//
// Answers five questions in the order somebody in danger asks them: am I in
// danger, where is it going, where must I not go, who is fighting it, what can I
// do. Pure — no DOM, no Leaflet.
import { bearingDeg, compassPoint, nearest } from './geo.js';

const URGENT_KM = 10;
const NEAR_KM = 30;

const COPY = {
  fr: {
    heat: (km, dir) => `Chaleur détectée à ${km} km au ${dir}`,
    none: 'Aucune chaleur détectée dans cette zone',
    lag: 'Les satellites passent quelques fois par jour et les nuages masquent la détection.',
    caveat: "Estimation par modèle (Rothermel), non validée pour ce feu. Suivez les consignes officielles.",
    forces: "Aéronefs observés à proximité. Leur rôle n'est pas confirmé.",
    ground: 'Les moyens au sol ne sont pas publiés. Leur absence ici ne signifie pas leur absence sur le terrain.',
    wind: 'Vent', gust: 'Rafales', humidity: 'Humidité', temp: 'Température',
    toward: 'Se dirige vers vous', away: 'Ne se dirige pas vers vous',
  },
  en: {
    heat: (km, dir) => `Heat detected ${km} km ${dir}`,
    none: 'No heat detected in this zone',
    lag: 'Satellites pass a few times a day and cloud blocks detection.',
    caveat: 'Model estimate (Rothermel), not validated for this fire. Follow official instructions.',
    forces: 'Aircraft observed nearby. What they are doing is not confirmed.',
    ground: 'Ground units are not published. Their absence here does not mean their absence on the ground.',
    wind: 'Wind', gust: 'Gusts', humidity: 'Humidity', temp: 'Temperature',
    toward: 'Heading toward you', away: 'Not heading toward you',
  },
};

const DIR = {
  fr: { N: 'nord', NE: 'nord-est', E: 'est', SE: 'sud-est',
        S: 'sud', SW: 'sud-ouest', W: 'ouest', NW: 'nord-ouest' },
  en: { N: 'north', NE: 'northeast', E: 'east', SE: 'southeast',
        S: 'south', SW: 'southwest', W: 'west', NW: 'northwest' },
};

// Within 60 degrees of the bearing from the fire to the reader counts as coming
// toward them. Tighter than that pretends a wind forecast is more precise than
// it is.
const TOWARD_TOLERANCE_DEG = 60;

function headingToward(fire, point, bearing) {
  if (bearing === null || bearing === undefined) return false;
  const toReader = bearingDeg(fire, point);
  const delta = Math.abs(((toReader - bearing + 540) % 360) - 180);
  return delta <= TOWARD_TOLERANCE_DEG;
}

export function describeLocal({ zone, point, lang = 'fr' }) {
  const L = lang === 'en' ? 'en' : 'fr';
  const t = COPY[L];
  const fires = (zone && zone.fires) || [];
  const facts = [];

  const near = fires.length ? nearest(point, fires) : null;
  const km = near ? Math.round(near.km) : null;
  const urgency = km === null ? 'none'
    : km <= URGENT_KM ? 'high'
    : km <= NEAR_KM ? 'medium' : 'low';

  const headline = near
    ? t.heat(km, DIR[L][compassPoint(bearingDeg(point, near.item))])
    : t.none;

  // Wind first among the facts: it is the reason the fire will or will not come.
  const hour = ((zone && zone.wind) || [])[0];
  if (hour) {
    if (hour.wind_kmh !== null && hour.wind_kmh !== undefined) {
      facts.push({ label: t.wind,
                   value: `${hour.wind_kmh} km/h → ${DIR[L][hour.wind_toward] || '—'}`,
                   tone: 'hot' });
    }
    if (hour.gust_kmh !== null && hour.gust_kmh !== undefined) {
      // Gusts drive fire runs. Measured at Lacanau: mean 8.8 against gusts 32.
      facts.push({ label: t.gust, value: `${hour.gust_kmh} km/h`, tone: 'bad' });
    }
    if (hour.humidity_pct !== null && hour.humidity_pct !== undefined) {
      facts.push({ label: t.humidity, value: `${hour.humidity_pct} %` });
    }
    if (hour.temp_c !== null && hour.temp_c !== undefined) {
      facts.push({ label: t.temp, value: `${hour.temp_c} °C` });
    }
  }

  let spread = null;
  const projection = near
    ? ((zone && zone.spread) || []).find((s) => s.id === near.item.id)
    : null;
  if (projection && projection.arcs && projection.arcs.length) {
    const towardYou = headingToward(near.item, point, projection.arcs[0].bearing);
    spread = {
      validated: false,
      caveat: t.caveat,
      model: projection.model,
      fuel_model: projection.fuel_model,
      arcs: projection.arcs,
      towardYou,
      verdict: towardYou ? t.toward : t.away,
    };
  }

  return {
    urgency,
    headline,
    sub: near ? '' : t.lag,
    facts,
    spread,
    forces: {
      aircraft: (near && near.item.aircraft) || 0,
      caveat: t.forces,
      // Never let an empty ground count read as nobody being there.
      groundUnknown: true,
      groundNote: t.ground,
    },
    nearestKm: km,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests-js/test_local.js`
Expected: PASS, 7 tests

- [ ] **Step 5: Add IGN basemaps and the imagery swap to `mapview.js`**

In `basemaps()`, add a third entry:

```javascript
    // IGN Plan v2 is France's official street map: named streets, tracks and
    // hamlets, free and keyless. Better than CARTO once a reader zooms to their
    // own street, which is the whole point of the local view.
    plan_ign: L.tileLayer(
      'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile'
      + '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM'
      + '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png',
      { maxZoom: 19, attribution: 'IGN — data.geopf.fr' }),
```

Add a method to the returned object for swapping the selected imagery overlay:

```javascript
    // The imagery picker replaces one overlay rather than accumulating them:
    // two stacked satellite layers show neither.
    setImagery(layer, date) {
      if (imageryOverlay) map.removeLayer(imageryOverlay);
      imageryOverlay = null;
      if (!layer) return null;
      imageryOverlay = L.tileLayer(tileUrl(layer, date), {
        maxNativeZoom: layer.maxNativeZoom, maxZoom: 19, opacity: 0.85,
        attribution: layer.attribution,
      });
      imageryOverlay.addTo(map);
      Object.values(layers).forEach((l) => {
        if (map.hasLayer(l) && l.bringToFront) l.bringToFront();
      });
      return imageryOverlay;
    },
```

Declare `let imageryOverlay = null;` beside `youMarker`, and import `tileUrl` from `./imagery.js` at the top of the file.

Add a `drawLocal(zone, labels)` method that renders, into `layers.fires` and two new layer groups `spread` and `detail`:
- each fire as a circle sized by `frp_total`, same as `drawFrance`
- each spread projection as **two translucent wedges** (mean and gust) from the fire along `bearing` for `distance_m`, drawn with `dashArray` so a modelled shape never looks like an observed one
- buildings and roads from `overpass.parse` as thin outlines

- [ ] **Step 6: Write `public/fr/zone.html`**

Copy the structure of `public/fr/index.html`, changing:
- `<script type="module" src="../js/local-page.js">` as the entry point
- the rail holds the five answers in order: urgency headline, spread verdict, where not to go, forces, and a `<details>` block with the skill checkboxes from `helping.SKILLS`
- the toolbar adds an imagery `<select>` populated from `imagery.LAYERS`, a date `<input type="range">` over `imagery.availableDates(today, 22)`, and a basemap segment with Plan IGN / satellite / plain
- a back link to `./` and a link to `sources.html`

Create `public/js/local-page.js` as the DOM wiring: read `?zone=<id>` or `?lat=&lon=`, load `data/zones/index.json`, fetch the matching zone file or fall back to live fetches, call `describeLocal`, render, and attach the viewport handler that calls `overpass.fetchViewport` when `map.getZoom() >= overpass.MIN_ZOOM`.

- [ ] **Step 7: Verify in a browser**

Run:
```bash
.venv/bin/python -m build.main --out public/fr/data --country fr
python3 -m http.server -d public 8180
```
Open `http://localhost:8180/fr/zone.html?zone=gironde`. Confirm, and report:
- the rail shows a distance and direction to real heat
- the spread wedges are visibly dashed and carry the model caveat
- the imagery `<select>` switches layers and the date slider changes the image
- zooming past 13 loads buildings and named streets
- the skill checkboxes change the listed actions

- [ ] **Step 8: Run both suites and commit**

```bash
.venv/bin/pytest -q
node --test tests-js/*.js
git add public/fr/zone.html public/js/local.js public/js/local-page.js public/js/mapview.js public/fr/index.html tests-js/test_local.js
git commit -m "Add the local view: one address and fifty kilometres around it

Answers five questions in the order somebody in danger asks them. Where is the
heat and how far. Where is it going. Where must I not go. Who is overhead. What
can I do.

Adds IGN Plan v2 as a basemap, France's official street map with named streets
and tracks, free and keyless. It beats CARTO once a reader zooms to their own
street, which is the point of this view.

The spread projection reaches the interface as two dashed wedges, mean wind and
gust, carrying the model name and validated=false. Dashed because a modelled
shape must never look like an observed one, and two wedges because one would
imply a precision the model does not have.

Aircraft counts say observed rather than claiming a response, and the ground
note is unconditional: SDIS do not publish unit positions, and an empty count
must never read as nobody being there."
```

---

## Task 11: CI and the provenance page

**Files:**
- Modify: `.github/workflows/build.yml`
- Modify: `public/fr/sources.html` (or create, if Task FR-F has not landed)

- [ ] **Step 1: Extend the France build step**

The existing `Build France data` step already runs `python -m build.main --out public/fr/data --country fr`, which now writes zones as part of `apply_france_extras`. Confirm no workflow change is needed for the data itself, then add zone reporting to the publish gate so a zone failure is visible rather than silent:

```yaml
      - name: Report pre-built zones
        continue-on-error: true
        run: |
          python - <<'EOF'
          import json, pathlib
          index = pathlib.Path("public/fr/data/zones/index.json")
          if not index.exists():
              print("no zone index written; the local view will fetch live everywhere")
          else:
              zones = json.loads(index.read_text())["zones"]
              print(f"pre-built zones: {len(zones)}")
              for z in zones:
                  print(f"  {z['id']:14} {z['reason']:8} r={z['radius_km']}km")
          EOF
```

`continue-on-error` because a missing zone index must never block publishing the danger level and the fire layer.

- [ ] **Step 2: Document the new sources on the provenance page**

Add to `public/fr/sources.html`, read live from the payload where possible:

- AROME 1.3 km via Open-Meteo — Météo-France high-resolution, hourly, free
- IGN RGE ALTI — elevation, free, keyless
- IGN Plan v2 and orthophoto — official French street map and 20 cm aerial
- OpenStreetMap via Overpass — buildings and streets, loaded for the visible area only
- NASA GIBS — the selectable imagery layers, with the honest note that **dated 10 m Sentinel-2 needs a Copernicus account we do not have**, so the 10 m option is an annual composite
- **The spread model** — Rothermel 1972, a correct implementation of a published model, **not validated against real fire behaviour**, indicative only, never a substitute for official instructions

- [ ] **Step 3: Push and verify live**

```bash
git add .github/workflows/build.yml public/fr/sources.html
git commit -m "Report pre-built zones in CI and document the new sources

A missing zone index is reported rather than fatal: the local view falls back to
live fetches, so it must never block publishing the danger level.

The provenance page states plainly that the spread projection is a correct
implementation of a published model and not validated against real fire
behaviour, and that ten-metre imagery is an annual composite because dated
Sentinel-2 needs an account this project does not have."
git push origin main
```

Then verify:
```bash
until [ "$(gh run list --limit 1 --json status -q '.[0].status')" = "completed" ]; do sleep 20; done
gh run list --limit 1 --json conclusion -q '.[0].conclusion'
T=$(date +%s)
curl -s "https://gautier242.github.io/fire-app/fr/data/zones/index.json?$T" | python3 -m json.tool
curl -s -o /dev/null -w "zone.html: %{http_code}\n" "https://gautier242.github.io/fire-app/fr/zone.html?$T"
```
Expected: a real zone index and HTTP 200 on the page. Report the zone ids and reasons.

---

## What is deliberately not built

**Beyond 50 km.** The national map already covers it — that is what `/fr/` is for. The local view is for the area you can act in; the country view is for the area you are asking about. Adding zones to `zones.json` extends pre-built detail to more places, and anywhere unlisted still works live.

**Live neighbour-to-neighbour coordination.** Task 8 ships the static skill-to-action mapping. Matching a person offering a spare room to a person needing one requires accounts, a backend and human moderation, because in a disaster that channel attracts scams and people impersonating officials. It needs its own spec and a named person doing moderation.

**Ground firefighter positions.** Confirmed unavailable: 22 SDIS datasets on data.gouv are budgets, boundaries and infrastructure, and OSM has 4 fire stations in the whole Gironde bounding box against a real figure near 100. The map says so rather than letting silence read as absence.

**Per-polygon fuel models.** Task 9 uses FM5 (garrigue basse) for the whole zone. BD Forêt would give real fuel per polygon and is the single biggest accuracy improvement available to the spread model. Noted as a `ponytail:` comment at the call site.

**Dated 10 m Sentinel-2.** Needs a free Copernicus Data Space account. Worth doing; blocked on registration, not code.

---

## Self-Review

**Spec coverage.** Street names → Task 10 (IGN Plan v2) and Task 6 (OSM). Imagery picker with dates → Task 5. Config file for pre-built zones → Task 1. 50 km radius → Task 1 config plus Task 6's per-layer split with the arithmetic. Where the fire is → Task 9 zone files. Where it is going → Tasks 3, 4, 7. How bad → `frp_total`/`frp_max` already in the payload, surfaced in Task 10. Who is fighting it → Task 10 forces block, aircraft only, ground gap stated. How I can help by skill → Task 8.

**Placeholder scan.** One deliberate open item: Task 4 Step 1 requires establishing the IGN elevation response shape from the live API before `fetch`/`normalize` are completed, and Task 7 Step 5 requires sourcing a published reference value. Both are instructions to verify against reality rather than placeholders, and both say explicitly what to do if the verification fails. Task 10 Steps 5–6 describe `drawLocal` and the page structure in prose rather than full code — the file is large, follows `drawFrance` directly above it, and the interfaces it consumes are fully specified.

**Type consistency.** `wind_toward` is the same key in `arome.py`, `wind.py` and `local.js`. `slope_deg` is the same name in `terrain.py`, `fire_spread.rate_of_spread` and `zone_build`. `industrial` and `in_country` match `build/flares.py`. `validated` is `False` in Python and `false` in the JS assertions on the same payload. `radius_km` is consistent across `zones.json`, `active_zones`, `write_zone` and `write_zone_index`. `arcs[].bearing`, `ros_m_min` and `distance_m` match between `fire_spread.project` and `test_local.js`.
