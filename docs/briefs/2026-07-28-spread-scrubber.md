# Brief: the 72-hour spread scrubber and wind

**Date:** 2026-07-28
**Verified against commit:** `80c3856` on `main`

**This is a NEUTRAL problem statement. It deliberately does NOT prescribe a fix.**
Every claim below is written so you can re-check it. Several were wrong when first
stated in conversation and were corrected only by reading the code — assume the same
could be true of anything here. Verify before you rely on it.

You are expected to produce a **written recommendation first**, and get it approved
**before writing code**.

---

## 1. Project context

Fire Near Me is a Canadian wildfire site that answers one question for a member of the
public: is there a fire near me, and should I leave. It is static HTML plus ES modules
on GitHub Pages, with a Python build that fetches government feeds every 30 minutes and
writes `public/data/summary.json`.

- Product direction and the three-level detail dial: `docs/specs/2026-07-28-v2-direction.md`
- Live site: https://gautier242.github.io/fire-app/
- Provenance page (what the app admits it cannot do): `/sources.html`

## 2. The symptom

The detail dial offers **Minimal / Simple / Advanced**. The site owner reported:

> "I don't see any option in Advanced that I don't have on Simple so what's the
> difference? How can I see the winds, the air quality, the plane water bomber routes
> etc.?"

They are correct. Advanced currently reveals exactly one control that Simple does not:
the "Satellite pass" chip.

## 3. Mechanics

**How mode gating works.** `public/js/app.js:105` `applyMode()` sets
`shell.dataset.mode`, then shows or hides every `.chip[data-adv]` according to whether
the mode is `advanced` (`app.js:110-115`). `ADVANCED_ONLY = ['satellite', 'closures']`
at `app.js:10` switches those layers off when leaving Advanced.

**Why only one chip appears.** `public/index.html:56-67` contains four chips —
`fires`, `orders`, `alerts`, `satellite`. Only `satellite` carries `data-adv`. There is
no `closures` chip in the markup at all, so the `closures` half of `ADVANCED_ONLY` and
the `hasClosures()` guard at `app.js:111-112` can never fire.

**The history module exists and is not connected.**
`build/sources/cwfis_history.py` is complete. `normalize()` (line 121) returns:

```
{"generated_at": <ISO of newest hour>, "hours": 72,
 "points": [[lon, lat, hour_index, band], ...],
 "wind":   [[hour_index, speed, direction], ...]}
```

`hour_index` runs 0..71 with 71 the most recent hour, anchored on the newest hour
actually observed rather than the wall clock (`cwfis_history.py:136-142`). `band` is a
fire-intensity class from `BAND_CUTS = (2000, 10000)` kW/m (`line 41`). Wind direction
is averaged as a vector, not as a plain number (`_representative`, `line 108`) — the
docstring explains that naive averaging puts the mean of 350° and 10° at due south.

`build/main.py:16-21` (`SECTIONS`) and `build/main.py:24-30` (`default_fetchers`) list
four source ids: `cwfis_perimeters`, `bc_fires`, `bc_evac`, `aqhi`. **Neither
`cwfis_history` nor `bc_roads` appears in either.** The build therefore never calls
them, and the published `summary.json` has no `closures` key and no history data.
Confirm with:

```
curl -s https://gautier242.github.io/fire-app/data/summary.json | python3 -c \
  "import json,sys; print(list(json.load(sys.stdin).keys()))"
```

At the time of writing this returned `['generated_at','sources','coverage','fires','evacuations','aqhi']`.

**Nothing in the frontend reads history or wind.** `public/js/mapview.js:82-88` defines
exactly five layers: `fires`, `orders`, `alerts`, `closures`, `satellite`. There is no
wind layer, no hotspot-history layer, and no scrubber UI anywhere in `public/`.

**The orphaned code is tested.** `tests/test_bc_roads.py` and
`tests/test_cwfis_history.py` pass — 37 tests between them, part of the 95 that pass
repo-wide. The modules were written well and simply never wired to the seam. Treat
that as the interesting fact about this codebase rather than an accident: two separate
agents each delivered a slice and neither owned `build/main.py`.

## 4. Claims to check yourself

Each of these was verified once, by the method given. Re-verify rather than trusting.

| Claim | How it was checked |
|---|---|
| `summary.json` is 224 KB raw, 47 KB gzipped | `gzip -c public/data/summary.json \| wc -c` |
| The size budget is 150 KB gzipped, and it guards **only** `summary.json` | `tests/test_budget.py:8` `BUDGET_KB = 150`, path at `line 7` |
| CWFIS answers a 72-hour `rep_date` filter directly; ~22,894 hotspots at spec time | `docs/specs/2026-07-28-v2-direction.md:76-80` — a claim in a spec, not a measurement you have made |
| The hotspot layer is continental; `agency` "CA" means California, not Canada | `cwfis_history.py:8-10`. Position is the only reliable filter |
| Unfiltered, the layer is ~17.9 million features | `cwfis_history.py:14-15` — never query without the date filter |
| Native CRS is EPSG:3978 in metres; without `srsName` longitudes come back six digits wide | `cwfis_history.py:11-12` |

**Unmeasured and load-bearing:** nobody has measured what `normalize()` actually
produces at full scale. A rough arithmetic estimate — a point serialises as roughly
`[-123.456,49.123,71,2],` ≈ 25 bytes, so 22,894 points ≈ 570 KB raw, and gzip on
repetitive numeric arrays typically lands near a third of that — puts it in the region
of 150–200 KB gzipped. **That is an estimate, not a measurement.** Measure it before
any design depends on it. `tests/fixtures/cwfis_history.json` is a 20 KB sample, far too
small to extrapolate from safely.

## 5. Fail-safe context

This project's rule is that stale data with an honest timestamp is publishable, and a
confident wrong answer is not.

- `build/main.py:80` refuses to publish if every source failed.
- `.github/workflows/build.yml` refuses to deploy when `fires` or `evacuations` is empty
  *because its fetch failed* — deploying that would show an all-clear map to someone who
  should be leaving.
- `public/js/status.js:32-40` degrades a negative evacuation answer to `cannot_check`
  when coverage is missing or data is stale. It never degrades to "you are safe".

A scrubber is a historical view, so its blast radius is different from the near-me
answer — but consider explicitly what it should do when the history file is missing,
partial, or older than its own `generated_at` claims, and whether a gap in the timeline
can be mistaken for "the fire stopped".

## 6. The requester's question

> "How can I see the winds […]?" — and, from the roadmap, whether the 72-hour spread
> scrubber described in the spec can now be built.

Roadmap position: `docs/specs/2026-07-28-v2-direction.md:112` lists "Spread scrubber +
wind — 72-hour hotspot file, lazy-loaded" as item 3, ahead of road closures and
aircraft.

## 7. Hard constraints

- **No framework, no build step, no npm dependencies.** Static HTML and ES modules.
  Leaflet is loaded from unpkg in `index.html`; that is the only third-party runtime code.
- **Bilingual.** New UI strings go in `public/js/i18n.js` in **both** `en` and `fr`.
  `tests-js/test_i18n.js:5` asserts the two key sets are exactly equal and will fail if
  you add to one only.
- **Paths must be page-relative, never root-absolute.** The site is served from
  `/fire-app/`. `href="/css/app.css"` resolves to the domain root and 404s; this broke
  the entire site until `ab1da9a`. Use `css/app.css`, `data/summary.json`.
- **`public/data/` is gitignored** and built fresh in CI. Never commit generated data.
- **The 150 KB gzipped budget on `summary.json` must not regress.** The spec's stated
  reason for a separate lazy-loaded file is precisely to stay out of that budget.
- **Plain language in user-facing copy** — "we check every 30 minutes", not "ETL cadence".
- **Commit messages are plain engineering prose.** No AI or tooling mentions, no
  Co-Authored-By trailers, no emoji.
- **Shared files are a collision risk.** `public/index.html`, `public/js/i18n.js`,
  `public/js/mapview.js` and `build/main.py` are touched by every feature in this area.
  Do not assume you are the only agent editing them; check `git status` and `git log`
  before you start and again before you commit. Never `git add .`.

## 8. Open preferences — the requester's call, not settled here

Do not silently decide any of these. Put options and tradeoffs in your recommendation.

- Whether the history ships as one file or per-hour chunks, and whether it lives under
  `public/data/` (CI-built, gitignored) or `public/static/` (committed).
- How wind is drawn: arrows per hour, streamlines, a single readout, or not on the map at all.
- Whether the scrubber timeline is labelled in UTC or the viewer's local time.
- Whether the scrubber is Advanced-only, as the spec assumes, or also reachable from Simple.
- Whether the history file refreshes on the same 30-minute cron as `summary.json` or less
  often, and what that costs against CWFIS.
- Whether hotspots outside Canada (the bounding box reaches into Oregon and Idaho by
  design — `cwfis_history.py:29-35`) are shown, dimmed, or dropped.

## 9. Key files

```
build/sources/cwfis_history.py    complete, tested, unwired
build/main.py:16-30               SECTIONS and default_fetchers — the seam
tests/test_cwfis_history.py       existing coverage
tests/test_budget.py              the 150 KB guard
public/js/mapview.js:82-88        layer registry
public/js/app.js:10,105-125       ADVANCED_ONLY and applyMode
public/index.html:55-82           toolbar chips and the detail dial
public/js/i18n.js                 both language tables
docs/specs/2026-07-28-v2-direction.md:76-90   the scrubber section
```

## 10. Expected deliverable

A written recommendation, approved before any code is written, covering:

1. Which claims above you verified, and any you found to be wrong.
2. The **measured** size of the 72-hour payload, raw and gzipped, and what that implies
   for load time on a rural connection.
3. Options for the file layout and the wind rendering, with honest tradeoffs, and one pick.
4. What you are deliberately not building, and when it would become worth building.
5. Rough scope in slices, each independently shippable, each with a test.

Work in small test-first slices after approval: a failing test, watch it fail for the
right reason, minimal code to pass, one commit per behaviour.
