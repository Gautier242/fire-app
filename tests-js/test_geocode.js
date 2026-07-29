import test from 'node:test';
import assert from 'node:assert/strict';
import { searchAddress } from '../public/js/geocode.js';

// One real BAN response, captured 2026-07-29 from
// data.geopf.fr/geocodage/search/?q=12+rue+de+la+Republique+Marseille&limit=2
const MARSEILLE = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [5.37367, 43.297093] },
      properties: {
        label: '12 Rue de la republique 13001 Marseille',
        score: 0.9658, housenumber: '12', id: '13201_7849_00012',
        name: '12 Rue de la republique', postcode: '13001', citycode: '13201',
        city: 'Marseille', district: 'Marseille 1er Arrondissement',
        context: "13, Bouches-du-Rhône, Provence-Alpes-Côte d'Azur",
        type: 'housenumber', importance: 0.62404, street: 'Rue de la republique',
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [5.369995, 43.301306] },
      properties: {
        label: 'Rue de la republique 13002 Marseille',
        score: 0.8031, id: '13202_7849', name: 'Rue de la republique',
        postcode: '13002', citycode: '13202', city: 'Marseille',
        context: "13, Bouches-du-Rhône, Provence-Alpes-Côte d'Azur",
        type: 'street', importance: 0.67836,
      },
    },
  ],
  query: '12 rue de la Republique Marseille',
};

// Every test replaces global fetch. Nothing here touches the network.
function stubFetch(impl) {
  const calls = [];
  global.fetch = (url, options) => {
    calls.push({ url: String(url), options });
    return impl(String(url), options);
  };
  return calls;
}

const ok = (body) => async () => ({ ok: true, status: 200, json: async () => body });

test.afterEach(() => { delete global.fetch; });

test('a query under three characters returns [] without a network call', async () => {
  const calls = stubFetch(() => { throw new Error('must not fetch'); });
  for (const q of ['', ' ', 'a', 'ma', '  m  ']) {
    assert.deepEqual(await searchAddress(q), []);
  }
  assert.equal(calls.length, 0);
});

test('a missing or non-string query returns [] without a network call', async () => {
  const calls = stubFetch(() => { throw new Error('must not fetch'); });
  assert.deepEqual(await searchAddress(undefined), []);
  assert.deepEqual(await searchAddress(null), []);
  assert.equal(calls.length, 0);
});

test('a normal result maps to label, lat, lon, postcode and city', async () => {
  stubFetch(ok(MARSEILLE));
  const results = await searchAddress('12 rue de la République, Marseille');

  assert.equal(results.length, 2);
  assert.deepEqual(results[0], {
    label: '12 Rue de la republique 13001 Marseille',
    lat: 43.297093,
    lon: 5.37367,
    postcode: '13001',
    city: 'Marseille',
  });
});

test('coordinates are read lat then lon from the GeoJSON lon,lat pair', async () => {
  stubFetch(ok(MARSEILLE));
  const [first] = await searchAddress('12 rue de la République Marseille');
  // Marseille is 43.3 N, 5.4 E. Swapped, it lands off the coast of Somalia.
  assert.ok(first.lat > 43 && first.lat < 44, `lat was ${first.lat}`);
  assert.ok(first.lon > 5 && first.lon < 6, `lon was ${first.lon}`);
});

test('the query and limit reach the request', async () => {
  const calls = stubFetch(ok(MARSEILLE));
  await searchAddress('rue de la République', { limit: 3 });
  const { url } = calls[0];
  // Percent-encoded, accents included. Verified live: BAN resolves this form.
  assert.match(url, /[?&]q=rue%20de%20la%20R%C3%A9publique(&|$)/);
  assert.match(url, /[?&]limit=3(&|$)/);
});

test('a 500 returns [] rather than throwing', async () => {
  stubFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  assert.deepEqual(await searchAddress('Marseille'), []);
});

test('a network failure returns [] rather than throwing', async () => {
  stubFetch(async () => { throw new TypeError('Failed to fetch'); });
  assert.deepEqual(await searchAddress('Marseille'), []);
});

test('malformed JSON returns [] rather than throwing', async () => {
  stubFetch(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }));
  assert.deepEqual(await searchAddress('Marseille'), []);
});

test('a response with no features returns []', async () => {
  stubFetch(ok({ type: 'FeatureCollection', features: [] }));
  assert.deepEqual(await searchAddress('zzzzzzzz'), []);
});

test('features with no usable geometry are skipped rather than returned as NaN', async () => {
  stubFetch(ok({ features: [
    { properties: { label: 'No geometry', city: 'X', postcode: '13001' } },
    { geometry: { coordinates: [] }, properties: { label: 'Empty coords' } },
    { geometry: { coordinates: [5.37, 43.29] }, properties: {} },
    ...MARSEILLE.features,
  ] }));
  const results = await searchAddress('Marseille');
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon)));
  assert.ok(results.every((r) => r.label));
});

test('an aborted request returns [] without an unhandled rejection', async () => {
  const unhandled = [];
  process.on('unhandledRejection', (e) => unhandled.push(e));

  const controller = new AbortController();
  stubFetch((url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () =>
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));

  const pending = searchAddress('Marseille', { signal: controller.signal });
  controller.abort();
  assert.deepEqual(await pending, []);

  // A user typing fast fires and cancels many of these. Give the loop a turn
  // for any stray rejection to surface before asserting none did.
  await new Promise((r) => setImmediate(r));
  process.removeAllListeners('unhandledRejection');
  assert.deepEqual(unhandled, []);
});

test('a signal already aborted returns [] and does not fetch', async () => {
  const calls = stubFetch(ok(MARSEILLE));
  assert.deepEqual(
    await searchAddress('Marseille', { signal: AbortSignal.abort() }),
    [],
  );
  assert.equal(calls.length, 0);
});
