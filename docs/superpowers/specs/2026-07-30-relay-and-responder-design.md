# The relay, and what the map can offer a firefighter

Two audiences in one document, at the owner's decision after the risk was stated:
a member of the public looking for where help is being organised, and a responder
who can use modelled figures the public page must not show.

## 1. The relay

### What was asked

Centralise the places where people are actually asking for and offering help —
préfecture and government pages, SDIS, mairies, Facebook entraide groups — rank them
by how much they can be trusted, and leave the URL clickable. Do nothing else with
them.

### Facebook cannot be read, and that settles the architecture

Measured 2026-07-30: `facebook.com/prefet33/` returns HTTP 200 and 309,942 bytes
whose only recognisable content is `Login` and `Cookie`. A public page requires an
authenticated session; a private group is private by definition; and their terms
prohibit automated collection either way.

So there is no version of this that reads Facebook. The owner's own framing — leave
the URL clickable — is therefore not a simplification, it is the only correct shape:
**a directory of links, curated by hand, that ingests nothing.**

That is the same judgement already made for evacuation orders: a curated file that
states when it was last touched beats a scraper that goes stale without saying so.

### Tiers

The owner chose to show every tier and label it honestly, on the reasoning that a
reader in trouble will find the Facebook group anyway and is better off arriving
pre-warned. Three tiers, and the tier is a statement about **who publishes it**,
never about whether a particular post is true.

| Tier | Who | What the interface says |
|---|---|---|
| `official` | Préfecture, SDIS, mairie, Sécurité Civile, Croix-Rouge | Source officielle |
| `institutional` | Established associations, local press | Organisation identifiée, non officielle |
| `community` | Facebook groups, forums, neighbourhood pages | Nous ne pouvons pas lire cette page. Personne ne vérifie ce qui y est publié |

Every `community` entry carries the scam warning unconditionally: real help never
asks for money, card details or account credentials. That is the same sentence the
coordination worker enforces server-side, so a reader meets it whether they post
here or leave for a group we cannot see.

**A tier is not a claim about a post.** An official page can carry an out-of-date
notice, and a Facebook group can carry the most useful message of the day. The tier
says who runs the page, which is the only thing we can actually know from outside.

### Shape

`public/static/fr/relay.json`, hand-maintained, same discipline as
`evacuations.json`: a `curated_at` date, the départements covered, and per entry a
name, URL, tier, area and one line saying what a reader will find there. A build-time
check that every URL resolves, so a dead link is reported rather than shipped, and a
reachability failure marks the entry rather than dropping it — a page that is down
during a fire is a fact worth showing.

Rendered as a page reachable from the local view and the France map. No iframe, no
preview, no fetching of content. Links open in a new tab and carry `rel="noopener
noreferrer"`, because we are sending people to pages we do not control.

### Explicitly not in scope

Reading, summarising, counting or republishing anything from those pages. The moment
this tool restates a Facebook post, it has vouched for it.

## 2. What the map can offer a firefighter

### What already exists and is not linked

`public/fr/pro.html` and `public/js/pro-page.js` ship today, unlinked by design. They
state the rate of spread itself, the slope it was computed on, the sampling scale of
that slope, and the three things the model cannot see. It needs a decision to exist,
not more code.

### Three ideas assessed before designing anything

**Where the firefighters are: no.** Verified earlier and unchanged — 22 SDIS datasets
on data.gouv are budgets and boundaries, and OSM holds 4 fire stations in the whole
Gironde bbox against roughly 100 real. Unit positions are not published anywhere, and
inferring them from aircraft or radio would be guessing about people's safety.

**Windy-grade wind: we already have better.** The build fetches AROME at **1.3 km**,
Météo-France's own high-resolution model. Windy's free tier serves ECMWF and GFS at
9–13 km; AROME is what it charges for over France. The real gaps are that we hold
only 12 hours ahead and no vertical profile, and neither is fixed by adding Windy.

**Water: this is the actual gap.** 53,938 points ship across départements 64, 81, 34
plus five local registers — and Gironde has none, which is where the fires are.
Searching data.gouv for `points eau incendie` returns **7 datasets and no Gironde**.

### The water decision this forces

Two findings, in tension.

1. Two PEI registers exist that this build does not use: **Seine-Maritime (76)** and
   **Alpes-de-Haute-Provence (04)**, both published by their SDIS. Adding them is
   pure gain — same shape, same completeness, two more départements covered.

2. OpenStreetMap holds **1,077 fire hydrants** in a 0.4° × 0.7° box around the Saumos
   fire. So Gironde water is obtainable — but crowd-sourced, of unknown completeness,
   and from the same source that has 4 of ~100 fire stations.

Point 2 runs against a decision already taken: *water points ship for complete
départements rather than partial sources, because the failure mode of that layer is a
firefighter concluding there is no water.* Adding OSM hydrants as though they were a
register would reverse it silently.

**The design keeps the decision and resolves the tension the same way the relay
does — with a tier.** A source is drawn with its completeness attached:

- `register`: an SDIS or commune PEI register. Complete for its area. Absence within
  it is meaningful.
- `crowd`: OpenStreetMap. **Absence means nobody has mapped it, never that there is no
  water.** Drawn distinctly, and every count says which tier it came from.

Nothing is merged into one undifferentiated dot. A responder can tell at a glance
whether they are looking at a register or at what volunteers happened to record, and
the layer never sums the two into a single reassuring number.

### Scope

1. `relay.json` plus its page and link check.
2. Two more PEI registers, 76 and 04, into the existing water source list.
3. OSM hydrants as an explicitly tiered `crowd` source, Gironde first.
4. Link `pro.html` from the local view, behind wording that says who it is for.

## 3. Safety rules specific to this work

- **A tier describes a publisher, not a post.** Applies to both halves.
- **Absence in a crowd source is not absence of the thing.** No hydrant on the map
  means nobody mapped one. The layer says so wherever a count appears.
- **The relay vouches for nobody.** No content is read, quoted, counted or cached.
- **The scam sentence is unconditional** on every community entry, not shown only
  when something looks wrong.
- **Official beats crowd, visibly**, the same discipline as the surveyed perimeter
  against the computed hull.
- **Canada must not regress.** The water source list and the map are shared surfaces.

## 4. Testing

- A relay entry whose URL fails to resolve is marked unreachable, not dropped.
- Every `community` entry carries the scam warning; a test asserts it cannot be
  omitted by editing the data file alone.
- A tier value outside the three known ones fails the build rather than rendering
  untiered.
- Water counts are reported per tier; no code path sums register and crowd into one
  total.
- An OSM fetch failure leaves the register layer intact and says the crowd layer is
  unavailable rather than empty.
- Adding 76 and 04 does not change the count or coverage of any existing département.

## 5. Open items

- Whether the relay should carry Landes and the other fire départements from the
  start, or ship Gironde-only and grow. The link check makes breadth cheap, but every
  entry is a page somebody has to have actually looked at.
- OSM hydrant completeness in Gironde is unmeasured. 1,077 is a count, not a
  coverage figure, and the honest thing is that we do not know what fraction it is.
  The `crowd` tier exists precisely because that number cannot be established.
