# Fire Near Me — France

**Date:** 2026-07-29
**Status:** Design approved. Ready for an implementation plan.

## 1. What this is

A French version of the existing Canadian wildfire site, in the same repository,
serving `/fr/` from the same GitHub Pages deployment.

The audience is the public first — a resident asking whether they are at risk and
what they should do about it — with the data layer shaped so an operational view
for pompiers and SDIS could be added later without a rewrite. That second audience
is explicitly **not** in scope here; naming it only constrains how the data layer
is organised, not what ships.

## 2. Why the French version is a different product

Canada and France have opposite data availability, and this inverts the whole
front page.

| | Canada | France |
|---|---|---|
| Evacuation orders | BC publishes machine-readable zones | **No feed at all** |
| Official danger forecast | none | **Météo des forêts, national, daily, D and D+1** |
| Address search | place names only (29,213) | **street addresses** (BAN) |
| Legal risk classification | none | **Géorisques, all 35,000 communes** |

In Canada the headline is *"you are inside an evacuation ORDER area"*. France has
no such feed, so the French headline is **prevention**: what the official danger
level is today and tomorrow, and what that legally requires of you.

### Why there is no evacuation feed, and why we stop looking for one

Searched and confirmed absent: `data.gouv.fr` returns **zero** datasets for
`evacuation` and zero for `arrêté préfectoral évacuation`.

This is architectural, not an oversight. **France's evacuation mechanism is
FR-Alert** — cell broadcast pushed directly to every phone in a geographic cell.
The state chose push-to-phone over publish-a-feed, so there is no API to consume.
Préfecture arrêtés exist as PDFs across 101 separate département websites.

Scraping those was considered and **rejected**: it would mean 101 fragile parsers
to catch a handful of orders per year, with staleness we could not detect, to
duplicate a channel that already reaches the person's phone more reliably than we
would. A scraper that silently goes stale is precisely the failure this project
refuses to ship.

Instead the app states plainly where the real signal comes from:

> Les ordres d'évacuation sont diffusés par FR-Alert directement sur votre
> téléphone. Cette carte ne peut pas les afficher.

…with a link to the relevant préfecture. That is more useful than a scrape,
because it tells someone which channel to trust.

### Rejected: DiaLog for road closures

`Base de données nationale de la réglementation de circulation` reads like the
French DriveBC. It is not. Measured: **103 MB**, 37,092 regulations, 4,257
`noEntry` entries — and **6 records mentioning "incendie" nationally**. It is a
registry of permanent municipal traffic rules (weight limits, one-way streets),
not an emergency feed. No road-closure layer ships in the French version.

## 3. Architecture

Country becomes a parameter, not a fork.

```
build/
  main.py              gains --country ca|fr; orchestration unchanged
  registry.py          coverage table per country
  sources/
    ca/                cwfis, bc_fires, bc_evac, aqhi, bc_roads, cwfis_history
    fr/                mdf, communes, firms, effis, atmo, georisques
    opensky.py         shared — global feed, works for both
public/
  index.html js/ css/  shared shell
  data/                Canada payload (live, untouched)
  fr/
    index.html         thin page, same modules, lang=fr
    data/              France payload
```

Everything below the fetchers is **unchanged**: per-source staleness, the
fail-safe rules, atomic writes, the CI "refuse to publish missing sections" gate,
and the size budget test. One site, one workflow, one 30-minute cron.

The frontend needs almost nothing new. `mapview.js`, `rail.js`, `history.js`,
`location.js`, `status.js` and `i18n.js` already consume a payload plus a coverage
table and know nothing about Canada. The complete `fr` translation table has
existed since the first commit, so France is `lang='fr'` by default rather than a
translation project.

`opensky.py` stays shared and unmoved: it takes a bounding box. A France box costs
4 credits like Canada, so both countries on the 30-minute cron spend 384/day
against the 4,000/day free limit.

## 4. Data sources

All verified reachable on 2026-07-29 unless marked.

| Layer | Source | Key | Notes |
|---|---|---|---|
| **Danger D / D+1** | Météo des forêts (Météo-France, via data.gouv.fr) | no | Official. Open licence (lov2). Daily ~14:50Z. Per-département, levels 1–4. CSV.GZ. **Slice 1.** |
| **Legal fire risk** | Géorisques GASPAR `/api/v1/gaspar/risques?code_insee=` | no | Per-commune `Feu de forêt` flag. Verified for Toulon (83061) and Antibes (06088). Covers all communes. |
| **Address search** | BAN `api-adresse.data.gouv.fr` | no | Street-level geocoding. Verified. |
| **Communes** | `geo.api.gouv.fr` | no | 35,000 communes; replaces `places.json`. |
| **Air quality** | Atmo France WFS `data.atmo-france.org/geoserver/ind/ows`, layer `ind:ind_atmo` | no | 23,965 communes for today. Official ATMO index + PM2.5 sub-index. |
| **Hotspots** | NASA FIRMS | **yes, free** | The one registration required. |
| **Burnt areas** | EFFIS `effis.nrt.ba.poly` | no | WMS tiles only — display layer, not queryable. |
| **Aircraft** | OpenSky | have | Existing credentials. Sécurité Civile callsign labelling. |
| **Satellite** | NASA GIBS | no | Already built, global. |
| **Vigilance** | Météo-France real-time API | **yes, free** | Optional, later slice. |

### Two constraints that shape the product

**EFFIS gives tiles, not features.** GetFeatureInfo returned nothing usable, and
there is no WFS. Burnt areas can be *drawn* but the app cannot say "you are 3 km
from a burn scar". FIRMS carries the actual detection that the rail answer needs.

**The ATMO table is 24.6 million rows unfiltered.** Same trap as the Canadian
CWFIS hotspot layer. Never query without a `date_ech` CQL filter; the existing
`cwfis_history.py` pattern transfers directly.

### Aircraft: why OpenSky, not FlightRadar24

FR24 has better raw coverage (more receivers, MLAT, satellite ADS-B). It loses on
two counts that matter here. Its API is a commercial contract rather than a
signup — and **FR24 honours blocking requests, so state aircraft routinely
disappear from its feed**. French Canadairs *are* state aircraft, making the
service that hides state aircraft the wrong tool for finding them. OpenSky does
not filter.

France is also easier than Canada here. Sécurité Civile flies named callsigns —
`PELICAN` (CL-415), `MILAN` (Dash-8), `BENGALE` (King Air), `DRAGON`
(helicopters) — so aircraft can be *labelled* precisely instead of filtered by the
airline denylist Canada needed. The generic low-altitude filter stays underneath,
so a contracted or private aircraft is not hidden by an allowlist.

Honest limitation, true of both services: an aircraft at 50 m during a drop is
below the radio horizon for ground receivers. Neither reliably sees the drop
itself.

Measured 2026-07-29 07:00 CET: 772 aircraft over the France box, 78 below 1800 m,
zero Sécurité Civile — water bombers do not fly at night. Coverage confirmed;
callsign labelling unverified until daylight in fire season.

## 5. The safety model

Three statements, in this order, never merged:

1. **What is happening** — fires detected near you (FIRMS). Absence is not safety.
2. **What is forecast** — Météo des forêts level today and tomorrow. Official and
   national, but a forecast about *conditions*, not a detection.
3. **What you must do** — the legal obligation at that level.

Rules carried over unchanged from the Canadian app:

- **Never say "vous êtes en sécurité".** With no evacuation feed we can never
  confirm the absence of an order. The strongest negative permitted is "aucun feu
  détecté à moins de X km" — a statement about our data, not about your safety.
- **Danger ≠ fire.** "Danger très élevé" with nothing burning is a normal August
  Tuesday in the Var. Forecast and detection stay visually and grammatically
  distinct, or the app cries wolf and gets ignored on the day it matters.
- **Département-level precision, stated as such.** Météo des forêts is
  per-département — a large area. The UI labels it as a département figure rather
  than implying it describes the reader's street.
- **Géorisques is a classification, not a live signal.** "Votre commune est
  classée à risque feu de forêt" is a legal fact about the commune, true in
  February. It must never read as "there is a fire".

## 6. Scope

**Slice 1 — prevention (ships alone, proves the country seam).**
BAN address search → commune → Météo des forêts D/D+1 → Géorisques risk
classification → what that level legally requires. One new page, two new sources,
no key needed. Delivers a real product with zero live fire data.

**Slice 2 — the remaining layers, as one batch.**
FIRMS hotspots, Atmo air quality, EFFIS burnt areas, OpenSky aircraft with
Sécurité Civile labelling, GIBS satellite, and the FR-Alert explanation in place
of an evacuation layer.

**Explicitly not building:** préfecture scraping, road closures (DiaLog is not an
emergency feed), the operational SDIS view, and any second deployment target.

## 7. Testing

Same discipline as the Canadian side: a fixture per source captured from live
data, `normalize()` tested against it, malformed records skipped rather than
raising, and empty payloads returning empty rather than erroring. New country
modules do not touch existing Canadian tests — 163 currently pass and must
continue to.

The France-specific cases worth naming:

- A commune with no Météo des forêts row (overseas, or a gap in publication)
  renders as "niveau non disponible", never as level 1.
- The ATMO fetch without a date filter must be impossible by construction, not by
  convention.
- Géorisques returning no `Feu de forêt` flag means "not classified", which is
  not the same as "safe" and must not render as reassurance.

## 8. Open items

- **NASA FIRMS key** — free registration, blocks slice 2 only.
- **Météo-France vigilance key** — free, optional, deferred.
- Sécurité Civile callsign labelling needs verification against daylight
  fire-season traffic.
