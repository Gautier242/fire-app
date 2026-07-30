# Handover to orchestrator-3

Written 2026-07-30 by orchestrator-2, whose context is filling. Everything below was
measured, not remembered. **Verify the claims rather than trusting them** — that is
the working method here and it has caught real errors in every round, in both
directions: agents have found defects in coordinator plans, and the coordinator has
found defects in agent reports.

## What this is

Two public wildfire sites, one repo, one GitHub Pages deploy:
`/` Canada (oldest, most-tested, must not regress) and `/fr/` France.
They answer one question for a member of the public: is there a fire near me and what
should I do. France also has a hyper-local view and, since tonight, a responder view.

## State, verify with the commands

```
.venv/bin/pytest -q                        -> 505 passed
node --test tests-js/*.js worker/test_*.js -> 230 pass
git status -sb                             -> check for unpushed work
```

Everything is pushed and live as of `024032b`. One untracked file,
`docs/briefs/2026-07-28-spread-scrubber-recommendation.md`, is not mine and has been
left alone by every agent for two days. Leave it.

## What is live

Pages, all HTTP 200, verified cache-busted:

| URL | What it is |
|---|---|
| `/` | Canada map |
| `/fr/` | France national map |
| `/fr/zone.html?zone=gironde` | Local view, 50 km around an address |
| `/fr/sources.html` | Provenance and limits |
| `/fr/entraide.html` | **New.** The relay: where help is organised |
| `/fr/pro.html` | **New.** Responder view, now linked from the local view |

Data files, all live: `data/summary.json`, `data/history.json`, `fr/data/summary.json`,
`fr/data/water.json`, `fr/data/history.json`, `fr/data/gironde.json`,
`fr/data/relay.json`, `fr/data/hydrants.json`, `fr/data/zones/index.json` plus
`zones/gironde.json` and `zones/landes.json`.

Live counts at handover: Canada 775 fires, 67 evacuations, no stale sources. France
253 fires, 96 danger rows, 51 closures. Gironde feed 116 closed roads, 11 evacuated
communes, 405.2 km² burned. Water 74,632 points. Hydrants 4,304. Relay 12 entries.

## What is local only

**Project 3, the coordination board.** `worker/` — a Cloudflare Worker with a
moderation queue, built and tested (33 tests, now running in CI) and **never
deployed**. There is deliberately no `wrangler.toml` and no KV namespace: writing one
is the first real step of publishing and stays the owner's to take.

Run it with `node worker/local.js`, then:
- `http://localhost:8787/` — the public board
- `http://localhost:8787/?token=local-moderator` — plus the review queue

It is running right now with 1 published post and 3 waiting in the queue, so the
owner can judge the moderation load. Storage is in-memory: stop it and everything is
gone, deliberately, because a local copy quietly accumulating real people's messages
is what the design exists to avoid.

## How help is organised now, end to end

Three distinct layers, and the distinction between them is the design:

1. **Official crisis data, ingested.** The Gironde département publishes closed roads,
   evacuated communes and a burn perimeter on public ArcGIS FeatureServers. Drawn on
   the local view: dashed red lines with no-entry signs, evacuation washes, a solid
   405 km² perimeter. See [[gironde-arcgis-feeds]] in memory for the endpoints.

2. **The relay, linked not ingested.** `/fr/entraide.html` lists where help is being
   organised, in three tiers — `official`, `institutional`, `community`. It reads
   nothing, quotes nothing, caches nothing. A tier states **who publishes a page,
   never whether a post on it is true.**

3. **The coordination board, local only.** Needs and offers with human moderation.
   Not deployed. The static half (`helping.js`, 8 skill checkboxes → advice) has been
   live on the local view all along.

## Live decisions the owner has made — do not relitigate

- **Full Rothermel spread model**: approved, validated against RMRS-GTR-371 table 17
  to 0.0193%, `validated=false` in every payload.
- **Curated over scraped**, twice: evacuations, and now the relay. A parser that goes
  stale in silence is worse than an honest gap.
- **Google's wildfire boundaries: rejected.** They do cover France, at 1 km, but there
  is no public API — only scraping, which breaks their terms and fails silently.
  Our FIRMS points are 375 m, so we compute finer boundaries ourselves.
- **Show all relay tiers, labelled honestly** rather than official-only: a reader in
  trouble finds the Facebook group anyway and is better off pre-warned.
- **Water is complete-and-narrow.** Registers are complete for their area; OSM is
  `crowd` and its absence means nobody mapped it. **Never summed.**
- **OpenSky over FlightRadar24**: FR24 hides state aircraft and French Canadairs are
  state aircraft.
- **Per-layer radius, not one global radius.**

## Safety rules. Not style preferences.

Each exists because breaking it produces a confident wrong answer somebody acts on.

- **ABSENCE IS NEVER SAFETY.** No detection means our satellites saw nothing, not that
  nothing is burning. Tests assert no string says "en sécurité".
- **UNAVAILABLE IS NOT NONE.** A failed fetch must never render as an empty result.
  This applies to the Gironde feed, the hydrants, the relay and the trail.
- **A TIER DESCRIBES A PUBLISHER, NEVER A POST.**
- **REGISTER AND CROWD ARE NEVER SUMMED** by any code path.
- **OBSERVED AND MODELLED MUST LOOK DIFFERENT.** The surveyed perimeter draws solid;
  the computed hull draws dashed with `validated=false`. Rothermel wedges are dashed.
- **A DETECTION IS NOT A PERIMETER.** A VIIRS pixel is 375 m that was hot when a
  satellite happened to look.
- **A BOUNDING BOX IS NOT A BORDER.** León came back as the largest "French" fire once.
- **GROUND FIREFIGHTERS ARE NOT PUBLIC DATA.** 22 SDIS datasets are budgets and
  boundaries; OSM has 4 fire stations in the Gironde bbox against ~100 real.
- **CANADA MUST NOT REGRESS.** `build/main.py`, `mapview.js`, `geo.js` and the water
  source list are shared. Verify Canada's fire and evacuation counts after every
  deploy, not just its HTTP status.
- **SAFETY CONFIG MUST BE TESTABLE.** France once published `fires: 304 → 0` because
  the publish gate's critical list sat in workflow YAML where no test could see it.
  It now lives in `build.main.CRITICAL_SECTIONS`.

## Traps already paid for. Do not rediscover.

- **Facebook cannot be checked at all.** A real préfecture page, a group invented on
  the spot and an impossible username all return HTTP 200 at ~308.5 KB with the title
  "Facebook", within 62 bytes of each other. `relay_check.UNCHECKABLE_HOSTS` leaves
  those unknown and spends no request.
- **Overpass reports a timed-out query as HTTP 200** with a `remark` field and zero
  elements. Check content, never status.
- **`urllib` raises `HTTPError` on every 4xx/5xx**, and it subclasses `OSError`, so a
  naive `except Exception` collapses "the page errored" into "our check failed". Use
  `build.http.make_session`.
- **FIRMS confidence values are the words** low/nominal/high, not letters.
- **The ATMO WFS table is 24.6 M rows** unfiltered; CWFIS hotspots 17.9 M. Always filter.
- **GIBS and EFFIS both serve a valid blank raster** for a date or year they lack.
- **EFFIS GetMap requires an explicit empty `STYLES=`** or MapServer 8 refuses.
- **Slope is scale-dependent**: 2.95° at 5,714 m against 24.15° at 286 m over the same
  massif, and Rothermel's slope term goes as tan², a ~110× swing.
- **Open-Meteo's ceiling is an 8192-byte URL**, not a point count.
- **Département comes from the INSEE code, never the postcode** — Ajaccio's 20xxx is 2A/2B.
- **`api-adresse.data.gouv.fr` is dead**; the live host is `data.geopf.fr/geocodage`.
- **GitHub Pages caches aggressively.** Always cache-bust with `?$(date +%s)`.
- **Page-relative paths in HTML.** Root-absolute 404s and broke the whole site once.
- **`git add <paths>` does not scope a commit** on this shared index. The pathspec must
  be on `git commit -- <paths>` too, or a parallel agent's staged files get swept in.
  This happened tonight and was repaired with `reset --soft`, never `--amend`.

## Parallel agents: what works

Seven agents ran concurrently tonight with zero merge collisions. What made it work:
**partition by exclusive file ownership, not by feature.** Each agent owns only new
files; every shared file stays with the coordinator and is wired serially afterwards.
Agents are told: if your work needs a change in a file you do not own, write the exact
change in your report rather than making it. All seven did.

Tell them to verify the prompt itself. Six of seven found real defects in the plan,
three of which would have shipped broken.

## Open items, in the order I would take them

1. **The community relay tier ships empty.** The thing the owner asked for most
   specifically has nothing in it, because Facebook links cannot be verified and A1
   correctly refused to ship unverifiable entries. The unexplored option is community
   entries that are *not* Facebook — forums, local association pages — which can be
   checked. Owner's call.
2. **Project 3 deploy decision.** Costs Workers Paid at $5/month and roughly 40
   minutes of moderation per hour during an incident, by the worker's own arithmetic
   at 20 s/item. Fully built; needs only the owner's word and a `wrangler.toml`.
3. **`water.json` is 737 KB gzipped**, up 37% after Seine-Maritime. No budget test
   covers side files. If it needs capping, split per département rather than drop a
   register.
4. **`sdis04` is unusable**, verified: Alpes-de-Haute-Provence publishes only a WMS
   (rendered pixels) and its WFS returns 403. Do not re-attempt without new evidence.
   **Calvados (SDIS 14)** is a genuinely available fourteenth département still lost to
   a dead host, with no tabular mirror because hydra does not parse GeoJSON.
5. **Per-polygon fuel from BD Forêt.** Every zone still burns as FM5 garrigue basse.
   This is the single biggest accuracy gain left in the spread model. EFFIS publishes
   a `fuel_map` layer that may serve. Marked `ponytail:` at the call site.
6. **Relay breadth.** Currently Gironde and Landes. Widening costs curation time — a
   human must open every page — not code.
7. **`feuxgironde.fr`** is live and was deliberately left out of the relay: its tier is
   ambiguous, a named private operator that is neither association nor crowd page.
8. **Dated 10 m Sentinel-2** needs a free Copernicus account.
9. **Photos and video from the public.** Owner chose "build it, I'll moderate"; never
   started. Would need the same abuse machinery as Project 3.
10. **The SDIS data-access letter** is drafted at `docs/sdis-request-letter.md`, awaiting
    review. Its finding: CRPA L311-2 means no right of access can compel a live feed
    into existence, so the formal route is a dead end.

## Working practices

- Strict TDD. Failing test first, watch it fail **for the right reason**, minimal code,
  one behaviour per commit.
- "Done" requires fresh command output, never memory of an earlier run. Report failures
  verbatim.
- Never `git add .`. Never `git commit --amend` while others are committing.
- No new dependencies. stdlib Python, vanilla ES modules, Leaflet only. GeoPackage is
  readable with stdlib `sqlite3` — that discovery avoided a geopandas dependency.
- Commit messages: plain engineering prose explaining **why**. No AI or tooling
  mentions, no Co-Authored-By, no emoji.
- Ask the owner rather than assuming. They have directed priorities throughout, and
  their instinct has twice been better than mine — the Gironde ArcGIS map and the
  "just leave the URL clickable" framing were both theirs.
