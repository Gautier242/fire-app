# Fire Near Me — v2 direction

**Date:** 2026-07-28
**Status:** Approved. Supersedes the presentation layer of the v1 design; the data
layer and safety rules carry forward unchanged.

## Why this changed

v1 optimised for "an elderly person can use this in a panic" and treated visual
quality as a distraction. That is a real failure mode: an app nobody opens protects
nobody, and a page that looks unserious does not get trusted with a decision about
leaving your house. Watch Duty is dense, dark, map-first, and usable by
non-technical people under stress — those properties were never in tension.

v1 also hid the map behind a button, which made the product read as a form.

## What carries forward unchanged

Everything below the presentation layer. Specifically:

- The safety rule (§3 of the v1 design): absence of evacuation data must never
  render as absence of danger. It applies at **every** detail level.
- All four ingestion sources, the build orchestrator, staleness handling, the
  registry, and the 150 KB near-me payload budget.
- 98 passing tests. None of them are invalidated by this change.

## The detail dial

One control, three levels. This is what resolves the tension between audiences
rather than averaging them into something mediocre.

| Level | Contains | For |
|---|---|---|
| **Minimal** | No map. One sentence at 2.5rem, one supporting line. Three facts. | Someone who smelled smoke and whose hands are shaking. Also the slow-connection and old-device fallback. |
| **Simple** *(default)* | Map + answer rail. Three layers: fires, orders, alerts. | First-time visitors. Remembered per device. |
| **Advanced** | Every layer, satellite imagery, aircraft, closures, 72-hour spread scrubber, fire-behaviour readouts. | Crews, reporters, EOC staff, and anyone who wants to understand rather than be reassured. |

Named **Advanced**, not Professional: the name should gate by appetite, not by job
title. A curious neighbour should not have to decide whether they qualify.

## Design rules

1. **Shape separates measurement from decision.** Satellite heat is always a glowing
   point. A human-drawn boundary — evacuation zone, road closure — is always hatched
   or dashed. Aircraft are always vector arrows with a track. The map must be
   readable with colour removed; hue alone fails exactly when it matters, because
   "large fire far away" and "leave now" would look identical.
2. **The map is the ground, the rail is the answer.** One screen, no mode switch.
   Someone who will never touch a map reads the rail and stops at the first sentence.
3. **Numbers in monospace, answers in plain language.** Distances, timestamps and
   status codes use tabular figures so the readout reads like an instrument. The
   sentence at the top is ordinary large type, because it is the only part that has
   to survive panic.
4. **Satellite is the wow, plain map is the work.** Imagery earns trust and shares;
   street names locate a burning house. One tap between them, layers unchanged.
5. **Nothing moves except what is live.** One slow pulse on the freshness indicator.
   No sliding panels, no animated counters.
6. **Light theme is a paper topographic map**, not an inversion, with the thermal
   ramp retuned so fire stays legible on a warm ground.

## New sources, verified 2026-07-28

| Layer | Source | Licence / limit | Cost |
|---|---|---|---|
| Satellite imagery | NASA GIBS WMTS, `gibs.earthdata.nasa.gov/wmts/epsg4326/best/` | No API key; explicitly supports embedded third-party use | $0 |
| Road closures | DriveBC Open511, `api.open511.gov.bc.ca` | OGL-BC. Ontario 511 equivalent exists. | $0 |
| Aircraft | OpenSky Network | 4 000 credits/day; Canada bbox = 4 credits/call. OAuth2 client-credentials since March 2026. | $0 at 5-minute refresh |
| Spread history | CWFIS `public:hotspots` with `rep_date AFTER <t>` | Open Government Licence | $0 |
| Photos / video | Cloudflare R2 | 10 GB free, **zero egress** | $0 to ~40 000 photos |

### Aircraft cadence is a budget decision
4 000 credits/day ÷ 4 per call = 1 000 calls. A 5-minute refresh costs 1 152
credits/day and fits. A 30-second refresh costs 23 000 and does not. Air tankers are
not a layer anyone evacuates on, so five minutes is both honest and free.

### The spread scrubber needs no datastore
CWFIS answers a 72-hour `rep_date` filter directly — 22 894 timestamped hotspots at
the time of writing. This was expected to be the first feature requiring a database;
it is not. It becomes another static file, lazy-loaded only in Advanced mode so it
never competes with the near-me payload budget.

Each hotspot also carries `ws`/`wd` (wind speed and direction at that hour), plus
`ros` (rate of spread), `hfi` (head fire intensity) and `fwi`. This is the most
valuable find in the v2 work: the map can show **why** a fire is moving where it is,
not merely that it moved. No public Canadian tool puts that in front of an ordinary
person in plain language.

### Media cost: the answer is egress, not storage
Storage was never the risk. R2 charges zero egress, so the viral day — 100 000 people
opening photos of a fire — costs nothing. A photo downscaled to 1600px is ~250 KB, so
the 10 GB free tier holds roughly 40 000. A 30-second 720p clip is ~3 MB: about 3 300.

**The real cost of user media is human moderation, not infrastructure.** Photos from
a fire will include distressing scenes and occasionally a body. Nothing publishes
without a human. That is a rota, and it — not the hosting bill — decides whether
media ships at all.

## The one architectural change

Uploads need something to sign them, and this app currently has no backend. A
Cloudflare Worker handles it inside the free tier, but it is the first always-on
infrastructure in the project and needs abuse limits from day one. An open upload
endpoint attached to a wildfire is an attractive target.

## Sequencing

1. **Shell rebuild** — map-first layout, detail dial, GIBS satellite basemap,
   basemap toggle. Reuses the existing card logic as rail renderers.
2. **Place-search ranking** — CGN ships a `Relevance at Scale` column that
   `build_places.py` currently discards, which is why typing "Kam" offers eight
   places in Quebec before Kamloops.
3. **Spread scrubber + wind** — 72-hour hotspot file, lazy-loaded.
4. **Road closures**, then **aircraft**.
5. **Photos**, gated on the moderation rota existing.
6. **Webcams**, **reporter network** — unchanged from the original brief, later slices.

## Open questions

None blocking. Basemap tiles, aircraft cadence, media storage and history retention
are all resolved above with verified numbers.
