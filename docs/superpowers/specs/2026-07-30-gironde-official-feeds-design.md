# The Gironde official feeds

An addendum to `2026-07-30-burn-history-and-honest-closures-design.md`, written
because the owner found something that spec assumed did not exist. It changes the
order of the remaining work and retires one of its conclusions.

## 1. What was found

The Département de la Gironde publishes
`gironde.maps.arcgis.com/apps/instant/basic/index.html?appid=f0f0b0ae3c1b4b85a697e209e0fcbc4b`.
Behind it are ArcGIS REST FeatureServers, `access: public`, owner `o.mougel`, no
token in any layer URL and no `licenseInfo` restriction. This is a documented API,
not a page to scrape, so the objection that killed the Google route does not apply.

Queried live 2026-07-30:

| Layer | Endpoint | Count |
|---|---|---|
| RD fermées | `ec_agol_vue/FeatureServer/3` | **24** |
| Voies fermées (hors RD) | `ec_agol_vue/FeatureServer/2` | **212** |
| Déviations | `ec_agol_vue/FeatureServer/1` | 2 |
| Informations ponctuelles | `ec_agol_vue/FeatureServer/0` | 25 |
| communes évacuées | `communes_evacuees/FeatureServer/0` | **20** |
| Zone affectée, Saumos 27/07 | `emprise_27_07_26/FeatureServer/0` | 1 |

`refreshInterval: 60` on the road layers — the département refreshes every minute.

### The closures are fire-attributed, and they are lines

Sample from RD fermées:

```
voie_designation: D807E1
evenements_de_crise_libelle: Incendie de Saumos
evenements_de_crise_cause_de_la_fermeture: Incendie
evenements_de_crise_fermeture: Fermeture totale
evenements_de_crise_date_heure_de_debut_de_fermeture: 2026-07-24+02:00
geometry: LineString
```

Every field Bison Futé could not give us. Bison Futé publishes points on the
national network and returned **zero** closures in Gironde or Landes while 17 fires
burned there; this returns 236 closed roads with a named cause, as geometry a reader
can follow rather than a dot on a road.

### France does have an evacuation feed, in Gironde

The 20 communes carry `nom`, `code_insee` and `statut`, as Polygon/MultiPolygon:
Andernos-les-Bains, Arès, Biganos, Lacanau, Lège-Cap-Ferret, Martignas-sur-Jalle and
fourteen more.

**This retires a claim repeated all session.** Every prior spec states France has no
evacuation feed because orders go out over FR-Alert. That is true nationally and
false for Gironde: the département publishes which communes are evacuated. The
hand-maintained `public/static/fr/evacuations.json` watching zero départements was
the correct answer to the wrong question.

### An official burn perimeter exists

`emprise_27_07_26` is a single Polygon with two rings, `Shape_Area` 405,170,600 m²
— **405 km²** — for the Saumos fire. Independently recomputed from the coordinates
at 422 km², agreeing to within the projection difference.

## 2. What this changes

**Project 2's fire boundary is demoted to a fallback.** `build/fire_boundary.py`
computes a convex hull over FIRMS detections as a substitute for a perimeter nobody
published. Where an official perimeter exists it wins on every axis: it is authored
by the service fighting the fire, it is concave where the fire is concave, and it
carries no `validated: false` caveat because it is an observation rather than a
model. The hull remains the answer for the 100 départements with no such feed, and
that is where it now belongs.

**Egress gains real detours.** E's `egress.js` assesses roads against modelled
spread. Two published `Déviations` are an official answer to the same question and
outrank any model. The modelled assessment stays for everywhere without them.

## 3. Scope of this addendum

1. `build/sources/fr/gironde.py` — one module, four concerns: closed roads
   (RD and non-RD merged, fire-cause preserved), déviations, evacuated communes,
   burn perimeter.
2. Wire into the France build as a side file, not a summary section. It is one
   département and its failure must never touch the national danger map.
3. Render on the local view: closure lines, evacuation polygons, burn perimeter.
4. A sources panel reachable from the map, per the owner's decision: every layer
   states its origin and its update time in the interface, not only on
   `sources.html`.

## 4. Safety rules specific to this data

- **Unavailable is not none.** A failed fetch renders as "indisponible", never as
  "aucune route coupée" or "aucune commune évacuée". This is the absence-is-never-
  safety rule applied to a feed we do not control, and it is the whole risk of
  depending on someone else's server for life-safety information.
- **Gironde only, said out loud.** The layer must state that it covers one
  département. A reader in Landes must not read an empty Gironde layer as calm.
- **An evacuation order is repeated, never authored.** We show what the département
  published and name it as theirs, with its timestamp. We never infer an order, never
  extend one to a neighbouring commune, and never soften one.
- **FR-Alert still supersedes.** The existing sentence stays: orders reach phones
  over FR-Alert and this map cannot show them all.
- **Official beats modelled, visibly.** An official perimeter draws solid; the
  computed hull stays dashed with `validated: false`. A reader must be able to tell
  which they are looking at without reading a caption.
- **Cap the work.** Every query carries `resultRecordCount` and the module takes an
  explicit cap, because these counts are today's counts on a live incident.

## 5. Testing

- A fetch failure yields an empty payload whose absence is distinguishable from a
  successful empty result, and the frontend renders the two differently.
- A closure with `cause` other than `Incendie` is kept but marked, so the layer never
  silently implies every closed road is a fire closure.
- A closure whose reopening time has passed is excluded.
- An evacuated commune with no geometry is dropped rather than drawn at [0, 0].
- The Gironde payload cannot make `summary.json` fail to write.

## 6. Known fragility

This exists because Gironde is burning. It may be withdrawn when the fire ends, and
no other département is known to publish an equivalent. The design accepts that: a
layer that is honestly empty most of the year and correct during an incident is worth
more than a national feed that does not exist. Complete-and-narrow over
incomplete-and-wide, the same judgement already made for water points.
