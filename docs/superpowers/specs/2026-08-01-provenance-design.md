# Provenance: where every drawn thing came from

Written 2026-08-01. Approved in brainstorming before any code.

Subsystem A of three. B (aircraft trajectories and replay) and C (water-point
accessibility) get their own specs and are sketched at the end so they are not
silently dropped.

## The problem

Every object the map draws already carries a `source` slug — `firms`, `opensky`,
`open_meteo`, `pei`, `osm` — and nothing joins that slug to a publisher, a URL,
or a caveat. A reader who clicks a water point is told what kind it is and
nothing about who surveyed it or when.

The freshness half of this is not cosmetic. Measured against data.gouv's
resource extras on 2026-08-01:

| Register | Publisher last updated | Points |
|---|---|---|
| Tarn | 2026-07-24, a week earlier | 6,691 |
| Hérault SDIS 34 | **2024-02-23, two and a half years earlier** | 19,296 |
| Seine-Maritime (the CSV we read) | **2024-11-22, twenty months earlier** | 20,694 |

The map draws all three identically. Our second- and third-largest registers
describe a network that is years old, and a crew reading the map cannot tell
them from the one refreshed last week. That is the same failure class as a
capacity figure that reads as a full tank: a confident answer somebody acts on.

## Verified before designing

Every claim below was checked against the live services on 2026-08-01, not
assumed. Two guesses failed the check and were corrected, which is why the URL
table is worth having in the spec at all.

| Target | Result |
|---|---|
| `openstreetmap.org/node/689469688` | 200 — the exact hydrant object |
| `worldview.earthdata.nasa.gov/?v=<bbox>&l=<layer>&t=<date>` | 200 — carries layer *and* date |
| `firms.modaps.eosdis.nasa.gov/map/#d:<date>;@<lon>,<lat>,9z` | 200 |
| `data.gouv.fr/datasets/<slug>` | 200 — note: **no `/fr/` prefix**, which is what made the first guess 404 |
| `opensky-network.org/aircraft-profile?icao24=…` | **410 Gone** — endpoint retired |
| `opensky-network.org/` | 403 to curl's UA, **200 with a browser UA** — the UA-blocking trap already documented for `relay_check` |
| Register API hosts (`tabular-api.data.gouv.fr`, `herault-data.fr`, `opendata56.fr`) | send **no `Last-Modified`** header, so freshness cannot be had free from our own fetch |

Two consequences. Aircraft are dataset-level only, because the per-record page
is gone — not because we could not be bothered. And publisher freshness has to
come from data.gouv's API, because the hosts we fetch from do not offer it.

`globe.adsbexchange.com/?icao=…` does answer 200 and is deliberately **not**
used: it is a different operator's observation of the same aircraft. Linking
there would attribute our data to a source it did not come from, which is the
one thing a provenance feature must never do.

## Design

### Two halves, because provenance is half claim and half measurement

**A curated registry**, `public/static/fr/provenance.json`, in the repo
(the same place and the same convention as `relay.json`, whose published
counterpart is likewise `fr/data/relay.json`). Who
publishes each source, the dataset URL, the record-URL template, the licence,
and the one-line limit. Human-maintained under the same discipline as
`relay.json`: a human opens every link, and the file carries a `_verified` note
saying so. It is a set of claims a person made, and it belongs in a diff where
it can be reviewed.

**A freshness layer**, built each run into `fr/data/provenance.json`. Publisher
last-modified pulled from data.gouv resource extras (`analysis:last-modified-at`)
and merged onto the registry. This is a measurement, not a claim, and it changes
on a scale of months.

Keeping them apart is the point. A wrong URL is somebody's mistake and shows up
in review; a stale date is a fact about the world.

### Record links, per source

| Source | Link | Precision |
|---|---|---|
| `osm` | `openstreetmap.org/node/{id}` | exact object — anyone can go correct it |
| `firms` | FIRMS map at the fire's own lon/lat and `last_seen` date | exact place and day |
| `pei` (registers) | the data.gouv dataset page for that register | dataset — no per-record page exists |
| `opensky` | `opensky-network.org/` | dataset — per-aircraft page is 410 Gone |
| GIBS layers | Worldview permalink with that layer and that date | exact layer and day |
| `ign_ortho` | Géoportail | dataset |
| `open_meteo` | Open-Meteo docs | dataset |

Our OSM ids ship prefixed (`osm-689469688`); the template strips the prefix.
The registry stores a template with `{id}`, `{lat}`, `{lon}`, `{date}` and a
substitution function fills what the object has.

### One renderer

`public/js/provenance.js` exports a single function producing the block every
popup uses — water, fires, aircraft, imagery. The map must not grow four
dialects of "where this came from".

The block, in both languages:

```
Borne ou poteau
Registre SDIS 76 — Seine-Maritime

Relevé publié le      22 nov. 2024
Récupéré par nous     il y a 41 min

⚠ Un registre de 2024 décrit le réseau de 2024.

  → Voir le jeu de données source
```

### Rules this feature lives under

- **A source we cannot place renders as "we cannot say where this came from."**
  Never a hidden link, never a blank. Same rule as everywhere else here.
- **An unknown publisher date renders as unknown, never as fresh.** The failure
  mode being avoided is a 2024 register looking an hour old, which is the exact
  thing this feature exists to expose.
- **A record link never points at a different operator's data.** Stated because
  adsbexchange makes it tempting and it would be a lie about provenance.
- **The two water tiers keep their separate wording.** A register's provenance
  line says who surveyed it; OSM's says nobody guarantees completeness. The
  shared renderer must not flatten that into one sentence.

### Failure behaviour

The data.gouv freshness fetch is bounded and non-fatal. If it fails the
previously published `provenance.json` keeps serving, exactly as `write_side_file`
already does for the other side files; if there is no previous file, every
publisher date renders unknown and every link still works, because the links
come from the curated half which is in the repo.

## Out of scope, deliberately

- **Canada.** `mapview.js` is shared but the Canadian popups are separate
  methods, so France can be wired without touching them. Canada follows once
  the shape is proven, and its counts must be re-verified after that deploy.
- **Licence enforcement or attribution auditing.** Display only.
- **Fixing the Hérault staleness.** This feature reveals it. Whether a register
  the SDIS last touched in February 2024 should still ship is a separate
  decision for the owner, and one this makes possible to take.
- **Seine-Maritime's newer resource.** data.gouv lists a GeoPackage updated
  2026-06-07 against the CSV we read at 2024-11-22. Switching sources is its
  own change with its own parsing risk; noted here so it is not lost.

## Scope of the change

| File | Change |
|---|---|
| `public/static/fr/provenance.json` | new, curated, human-verified — Canada would add its own |
| `build/provenance.py` | new — merge registry with data.gouv freshness |
| `build/main.py` | publish `provenance.json` as a side file |
| `public/js/provenance.js` | new — the one renderer |
| `public/js/mapview.js` | water, fire and aircraft popups call it |
| `public/js/imagery.js` | layers carry their Worldview template |
| `tests/test_provenance.py` | merge, failure, unknown-date behaviour |
| `tests-js/test_provenance.js` | rendering, both tiers, unknown source, no-safety wording |
| `tests/test_budget.py` | a budget entry, or the new file fails the build |

Constraints held: stdlib Python, vanilla ES modules, Leaflet only; no new
dependencies; strict TDD, one behaviour per commit; `git commit -- <paths>`.

## The other two subsystems

**B — aircraft trajectories and daily replay.** Aircraft are snapshots today:
one position per aircraft per build, and the build runs every 30 minutes. Forty-
eight samples a day shows rough movement, not a drop pattern — a Canadair's
cycle is minutes. So B is not a UI problem, it is a sampling decision: either a
much faster dedicated poller, or an honest replay that says outright it is
showing half-hourly dots and not a flight path. That decision belongs in its own
spec.

**C — water-point accessibility.** `build/sources/fr/hydrants.py:50` requests
`emergency=fire_hydrant` and keeps only id, lat and lon. OSM also publishes
`fire_hydrant:position` (lane, sidewalk, green, parking_lot),
`fire_hydrant:type` (pillar, underground, pond), `operational_status` and
`couplings`, and `emergency=suction_point` / `water_tank` / `fire_water_pond`
are separate tags never fetched. The accessibility signal is published data we
throw away, so C is mostly "stop discarding it". Inferring reachability
ourselves — from distance to a road, say — would be this app's cardinal sin:
a tank the map called reachable is the same failure as a tank it called full.
