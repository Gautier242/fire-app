// worker/index.js
// Needs and offers: the live half of "how can anybody help".
//
// public/js/helping.js answers this statically and safely — it never talks to a
// stranger. This does, and that is the whole risk. In a disaster a channel where
// anyone can post reaches desperate people, so the design assumption is that some
// share of submissions are scams and every one of them is unpublished until a
// human says otherwise.
//
// Nothing here deploys itself. See README.md for what running it commits you to.

export const LIMITS = {
  bodyBytes: 4096,
  textChars: 280,
  contactChars: 120,
  writesPerIpPerHour: 5,
  // Derived, not chosen: nothing reaches a public surface unreviewed, so the
  // sustained inflow this code permits must be an inflow one moderator can clear.
  // At 20 seconds to read and judge a post, 120 an hour is 40 minutes of work per
  // hour. 200 would be 67 minutes per hour — a queue that grows for as long as the
  // flood lasts. Raising this needs a second moderator, not a bigger number.
  writesPerHourGlobal: 120,
  reviewsPerHour: 600,
  recordLifetimeMs: 48 * 60 * 60 * 1000,
  readCap: 200,
};

export const KINDS = ['need', 'offer'];

export const CATEGORIES = [
  'shelter', 'water', 'food', 'transport', 'equipment', 'labour', 'medical', 'logistics',
];

// Metropolitan and overseas départements, INSEE form. Coarse location, deliberately:
// a département is enough to match an offer to a need and is not an address.
// 01-19, 21-95, 2A, 2B, 971-976. There is no departement 20 — Corsica is 2A/2B —
// and no 96 or 99, so a lazier \d\d would accept codes that do not exist.
const AREA = /^(0[1-9]|1\d|2[1-9]|[3-8]\d|9[0-5]|2A|2B|97[1-6])$/;

const RECORD = 'rec:';

// The only fields a submitter may send. Anything else is refused rather than
// dropped: a field we silently ignore is a field an attacker keeps trying, and
// `published` is in the payload shape we store.
const ACCEPTED_FIELDS = ['kind', 'category', 'area', 'text', 'contact'];

// The scam signature this system exists to keep off the map. Money moving toward
// the poster, or a credential moving toward the poster, is never part of a
// genuine offer of help — the real channels never ask for either.
const SOLICITATION = new RegExp([
  'iban', '\\brib\\b', '\\bbic\\b', 'paypal', 'revolut', 'lydia', 'paylib', 'cashapp', 'zelle',
  'bitcoin', 'crypto', 'usdt', 'virement', 'mandat cash', 'western union',
  'carte bancaire', 'numero de carte', 'numéro de carte', 'credit card', '\\bcvv\\b',
  'carte cadeau', 'gift card', 'paiement', 'payment', '\\bpayer\\b',
  'mot de passe', 'password', 'identifiant', 'france connect', 'franceconnect',
  'code de sécurité', 'code de securite', '\\b2fa\\b', 'code reçu par sms', 'code recu par sms',
].join('|'), 'i');

// A number in front of a street word. Coarse location is the whole point, and a
// submitter typing their own address is the likeliest way this system doxxes
// somebody. Street words that double as ordinary nouns — place, cour, voie —
// are deliberately absent: "4 places dans ma voiture" must go through.
const STREET_ADDRESS = /\b\d{1,4}\s*(bis|ter)?\s*(rue|avenue|av|boulevard|bd|chemin|impasse|all[eé]e|route|quai|lotissement|r[eé]sidence)\b/i;

const byteLength = (text) => new TextEncoder().encode(text).length;

const HOUR_MS = 60 * 60 * 1000;

// The storage-level TTL, so an abandoned record leaves the store on its own even
// if nobody ever reads it again. Reads do not depend on it.
const lifetimeSeconds = () => Math.ceil(LIMITS.recordLifetimeMs / 1000);

const json = (status, payload) => new Response(JSON.stringify(payload), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
});

export async function handle(request, ctx) {
  const { pathname } = new URL(request.url);
  const method = request.method.toUpperCase();
  try {
    if (pathname === '/api/submit') {
      return method === 'POST' ? await submit(request, ctx) : json(405, { error: 'method' });
    }
    if (pathname === '/api/board') {
      return method === 'GET' ? await board(request, ctx) : json(405, { error: 'method' });
    }
    if (pathname === '/api/queue') {
      return method === 'GET' ? await queue(request, ctx) : json(405, { error: 'method' });
    }
    if (pathname === '/api/review') {
      return method === 'POST' ? await review(request, ctx) : json(405, { error: 'method' });
    }
    return json(404, { error: 'no such endpoint' });
  } catch (err) {
    // Any doubt about a write ends here, before it reached storage.
    return json(503, { error: 'unavailable' });
  }
}

async function submit(request, ctx) {
  // No address means no way to hold anyone to a limit, so there is no way to
  // accept this safely.
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) return json(400, { error: 'no client address' });

  const raw = await request.text();
  if (byteLength(raw) > LIMITS.bodyBytes) return json(413, { error: 'too large' });

  let posted;
  try {
    posted = JSON.parse(raw);
  } catch {
    return json(400, { error: 'not json' });
  }
  if (posted === null || typeof posted !== 'object' || Array.isArray(posted)) {
    return json(400, { error: 'not an object' });
  }

  const refusal = refuse(posted);
  if (refusal) return json(422, { error: refusal });

  // Per address first, so one abuser spends their own allowance before the
  // channel's. Both are checked before the record is built or stored.
  if (!await within(ctx, `ip:${ip}`, LIMITS.writesPerIpPerHour)) return tooMany(ctx);
  if (!await within(ctx, 'all', LIMITS.writesPerHourGlobal)) return tooMany(ctx);

  const record = {
    // The creation time leads the id so that a store listing keys in
    // lexicographic order — which is what KV does — hands back the oldest first.
    // A 48-hour backlog can be many times the 200-record read cap, and a
    // moderator who can only ever see an arbitrary 200 of it can never drain it.
    // Thirteen digits stay fixed-width until the year 2286.
    id: `${String(ctx.now()).padStart(13, '0')}-${crypto.randomUUID()}`,
    kind: posted.kind,
    category: posted.category,
    area: posted.area,
    text: posted.text.trim(),
    contact: typeof posted.contact === 'string' ? posted.contact.trim() : '',
    published: false,
    createdAt: ctx.now(),
    expiresAt: ctx.now() + LIMITS.recordLifetimeMs,
    provenance: { via: 'public-form' },
  };
  await ctx.store.put(RECORD + record.id, record, { ttlSeconds: lifetimeSeconds() });
  return json(202, { id: record.id, published: false, expiresAt: record.expiresAt });
}

// A fixed hourly window: the counter for the current hour, incremented, refused
// once it passes the limit. Over the limit it is not written back, so a flood
// cannot inflate it further.
//
// ponytail: fixed window, so an attacker straddling the boundary gets 2x the
// allowance in a couple of minutes. A sliding window needs per-key ordering that
// eventually consistent KV cannot give; move both counters to a Durable Object if
// the burst ever matters. The same consistency limit means concurrent writes in
// different colos can undercount — the numbers below are a ceiling on sustained
// rate, not a hard cap on a simultaneous burst.
async function within(ctx, key, limit) {
  const hour = Math.floor(ctx.now() / HOUR_MS);
  const slot = `rl:${hour}:${key}`;
  const seen = await ctx.store.get(slot);
  const used = (seen && seen.n) || 0;
  if (used + 1 > limit) return false;
  await ctx.store.put(slot, { n: used + 1 }, { ttlSeconds: 2 * 3600 });
  return true;
}

function tooMany(ctx) {
  const untilNextHour = HOUR_MS - (ctx.now() % HOUR_MS);
  return new Response(JSON.stringify({ error: 'rate limit' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Retry-After': String(Math.ceil(untilNextHour / 1000)),
    },
  });
}

// Returns the reason to refuse, or null. Every doubt is a refusal: a submission
// we are unsure about is one we do not store.
function refuse(posted) {
  for (const field of Object.keys(posted)) {
    if (!ACCEPTED_FIELDS.includes(field)) return `unknown field: ${field}`;
  }
  if (!KINDS.includes(posted.kind)) return 'kind must be need or offer';
  if (!CATEGORIES.includes(posted.category)) return 'unknown category';
  if (typeof posted.area !== 'string' || !AREA.test(posted.area)) {
    return 'area must be a departement code, not a postcode or an address';
  }
  if (typeof posted.text !== 'string' || !posted.text.trim()) return 'text is required';
  if (posted.text.length > LIMITS.textChars) return 'text too long';
  if (posted.contact !== undefined) {
    if (typeof posted.contact !== 'string') return 'contact must be text';
    if (posted.contact.length > LIMITS.contactChars) return 'contact too long';
  }
  const prose = `${posted.text} ${posted.contact || ''}`;
  if (SOLICITATION.test(prose)) {
    return 'no money and no credentials: real help never asks for either';
  }
  if (STREET_ADDRESS.test(prose)) {
    return 'no street addresses: give the departement and let a moderator connect you';
  }
  return null;
}

// Expiry is decided here, against the injected clock, and not left to the store:
// KV drops a key on its own schedule and can serve one that has just fallen due.
// A record at or past its expiry is treated as absent by every read path.
const live = (record, ctx) => record && record.expiresAt > ctx.now();

// Bounded, and honest about the bound: one record past the cap is fetched purely
// to find out whether there were more. A read that silently returned 200 of 900
// would look exactly like a complete board, and on this site a partial answer
// presented as a complete one is the failure mode that matters.
async function readRecords(ctx) {
  const scanned = await ctx.store.list(RECORD, LIMITS.readCap + 1);
  const truncated = scanned.length > LIMITS.readCap;
  const records = scanned
    .slice(0, LIMITS.readCap)
    .filter((record) => live(record, ctx))
    .sort((a, b) => a.createdAt - b.createdAt);
  return { records, truncated };
}

// The public shape, built by naming the fields rather than by deleting the ones
// we do not want. A blocklist forgets the field somebody adds next year; this
// cannot leak a field nobody listed here. The contact line stays behind: a
// moderator connects the two parties, so a stranger's phone number never sits on
// a public page for anyone to harvest.
//
// provenance travels with the record on purpose. A board entry is a stranger's
// claim that a human read, and it must never be mistaken for official
// information from a mairie or a préfecture.
const publicView = (record) => ({
  id: record.id,
  kind: record.kind,
  category: record.category,
  area: record.area,
  text: record.text,
  createdAt: record.createdAt,
  publishedAt: record.publishedAt,
  expiresAt: record.expiresAt,
  provenance: record.provenance,
});

const FILTERS = ['area', 'kind', 'category'];

// Matching is this: a reader asks for the needs they can meet, in their
// departement. An unusable filter is refused rather than dropped — quietly
// ignoring ?area= would show somebody entries from the other end of France as
// though they were next door, which is worse than an error message.
function filterFrom(params) {
  for (const name of params.keys()) {
    if (!FILTERS.includes(name)) return { error: `unknown filter: ${name}` };
  }
  const wanted = {};
  if (params.has('area')) {
    const area = params.get('area');
    if (!AREA.test(area)) return { error: 'area must be a departement code' };
    wanted.area = [area];
  }
  for (const [name, vocabulary] of [['kind', KINDS], ['category', CATEGORIES]]) {
    if (!params.has(name)) continue;
    const values = params.get(name).split(',').map((v) => v.trim()).filter(Boolean);
    if (!values.length) return { error: `${name} filter is empty` };
    for (const value of values) {
      if (!vocabulary.includes(value)) return { error: `unknown ${name}: ${value}` };
    }
    wanted[name] = values;
  }
  return { wanted };
}

async function board(request, ctx) {
  const { wanted, error } = filterFrom(new URL(request.url).searchParams);
  if (error) return json(422, { error });

  const { records, truncated } = await readRecords(ctx);
  const shown = records
    .filter((r) => r.published)
    .filter((r) => Object.entries(wanted).every(([field, values]) => values.includes(r[field])))
    .map(publicView);
  return json(200, { records: shown, truncated, cap: LIMITS.readCap });
}

async function queue(request, ctx) {
  const refusal = moderatorRefusal(request, ctx);
  if (refusal) return refusal;
  const { records, truncated } = await readRecords(ctx);
  return json(200, { records: records.filter((r) => !r.published), truncated, cap: LIMITS.readCap });
}

// The human decision. Publishing is the only way onto the board; rejecting
// deletes, because there is no reason to keep a refused stranger's contact line.
async function review(request, ctx) {
  const refusal = moderatorRefusal(request, ctx);
  if (refusal) return refusal;

  // A stolen token gets an hour's worth of damage, not unlimited publishing. The
  // number is far above any human moderation rate, so it never blocks the owner.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!await within(ctx, `mod:${ip}`, LIMITS.reviewsPerHour)) return tooMany(ctx);
  if (!await within(ctx, 'mod:all', LIMITS.reviewsPerHour)) return tooMany(ctx);

  const raw = await request.text();
  if (byteLength(raw) > LIMITS.bodyBytes) return json(413, { error: 'too large' });
  let posted;
  try {
    posted = JSON.parse(raw);
  } catch {
    return json(400, { error: 'not json' });
  }
  if (!posted || typeof posted.id !== 'string' || !posted.id) return json(422, { error: 'id required' });
  if (posted.action !== 'publish' && posted.action !== 'reject') {
    return json(422, { error: 'action must be publish or reject' });
  }

  const key = RECORD + posted.id;
  const record = await ctx.store.get(key);
  if (!live(record, ctx)) return json(404, { error: 'no such record' });

  if (posted.action === 'reject') {
    await ctx.store.delete(key);
    return json(200, { id: posted.id, published: false, deleted: true });
  }

  record.published = true;
  record.publishedAt = ctx.now();
  record.provenance = { ...record.provenance, reviewedAt: ctx.now() };
  await ctx.store.put(key, record, { ttlSeconds: lifetimeSeconds() });
  return json(200, { id: posted.id, published: true });
}

// A missing token is a closed door, not an open one: an unconfigured deployment
// must not be a deployment where anybody can read a stranger's contact details.
function moderatorRefusal(request, ctx) {
  if (!ctx.moderatorToken) return json(503, { error: 'moderation not configured' });
  const header = request.headers.get('Authorization') || '';
  const offered = header.startsWith('Bearer ') ? header.slice(7) : '';
  return sameSecret(offered, ctx.moderatorToken) ? null : json(401, { error: 'moderator only' });
}

function sameSecret(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// The storage boundary, Workers KV on the other side. The only untested-against-
// reality code here: memory_store.js is the same interface for the tests, and the
// fake KV in the test file checks this adapter's shape assumptions.
export function kvStore(kv) {
  return {
    async get(key) {
      return await kv.get(key, 'json');
    },
    async put(key, value, options = {}) {
      const settings = options.ttlSeconds ? { expirationTtl: options.ttlSeconds } : {};
      await kv.put(key, JSON.stringify(value), settings);
    },
    async list(prefix, cap) {
      const { keys } = await kv.list({ prefix, limit: cap });
      const values = await Promise.all(keys.map((k) => kv.get(k.name, 'json')));
      return values.filter(Boolean);
    },
    async delete(key) {
      await kv.delete(key);
    },
  };
}

// A missing NEEDS binding makes every store call throw, which handle() turns into
// 503. That is deliberate: a misconfigured deployment must not answer reads with
// an empty board, because "nothing to report" is exactly how a broken source
// disguises itself on this site.
export default {
  async fetch(request, env) {
    return await handle(request, {
      store: kvStore(env.NEEDS),
      now: () => Date.now(),
      moderatorToken: env.MODERATOR_TOKEN,
    });
  },
};
