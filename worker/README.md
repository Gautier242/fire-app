# Needs and offers — the live half of "how can anybody help"

A Cloudflare Worker matching what people can offer (shelter, water, food,
transport, equipment, labour, medical, logistics) against what is needed, by
département.

**This is not deployed, and deploying it is a decision with an ongoing cost.**
Read §4 before deciding. There is deliberately no `wrangler.toml` in this
directory: adding one, with a real KV namespace id in it, is the first step of
deploying, and that step is the owner's to take.

`public/js/helping.js` already ships the static half — a skill-to-action mapping
that never talks to a stranger. This is the half that does, and that is the whole
risk. In a disaster, a channel where anyone can post reaches people who are
frightened and in a hurry, which is precisely the audience a scam wants.

## 1. What it is

| Endpoint | Who | What |
|---|---|---|
| `POST /api/submit` | anyone | A need or an offer. Stored **unpublished**. |
| `GET /api/board` | anyone | Published, unexpired records. Filterable. |
| `GET /api/queue` | moderator | Everything awaiting review, oldest first. |
| `POST /api/review` | moderator | `publish` or `reject` one record. |

A record is `kind` (need/offer), `category`, `area` (département code), `text`
(≤ 280 chars) and an optional `contact` line (≤ 120 chars). Nothing else is
accepted — a payload with a sixth field is refused rather than trimmed.

Board filters: `?area=33&kind=need&category=shelter,water`. An unusable filter
value is a 422, never a silently wider result, because a reader shown entries from
the other end of France as though they were local is worse off than one shown an
error.

### Design rules the tests hold

- **Nothing a stranger writes reaches a public surface unreviewed.** Default state
  is `published: false`; the only route onto the board is a human decision.
- **The contact line never appears in a public read.** The public shape is built
  from a nine-field allowlist, so a field added later cannot leak by default. The
  moderator connects the two parties.
- **Coarse location only.** Département, not commune, not address. Free text
  containing a street address is refused, so a submitter cannot publish their own
  front door by accident.
- **No credentials, no payments, ever.** Text soliciting either is refused
  outright. That is the scam signature this system exists to keep off the map.
- **Everything expires.** 48 hours, enforced on read against an injected clock. A
  stale offer of shelter is worse than none: somebody drives to a house that
  filled up yesterday.
- **Every record carries provenance.** `{ via: 'public-form', reviewedAt }` travels
  into the public view on purpose, so a board entry is never mistaken for
  information from a mairie or a préfecture.
- **Fail closed everywhere.** A store that cannot answer returns 503, never an
  empty list. An empty board and a broken board must not look the same, for the
  same reason absence of detection is never absence of fire.
- **Bounded and honest about it.** Reads cap at 200 records and say
  `truncated: true` when they hit it.

## 2. The limits, and why those numbers

All in `LIMITS` in `index.js`, all asserted at those exact values in the tests.

| Limit | Value | Why |
|---|---|---|
| Writes per address per hour | 5 | Enough to post a need, an offer and a correction. |
| Writes per hour, whole channel | **120** | Derived — see below. |
| Reviews per hour | 600 | Bounds a leaked moderator token; far above human pace. |
| Body size | 4 KB | Checked before parsing. |
| Record life | 48 h | |
| Records per read | 200 | One KV `list` page holds up to 1,000, so this fits. |

**The global limit is the one number that matters.** Since nothing is published
without review, the sustained inflow the code permits has to be inflow one person
can clear:

```
120 submissions/hour × 20 s to read and judge each = 40 minutes of work per hour
200 submissions/hour × 20 s                        = 67 minutes of work per hour
```

At 200 an hour the queue grows for as long as the flood lasts, so the limit is
120. A test fails if anyone raises it past one moderator's throughput. Raising it
means recruiting a second moderator, not editing a constant.

The 20-second figure is the assumption to argue with; the arithmetic follows from
it.

**Accepted cost:** at the peak of a serious incident, genuine posts get refused
with `Retry-After`. A refused post is recoverable — the person tries again in an
hour, or phones the mairie. An unreviewable queue is not: needs expire unread and
nobody ever learns they went unanswered.

**Known ceiling.** The window is fixed, not sliding, so an attacker straddling the
boundary gets roughly double the allowance in a couple of minutes. Worse, KV
allows **one write per second to the same key** (verified in Cloudflare's docs),
and both counters are single keys, so a simultaneous burst can undercount. These
numbers bound the *sustained* rate, which is what moderation load depends on. If
burst accuracy ever matters, the counters move to a Durable Object.

## 3. Running the tests

No dependencies, no build step, no network. The storage boundary has an in-memory
implementation (`memory_store.js`) and the clock is injected, so every test is
deterministic.

```
node --test worker/test_*.js
```

The repo's CI currently runs `node --test tests-js/*.js`, which does **not** match
this directory. See the handover note: one line in `.github/workflows/test.yml`
needs to change, and it is not this agent's file to edit.

## 4. What deploying this would commit you to

### 4.1 Money and infrastructure

The Workers **free tier cannot carry an incident**, verified against Cloudflare's
limits page:

| Free tier | Limit | What this Worker does |
|---|---|---|
| KV writes per day | **1,000** | A published submission costs **4 writes** (two rate counters, the record, the review). So ~250 published items/day, against a code limit of 2,880. |
| KV reads per day | **100,000** | One uncached board read is 1 `list` + up to 200 `get`s = **201 reads**, so ~497 uncached board loads/day. |
| Worker requests per day | 100,000 | Fine. |

So: **Workers Paid, $5/month minimum**, plus metered KV beyond the included
allowance. The board response carries `max-age=30` to keep repeat reads off KV; if
read volume ever actually bites, the fix is `caches.default` inside the Worker or
one denormalised board blob rewritten on each publish.

You also create a **KV namespace holding other people's personal data**, and a
`MODERATOR_TOKEN` secret which is a single shared password with no rotation
mechanism. Anyone holding it can publish anything to the board, capped at 600
items an hour.

### 4.2 The moderation load, per day

The code's own ceiling: `120/hour × 24 = 2,880 submissions/day`, which at 20
seconds each is **16 hours of moderation in a day**. That is the worst case you
are signing up for, not a projection.

A plausible incident, on this repo's own verified figures — 17 active fires in
Gironde (33) and Landes (40) on 2026-07-30, 111 of 304 bbox detections inside
France. Assume 30,000 people displaced over three days (the July 2022 Gironde
fires are widely reported around 37,000 evacuated; that figure was **not**
verified in this session, so 30,000 is used as a round, conservative stand-in):

| Share who post | Submissions | Moderation at 20 s | Per day, over 3 days |
|---|---|---|---|
| 0.5% | 150 | 50 min | 17 min |
| 2% | 600 | 3 h 20 | 1 h 7 |
| 5% | 1,500 | 8 h 20 | 2 h 47 |

Two things this table hides:

1. **Rejections cost the same as approvals.** Assume a third of submissions in a
   disaster are scams or spam: in the 5% row that is 500 posts to read and refuse.
   The refusal rules catch the crude ones for free; the plausible ones need a human.
2. **Arrival is not flat.** If half of the 5% row arrives in the first four hours,
   that is 188/hour against a 120/hour limit, and genuine posts get refused during
   exactly the hours they matter most.

At 5% participation this is **an hour before work, an hour at lunch and an hour in
the evening, for three days.** If that is not available, the honest options are a
lower global limit, a second moderator, or not deploying this.

### 4.3 Obligations that are not code

- **A human on call.** A need posted at 02:00 sits unpublished until somebody
  wakes up. The channel must never be presented as an emergency route: 112/18 is
  the emergency route, and this is for logistics around it.
- **Legal.** You become the controller of personal data (contact lines) for EU
  residents. The 48-hour expiry is the retention control. There is **no
  self-service withdrawal**: a submitter cannot delete their own post, so erasure
  requests come to you and you action them through `reject`. That was a deliberate
  choice — a withdraw endpoint needs a per-record secret, and a guessable one
  becomes a way to delete other people's genuine offers.
- **Deletion is an operational duty, not just a legal one.** Someone whose spare
  room fills up has no way to take the offer down themselves for up to 48 hours.
- **A published board entry carries your site's authority** whatever the
  provenance field says. The frontend has to make "a stranger wrote this, a human
  read it, nobody verified it" unmissable.

## 5. Deliberately not built

- **Accounts, verified identity, reputation.** Would need a whole auth system to
  make a channel that is already gated by human review slightly better gated.
- **Skill-to-category mapping.** `public/js/helping.js` owns the skill vocabulary;
  a second copy here would drift with nothing able to catch it. The caller maps
  skills to `?category=` values.
- **Geocoding, distance matching, notifications.** Département filtering is enough
  to match an offer to a need, and every one of those adds an I/O boundary.
- **A DM channel between parties.** The moderator brokering the introduction is
  what keeps a contact line off a public page.
