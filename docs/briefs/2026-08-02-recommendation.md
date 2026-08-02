# Recommendation: the frozen fortnight, panel sizing, and what to do first

Written 2026-08-02, against `8db0fd7`. Every number below was recomputed or
measured, not taken from the handover brief. Where the brief was wrong, it says
so. **Nothing has been implemented. This asks for a direction.**

## TL;DR

The frozen Gironde fortnight **cannot be built as specified**: the heat data for
21 July does not exist in this repo, on the live site, or upstream. The oldest
heat detection we hold anywhere is **2026-07-23 14:00Z**, and 21–22 July are gone
from NASA's keyless feed permanently.

Worse and more urgent: **5,132 detections covering 23 Jul 14:00 – 26 Jul 01:30
survive in exactly one place on Earth** — the gitignored, untracked
`public/fr/data/history.json` in this working copy. FIRMS has rolled past them,
the archive never captured them, git does not track them. A single
`python3 -m build.main` destroys the earliest record of this fire. I have taken a
byte-identical safety copy outside the repo; making it permanent needs your word.

Separately, the panel fix is not the one the brief implies: the contact sheet can
**never** fit at any size (30 dates need an 1853 px panel; the map allows 1036 px).
Asking for 14 dates instead of 30 — which is what you wanted anyway — makes it fit
at 909 px. And the heat panel hides **0%** of its content; it is not the same bug.

## What I verified

| Claim (from the brief) | Verdict |
|---|---|
| 562 pytest / 270 node pass | **Confirmed**, fresh run |
| 21 commits unpushed | **Wrong** — 19 ahead, and **1 behind**: `41a5d54` is on origin |
| Panel opens 430×234, film 342/1765 px | **Confirmed exactly** in browser at 1440×900 |
| 1765 px = 30 thumbs × 54 px | **Confirmed**: 30×54 + 29×5 gap = 1765 |
| `#day-scrubber` has "the same default geometry" | **Wrong** — it is 340×126 and overflows **0%** |
| `availableDates()` can be asked for another window | **Confirmed, stronger**: it already takes the end date as its first argument |
| GIBS serves real tiles for past dates | **Confirmed**: 2026-07-21 returns 8,801 B (threshold 5,000) |
| `normalize(window_start)` pins a 336 h window, drops rather than clamps | **Confirmed**, 9 tests |
| Pinned window is untested against real payload sizes | **Computed below** — the brief gave no size |
| 5-min aircraft polling costs 1,152 credits/day | **Wrong — it is 2,304/day**, see below |
| `archive/` may hold 21 Jul – 4 Aug | **Wrong** — it holds **one day**, 2026-08-01 |
| Panels missing behaviour on `index.html`/`pro.html` | **Understated** — those pages have **no scrubbers at all** |

Three of the brief's load-bearing claims are wrong, and one of them (the archive)
is the one the whole first task rests on.

### The number nobody computed: does the data exist?

The frozen page needs 21 July onward. Here is every store, checked:

| Store | Covers | Holds heat? |
|---|---|---|
| `public/fr/data/history.json` (local, **gitignored**) | 23 Jul 14:00 – 30 Jul 13:00 | yes, 7,826 pts |
| Live site `history.json` | ~26 Jul – now, rolling | yes, but has rolled past 23–25 Jul |
| `archive/` (twice daily, live in CI) | **2026-08-01 only** | **no** — captures summaries + gironde, never the trail |
| git history | — | `public/fr/data/` is in `.gitignore:7` |
| FIRMS keyless bulk CSV | last 168 h only | rolling; 21–25 Jul unreachable |
| NASA GIBS imagery | years back | **yes** — verified for 21 Jul |

So: **satellite imagery for the whole fortnight is recoverable and free. The heat
trail for 21–22 July is unrecoverable at any price without a key, and 23–25 July
survives only in this working copy.**

### Payload sizes, which the brief left blank

Measured, gzip -9:

```
fr/data/history.json   41.0 KB gz   (7 days, all France, 7,826 pts)
fr/data/summary.json   64.8 KB gz   (brief said 63.2 — close enough)
zones/gironde.json      3.3 KB gz
```

Of the 7,826 national detections, **3,951 (50.5%) fall within 50 km of the Gironde
centre** — this one fire is half of France's heat right now. A zone-scoped
fortnight, built by clipping and doubling the span:

```
Gironde 50 km, 7 days   17.4 KB gz
Gironde 50 km, 14 days  ~34.7 KB gz   (2x, honest upper bound)
National      14 days   ~82   KB gz
```

Both fit the 150 KB side-file cap. But the national option doubles the file every
reader of `/fr/` downloads, to serve one département — and, as the brief rightly
says, pins the national trail to one fire.

### Panel sizing: the fix is not "make it bigger"

Measured at 1440×900: the map pane is **1060 px**, `max-width: calc(100% - 24px)`
so a panel may reach **1036 px**. Panel chrome (padding + two nav arrows + gaps) is
**88 px**, so the film gets `panel − 88`.

```
panel needed for 30 thumbs   1853 px   > 1036 px max   IMPOSSIBLE at any size
panel needed for 14 thumbs    909 px   <= 1036 px      fits, 127 px to spare
currently visible              5 of 30 thumbs
best possible by dragging     16 of 30 thumbs
```

Enlarging the default cannot solve this, because the content is oversized, not the
box. **Asking `availableDates()` for 14 dates instead of 30 is the root-cause fix**
— and it is the same change task 3 needs. The two tasks are one change.

The heat panel is a different matter entirely: `clientWidth 338 / scrollWidth 338`,
nothing hidden. It is small, but it hides no content — its slider already spans its
full width. Treating it as the same bug would be cargo-cult.

### Aircraft: the brief's credit arithmetic is wrong

`build/main.py:87` fetches Canada and `:95` fetches France — **two calls per build**,
4 credits each.

```
30 min:  48 builds/day x 8 credits =   384/day    (matches the code comment)
 5 min: 288 builds/day x 8 credits = 2,304/day    58% of the 4,000 free tier
```

The brief's 1,152 is the *single-country* figure inherited from the `opensky.py`
docstring, which was written before France was added and is now stale. 5-minute
polling still fits, but at 58% of the tier rather than 29% — one retry storm or a
third bbox breaks it. The docstring should be corrected either way.

Also confirmed: `summary.aircraft` is **empty (0)** right now, so nothing here can
be verified against live data; and `local.js:113` reads `near.item.aircraft` (a
per-incident count) while the map reads `summary.aircraft`, so they can disagree.

## Options for the frozen fortnight (task 1)

**A — Rescue and freeze what exists; be honest about the start date.** Commit the
rescued `history.json` as a pinned window starting 23 Jul 14:00Z, wire
`normalize(window_start)` into a per-zone file, and label the page with the real
window rather than the requested one. Cost: ~35 KB gz side file, one build change.
Recovers 5,132 detections that are otherwise lost tonight. Leaves 21–22 Jul absent.

**B — Register a FIRMS `MAP_KEY` and backfill properly.** The `api/area` endpoint
serves arbitrary date ranges. Gets the true 21 July start. Costs a free NASA
account and a repo secret — the repo already carries `OPENSKY_CLIENT_ID/SECRET`, so
there is precedent, but it is a new external dependency and **your call, not mine**.
Does not conflict with A; A should happen first regardless.

**C — Satellite-only frozen page.** Ship the frozen Gironde view with GIBS imagery
(complete, 21 Jul onward, verified) and the 1 Aug archived crisis snapshot, and no
heat trail. Entirely honest, works today, nothing new to store. But it drops the
layer that shows where the fire has already been — the thing a reader uses to
decide which way to drive.

**D — Do nothing yet.** Defensible only if the fire is over. It is not: the live
Gironde feed still shows an active perimeter. And D silently chooses to lose the
23–26 July record, which is the one decision here that cannot be undone.

**I recommend A now, plus capturing `history.json` in `archive/` going forward, and
B as a follow-up if you want the true 21 July start.** A is the only option that
stops ongoing, irreversible data loss, and it does so tonight.

## The four preferences you reserved — my read, your call

1. **What payload carries the pinned fortnight.** I recommend **a per-zone trail
   file** (`fr/data/zones/gironde-trail.json`, ~35 KB gz). It keeps the national
   trail rolling and live, matches where zone config already lives, and costs
   readers of `/fr/` nothing. The national-file option is ~82 KB and pins France to
   one fire. **Not deciding this without you — it is the one you flagged hardest.**
2. **What "21 July + 14 days" means.** The tested mechanism implements a fixed
   window from a fixed start. Given the data reality, the honest version is a fixed
   window from **23 Jul 14:00Z** unless you take option B. Which shape do you want?
3. **All data, or only what the archive holds.** Now answerable: the archive holds
   one day. So "all data" means "everything we rescued", which is heat 23–30 Jul,
   imagery for the full fortnight, and Gironde crisis state for 1 Aug only.
4. **Whether a partial fortnight renders at all.** I lean yes, *provided* the panel
   states the window it actually covers and days outside it are drawn as
   "no observation" rather than as empty map. An empty day and a day without fire
   must not render alike — that is the repo's first safety rule, and it is the one
   thing I would not ship without.

## Tradeoffs I am accepting

- 21–22 July stay absent under option A. The page will say so rather than imply the
  fire began on the 23rd.
- Cutting the contact sheet from 30 dates to 14 removes reach the archive supports.
  Mitigated by the end-date picker, which reaches further than 30 days ever did.
- The heat panel gets a modest legibility bump only, not the satellite treatment.
- Task 4 (panels on `index`/`pro`) is larger than briefed — those pages need
  scrubbers built, not wired — and Canada's `/index.html` carries a `.scrubber` that
  inherits any shared CSS change, so it must be re-verified (774 fires, 67 evac).
- Task 5 stays scoped to correcting the stale credit arithmetic and the
  `local.js` / `summary.aircraft` mismatch. Trace accumulation needs the archive to
  persist positions and is a separate piece of work.

## Rough scope, in the order I would take it

| # | Work | Files | Test |
|---|---|---|---|
| 0 | Rescue the trail: commit the 23–30 Jul snapshot, add `history.json` to `archive.py` | `build/archive.py`, new data file | new test: archive captures the trail |
| 1 | Wire `normalize(window_start)` to a per-zone trail file | `build/main.py`, `build/zones.py`, `zones.json` | extend `test_fr_history_window.py`; budget test for the new side file |
| 2 | 14 dates, and a default panel size that fits them | `local-page.js`, `app.css` | node test: default width >= content width, clamped to map |
| 3 | End-date picker, native `<input type="date">` | `local-page.js`, `zone.html` + FR/EN keys | `test_page_i18n.js` will demand both languages |
| 4 | Frozen-page rendering with an honest window label | `local-page.js`, `history.js` | assert the "no observation" rendering |

Strict TDD throughout, failing test first. No new dependencies. Commits scoped with
`git commit -- <paths>`. Canada counts re-verified before any push.

## What I need from you

1. **May I commit the rescued `history.json` snapshot?** This is the only urgent
   item — the data dies on the next build. A safety copy is already outside the repo.
2. **Option A, B, or C** for the frozen fortnight.
3. **Per-zone trail file, or national?** (preference 1)
4. **Do you want a FIRMS key** so 21–22 July can be recovered? (preference 2)

I have written no code and changed nothing in the repo beyond this document.
