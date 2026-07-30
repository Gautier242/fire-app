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
  writesPerHourGlobal: 200,
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
      return method === 'GET' ? await board(ctx) : json(405, { error: 'method' });
    }
    if (pathname === '/api/queue') {
      return method === 'GET' ? await queue(request, ctx) : json(405, { error: 'method' });
    }
    return json(404, { error: 'no such endpoint' });
  } catch (err) {
    // Any doubt about a write ends here, before it reached storage.
    return json(503, { error: 'unavailable' });
  }
}

async function submit(request, ctx) {
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

  const record = {
    id: crypto.randomUUID(),
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
  await ctx.store.put(RECORD + record.id, record);
  return json(202, { id: record.id, published: false });
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

async function readRecords(ctx) {
  return await ctx.store.list(RECORD, LIMITS.readCap);
}

async function board(ctx) {
  const records = (await readRecords(ctx)).filter((r) => r.published);
  return json(200, { records });
}

async function queue(request, ctx) {
  const refusal = moderatorRefusal(request, ctx);
  if (refusal) return refusal;
  const records = (await readRecords(ctx)).filter((r) => !r.published);
  return json(200, { records });
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
