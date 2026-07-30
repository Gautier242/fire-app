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
