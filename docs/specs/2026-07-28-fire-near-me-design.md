# Fire Near Me — v1 Design

**Date:** 2026-07-28
**Status:** Approved, ready for implementation planning

## 1. Goal

A web page that answers one question for an elderly or non-technical person in Canada:
**"Is there a fire near me, and am I in danger?"**

It answers in plain language, in English and French, and it is honest about what it
does not know.

## 2. Scope

This is the first slice of a larger product. It ships alone and is useful alone.

**In scope:** read-only wildfire, evacuation, and air quality information for a
location the user chooses; two screens plus a provenance page; English and French.

**Out of scope for v1** (each a later slice with its own spec): user accounts and
saved places, push notifications, the volunteer reporter network and its moderation
back-office, citizen photo/video uploads, AI summarization, aviation tracking,
webcams, road closures, shelters, and donation directories.

**Non-goals:** this is not a GIS tool, not a dashboard, and not a replacement for
official emergency channels. Every screen points at the official source.

## 3. The safety rule

Coverage varies by province. **Silence must never read as safety.**

The evacuation card renders exactly one of three states:

1. **Order or alert found** — the user's point falls inside a known evacuation polygon.
2. **Checked, nothing found** — only where we have a real evacuation feed (BC in v1).
3. **Cannot check** — everywhere else: *"We cannot check evacuation orders in
   Alberta."* plus the official provincial link.

Outside BC the app never says "no evacuation near you." Coverage state is read from
the source registry (§6), not hardcoded in the UI.

## 4. Verified data sources

All endpoints verified live on 2026-07-28 with the counts shown.

| Source | Endpoint | Provides | Count |
|---|---|---|---|
| CWFIS | `https://cwfis.cfs.nrcan.gc.ca/geoserver/ows` WFS `public:m3_polygons_current` | national estimated fire perimeters | 642 |
| CWFIS | same, `public:hotspots_24h` | national satellite hotspots, 24h | 6,346 |
| BC Wildfire Service | `https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/BCWS_ActiveFires_PublicView/FeatureServer/0` | named fires, status, size, cause, official URL | 782 |
| BC | `.../Evacuation_Orders_and_Alerts/FeatureServer/0` | Order/Alert polygons, issuing agency, people affected | 67 |
| ECCC | `https://api.weather.gc.ca/collections/aqhi-observations-realtime/items?latest=true` | AQHI 1–10, bilingual names and timestamps | 126 stations |
| NRCan | Canadian Geographical Names database | community names for location fallback | one-time build |

**Never query `public:hotspots`** — it is the full season, 17,916,325 features.
Use `public:hotspots_24h`.

### Known limits of the national data

CWFIS perimeter features carry only `hcount`, `firstdate`, `lastdate`, `area`. There
is **no name and no stable identifier**, and polygons are re-derived each run as
hotspots accumulate and merge. Consequences, which the UI must respect:

- Outside BC, copy is *"an area of active burning about 14 km northeast"* — never a
  named incident, never a stable link.
- We cannot show "this fire is growing" nationally, because we cannot match a polygon
  across runs.
- The `area` field's unit is **not confirmed**. Implementation must confirm it against
  the CWFIS `fm3buffered` metadata before any size is displayed. Until confirmed, size
  is omitted rather than guessed — a size wrong by 100x is worse than no size.

## 5. Screens

### Near me (`/`)
One large button: **"Check fires near me"** / **"Vérifier les feux près de moi"**.
On press, browser geolocation. If declined or unavailable, a searchable list of
Canadian community names. Choice persists in `localStorage`; no server-side storage
of any user location.

Then three cards, in this order:

1. **Fire** — nearest fire, distance, and compass direction, or "No fires within 25 km".
2. **Evacuation** — one of the three states in §3.
3. **Air quality** — AQHI band and Health Canada's advice text for that band.

Each card shows its own data age. Colour: green safe, amber caution, red danger, with
an icon and text label so colour is never the only signal.

### Map (`/map`)
Leaflet. Three toggles: fires, evacuation zones, perimeters. No other controls.
Perimeters load lazily on first map view, not on the near-me path.

### Where this comes from (`/sources`)
Every source, what it covers, its last successful update, and its official link.

## 6. Data model

The build produces three static files.

**`summary.json`** — everything the near-me screen needs.

```json
{
  "generated_at": "2026-07-28T12:00:00Z",
  "sources": [
    { "id": "bc_evac", "ok": true,  "fetched_at": "2026-07-28T12:00:00Z", "stale": false }
  ],
  "coverage": [
    { "province": "BC", "named_fires": true,  "evacuations": true,
      "official_url": "https://wildfiresituation.nrs.gov.bc.ca/" },
    { "province": "AB", "named_fires": false, "evacuations": false,
      "official_url": "https://www.alberta.ca/wildfire-status" }
  ],
  "fires": [
    { "id": "bc:V70397", "lat": 50.1, "lon": -120.4, "named": true,
      "name": "Smith Creek", "status": "Out of Control", "size_ha": 1240,
      "url": "https://...", "source": "bc_wildfire" },
    { "id": "cwfis:idx:412", "lat": 54.2, "lon": -110.9, "named": false,
      "source": "cwfis_m3" }
  ],
  "evacuations": [
    { "id": 123, "kind": "order", "name": "Highway 3 corridor",
      "agency": "Regional District of X", "polygon": [[lon, lat], "..."] }
  ],
  "aqhi": [
    { "id": "ABYRK", "lat": 48.9, "lon": -55.6,
      "name": { "en": "Grand Falls - Windsor", "fr": "Grand Falls - Windsor" },
      "value": 1.48, "observed_at": "2026-07-28T11:00:00Z" }
  ]
}
```

`cwfis:idx:N` identifiers are explicitly **run-scoped**, not stable. Nothing may
persist or link to them.

**`perimeters.geojson`** — simplified polygons for the map only, lazy-loaded.

**`places.json`** — Canadian community names with coordinates, built once, refreshed
manually. Not part of the 10-minute cycle.

### Size budget
642 perimeter centroids + 782 BC fires + 67 simplified evacuation polygons + 126 AQHI
readings ≈ **under 70 KB gzipped** for `summary.json`. If it exceeds 150 KB gzipped,
that is a signal to reconsider, not something to silently accept.

## 7. Status logic

Evaluated in the browser, in this order, first match wins:

1. Point inside an evacuation **order** polygon → **red**, "You are in an evacuation order area."
2. Point inside an evacuation **alert** polygon → **amber**, "You are in an evacuation alert area."
3. Nearest fire within `NEAR_KM` (default 25) → **amber**, "Fire 12 km north."
4. Otherwise → **green**, "No fires within 25 km."

Distance is haversine; direction is initial bearing mapped to 8 compass points.
Point-in-polygon is ray casting over 67 polygons — no library.

AQHI is independent of the above and always shown, using the nearest station and the
official bands: 1–3 low risk, 4–6 moderate, 7–10 high, above 10 very high. Health
Canada's published advice text for each band is stored as static bilingual copy.
If the nearest station is more than 100 km away, the card says the reading is from a
distant station and names it.

All user-facing strings are template-generated from these structured fields, so
English and French are correct by construction. No free text, no translation step.

## 8. Build pipeline

GitHub Actions cron, every 10 minutes: a Python script fetches the five sources,
normalizes them, writes the three files, and deploys to Cloudflare Pages.

Each source is a separate fetcher module behind one registry. The registry entry
declares the province, what the source provides, and its official URL — this is what
populates `coverage` in `summary.json`. Adding Alberta later is one module plus one
registry line, with no UI change.

### Failure behaviour
- A failing source keeps its **last good data**, flagged `stale: true` with its real
  `fetched_at`. Never fabricate, never silently serve stale data as current.
- Any source over 60 minutes old surfaces on the affected card itself, not only on
  `/sources`.
- If **evacuation** data is stale, the evacuation card degrades to the "cannot check"
  state of §3. A stale evacuation feed must never produce a reassuring answer.
- All fetches are bounded: explicit timeout, bounded retries, and a cap on features
  requested per source.

## 9. Frontend

Vanilla JavaScript, Leaflet for the map, no build step. Two screens with one button
do not justify a framework, and the users are disproportionately on old devices and
rural connections. Revisit only if a later slice adds real client-side state.

Accessibility is a requirement, not a polish pass: large default type, high contrast,
keyboard navigable, large tap targets, colour never the sole signal, and the page
usable at 200% zoom.

## 10. Testing

Pure functions get unit tests: haversine distance, bearing to compass point,
point-in-polygon, AQHI banding, and the §7 status decision table.

Normalizers are tested against saved fixtures captured from the real endpoints, so
tests never touch the network. One fixture per source, including a malformed and an
empty response.

The §3 safety rule gets an explicit test: a point in a province with no evacuation
feed must never produce the "nothing found" state.

## 11. Deployment

- Repo: `fire-near-me`, public, under `Gautier242`. (Rename freely; the brief
  suggested `wildfire-canada-assistant`.)
- Branches: `main` deploys to production. Work on short-lived branches off `main`.
  A `dev` branch adds no value at this size.
- Hosting: Cloudflare Pages, free tier, unmetered bandwidth. Chosen for reliability
  under load, not only cost: traffic spikes hardest during an active emergency, and a
  static file on a CDN cannot fall over the way a single small server can.
- Secrets: none required. Every source is public and unauthenticated. The only secret
  is the Cloudflare deploy token, held as a GitHub Actions secret.

## 12. Accepted tradeoffs

- Perimeters are satellite **estimates** and lag reality by hours. The UI labels them
  as estimates.
- A 10-minute refresh is not live. The data age is always visible.
- Outside BC the app is openly incomplete rather than pretending to be national.
- No server means nothing can be personalized or pushed. That is the next slice.
