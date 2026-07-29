# France — the live incident map

**Date:** 2026-07-29
**Status:** Design approved. Supersedes the layer scope of
`2026-07-29-france-design.md`; its architecture and safety model stand.

## 1. The problem

Slice 1 shipped a danger forecast at `/fr/`. It shows no fires, no road closures,
no aircraft. The owner's verdict was blunt and correct: *"ça ne sert vraiment à
rien"*. A map that forecasts risk while showing nothing burning cannot help a
resident decide anything, and helps a firefighter less.

At the moment of writing, **609 satellite fire detections sat inside the France
box** and a Sécurité Civile Dash-8 (MILAN78) was airborne at 2 350 ft. None of it
was on the map.

## 2. What was verified, 2026-07-29

Every claim below was checked live, not read from documentation.

| Layer | Source | Key | Measured |
|---|---|---|---|
| **Fire detections** | FIRMS `J1_VIIRS_C2_Europe_24h.csv` | **none** | 2 724 Europe-wide, **609 in the France box** |
| **Aircraft** | OpenSky | have | MILAN78 airborne; 1 280 aircraft, 239 below 1 800 m |
| **Road closures** | Bison Futé `Evenementiel-DIR/cnir/coupures.html` | none | **73 live closures**, HTML table |
| **Wind** | Open-Meteo | none | 48 h hourly, per coordinate |
| **Water points** | data.gouv PEI / DFCI | none | 7 datasets, fragmented by département |

**The FIRMS key was never needed.** The `api/area` endpoint requires one; the
Europe 24-hour CSV does not. This removes the only blocker on the whole slice.

### Confirmed unavailable

- **Evacuation orders.** No feed exists. France broadcasts by FR-Alert to
  phones. Unchanged from the previous spec.
- **Live SDIS unit positions.** Checked: 22 SDIS datasets on data.gouv are
  budgets, boundaries and infrastructure; no SDIS publishes live interventions.
  This is a deliberate operational-security decision, not an oversight, and no
  scraping strategy changes it.

## 3. The central data problem: detections are not fires

609 detections are not 609 fires. A VIIRS pixel is 375 m and one fire lights up
many — the Lacanau cluster alone is 7 detections inside ~1 km.

The build must group detections into **incidents**, and attach wind, aircraft and
spread to the incident rather than to each pixel. Without this the map is an
unusable rash of dots and no rail sentence can be written about "the fire near
you".

Clustering is by distance: detections within **1.5 km** join the same incident.
Simple, stdlib-only, and standard practice for FIRMS data.

An incident carries: centre, detection count, total and peak FRP (fire radiative
power, a proxy for intensity), first and last detection time, and its bounding
box.

### Two traps already hit

**Confidence values are words, not letters.** They are `low`, `nominal`, `high`
— not `l`/`n`/`h`. A filter written from the documentation returned zero rows on
real data. Any confidence filter must be asserted against the fixture.

**FIRMS detects heat, not wildfire.** It sees industrial flares, refineries and
agricultural burning. La Mède and Lacq will appear every single day. Without an
industrial mask the map shows permanent fires that never move, and once a reader
learns to ignore two fixed dots they will ignore the real one beside them.

The mask is built from persistence, not a hand-maintained blocklist: a cluster
that appears at the same coordinates on most days is infrastructure, not an
incident. That requires keeping a rolling record of cluster centres.

## 4. The aircraft inference

An incident is marked **"moyens aériens engagés"** when an aircraft is within
10 km, below 1 500 m, and has been seen there across more than one build cycle.
One pass overhead is transit; repeated low presence is a drop pattern.

It renders as an observation about aircraft, never a claim about the response:
*"un Dash-8 de la Sécurité Civile tourne au-dessus de ce feu"*, not *"ce feu est
traité"*.

**The absence of aircraft means nothing.** They do not fly at night — at 07:00
the France box held zero Sécurité Civile callsigns and at 17:30 it held MILAN78.
The UI must never let an empty aircraft layer read as "nothing is being done".

Sécurité Civile callsigns are already implemented: `PELICAN` (Canadair CL-415),
`MILAN` (Dash-8), `BENGALE` (King Air), `DRAGON` (helicopters). Unrecognised
callsigns are shown unlabelled rather than hidden.

## 5. Prediction: observed, not modelled

Ships now: the wind at each incident, and the direction its detections have moved
over 24–48 hours — the same approach as the Canadian spread scrubber.

**Deferred, deliberately:** a full fire-behaviour model (rate of spread,
intensity — Rothermel or FWI). A wrong spread prediction can send someone the
wrong way. It needs fuel maps and validation by someone qualified, and must not
ship unvalidated beside an observed layer. Revisit once the observed layer is
proven; the owner asked to be reminded.

## 6. Ground firefighters

The map will never show where firefighters are on the ground, and must say so
where a user would otherwise read absence as nobody being there.

Three tracks, only two of them code:

1. **Air engagement inference** — §4, buildable now.
2. **Water points and fire stations** — real data, fragmented by département.
   A coverage map, not a national layer.
3. **Live unit positions** — a data-sharing request to SDIS or the Ministère de
   l'Intérieur. Paperwork, not code. Unlikely to be granted for a public site.

## 7. Safety rules

Carried from the existing app, plus the ones this slice introduces:

- **Absence is never safety.** No fire detected means our satellites saw nothing
  in the last 24 h, not that you are safe. Cloud blocks detection.
- **Detection lags.** VIIRS passes a few times a day. A fire that started an hour
  ago may not appear. The UI states the age of the last pass.
- **An unclustered detection is not an incident.** A single low-confidence pixel
  renders differently from a 7-pixel 290 MW cluster, and the difference must be
  visible without colour.
- **Aircraft absence is not response absence** (§4).
- **Road closures come from Bison Futé and are not exhaustive.** They cover the
  réseau routier national, not communal roads a préfecture may close.

## 8. Scope

Independently shippable slices:

1. **FIRMS incidents** — fetch, cluster, industrial mask. The unblock; everything
   else attaches to it.
2. **Wind per incident** — Open-Meteo.
3. **Road closures** — Bison Futé parse and geocode.
4. **Aircraft engagement** — wiring plus the inference rule.
5. **Spread direction** — 24–48 h detection movement.
6. **Water points** — fragmented, coverage-mapped.

## 9. Open items

- SDIS data-sharing approach: who to contact, and whether it is worth the effort
  for a public site.
- French UI copy needs a native-speaker review; the owner will do this.
