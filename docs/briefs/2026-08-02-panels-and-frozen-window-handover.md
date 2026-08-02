# Brief: floating panels, date selection, and a frozen fortnight

Written 2026-08-02. **This is a neutral problem statement. It deliberately does
not prescribe a fix.** Everything below was measured against commit `7d09cbd`,
in a browser or by test, not remembered. Verify it rather than trusting it —
that is the working method here and it has caught real errors every round,
including several in this session's own earlier work.

## The app, in five lines

Two public wildfire sites in one repo, one GitHub Pages deploy: `/` is Canada
(oldest, most-tested, must not regress) and `/fr/` is France, which also has a
hyper-local view (`/fr/zone.html?zone=gironde`), a responder view, a provenance
page, a mutual-aid page and a chronology. They answer one question for a member
of the public: is there a fire near me and what should I do. Read
`docs/briefs/2026-08-01-mobile-and-language-brief.md` and
`docs/briefs/2026-07-30-orchestrator-3-handover.md` before touching anything.

## State at handover

```
.venv/bin/pytest -q                        -> 562 passed
node --test tests-js/*.js worker/test_*.js -> 270 pass
git status -sb                             -> 21 commits ahead of origin/main
```

**Nothing is pushed.** The live site does not have any of this session's work.
Pushing is the owner's call and has not been asked for.

One untracked file, `docs/briefs/2026-07-28-spread-scrubber-recommendation.md`,
is not ours and has been left alone for days. Leave it.

Serve locally with a no-store server — `python3 -m http.server` lets the browser
cache ES modules and you will spend a round "verifying" your own previous
version:

```python
import http.server, functools, sys
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()
http.server.HTTPServer(('127.0.0.1', 8899), functools.partial(H, directory=sys.argv[1])).serve_forever()
```

Playwright additionally needs `Network.setCacheDisabled` over CDP; without it the
module cache survives a browser restart.

## Symptom 1 — the two scrubber panels open far too small

The owner's words: *"l'ouverture par défaut des fenêtres satellite et heat over
se font dans des fenêtres bien trop petites donc on voit rien"*.

Measured on `/fr/zone.html?zone=gironde` at 1440×900, after choosing a satellite
layer:

| | measured |
|---|---|
| `#scrubber` outer box | 430 × 234 px |
| `.film` visible width | 342 px |
| `.film` scroll width | 1765 px |

So 81% of the contact sheet is outside the panel on open. `availableDates()`
returns 30 dates and each thumbnail is 54 px wide (`app.css`, `.film .thumb`),
which is where 1765 comes from. Arrows either side page through it
(`local-page.js`, `wireFilmNav`) and a scrollbar was widened, but the default
panel width was never revisited.

`#day-scrubber` (the heat trail) has the same default geometry.

The panels are resizable from eight grips and draggable by their header, and
their minimum size is computed from content in `contentMin()` — see
`local-page.js`. Nothing currently sets a sensible *initial* size.

## Symptom 2 — a date cannot be chosen, which is the whole point

The owner's words, and this is the part that reframes the request: *"quand je
dis qu'il faut pouvoir sélectionner le jour et afficher les 14 précédents c'est
surtout si dans 6 mois je veux revenir sur ce feu, les 14 jours précédents ma
date dans 6 mois y'aura rien"*.

The requirement is therefore **navigation into the past**, not a nicer control:
pick an end date, see the fortnight before it, so the Gironde fire is still
reachable in six months. Default end date is today.

The two layers are not in the same position, and the difference is the crux:

**Satellite imagery — the archive exists.** Tiles are fetched per date straight
from NASA GIBS (`imagery.js`, `tileUrl`), not from our payload. GIBS holds years.
`availableDates(todayUTC(), 30)` currently asks for 30 days ending today; nothing
stops it being asked for any other 14. Claim to verify: a GIBS date we do not
hold returns *a valid blank tile, not an error* — `mapview.js:37` sets
`EMPTY_TILE_BYTES = 5000` and `latestImageryDate()` probes tile size to tell a
real pass from an empty one. That probe is the existing machinery for telling a
reader "too old" instead of showing a white square.

**Heat detections — the archive does not exist.** `fr/data/history.json` is a
single rolling file. `build/sources/fr/firms_history.py:74` sets `HOURS = 168`
(7 days) and anchors the index grid on the newest detection observed, so every
build slides the window forward. Six months from now that file contains the last
seven days and nothing of this fire.

The frontend slider length is already data-driven — `local-page.js` sets
`slider.max = String(days.length)` — so it becomes a fortnight when a fortnight
of data exists, and shows seven days today because that is what there is.

**A note on why nobody has simply set the slider to 14:** on this layer an empty
day and a day with no fire render identically. The repo's first safety rule is
that absence is never safety. Whether that reasoning holds here is yours to
judge, but it is why the current session stopped rather than widened the control.

## Mechanics you will need

**A pinned window already exists and is tested, but nothing calls it.**
`firms_history.normalize()` takes an optional `window_start`. Given one it pins
the index grid to that hour, spans `WINDOW_HOURS = 14 * 24 = 336`, drops rather
than clamps anything outside, and emits `window_start` in the payload.
`history.js` `hourToDate()` honours it. Covered by
`tests/test_fr_history_window.py` (9 tests, including two builds six months
apart producing identical indices) and two tests in `tests-js/test_history.js`.

Dropping rather than clamping is load-bearing: clamping would file heat from six
months after the fire under the fire's last hour.

**Why it is not wired.** `fr/data/history.json` is one national file, written
once per build at `build/main.py:558`. A pinned fortnight belongs to an event,
not to France. Threading `event_start` into that call would pin the national
trail to one fire. Zone config already has a home —
`public/static/fr/zones.json`, loaded by `build/zones.py` at `main.py:261` — so
where an `event_start` would live is settled; what payload carries the pinned
window is not.

**Budgets.** `tests/test_budget.py` caps critical-path files at 150 KB gzipped
and side files at 150 KB, justified explicitly by "often on a phone, often on a
degraded network in exactly the conditions that produced the fire". A pinned
fortnight is twice the span of the current trail. Today `fr/data/summary.json`
is 63.2 KB gzipped and `fr/data/history.json` is a side file.

**Aircraft.** Positions come from OpenSky `/api/states/all` (instantaneous state
vectors, no track history) on a 30-minute cron (`.github/workflows/build.yml:5`).
One position per aircraft per 30 minutes; a Canadair at ~250 km/h covers ~125 km
between samples. `mapview.js` `drawLocal()` draws a rotated arrow along
`plane.track`, which is a bearing at one instant. No trajectory data exists
anywhere in the repo. Budget arithmetic, computed from
`build/sources/opensky.py`: free tier 4000 credits/day, France bbox 4 credits per
call, both countries at 30 minutes spend 384/day; 288 calls/day (5 minutes)
would spend 1152. Two constraints found rather than assumed: GitHub Actions cron
has a 5-minute floor **and** drifts under load, so spacing will be uneven and
timestamps must come from the data; and accumulating a trace needs positions
persisted between runs, which is `archive/`'s territory
(`.github/workflows/archive.yml`, twice daily), not the 30-minute build's.

Also open: the local rail's aircraft count and the map's positions read
different fields (`local.js:113` uses `near.item.aircraft`, a per-fire count;
the map uses `summary.aircraft`), so they can disagree.

## Evidence to re-verify rather than trust

- `zone.water.points` is empty for the Gironde because **no SDIS register
  publishes for département 33**. Check `public/fr/data/zones/gironde.json`
  → `water.coverage`: the registers are 64, 81, 35, 74, 49, 17. Every water
  point drawn on the Gironde view is OpenStreetMap crowd data (2,992 within
  50 km). Register and crowd are never summed and never drawn alike.
- Panels are only wired on `zone.html`. `index.html` and `pro.html` have panels
  with none of the close / move / resize behaviour.
- `summary.aircraft` was empty at handover, so the aircraft layer was verified
  against an injected fixture, not live data.

## Hard constraints

- **Absence is never safety.** No detection means our satellites saw nothing,
  not that nothing is burning. Tests assert no string says "en sécurité".
- **Unavailable is not none.** A failed fetch must never render as an empty
  result — including a folded panel hiding an unavailable-source notice.
- **Observed and modelled must look different**; **a detection is not a
  perimeter**; **a tier describes a publisher, never a post**.
- **Do not fold the FR-Alert box or any sentence about what we cannot see.**
  Layer filters, the legend and provenance detail may fold.
- **Canada is shared.** `app.css`, `mapview.js`, `geo.js` and `i18n.js` serve
  both sites. Verify Canada's fire and evacuation counts after any change, not
  just HTTP 200. At handover: 774 fires, 67 evacuations.
- **No new dependencies.** stdlib Python, vanilla ES modules, Leaflet only.
- Strict TDD; failing test first, watched failing for the right reason.
- `git add <paths>` does not scope a commit here — the pathspec must also be on
  `git commit -- <paths>`, after `-m`. Never `git add .`, never `--amend` on main.
- Commit messages: plain engineering prose explaining *why*. No AI or tooling
  mentions, no Co-Authored-By, no emoji. Write them via `-F file`; backticks in
  `-m` get executed by the shell.
- `tests-js/test_page_i18n.js` fails if a control in the map region has no
  `data-t`, or if a key is missing from either language. Any new control needs
  keys in both, in each page's own `COPY` (and `i18n.js` for Canada).

## Open preferences — the requester's call, not settled here

- **What payload carries the pinned fortnight.** A per-zone trail file, one file
  carrying both windows, or something else. Affects the 150 KB budget.
- **What "start from 21 July and add a day until 14" means precisely.** The
  owner has described three shapes across the session: a fixed 14-day window
  from the day before the fire; a window that grows daily to 14 then freezes;
  and an end-date picker with 14 days behind it. They are not the same. The
  tested mechanism implements the first.
- **Whether the frozen page shows all data or only what the archive holds.**
  `archive/` runs twice daily; what it actually contains for 21 Jul – 4 Aug has
  not been checked.
- **Whether a partial fortnight is drawn at all**, given that an empty day and a
  day without fire look identical on the heat layer.

## Open work, as recorded in the task list

1. `gironde_save_14j` — a frozen 14-day Gironde page, 21 July onward, all data
   frozen at that fortnight. Every other page stays live: if there is no fire,
   the live Gironde and France pages must show no fire.
2. Default sizes for the two scrubber panels (symptom 1).
3. End-date selection for satellite imagery, and for the heat trail once its
   data exists (symptom 2).
4. Panels on `index.html` and `pro.html`.
5. 5-minute aircraft polling and trace accumulation.

## Key files

`public/js/local-page.js` (panels, film strip, drag/resize, zone wiring) ·
`public/js/mapview.js` (layers, drawLocal, drawWater) ·
`public/js/imagery.js` + `public/js/history.js` (dates and hour decoding) ·
`public/css/app.css` (shared with Canada) · `public/fr/zone.html` ·
`build/sources/fr/firms_history.py` · `build/main.py:558` ·
`tests/test_fr_history_window.py` · `tests/test_budget.py`

## Expected deliverable

A written recommendation before any code, per `CLAUDE.md`: verified facts,
options with honest tradeoffs, rejections argued on the owner's own stated
axes, one pick, accepted tradeoffs, rough scope — and approval before writing.
The payload question in particular should not be decided silently.
