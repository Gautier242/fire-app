// Guards the province-coverage data file itself, not just the lookup code.
// A previous build produced 712 features with geometry: null and passed every
// count-based check, which would have told every user in Canada that we cannot
// check their province while looking like it worked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { provinceAt } from '../public/js/location.js';

const COVERAGE = JSON.parse(readFileSync('public/static/coverage.geojson', 'utf8'));

const PROVINCE_CODES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'];

test('every feature has real geometry', () => {
  for (const feature of COVERAGE.features) {
    assert.ok(feature.geometry, 'feature has null geometry');
    assert.ok(feature.geometry.coordinates.length > 0);
  }
});

test('all thirteen provinces and territories are represented', () => {
  const present = new Set(COVERAGE.features.map((f) => f.properties.province));
  assert.deepEqual([...present].sort(), PROVINCE_CODES);
});

test('coordinates are longitude/latitude, not projected metres', () => {
  for (const feature of COVERAGE.features) {
    const [lon, lat] = feature.geometry.coordinates[0][0][0];
    assert.ok(lon >= -141 && lon <= -52, `lon out of range: ${lon}`);
    assert.ok(lat >= 41 && lat <= 84, `lat out of range: ${lat}`);
  }
});

test('every feature carries a bbox for the coastal fallback', () => {
  for (const feature of COVERAGE.features) {
    assert.equal(feature.properties.bbox.length, 4);
  }
});

test('known cities resolve to the right province', () => {
  const cities = [
    ['Vancouver', 49.2827, -123.1207, 'BC'],   // 1.3 km offshore of the generalized coast
    ['Kamloops', 50.6745, -120.3273, 'BC'],
    ['Lytton', 50.2316, -121.5824, 'BC'],
    ['Edmonton', 53.5461, -113.4938, 'AB'],
    ['Fort McMurray', 56.7264, -111.3803, 'AB'],
    ['Toronto', 43.6532, -79.3832, 'ON'],
    ['Montreal', 45.5017, -73.5673, 'QC'],
    ['Winnipeg', 49.8951, -97.1384, 'MB'],
    ['Saskatoon', 52.1332, -106.6700, 'SK'],
    ['Yellowknife', 62.4540, -114.3718, 'NT'],
    ['Whitehorse', 60.7212, -135.0568, 'YT'],
    ['Halifax', 44.6488, -63.5752, 'NS'],      // 1.2 km offshore
  ];
  for (const [name, lat, lon, expected] of cities) {
    assert.equal(provinceAt({ lat, lon }, COVERAGE), expected, `${name} resolved wrongly`);
  }
});

test('a point far outside Canada resolves to null, not a guess', () => {
  assert.equal(provinceAt({ lat: 10, lon: -60 }, COVERAGE), null);
  assert.equal(provinceAt({ lat: 40.7, lon: -74.0 }, COVERAGE), null); // New York
});
