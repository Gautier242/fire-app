# Burn history and honest closures

Project 1 of four approved on 2026-07-30. The remaining three — computed fire
boundaries with egress routing, the volunteer/needs half, and a responder-facing
view — are committed and specified separately. This document covers only the first.

## 1. The problem

The owner's complaint: the map shows neither the roads that are blocked nor the
areas that have already burned, while Google Maps shows both.

Both halves of that are substantially right, and the causes are different.

## 2. What was verified, 2026-07-30

### The closures layer

Of 47 live closures in the France summary:

- **0** mention fire, smoke or incendie in their headline.
- **25** have a start date in the future — some in October and December.
- They cluster in 78, 09, 31, 77, 92, 75. **None** in 33 (Gironde) or 40 (Landes),
  where all 17 current fires are.

`build/sources/fr/roads.py` is not at fault for the content: it deliberately reads
Bison Futé's *coupures* table and deliberately skips `RecapChantiersEnCours.html`,
on the stated grounds that "during an evacuation a map covered in paving crews is
worse than no road layer." These are genuine cuts to the réseau routier national.

The two real defects:

1. The module parses future start dates (its docstring documents the `?` and `!`
   markers that accompany them) but emits no field distinguishing a cut that is
   closed **now** from one scheduled for December. The frontend therefore cannot
   tell, and renders both identically.
2. A layer named "Routes coupées" beside a fire map is read as *closures caused by
   this fire*. It is in fact every national-network cut in France for any reason.

### Google's wildfire boundaries

France **is** covered — the layer reached France, Spain, Portugal, Italy, Greece and
others in the Europe/Africa expansion. Google publishes the technical shape: 1 km²
resolution, refreshed every 10–15 minutes, from GOES-18/19, Himawari-9, GK2A, Suomi
NPP and NOAA-20.

There is **no public API, dataset or developer access**. Google's own documentation
states the output is loaded into Google Maps and Google Search. Scraping is therefore
the only route, and it is rejected:

- It breaches Google's terms.
- It fails silently. A changed selector yields an empty layer, which on this map
  reads as *no fire* — the failure mode already rejected when curated evacuations
  were chosen over a préfecture scraper.

The decisive fact is that **Google's inputs are our inputs**. Suomi NPP and NOAA-20
VIIRS are the same satellites `firms.py` already ingests, and FIRMS serves them at
**375 m against Google's 1 km output**. Google's advantage is not data; it is
clustering points into a boundary. That is computable here, and is Project 2.

### Burned areas — what is actually obtainable

EFFIS WMS at `maps.effis.emergency.copernicus.eu/effis` responds, 104 KB of
capabilities, and requires an explicit empty `STYLES=` parameter (MapServer 8 refuses
GetMap without it).

Measured by decoding the returned PNG and counting non-transparent pixels:

| Layer | Extent tested | Non-transparent pixels |
|---|---|---|
| `modis.ba.2025` | France | **25,288** |
| `effis.nrt.ba.poly` | Gironde/Landes | 0 |
| `effis.nrt.ba.poly` | All Europe | 0 |
| `modis.ba` (current) | France | 0 |

So EFFIS holds real French burn polygons for 2016–2025, and its **near-real-time
layer is empty across the whole continent**. EFFIS answers "has my area burned in a
past season". It does not answer "what burned in the fire that is burning now".

`GetFeatureInfo` rejects `application/json` for these layers; `text/plain` and
`application/vnd.ogc.gml` are offered. Byte size alone must never be trusted as
evidence of content — the empty Gironde response was a valid 1,980-byte PNG, the
same trap as GIBS.

### FIRMS history

France currently fetches only the rolling 24-hour Europe CSV. Canada's 72-hour
replay comes from `cwfis_history.py`, a Canada-only WFS, so it is not reusable.

Keyless longer ranges do exist for Europe, verified:

| Feed | Rows | Bytes |
|---|---|---|
| `J1_VIIRS_C2_Europe_24h` | 3,058 | 252 KB |
| `J1_VIIRS_C2_Europe_48h` | 4,389 | 362 KB |
| `J1_VIIRS_C2_Europe_7d` | 18,595 | 1.5 MB |
| `SUOMI_VIIRS_C2_Europe_48h` | 5,135 | 413 KB |
| `SUOMI_VIIRS_C2_Europe_7d` | 20,110 | 1.6 MB |

A 7-day burn trail needs no API key.

**Cost model.** Measured, not estimated. The current 24h pair is 252,013 + 286,805 =
526 KB per build. The 7d pair is 3.00 MB. The build runs every 30 minutes, so 48 builds
a day:

| | Per build | Per day |
|---|---|---|
| Current 24h pair | 526 KB | 24.7 MB |
| 7d pair | 3.00 MB | 144 MB |

A **5.8×** increase in FIRMS volume. Accepted: these are static bulk CSVs NASA
publishes for exactly this use, fetched once per build with no per-item requests. If it
ever needs cutting, the 48h pair costs 775 KB per build and loses the early trail of a
week-old fire.

## 3. What ships, in order

### 3.1 Seven-day detection history for France

A new `build/sources/fr/firms_history.py` fetching the 7d pair, filtered to the France
bbox, tagged by country with the existing `flares.tag_country`, and masked by the
existing industrial-persistence logic.

Written to its own `fr/data/history.json`, following `write_history`'s existing rule:
a failure there must never touch the summary, because "a replay nobody can see is an
inconvenience, an evacuation map nobody can see is not."

Rendered as a fading trail, oldest palest, visually distinct from current detections.

**The honesty constraint.** This layer must never be labelled "zones brûlées". A VIIRS
detection is a 375 m pixel that was hot at a moment a satellite happened to look. It is
evidence of where fire has been, not a mapped perimeter, and cloud gaps leave holes in
it. The label states what it is: heat detected over seven days.

### 3.2 Surface OPERA DIST-ALERT as the burn-scar layer

Already shipping in `public/js/imagery.js` at 30 m — vegetation-loss alerts, the
closest near-real-time burn-scar product available without an account. The defect is
discoverability: it sits in the catalogue under a name that does not tell a reader it
shows where vegetation has been destroyed.

No new fetching. A plain label, and a direct toggle on the zone page.

### 3.3 Closures that do not overstate

- `roads.py` emits a boolean `in_force`, true when the cut's start is at or before the
  build's clock. Cuts with `in_force: false` are **kept in the payload and excluded
  from the map layer**, because a scheduled closure is real information that simply
  does not belong on a map of what is shut right now. Where a page lists closures as
  text it may show them, dated. They never render as presently closed.
- The layer is named for what it contains: national-network cuts, all causes.
- The existing zone-page sentence — "Bison Futé ne voit que le réseau national" —
  already states the coverage limit correctly and is kept.

### 3.4 EFFIS historical burn scars

Year-selectable WMS layers, 2016–2025, via `L.tileLayer.wms` — Leaflet's own, no new
dependency. Styled cold and captioned with the year so they can never be mistaken for
live fire. Explicitly labelled as past seasons, not this fire.

Because EFFIS returns a valid non-empty PNG for a date it has no data for, and an
empty one otherwise, availability is probed rather than assumed — the GIBS rule.

## 4. Cut from scope

**`georisques.py` stays unwired.** It is built and tested, and it answers a real
question — whether a commune is legally classified as forest-fire exposed, which
triggers débroussaillement duty. But that classification is equally true in February.
It does not tell a reader whether they are in danger now, and its False means only
"not classified", never "safe". Wiring it into an emergency surface would add a field
whose most likely misreading is reassurance. Prevention context belongs on a
prevention page, if anywhere.

## 5. Safety rules this must not break

- **Absence is never safety.** Every layer here can be empty for reasons that have
  nothing to do with the reader's risk: cloud, no satellite pass, a source that has
  not recorded an event. Each gets a test asserting its emptiness renders as
  absence-of-data and never as absence-of-fire.
- **Observed and modelled must look different.** Everything in this project is
  observed or archival. Nothing here is dashed, because nothing here is modelled —
  that distinction belongs to the Rothermel wedges and must stay clean.
- **A detection is not a perimeter.** 3.1 applies this specifically.
- **Canada must not regress.** `firms.py`, `roads.py` and `mapview.js` are shared or
  parallel surfaces. Canada's fire count, evacuation count and history file are
  checked live after deploy, not merely its HTTP status.
- **The publish gate covers what ships.** Tonight France published `fires: 304 → 0`
  because the gate's critical list lived in workflow YAML where no test could see it.
  Any new section that would misinform when empty is added to
  `build.main.CRITICAL_SECTIONS`, in code, with a test.

## 6. Testing

Strict TDD, one behaviour per commit. Specifically:

- Fixtures for the 7d CSV including a cloud gap and an industrial site with fewer than
  three days of history, which must not be masked.
- A closure whose start is in the future must not be reported as currently closed.
- A France build with a failed history fetch still writes a correct summary.
- An EFFIS probe that returns an empty raster must resolve to "no data for this year",
  not a blank layer presented as no burns.

## 7. Open items

- Whether the 7-day trail should be capped in payload size for a season worse than
  this one. Current arithmetic: 24 h yields 304 bbox detections and 111 inside France,
  so 7 d projects to roughly 2,100 and 780. Not a problem today; the cap parameter goes
  in from the start because unbounded work over external items always gets one.
- EFFIS `fuel_map` was found while probing and is not used here. It bears directly on
  the deferred per-polygon fuel item, which currently assigns FM5 garrigue basse to
  every zone. Noted for Project 2, not adopted in this one.
