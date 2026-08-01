# Brief: make the French site mobile-first, and make the language switch total

Written 2026-08-01 for a fresh agent. Everything below was measured on this
repo today, not remembered. **Verify it rather than trusting it** — that is the
working method here and it has caught real errors every round, including in
this brief's own earlier drafts.

## The app, in one paragraph

Two public wildfire sites in one repo, one GitHub Pages deploy: `/` is Canada
(oldest, most-tested, must not regress) and `/fr/` is France, which also has a
hyper-local view, a provenance page, a mutual-aid page, a chronology and a
responder view. They answer one question for a member of the public: is there a
fire near me and what should I do. Read `CLAUDE.md` and
`docs/briefs/2026-07-30-orchestrator-3-handover.md` before touching anything.

## Job 1 — the language switch is not total

There is already a language button on every page, top right, wired to
`localStorage['fire-near-me.fr.lang']`. Most of each page translates. The map
controls do not: they are hardcoded French in the HTML and nothing updates them.

Measured in a real browser on 2026-08-01 by switching to English and reading the
DOM back:

**`/fr/zone.html` — 9 controls stay French**

    Feux détectés · Propagation modélisée · Routes coupées · Bâtiments et rues
    Communes évacuées · Déjà brûlé · Routes vers le feu · Tout masquer · Sobre

**`/fr/pro.html` — 4 controls stay French**

    Chaleur détectée · Propagation modélisée † · Points d'eau — registre
    Bornes OSM — pas un registre

`/fr/index.html` was not measured; check it the same way. `sources.html`,
`entraide.html` and `chronologie.html` are clean — they render entirely from JS.

Why it happens: `local-page.js` re-labels 24 elements on switch and `pro-page.js`
10, but the toolbar chips are not among them. Exactly one chip (`chip-trail`) is
wired, via `c().trailChip` — copy that pattern. The legend already translates
because it is built from `c().legend.*`; the chips should work the same way.

Note the trap: `tests-js/test_i18n.js` asserts the French and English key sets
are identical. Add every new key to both or the suite fails — which is the point.

**The button itself** should also be easier to find. It is a `btn-ghost` that
reads as secondary chrome. The owner asked for it to be obvious. Do not put a
flag emoji on it — a flag names a country, not a language, and this site is read
by people in France who do not read French.

## Job 2 — mobile

The France pages are a desktop two-column shell (`.shell` → `.rail` + `.map`)
stacked vertically on a phone. Measured on a 390×844 viewport, `/fr/zone.html`:

| Element | Where it lands |
|---|---|
| `#rail` (sidebar) | y=0, **1,812 px tall** |
| `#toolbar` (the layer filters) | **y = 1,825** |
| legend | **y = 2,071** |
| the map | pushed below all of it |

Total ≈ 2,300 px, about **2.7 screens**. A reader on a phone scrolls past the
entire sidebar to reach the map, and the filters that control the map sit below
it. There is no horizontal overflow — the problem is purely vertical order and
bulk.

What the owner asked for: foldable filters, foldable legend/captions, foldable
side panels. The obvious shape is map-first on small screens with the rail and
the toolbar collapsing into sheets or accordions, but the design is yours to
propose. Use `superpowers:brainstorming` and get the design approved before
writing code.

Constraints that are not negotiable:

- **Do not regress desktop.** The two-column layout is what the owner uses.
- **Do not hide the FR-Alert box or any safety sentence behind a fold.** A
  caveat a reader must tap to see is a caveat they will not read. Layer filters,
  the legend and provenance detail may fold; statements about what we cannot
  see may not.
- **Canada is shared.** `app.css`, `mapview.js` and `geo.js` serve both sites.
  After any deploy, verify Canada's fire and evacuation counts, not just HTTP
  200.

## How this codebase works

- **Strict TDD.** Failing test first, watch it fail *for the right reason*,
  minimal code, one behaviour per commit. `superpowers:test-driven-development`.
- **Verify in a real browser**, not only in tests. Playwright is available and
  is how every number in this brief was obtained. A layout claim without a
  measured `getBoundingClientRect()` is an opinion.
- **No new dependencies.** stdlib Python, vanilla ES modules, Leaflet only.
- `.venv/bin/pytest -q` → 547 passed. `node --test tests-js/*.js worker/test_*.js`
  → 253 pass. Both must stay green.
- Commit messages: plain engineering prose explaining *why*. No AI or tooling
  mentions, no Co-Authored-By, no emoji.
- `git add <paths>` does **not** scope a commit here. The pathspec must be on
  `git commit -- <paths>` too, and it goes *after* `-m`.
- Never `git add .`. Never `git commit --amend` on main.
- `graphify-out/` is gitignored generated output; ignore it.

## The safety rules, which outrank any design

This app tells people whether to leave their house. Each rule exists because
breaking it produces a confident wrong answer somebody acts on.

- **Absence is never safety.** No detection means our satellites saw nothing in
  the window, not that nothing is burning. Tests assert no string says
  "en sécurité".
- **Unavailable is not none.** A failed fetch must never render as an empty
  result — this applies to a collapsed panel too: a fold that hides an
  unavailable-source notice converts it into an all-clear.
- **A tier describes a publisher, never a post.**
- **Register and crowd water are never summed** by any code path, and never
  drawn alike: the register draws solid, OpenStreetMap draws hollow and dashed.
- **Observed and modelled must look different.** Surveyed perimeter solid,
  computed hull dashed with `validated=false`, Rothermel wedges dashed.
- **A detection is not a perimeter.** A VIIRS pixel is 375 m that was hot when a
  satellite happened to look.

## First actions

Run these and report the real numbers before changing anything:

    .venv/bin/pytest -q                          expect 547 passed
    node --test tests-js/*.js worker/test_*.js   expect 253 pass
    git status -sb                               expect clean
    cd public && python3 -m http.server 8899     then drive it with Playwright

One untracked file, `docs/briefs/2026-07-28-spread-scrubber-recommendation.md`,
is not yours and has been left alone for days. Leave it.

## Scope boundary

Do these two jobs. Do not start the provenance feature — it has an approved spec
at `docs/superpowers/specs/2026-08-01-provenance-design.md` awaiting its
implementation plan, and it touches the same popups you will be moving. Say so
in your final report if you find the two collide.
