import test from 'node:test';
import assert from 'node:assert/strict';
import { provinceAt, searchPlaces } from '../public/js/location.js';

const COVERAGE = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { province: 'BC' },
      geometry: { type: 'Polygon', coordinates: [[[-121, 49], [-121, 51], [-119, 51], [-119, 49]]] } },
    { type: 'Feature', properties: { province: 'AB' },
      geometry: { type: 'Polygon', coordinates: [[[-115, 49], [-115, 51], [-113, 51], [-113, 49]]] } },
  ],
};

test('provinceAt finds the containing province', () => {
  assert.equal(provinceAt({ lat: 50, lon: -120 }, COVERAGE), 'BC');
  assert.equal(provinceAt({ lat: 50, lon: -114 }, COVERAGE), 'AB');
});

test('provinceAt returns null outside every polygon', () => {
  // Fail-safe: an unknown province means the caller must say "cannot check".
  assert.equal(provinceAt({ lat: 10, lon: -60 }, COVERAGE), null);
});

const PLACES = [
  { n: 'Kamloops', p: 'BC', lat: 50.67, lon: -120.33 },
  { n: 'Kamsack', p: 'SK', lat: 51.56, lon: -101.9 },
  { n: 'Vancouver', p: 'BC', lat: 49.28, lon: -123.12 },
];

test('searchPlaces matches a name prefix, case-insensitively', () => {
  const results = searchPlaces('kam', PLACES);
  assert.deepEqual(results.map((p) => p.n), ['Kamloops', 'Kamsack']);
});

test('searchPlaces caps the number of results', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ n: `Ax${i}`, p: 'ON', lat: 45, lon: -75 }));
  assert.equal(searchPlaces('ax', many, 10).length, 10);
});

test('searchPlaces returns nothing for a query that is too short', () => {
  assert.deepEqual(searchPlaces('k', PLACES), []);
  assert.deepEqual(searchPlaces('', PLACES), []);
});
