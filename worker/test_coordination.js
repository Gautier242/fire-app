// worker/test_coordination.js
// Every test runs offline against the in-memory store and an injected clock.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIMITS, handle } from './index.js';
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
