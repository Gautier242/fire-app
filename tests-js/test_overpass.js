import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MIN_ZOOM, buildQuery, parse } from '../public/js/overpass.js';

const BOUNDS = { south: 44.95, west: -1.12, north: 45.01, east: -1.04 };

test('the query is bounded by the viewport and asks only for what was requested', () => {
  const q = buildQuery(BOUNDS, ['building']);
  assert.ok(q.includes('44.95,-1.12,45.01,-1.04'));
  assert.ok(q.includes('building'));
  assert.ok(!q.includes('highway'), 'must not fetch roads when only buildings asked');
  assert.ok(/timeout:\d+/.test(q), 'an unbounded Overpass query is rude and slow');
});

test('buildings and roads are separated with usable geometry', () => {
  const payload = { elements: [
    { type: 'way', id: 1, tags: { building: 'house' },
      geometry: [{ lat: 44.96, lon: -1.10 }, { lat: 44.961, lon: -1.10 }, { lat: 44.961, lon: -1.101 }] },
    { type: 'way', id: 2, tags: { highway: 'residential', name: 'Rue des Pins' },
      geometry: [{ lat: 44.97, lon: -1.09 }, { lat: 44.975, lon: -1.088 }] },
  ] };

  const { buildings, roads } = parse(payload);

  assert.equal(buildings.length, 1);
  assert.equal(roads.length, 1);
  assert.equal(roads[0].name, 'Rue des Pins');
  assert.deepEqual(buildings[0].points[0], [44.96, -1.10]);
});

test('a way with no geometry is dropped rather than drawn at null', () => {
  const payload = { elements: [{ type: 'way', id: 3, tags: { building: 'yes' } }] };
  assert.equal(parse(payload).buildings.length, 0);
});

test('an unnamed road is kept, because an unnamed track is still an escape route', () => {
  const payload = { elements: [
    { type: 'way', id: 4, tags: { highway: 'track' },
      geometry: [{ lat: 44.97, lon: -1.09 }, { lat: 44.975, lon: -1.088 }] },
  ] };
  const { roads } = parse(payload);
  assert.equal(roads.length, 1);
  assert.equal(roads[0].name, null);
});

test('a malformed or empty payload returns empty lists rather than throwing', () => {
  for (const payload of [null, {}, { elements: null }, { elements: [{}] }]) {
    const out = parse(payload);
    assert.deepEqual(out.buildings, []);
    assert.deepEqual(out.roads, []);
  }
});

test('a minimum zoom is declared so a whole-country query is impossible', () => {
  // 123 buildings/km2 measured near Lacanau: a 50 km radius is ~966,000
  // buildings and a 100 km radius ~3.85 million. Neither can be loaded, so
  // buildings are bound to the viewport and gated on zoom.
  assert.ok(MIN_ZOOM >= 12);
});
