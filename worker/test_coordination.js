// worker/test_coordination.js
// Every test runs offline against the in-memory store and an injected clock.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker, { LIMITS, handle } from './index.js';
import { memoryStore } from './memory_store.js';

const T0 = Date.UTC(2026, 6, 30, 12, 0, 0);
const TOKEN = 'test-moderator-token';

// A context whose clock only moves when a test moves it.
function ctx(overrides = {}) {
  const c = { store: memoryStore(), at: T0, moderatorToken: TOKEN, ...overrides };
  c.now = () => c.at;
  return c;
}

const OFFER = { kind: 'offer', category: 'shelter', area: '33', text: 'Deux lits libres, chiens acceptes.', contact: 'mairie de Salles, guichet' };

function post(path, body, { ip = '203.0.113.9', token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (ip) headers['CF-Connecting-IP'] = ip;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return new Request(`https://example.invalid${path}`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function get(path, { token } = {}) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return new Request(`https://example.invalid${path}`, { headers });
}

const body = async (response) => await response.json();

// Submit and review in one step, for tests about what happens after review.
async function published(c, record = OFFER) {
  const { id } = await body(await handle(post('/api/submit', record), c));
  const response = await handle(post('/api/review', { id, action: 'publish' }, { token: TOKEN }), c);
  assert.equal(response.status, 200);
  return id;
}

test('an oversized body is refused before it is even parsed', async () => {
  const c = ctx();
  const huge = JSON.stringify({ ...OFFER, text: 'a'.repeat(6000) });
  assert.ok(huge.length > LIMITS.bodyBytes);
  const response = await handle(post('/api/submit', huge), c);
  assert.equal(response.status, 413);
  assert.equal(c.store._size(), 0, 'an oversized body reached storage');
});

test('a malformed submission is rejected and persists nothing', async () => {
  const cases = {
    'not json at all': 'kind=offer&text=hello',
    'a json array': '[]',
    'no kind': { ...OFFER, kind: undefined },
    'an invented kind': { ...OFFER, kind: 'command' },
    'an invented category': { ...OFFER, category: 'weapons' },
    'no category': { ...OFFER, category: undefined },
    'empty text': { ...OFFER, text: '   ' },
    'text past the limit': { ...OFFER, text: 'a'.repeat(LIMITS.textChars + 1) },
    'a contact past the limit': { ...OFFER, contact: 'a'.repeat(LIMITS.contactChars + 1) },
    'no area': { ...OFFER, area: undefined },
    'a postcode where a departement belongs': { ...OFFER, area: '33260' },
    'an invented departement': { ...OFFER, area: '99' },
    'a non-string text': { ...OFFER, text: { fr: 'bonjour' } },
    'an unknown field': { ...OFFER, published: true },
    'a smuggled payment field': { ...OFFER, iban: 'FR7630006000011234567890189' },
  };
  for (const [name, payload] of Object.entries(cases)) {
    const c = ctx();
    const response = await handle(post('/api/submit', payload), c);
    assert.ok(response.status === 400 || response.status === 422,
      `${name} was answered ${response.status}`);
    assert.equal(c.store._size(), 0, `${name} persisted something`);
  }
});

test('a request for money or credentials is refused, in either language', async () => {
  const scams = [
    'Hebergement disponible, envoyez 200 EUR par virement pour reserver.',
    'Shelter available, send payment via PayPal first.',
    'Donnez-moi votre mot de passe France Connect et je fais la demande pour vous.',
    'Transport possible, paiement en bitcoin uniquement.',
    'Je peux vous aider, envoyez votre numero de carte bancaire.',
  ];
  for (const text of scams) {
    const c = ctx();
    const response = await handle(post('/api/submit', { ...OFFER, text }), c);
    assert.equal(response.status, 422, `not refused: ${text}`);
    assert.equal(c.store._size(), 0, `persisted: ${text}`);
  }
});

test('a street address is refused so nobody publishes their own front door', async () => {
  const c = ctx();
  const response = await handle(post('/api/submit', { ...OFFER, text: 'Venez au 12 rue des Ecoles, il y a de la place.' }), c);
  assert.equal(response.status, 422);
  assert.equal(c.store._size(), 0);
});

test('ordinary French wording that merely counts things is accepted', async () => {
  for (const text of ['J\'ai 4 places dans ma voiture.', '2 routes sont coupees, je connais un detour.', 'Piscine de 30 m3 utilisable.']) {
    const c = ctx();
    const response = await handle(post('/api/submit', { ...OFFER, text }), c);
    assert.equal(response.status, 202, `wrongly refused: ${text}`);
  }
});

test(`one address gets ${LIMITS.writesPerIpPerHour} writes an hour and no more`, async () => {
  const c = ctx();
  for (let i = 0; i < LIMITS.writesPerIpPerHour; i += 1) {
    const response = await handle(post('/api/submit', OFFER), c);
    assert.equal(response.status, 202, `write ${i + 1} of the allowance was refused`);
  }
  const overrun = await handle(post('/api/submit', OFFER), c);
  assert.equal(overrun.status, 429);
  assert.ok(overrun.headers.get('Retry-After'), 'a refusal must say when to come back');

  // The limit is per address, not a global freeze on everybody else.
  const neighbour = await handle(post('/api/submit', OFFER, { ip: '203.0.113.10' }), c);
  assert.equal(neighbour.status, 202);

  // And it lifts.
  c.at += 60 * 60 * 1000;
  assert.equal((await handle(post('/api/submit', OFFER), c)).status, 202);
});

test(`the whole channel gets ${LIMITS.writesPerHourGlobal} writes an hour, across all addresses`, async () => {
  const c = ctx();
  const perIp = LIMITS.writesPerIpPerHour;
  for (let i = 0; i < LIMITS.writesPerHourGlobal; i += 1) {
    const ip = `198.51.100.${Math.floor(i / perIp)}`;
    const response = await handle(post('/api/submit', OFFER, { ip }), c);
    assert.equal(response.status, 202, `global write ${i + 1} was refused early`);
  }
  // A fresh address with its whole personal allowance intact is still refused.
  const fresh = await handle(post('/api/submit', OFFER, { ip: '198.51.100.240' }), c);
  assert.equal(fresh.status, 429);
});

test('a submission with no client address is refused, because it cannot be rate-limited', async () => {
  const c = ctx();
  const response = await handle(post('/api/submit', OFFER, { ip: null }), c);
  assert.equal(response.status, 400);
  assert.equal(c.store._size(), 0);
});

test('the moderation queue is unreachable without the moderator token', async () => {
  const c = ctx();
  await handle(post('/api/submit', OFFER), c);

  for (const attempt of [get('/api/queue'), get('/api/queue', { token: 'wrong' })]) {
    const response = await handle(attempt, c);
    assert.equal(response.status, 401);
    const payload = await body(response);
    assert.equal(payload.records, undefined, 'an unauthenticated reader saw the queue');
  }
});

test('an unconfigured moderator token closes the queue rather than opening it', async () => {
  const c = ctx({ moderatorToken: undefined });
  await handle(post('/api/submit', OFFER), c);
  const response = await handle(get('/api/queue', { token: 'anything' }), c);
  assert.equal(response.status, 503);
});

test('a submission is accepted but not published', async () => {
  const c = ctx();
  const response = await handle(post('/api/submit', OFFER), c);
  assert.equal(response.status, 202);

  const board = await body(await handle(get('/api/board'), c));
  assert.deepEqual(board.records, [], 'a stranger reached a public surface without review');

  const queue = await body(await handle(get('/api/queue', { token: TOKEN }), c));
  assert.equal(queue.records.length, 1);
  assert.equal(queue.records[0].published, false, 'default state must be unpublished');
});

test('review is what puts a record on the board', async () => {
  const c = ctx();
  const id = await published(c);

  const board = await body(await handle(get('/api/board'), c));
  assert.equal(board.records.length, 1);
  assert.equal(board.records[0].id, id);

  const queue = await body(await handle(get('/api/queue', { token: TOKEN }), c));
  assert.deepEqual(queue.records, [], 'a reviewed record is still waiting in the queue');
});

test('a rejected record is deleted, not merely hidden', async () => {
  const c = ctx();
  const { id } = await body(await handle(post('/api/submit', OFFER), c));
  assert.equal((await handle(post('/api/review', { id, action: 'reject' }, { token: TOKEN }), c)).status, 200);

  assert.deepEqual((await body(await handle(get('/api/board'), c))).records, []);
  assert.deepEqual((await body(await handle(get('/api/queue', { token: TOKEN }), c))).records, []);
  assert.equal(await c.store.get(`rec:${id}`), null, "a refused stranger's contact line was kept");
});

test('review refuses anything but a moderator making a known decision', async () => {
  const c = ctx();
  const { id } = await body(await handle(post('/api/submit', OFFER), c));
  const cases = [
    [post('/api/review', { id, action: 'publish' }), 401],
    [post('/api/review', { id, action: 'publish' }, { token: 'wrong' }), 401],
    [post('/api/review', { id, action: 'delete-everything' }, { token: TOKEN }), 422],
    [post('/api/review', { id: 'not-a-real-id', action: 'publish' }, { token: TOKEN }), 404],
    [post('/api/review', { action: 'publish' }, { token: TOKEN }), 422],
  ];
  for (const [request, expected] of cases) {
    assert.equal((await handle(request, c)).status, expected);
  }
  // Through all of that it stayed unpublished.
  assert.deepEqual((await body(await handle(get('/api/board'), c))).records, []);
});

test(`the moderator path is itself capped at ${LIMITS.reviewsPerHour} an hour, in case the token leaks`, async () => {
  const c = ctx();
  const probe = () => handle(post('/api/review', { id: 'no-such-record', action: 'publish' }, { token: TOKEN }), c);
  for (let i = 0; i < LIMITS.reviewsPerHour; i += 1) {
    assert.equal((await probe()).status, 404, `review ${i + 1} of the allowance was refused`);
  }
  assert.equal((await probe()).status, 429);

  // Generous enough that a real moderator clearing a real queue never meets it:
  // it is a ceiling on a stolen token, not on the human.
  assert.ok(LIMITS.reviewsPerHour > LIMITS.writesPerHourGlobal);
});

test('a record disappears from every read once it expires', async () => {
  const c = ctx();
  await published(c);
  assert.equal((await body(await handle(get('/api/board'), c))).records.length, 1);

  c.at = T0 + LIMITS.recordLifetimeMs - 1;
  assert.equal((await body(await handle(get('/api/board'), c))).records.length, 1,
    'expired an hour early');

  c.at = T0 + LIMITS.recordLifetimeMs;
  assert.deepEqual((await body(await handle(get('/api/board'), c))).records, [],
    'a stale offer of shelter is worse than none');
});

test('an unreviewed record expires out of the moderation queue as well', async () => {
  const c = ctx();
  await handle(post('/api/submit', OFFER), c);
  assert.equal((await body(await handle(get('/api/queue', { token: TOKEN }), c))).records.length, 1);

  c.at = T0 + LIMITS.recordLifetimeMs;
  assert.deepEqual((await body(await handle(get('/api/queue', { token: TOKEN }), c))).records, [],
    'a moderator was asked to review something already dead');
});

test('an expired record cannot be published back into life', async () => {
  const c = ctx();
  const { id } = await body(await handle(post('/api/submit', OFFER), c));
  c.at = T0 + LIMITS.recordLifetimeMs;
  const response = await handle(post('/api/review', { id, action: 'publish' }, { token: TOKEN }), c);
  assert.equal(response.status, 404);
  assert.deepEqual((await body(await handle(get('/api/board'), c))).records, []);
});

test('a public read carries no contact, no credential and no payment field', async () => {
  const c = ctx();
  await published(c, { ...OFFER, contact: 'Marie, 06 12 34 56 78' });

  const response = await handle(get('/api/board'), c);
  const raw = await response.text();
  assert.doesNotMatch(raw, /06 12 34 56 78/, 'a phone number reached the public board');

  const { records } = JSON.parse(raw);
  assert.equal(records.length, 1);
  assert.deepEqual(Object.keys(records[0]).sort(), [
    'area', 'category', 'createdAt', 'expiresAt', 'id', 'kind', 'provenance', 'publishedAt', 'text',
  ], 'the public shape changed — every added field is a new way to leak');

  // Belt as well as braces: no field name anywhere in a public payload may look
  // like a contact detail, a credential or a payment instrument.
  const forbidden = /contact|phone|tel|email|mail|address|adresse|password|passe|token|secret|iban|rib|card|carte|payment|paiement|price|prix|amount|montant/i;
  const walk = (node, path) => {
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      assert.doesNotMatch(key, forbidden, `public field ${path}${key} looks like personal or payment data`);
      walk(value, `${path}${key}.`);
    }
  };
  walk(records[0], '');
});

test('a public read says where the entry came from, so it never reads as official', async () => {
  const c = ctx();
  await published(c);
  const { records } = await body(await handle(get('/api/board'), c));
  assert.equal(records[0].provenance.via, 'public-form');
  assert.equal(records[0].provenance.reviewedAt, T0);
  assert.equal(records[0].createdAt, T0);
});

// Matching: a reader wants the needs they can meet, near them.
async function seedBoard(c) {
  const entries = [
    { kind: 'need', category: 'shelter', area: '33', text: 'Famille de 4 cherche un toit ce soir.' },
    { kind: 'offer', category: 'shelter', area: '33', text: 'Deux lits libres.' },
    { kind: 'offer', category: 'water', area: '33', text: 'Piscine utilisable par les pompiers.' },
    { kind: 'offer', category: 'transport', area: '40', text: 'Je peux conduire deux personnes.' },
  ];
  for (const [i, entry] of entries.entries()) {
    await published(c, { ...entry, contact: 'via la mairie' });
    // Each poster gets their own address so the per-address limit stays clear of this.
    void i;
  }
}

test('the board can be filtered to what a reader can actually use', async () => {
  const c = ctx();
  await seedBoard(c);

  const only = async (query) => (await body(await handle(get(`/api/board${query}`), c))).records;

  assert.equal((await only('')).length, 4);
  assert.equal((await only('?area=33')).length, 3);
  assert.equal((await only('?area=40')).length, 1);
  assert.equal((await only('?kind=need')).length, 1);
  assert.equal((await only('?category=shelter,water')).length, 3);

  const combined = await only('?area=33&kind=offer&category=shelter');
  assert.equal(combined.length, 1);
  assert.equal(combined[0].text, 'Deux lits libres.');
});

test('an unusable filter is refused rather than quietly ignored', async () => {
  const c = ctx();
  await seedBoard(c);
  // Silently dropping a filter would show a reader entries from another
  // departement as though they were local. That is worse than an error.
  for (const query of ['?area=99', '?area=33260', '?kind=command', '?category=weapons', '?departement=33']) {
    const response = await handle(get(`/api/board${query}`), c);
    assert.equal(response.status, 422, `${query} was not refused`);
  }
});

test('a read that hit the cap says so instead of looking complete', async () => {
  // Seeded directly: the point is a store holding more than one read can return.
  const seed = [];
  for (let i = 0; i <= LIMITS.readCap; i += 1) {
    seed.push([`rec:seeded-${i}`, {
      id: `seeded-${i}`, kind: 'offer', category: 'shelter', area: '33',
      text: `offre ${i}`, contact: 'via la mairie', published: true,
      createdAt: T0, publishedAt: T0, expiresAt: T0 + LIMITS.recordLifetimeMs,
      provenance: { via: 'public-form', reviewedAt: T0 },
    }]);
  }
  const c = ctx({ store: memoryStore(seed) });

  const full = await body(await handle(get('/api/board'), c));
  assert.equal(full.records.length, LIMITS.readCap);
  assert.equal(full.truncated, true, 'a capped read presented itself as the whole board');

  // A filter narrows the cap's output, so it too may be incomplete, and says so.
  const filtered = await body(await handle(get('/api/board?area=40'), c));
  assert.deepEqual(filtered.records, []);
  assert.equal(filtered.truncated, true);
});

test('an uncapped read is not marked truncated', async () => {
  const c = ctx();
  await seedBoard(c);
  const payload = await body(await handle(get('/api/board'), c));
  assert.equal(payload.truncated, false);
  const queue = await body(await handle(get('/api/queue', { token: TOKEN }), c));
  assert.equal(queue.truncated, false);
});

// A store that answers reads but refuses writes, which is how a quota-exhausted
// or partly-broken KV namespace actually behaves.
function writeRefusingStore(seed = []) {
  const store = memoryStore(seed);
  return { ...store, put: async () => { throw new Error('KV write failed'); } };
}

test('a store that cannot write answers 503 and stores nothing', async () => {
  const c = ctx({ store: writeRefusingStore() });
  const response = await handle(post('/api/submit', OFFER), c);
  assert.equal(response.status, 503);
  assert.equal(c.store._size(), 0);
});

test('a failed publish leaves the record exactly as it was', async () => {
  const waiting = {
    id: 'waiting-1', kind: 'offer', category: 'shelter', area: '33',
    text: 'Deux lits libres.', contact: 'via la mairie', published: false,
    createdAt: T0, expiresAt: T0 + LIMITS.recordLifetimeMs, provenance: { via: 'public-form' },
  };
  const c = ctx({ store: writeRefusingStore([['rec:waiting-1', waiting]]) });

  const response = await handle(post('/api/review', { id: 'waiting-1', action: 'publish' }, { token: TOKEN }), c);
  assert.equal(response.status, 503);

  // The previous good state survived: still unpublished, still off the board.
  assert.deepEqual(await c.store.get('rec:waiting-1'), waiting);
  assert.deepEqual((await body(await handle(get('/api/board'), c))).records, []);
});

test('a store that cannot read answers 503 rather than an empty board', async () => {
  // An empty board and a broken board must never look the same to a caller.
  const c = ctx({ store: { ...memoryStore(), list: async () => { throw new Error('KV read failed'); } } });
  const response = await handle(get('/api/board'), c);
  assert.equal(response.status, 503);
  const payload = await body(response);
  assert.equal(payload.records, undefined);
});

// A stand-in for Workers KV, mimicking only the four calls the adapter makes.
// It proves the adapter's shape assumptions, not KV's behaviour.
function fakeKv() {
  const map = new Map();
  return {
    ttls: [],
    async get(key, type) {
      assert.equal(type, 'json', 'the adapter must ask KV to parse');
      const raw = map.get(key);
      return raw === undefined ? null : JSON.parse(raw);
    },
    async put(key, raw, options) {
      assert.equal(typeof raw, 'string', 'KV stores strings');
      if (options && options.expirationTtl) this.ttls.push(options.expirationTtl);
      map.set(key, raw);
    },
    async list({ prefix, limit }) {
      const keys = [...map.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit);
      return { keys: keys.map((name) => ({ name })) };
    },
    async delete(key) { map.delete(key); },
  };
}

test('the deployable entrypoint carries a submission through to the board', async () => {
  const kv = fakeKv();
  const env = { NEEDS: kv, MODERATOR_TOKEN: TOKEN };

  const accepted = await worker.fetch(post('/api/submit', OFFER), env);
  assert.equal(accepted.status, 202);
  const { id } = await body(accepted);

  const board = await body(await worker.fetch(get('/api/board'), env));
  assert.deepEqual(board.records, [], 'the entrypoint published without review');

  assert.equal((await worker.fetch(post('/api/review', { id, action: 'publish' }, { token: TOKEN }), env)).status, 200);
  const after = await body(await worker.fetch(get('/api/board'), env));
  assert.equal(after.records.length, 1);
  assert.equal(after.records[0].id, id);

  // Every stored key carries a storage TTL, so nothing lives in KV forever.
  assert.ok(kv.ttls.length >= 3);
  assert.ok(Math.max(...kv.ttls) <= LIMITS.recordLifetimeMs / 1000);
});

test('a missing KV binding fails closed instead of serving an empty board', async () => {
  // The configuration mistake this project has already shipped once: a broken
  // source rendering as "nothing to report".
  const response = await worker.fetch(get('/api/board'), { MODERATOR_TOKEN: TOKEN });
  assert.equal(response.status, 503);
});

test('the oldest waiting record is always the one a moderator can reach', async () => {
  // The read cap is 200 and a 48-hour backlog can be far larger, so which 200 a
  // read returns decides whether the queue can ever be drained. Ids carry the
  // creation time so the store's own key order is chronological.
  const c = ctx();
  const ids = [];
  for (let i = 0; i < 3; i += 1) {
    c.at = T0 + i * 1000;
    ids.push((await body(await handle(post('/api/submit', OFFER), c))).id);
  }
  assert.deepEqual([...ids].sort(), ids, 'ids must sort chronologically or FIFO is impossible');

  // And the order is not left to the store: a store handing records back newest
  // first still yields oldest first.
  const record = (n) => [`rec:${n}`, {
    id: String(n), kind: 'offer', category: 'shelter', area: '33', text: `offre ${n}`,
    contact: 'via la mairie', published: true, createdAt: T0 + n, publishedAt: T0 + n,
    expiresAt: T0 + LIMITS.recordLifetimeMs, provenance: { via: 'public-form' },
  }];
  const reversed = ctx({ store: memoryStore([record(3), record(2), record(1)]) });
  const { records } = await body(await handle(get('/api/board'), reversed));
  assert.deepEqual(records.map((r) => r.text), ['offre 1', 'offre 2', 'offre 3']);
});

test('the global write limit stays inside one moderator\'s throughput', () => {
  // The owner accepted "build it, I'll moderate" — one person. Nothing may reach
  // a public surface unreviewed, so the sustained inflow the code permits has to
  // be an inflow one human can clear, or the queue grows without bound until the
  // 48-hour expiry silently drops needs nobody ever read.
  //
  // Twenty seconds to read a short post, judge it and decide. This constant is
  // the assumption to revisit, not the arithmetic.
  const SECONDS_PER_ITEM = 20;
  const workSecondsPerHour = LIMITS.writesPerHourGlobal * SECONDS_PER_ITEM;
  assert.ok(workSecondsPerHour <= 40 * 60,
    `${LIMITS.writesPerHourGlobal} writes an hour is ${Math.round(workSecondsPerHour / 60)} `
    + 'minutes of moderation per hour; a single moderator needs it under 40');
});

test('the moderation queue is never cached, the public board briefly is', async () => {
  const c = ctx();
  await published(c);

  // The queue is the one response carrying a contact line. Nothing between the
  // moderator and the Worker may keep a copy of it.
  const queue = await handle(get('/api/queue', { token: TOKEN }), c);
  assert.match(queue.headers.get('Cache-Control'), /no-store/);

  // The board is public and read on every page load, so a short shared cache is
  // what keeps this affordable. It also bounds how long a deleted scam post can
  // survive in a cache, which is why the window is seconds and not minutes.
  const board = await handle(get('/api/board'), c);
  const cache = board.headers.get('Cache-Control');
  assert.match(cache, /max-age=(\d+)/);
  assert.ok(Number(cache.match(/max-age=(\d+)/)[1]) <= 60);

  // A refusal must never be cached as though it were the board.
  const refused = await handle(get('/api/board?area=99'), c);
  assert.equal(refused.status, 422);
  assert.match(refused.headers.get('Cache-Control') || 'no-store', /no-store/);
});

test('money words are refused even when the sentence is reassuring', async () => {
  // A deliberate false positive, recorded so it is a known choice and not a
  // surprise: "gratuit, aucun paiement demande" is a *good* signal from a
  // genuine offer, and it is still refused because it contains a money word.
  //
  // The alternative is parsing negation in two languages, which fails in the
  // dangerous direction the first time it reads "no payment needed, just send
  // 50 EUR for fuel". The refusal names the reason, so the submitter rephrases.
  const c = ctx();
  const response = await handle(post('/api/submit', { ...OFFER, text: 'Hebergement gratuit, aucun paiement demande.' }), c);
  assert.equal(response.status, 422);
  assert.match((await body(response)).error, /no money and no credentials/);
  assert.equal(c.store._size(), 0);
});
