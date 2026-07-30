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
const AREA = /^(0[1-9]|[1-9]\d|2A|2B|97[1-6])$/;

const RECORD = 'rec:';

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
  let posted;
  try {
    posted = JSON.parse(raw);
  } catch {
    return json(400, { error: 'not json' });
  }

  const record = {
    id: crypto.randomUUID(),
    kind: posted.kind,
    category: posted.category,
    area: posted.area,
    text: posted.text,
    contact: posted.contact,
    published: false,
    createdAt: ctx.now(),
    expiresAt: ctx.now() + LIMITS.recordLifetimeMs,
    provenance: { via: 'public-form' },
  };
  await ctx.store.put(RECORD + record.id, record);
  return json(202, { id: record.id, published: false });
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
