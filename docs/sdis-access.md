# SDIS operational data — what can legally be obtained, from whom, and whether to bother

**Date:** 2026-07-29
**Scope:** open item §9 of `superpowers/specs/2026-07-29-france-live-map-design.md` —
"SDIS data-sharing approach: who to contact, and whether it is worth the effort."
**Status:** findings and a recommendation. No code. Companion letter:
`sdis-request-letter.md`.

## Summary

There is **no legal route to live SDIS unit positions**, and the reason is not the
security exclusion everyone assumes — it is article L311-2 CRPA: the right of access
covers documents that *exist*, and does not oblige an administration to produce a new
one. A live feed is not a document. CADA cannot order it into existence. The security
exclusion (L311-5 2° d) merely closes the door a second time.

What is obtainable is a **voluntary** arrangement, and the precedent for one is much
stronger than the spec assumed. Two corrections to §2 of the spec:

- "No SDIS publishes live interventions" is true **on data.gouv.fr** and false **on
  SDIS websites**. At least one SDIS — Vendée — publishes every one of its individual
  interventions at commune granularity, with the exact address deliberately withheld, as
  structured JSON embedded in the page (§1.3.1). It is **daily and covers the previous
  day**, not live, its only fire category is undifferentiated `INC`, and its licence is
  all-rights-reserved — so it is no use as a *source*. Its value is as **evidence**: a
  SDIS decided unprompted that this granularity is compatible with operational security.
- DGSCGC already collects "interventions en cours" indicators from **all 99** SIS and
  publishes them per-département, including a `Feux de végétations` column. Annually.
  So the ask is a **cadence change on an existing collection**, not a new category of
  disclosure. That is the single strongest argument available and the letter is built
  on it.

**Recommendation: send one letter, then drop it.** Budget half a day, not a project.
The aircraft inference (§4 of the spec) already delivers most of the operational
signal, and it delivers it *today* with no counterparty. Details in the last section.

---

## Question 1 — Is there a legal route?

### 1.1 CADA and the right of access

The right of access lives in the **Code des relations entre le public et
l'administration (CRPA), Livre III**. SDIS are *établissements publics administratifs*
départementaux and are squarely within its scope — CADA routinely rules on SDIS
documents, and the search index of CADA opinions has a dedicated `Intervention` tag
with many SDIS cases ([cada.data.gouv.fr](https://cada.data.gouv.fr/search?tag=Intervention)).

Three provisions decide this, in descending order of importance.

**(a) L311-2 — the decisive one, and it is not a security provision.**
The right to communication applies only to *completed, existing* documents, and it does
not require the administration to create or compile a new document to answer a request
([Légifrance L311-2](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000031367700)).

A continuously updated feed of unit positions is not a document; it is a live view of an
operational system (the SGO, migrating to NexSIS — see §2.1). Asking for it is asking
the SDIS to build something. **No amount of CADA procedure produces it.** Any request
framed as a *droit à communication* will be refused on this ground alone, and correctly.

This reframes the whole exercise: the only viable path is a **voluntary mise à
disposition**, negotiated, not compelled. The letter says so explicitly rather than
posturing about legal rights it does not have.

**(b) L311-5 2° — the security exclusion, verbatim.**
Documents are non-communicable where consultation or communication would harm
([Légifrance L311-5](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033265181)):

> « d) A la sûreté de l'Etat, à la sécurité publique, à la sécurité des personnes ou à
> la sécurité des systèmes d'information des administrations ; »
>
> « g) A la recherche et à la prévention, par les services compétents, d'infractions de
> toute nature ; »

Both bite. (d) covers live positions directly — knowing where the engines are is
knowing where they are not. (g) is the less obvious one and matters more than it looks:
a large share of French wildfires are of criminal origin, and a live map of the response
is a feedback loop for an arsonist. This is not a hypothetical an SDIS will dismiss, and
the letter concedes it up front instead of waiting to be told.

Note the article was amended by *loi n° 2026-403 du 26 mai 2026* (in force 28 May 2026);
the text quoted above is the version in force at the date of this document.

**(c) L311-6 — personal data.**
Documents whose disclosure would harm *la protection de la vie privée* are communicable
only to the interested party ([Légifrance L311-6](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033218964)).
CADA applies this to SDIS intervention records: an *attestation d'intervention* is
delivered to the person rescued or their representative, not to third parties. An
intervention address is personal data about whoever lives there. Any ask at
address granularity is dead on arrival — which is why every option in §3 stops at
commune or above.

### 1.2 Open-data-by-default (loi pour une République numérique)

*Loi n° 2016-1321 du 7 octobre 2016 pour une République numérique* ("loi Lemaire"),
codified at **CRPA L312-1-1**
([Légifrance](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033205512/2026-05-04)),
requires administrations to publish online, inter alia, *« les bases de données, mises à
jour de façon régulière, qu'elles produisent ou qu'elles reçoivent »* and regularly
updated data of economic, social, health or environmental interest.

Does it reach SDIS? Yes in principle — SDIS are administrations under L300-2, and they
are far above the staffing floor (the obligation exempts legal persons below a headcount
threshold set by decree, and territorial collectivities under 3 500 inhabitants; neither
saves a SDIS). SDIS behave as if it applies: 21 SDIS have registered as publishing
organisations on data.gouv.fr.

But **L312-1-1 carves out L311-5 and L311-6 by reference**, so the security and privacy
exclusions above travel intact into the open-data obligation. Open data by default does
not mean operational data by default. It obliges publication of the DFCI infrastructure,
the budget, the boundaries — which is exactly the 22-dataset picture the spec already
established — and obliges nothing about the SGO.

There is a second, quieter limit: the obligation attaches to bases the administration
*produces or receives*, in the form it holds them. It is not a duty to derive a new
aggregate. Same wall as L311-2.

### 1.3 Has any SDIS ever published live interventions? Yes.

This is where the spec's blanket claim needs narrowing. Checked live on 2026-07-29:

| Service | What is published | Status when checked |
|---|---|---|
| **SDIS Vendée (85)** | Every individual intervention of **the previous day**, categorised (`SAP` / `AVP` / `INC` / `OD`), positioned to the **commune centroid**, address withheld, as embedded JSON | Live and fully characterised — see §1.3.1 |
| SDIS 32 (Gers) | Page titled "Interventions en cours" | Page live (HTTP 200) but **no intervention data rendered** in the response; could not establish whether the feature still works |
| SDIS 37 (Indre-et-Loire) | "Activités opérationnelles en temps réel" | **Host unreachable** from here (connection refused); could not verify |
| SDIS 18 (Cher) | `carte_intervention.php` | **Host unreachable**; could not verify |

The Vendée page states its own rule, verbatim:

> « Les interventions sont positionnées à titre indicatif sur la carte. Les coordonnées
> GPS ciblent la véritable commune du lieu de l'intervention mais jamais l'adresse
> exacte. Cette dernière reste confidentielle. »
> — [sdis-vendee.com](https://sdis-vendee.com/nos-missions/lactivite-operationnelle-des-dernieres-24h/)

That single sentence is the negotiated position an SDIS has already reached on its own:
**commune yes, address never.** It is worth more to the letter than any statute, because
it is a SDIS telling another SDIS that this is publishable. The letter quotes it.

### 1.3.1 Is the Vendée feed machine-readable? Yes — fully. But it is not live.

Investigated 2026-07-29. An earlier draft of this document said there was no structured
endpoint behind the map. That was wrong: the data is HTML-escaped inside an attribute, so
a grep for coordinates finds nothing. It is clean, structured JSON.

**Where it is.** There is no API. The page carries the whole dataset server-rendered into
a single attribute:

```
<div id="markers" data-markers='{"source":"interventions","markers":[[{"label":"date",…}]]}'>
```

`sdis_map_interactive.js` reads it with `JSON.parse(document.querySelector('#markers')
.getAttribute('data-markers'))` and plots it. One GET of the page yields the complete
dataset — no pagination, no ajax, no token.

**Shape.** 123 records when pulled, each an array of `{label, value}` pairs, seven fields,
no nesting:

| Field | Example | Notes |
|---|---|---|
| `date` | `28/07/2026` | **Date only. No time of day.** |
| `numero` | `26VE039126` | Sequential incident number |
| `commune` | `SAINT HILAIRE DE VOUST` | Uppercase, unaccented |
| `code_insee` | `85229` | **Official INSEE code — joins directly to our commune data** |
| `latitude` / `longitude` | `46.589307465418464` | Commune centroid, see below |
| `raison_sortie` | `SAP` | Category code |

**Granularity: the commune claim is true, and provable.** Of the 27 communes with more
than one intervention in the file, **all 27** have exactly one distinct coordinate pair
shared by every intervention there — La Roche-sur-Yon's 10 interventions sit on one
identical point. The client-side script even carries a hack to nudge overlapping markers
apart (`newLng = pos.lng() - 0.0004`), which only exists because collisions are the norm.
These are centroids, not addresses. The mentions on the page are accurate, not
aspirational.

**Cadence: daily, and it is D-1, not "the last 24 hours".** All 123 records carry the same
date — **the previous calendar day**. Two fetches 68 minutes apart returned byte-identical
record sets. There is no time-of-day field anywhere, so intra-day ordering is not
recoverable even in principle. This is a nightly batch of yesterday, not a live or rolling
feed. The response carries `max-age=0` with no `Last-Modified` or `ETag`, so the page is
rendered per request but the underlying extract is not.

**Coverage is partial and I cannot explain the gap.** The published `numero` values span
219 consecutive IDs (`…039126` to `…039344`) but only **123** records appear — 44 % of the
range is absent. Cancelled calls, non-published categories, or IDs consumed elsewhere;
the data does not say which. Do not treat the count as the département's true intervention
total.

**Categories are too coarse for this map.** `raison_sortie` in the pull: `SAP` 85 (secours
à personne), `AVP` 20 (accidents), `INC` **15**, `OD` 3. `INC` is *all* fires — chimney,
vehicle, dwelling, vegetation, undifferentiated. **There is no vegetation or forest-fire
category.** So even with the feed in hand, the question this map needs answered — *is a
feu de forêt being fought here* — is not answerable from it.

**Licence: all rights reserved.** SDIS Vendée is not registered on data.gouv.fr, and the
site's mentions légales state:

> « Tous les droits de reproduction sont réservés […] Toute reproduction, représentation,
> adaptation, modification partielle ou intégrale de tout élément composant le site, par
> quelque moyen que ce soit, est interdite sous peine de poursuite judiciaire. »
> — [sdis-vendee.com/mentions-legales](https://sdis-vendee.com/mentions-legales/)

Reproduction requires express authorisation from the directeur de publication. `robots.txt`
is fully permissive (`Disallow:` empty), but that governs crawling, not copyright, and is
not permission. There is a serious argument that the *informations publiques* inside a
document produced by an administration are reusable under CRPA L321-1 regardless of
boilerplate — facts are not authored, and a public-sector factual database sits in the
réutilisation regime. That is an argument, not a licence. **Consuming this without asking
would be taking a position on French public-information law in order to obtain a
low-wildfire département's daily fire count. Not worth it.** If it is ever wanted, ask;
the address is on the same page as the prohibition.

**What this is and is not worth.** It is *not* a usable source for this map: wrong
département for wildfire, D-1 instead of live, no vegetation category, and reuse
prohibited. Its entire value is **evidentiary** — it proves a SDIS decided, on its own,
that publishing individual interventions with INSEE codes and commune centroids is
compatible with operational security, and has kept doing so. That is the argument to put
in front of SDIS 34. But it must be cited for what it is: a **daily** publication of the
**previous day**, not a live feed. Citing it as live would misdescribe a peer's practice
to a body that can check in thirty seconds, and would cost more credibility than the point
is worth.

**Did anyone stop, and why?** Could not establish. I found no reporting of a SDIS
withdrawing a public intervention feed and no stated reason for one. The SDIS 32 page
being an empty shell is *consistent* with a quietly retired feature, but consistent is
not evidence and I am not going to write it up as one. Treat this question as open.

### 1.4 What I could not establish

- Whether any SDIS has ever *withdrawn* such a feed, and on what grounds (§1.3).
- Whether the SDIS 32 / 37 / 18 pages still serve live data — two hosts were unreachable
  from this network and one returned no data.
- Whether NexSIS's design includes any external data-sharing interface. The ANSC
  describes the platform as enabling *« collaboration and data exchange for the entire
  rescue chain, partners and authorities: mayors, prefects, CODs »*
  ([ansc.interieur.gouv.fr](https://ansc.interieur.gouv.fr/nexsis-18-112/)) — that
  enumeration is institutional actors, with no public tier mentioned. I found no
  published API specification, and I am not inferring one from a marketing sentence.

---

## Question 2 — Who is the right recipient?

### 2.1 The national route: DGSCGC — real, and it already runs the collection

**DGSCGC** (Direction générale de la sécurité civile et de la gestion des crises,
Ministère de l'Intérieur) is verified as the national authority. Its internal
organisation is set by the *arrêté du 6 avril 2021*
([Légifrance](https://www.legifrance.gouv.fr/loda/id/JORFTEXT000043386231/2026-02-05)),
which establishes the **Direction des sapeurs-pompiers (DSP)** and, within it (art. 3),
the **sous-direction des services d'incendie et des acteurs du secours** — the unit that
owns the relationship with the 99 SIS. That is the correct national addressee.

Also within DGSCGC: the **COGIC**, the interministerial operational centre that holds a
24/7 national picture and records every sécurité civile event. COGIC is where the live
national data actually is. It is also, for exactly that reason, the least plausible
source of a public feed — it is a crisis command centre, not a publisher. Do not write
to COGIC.

The important finding is what DGSCGC **already publishes**. Verified by pulling it:

> `data.gouv.fr` — *Interventions réalisées par les services d'incendie et de secours*,
> publisher **Ministère de l'Intérieur**, frequency **annual**, collected by DGSCGC from
> every SIS. The 2024 file is **99 SIS × 71 columns**, one row per SIS (SDIS + BSPP +
> BMPM), and column 15 is **`Feux de végétations`**.
> [dataset](https://www.data.gouv.fr/datasets/interventions-realisees-par-les-services-d-incendie-et-de-secours)

So: a per-département count of vegetation-fire interventions, from all 99 services,
published openly by the ministry, is **already a thing that exists**. What we want is the
same indicator at a different cadence. That is a materially easier thing to ask for than
a new disclosure, and it is the spine of the letter.

The other national actor is the **ANSC** (Agence du numérique de la sécurité civile,
created by *décret n° 2018-856 du 8 octobre 2018*), which builds **NexSIS 18-112**, the
unified SI intended to replace ~99 separate SGOs. NexSIS is the only thing that could
ever make a national live feed technically cheap — today the data is in 99 different
systems, which is half the reason the answer is no. But deployment is slow: nine SIS as
of mid-2025 per the Cour des comptes
([report](https://www.ccomptes.fr/fr/publications/lagence-du-numerique-de-la-securite-civile-et-le-projet-nexsis)).
ANSC is worth knowing about, not worth writing to now — they have no mandate to publish.

### 2.2 ENTENTE / Valabre — real, relevant, but not a data source

The **Entente Valabre** (Entente pour la forêt méditerranéenne) is a public establishment
grouping 15 départements and 15 SDIS plus Corsica, based at Gardanne alongside the
état-major de zone Sud ([valabre.com](https://www.valabre.com/)). Its Pôle Nouvelles
Technologies was mandated by the ministry to study national early fire-detection
deployment ([pont-entente.org](http://www.pont-entente.org/a-propos.php)). It centralises
**DFCI infrastructure** data for the Mediterranean départements.

Two things it gives and does not give:

- **Prométhée**, the Mediterranean forest-fire database running since 1973 across the 15
  south-eastern départements, was **merged into BDIFF in early 2023**
  ([Cerema](https://outil2amenagement.cerema.fr/outils/la-base-donnees-promethee)).
  BDIFF is now the single national forest-fire database
  ([Cerema](https://outil2amenagement.cerema.fr/outils/la-base-donnees-sur-les-incendies-forets-en-france-bdiff)).
  Both are **retrospective statistical records** — fire counts, surfaces, causes, after
  the fact. Useful for a "historique des feux dans votre commune" panel; useless for a
  live map. Not what this document is about, but worth a separate look someday.
- I found **no live or near-live operational feed** published by Entente Valabre or by a
  "cellule de veille opérationnelle". Their operational role is internal coordination for
  the zone Sud. Do not write to them for live data.

### 2.3 The best 2–3 SDIS to approach first

Selection rule: a SDIS that (a) has real wildfire exposure, so the ask is about something
they care about, and (b) has already chosen to publish geographic open data, so we are
asking a publisher to publish rather than asking a non-publisher to start.

Criterion (b) is sharper than expected. Of the **21** SDIS registered as organisations on
data.gouv.fr, several have **zero** datasets, and several more publish only mandatory
*déclarations de profil d'acheteur* — a procurement filing, not open data. Verified
counts of substantive geographic datasets:

| SDIS | Substantive datasets published | Wildfire exposure | Verdict |
|---|---|---|---|
| **34 Hérault** | **5** — PEI, centres d'incendie et de secours, compagnies, groupements, postes de secours de plages | Mediterranean, Prométhée zone | **First approach** |
| **30 Gard** | **5** — secteurs de CIS, centres d'intervention, PEI (×3) | Mediterranean, Prométhée zone | **Second approach** |
| 04 Alpes-de-Haute-Provence | 2 (incl. PEI) | Prométhée zone, lower population | Credible third |
| 85 Vendée | 0 on data.gouv — but publishes the 24 h intervention map on its own site (§1.3) | Low | Cite as precedent, don't ask |
| 06 Alpes-Maritimes | 3, **all** procurement declarations | High | No open-data practice |
| 83 Var | 1, procurement declaration | Very high | No open-data practice |
| 33 Gironde | 2, both subsidy declarations | Very high (Landiras 2022) | No open-data practice |

The instinct is to write to the Var or the Gironde because that is where things burn. The
data says don't: they have never published anything and the request lands cold. **SDIS 34
and SDIS 30 are the only two SDIS in the Mediterranean zone with a demonstrated habit of
publishing structured geographic data**, including the PEI layer this project separately
wants. They are the warm door.

**Recommended sequence:**

1. **SDIS 34 (Hérault)** — the letter is addressed here. Official address, verified via
   the government directory: Parc du Bel Air, 150 rue Supernova, 34570 Vailhauquès
   ([lannuaire.service-public.gouv.fr](https://lannuaire.service-public.gouv.fr/navigation/sdis)).
2. **SDIS 30 (Gard)** — same letter, swap the address block. Send only after 34 answers,
   or simultaneously if you would rather not wait; there is no cost to both.
3. **DGSCGC / DSP** — only *after* one SDIS says yes. A ministry will not pilot a format
   for a hobby map, but it may generalise a format a SDIS already agreed to. One granted
   pilot is the entire argument; without it the national letter is noise.

Address every letter to the **PRADA** (personne responsable de l'accès aux documents
administratifs), whose designation is mandatory under **CRPA L330-1 and R330-2 to R330-4**
([CADA guide des PRADA](https://www.cada.fr/sites/default/files/guide_des_prada.pdf)),
with the directeur départemental in copy. The PRADA is a named, obligated official whose
job is to route exactly this; a letter to a general contact form is not.

**Do not name a person.** I have not verified who holds the PRADA post at SDIS 34 and
will not invent one. The letter uses the function, not a name — which is correct practice
anyway and never goes stale.

---

## Question 3 — The intermediate asks, ranked

Ranked by usefulness **to this map** divided by the effort and risk it imposes on the
grantor. Note that usefulness is judged against this map's actual audience — residents
deciding what to do — not against firefighters, who have their own systems.

### Rank 1 — Count of vegetation-fire interventions in progress, per département

**Ask for this first.** Ratio is best by a distance.

- *Usefulness: high.* It resolves the map's central ambiguity. The map will show a FIRMS
  cluster; it cannot say whether that heat signature is a fire being fought, an
  agricultural burn, or the La Mède flare. A département-level count of vegetation-fire
  interventions in progress separates "something is happening and the SDIS is on it" from
  "a pixel is warm". No other layer does this.
- *Effort for them: low.* The number is on the CTA wall already. It is a `SELECT COUNT`
  against the SGO.
- *Risk for them: low.* No position, no commune, no address, no unit, no vehicle count.
  A count over an area of several thousand km² tells an arsonist nothing they could act
  on and tells a burglar nothing at all.
- *Precedent: direct.* DGSCGC publishes this exact indicator per SIS every year (§2.1).
  We are asking for a cadence, not a category.

### Rank 2 — A delayed feed, 30–60 minutes, commune granularity

The right fallback, offered in the same letter so a "no" to rank 1 has somewhere to land.

- *Usefulness: high* — higher than rank 1 in absolute terms, since it attaches the
  response to a specific incident rather than to a département.
- *Effort: medium.* Needs a filtered export, not a counter.
- *Risk: medium, and already accepted by a SDIS.* Vendée publishes commune granularity
  today with the address withheld (§1.3). A 30–60 minute delay strips the real-time value
  to anyone who would misuse it while losing almost nothing for a resident — a vegetation
  fire is an hours-to-days event, not a minutes event.

### Rank 3 — Points d'eau incendie, nationally

Include as a low-cost rider. Do not lead with it.

- *Usefulness to this map: low.* PEI serve firefighters, not residents. Nobody reading a
  public map decides anything from a hydrant. The spec already scoped it as a coverage
  map, correctly.
- *Effort: low per SDIS, but the ask does not scale* — PEI are held per-département by
  design under the RDDECI regime, so "nationally" means 96 separate conversations, not
  one. Verified: a data.gouv search returns **5** PEI datasets total, from SDIS 04, 34,
  76, 81 and the Département de l'Hérault. That is the whole national picture.
- *Risk: near zero,* which is the point — it is the easiest thing a SDIS can say yes to,
  and a cheap yes opens the door for rank 1. Worth one sentence at the end of the letter.

### Rejected — a boolean "feu de forêt en cours" per commune

Argued against, and the reason is a safety rule rather than a political one.

A per-commune boolean carries roughly the information of rank 2 while being *harder* for
the SDIS to grant — a flag on 36 000 communes is functionally a position. And it fails
the project's own rule that **absence is never safety** (spec §7). A boolean has two
states, and the false state renders as "no fire in your commune", which a reader will
take as an all-clear from an official source. A count of `0` at département level reads
as a statistic; a `false` on your own commune reads as a promise. This project should not
ship a widget that makes a promise the SDIS never made. Worse ratio, worse failure mode,
drop it.

---

## Recommendation: is this worth pursuing?

**Send the letter. Do not build a project around the answer.**

The honest cost model:

- **Cost to ask:** the letter exists; postage and an afternoon. Near zero.
- **Cost to pursue formally:** an administration has one month to answer, silence counts
  as refusal, then two months to seize CADA, whose opinion arrives months later and is
  **advisory only**, after which the sole remedy is the tribunal administratif. Six to
  eighteen months of correspondence — and at the end of it, **L311-2 means the likely
  outcome is a legally correct refusal**, because we would be asking for a document that
  does not exist. Formal escalation here is not a long shot; it is the wrong instrument.
- **Value if granted:** rank 1 upgrades the map's incident cards from "a satellite saw
  heat" to "a satellite saw heat and the SDIS is engaged on N vegetation fires in this
  département". Genuinely good. Not transformative.
- **Value already in hand:** the aircraft inference (spec §4) delivers most of the same
  signal today, with no counterparty, no paperwork and no permission. In the Mediterranean
  season, aerial means are engaged on essentially every significant feu de forêt — a
  Dash-8 orbiting at 2 350 ft over a cluster is a strong indicator that the fire is real,
  significant, and being fought. That is the 80 %, and it is already shipping.

So the SDIS data is an increment on a layer that already works, obtainable only by
goodwill, on a timescale of months. That is a letter, not a roadmap item.

Two things make the letter worth writing anyway. It costs almost nothing. And the ask has
a real, verified precedent behind it — DGSCGC's annual per-département collection, and a
SDIS already publishing at commune granularity — which is a much better hand than "please
give us your operational data". Somebody may well say yes.

**Concretely:** send to SDIS 34, copy SDIS 30, set a reminder for six weeks. If both are
silent, close this out and leave the aircraft inference to carry it. Do not escalate to
CADA — §1.1(a) explains why that road ends in a correct refusal, and burning goodwill
with the two most open SDIS in the Mediterranean zone would cost more than the data is
worth.

---

## Sources

Legal texts (Légifrance, version in force at 2026-07-29):
[CRPA L311-2](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000031367700) ·
[L311-5](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033265181) ·
[L311-6](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033218964) ·
[L312-1-1](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033205512/2026-05-04) ·
[arrêté du 6 avril 2021, organisation DGSCGC](https://www.legifrance.gouv.fr/loda/id/JORFTEXT000043386231/2026-02-05)

CADA: [guide des PRADA](https://www.cada.fr/sites/default/files/guide_des_prada.pdf) ·
[opinions tagged Intervention](https://cada.data.gouv.fr/search?tag=Intervention)

Data, pulled and inspected 2026-07-29:
[Interventions réalisées par les SIS (DGSCGC, annual, 99×71)](https://www.data.gouv.fr/datasets/interventions-realisees-par-les-services-d-incendie-et-de-secours) ·
data.gouv.fr API — 21 SDIS organisations, 5 PEI datasets nationally

Institutions:
[ANSC / NexSIS 18-112](https://ansc.interieur.gouv.fr/nexsis-18-112/) ·
[Cour des comptes, ANSC et NexSIS](https://www.ccomptes.fr/fr/publications/lagence-du-numerique-de-la-securite-civile-et-le-projet-nexsis) ·
[Entente Valabre](https://www.valabre.com/) ·
[Pôle Nouvelles Technologies](http://www.pont-entente.org/a-propos.php) ·
[Prométhée (Cerema)](https://outil2amenagement.cerema.fr/outils/la-base-donnees-promethee) ·
[BDIFF (Cerema)](https://outil2amenagement.cerema.fr/outils/la-base-donnees-sur-les-incendies-forets-en-france-bdiff) ·
[annuaire SDIS](https://lannuaire.service-public.gouv.fr/navigation/sdis)

SDIS publications:
[SDIS Vendée, activité opérationnelle](https://sdis-vendee.com/nos-missions/lactivite-operationnelle-des-dernieres-24h/)
(data pulled and parsed 2026-07-29, §1.3.1) ·
[SDIS Vendée, mentions légales](https://sdis-vendee.com/mentions-legales/) ·
[SDIS 32, interventions en cours](https://www.sdis32.fr/interventions-en-cours/)

## Unverified items

Nothing in this document is a placeholder. The letter contains one `[à vérifier]`: the
name of the PRADA at SDIS 34, which I deliberately did not attempt to source. Address it
by function.

Open questions I could not close:

- Why 44 % of the Vendée `numero` range is unpublished (§1.3.1). Cancelled calls,
  withheld categories, or shared numbering — the data does not distinguish them.
- Whether the Vendée extract runs on a fixed nightly schedule or irregularly. Two fetches
  68 minutes apart is enough to prove it does not update intra-day, not enough to
  establish when it does.
- Whether the all-rights-reserved notice on the Vendée site would actually survive against
  a reuse claim under the CRPA L321-1 réutilisation regime. Untested, and not worth testing
  for this dataset.
