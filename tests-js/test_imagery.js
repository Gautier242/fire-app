// tests-js/test_imagery.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LAYERS, availableDates, tileUrl } from '../public/js/imagery.js';

test('every layer declares what it is and whether it can be dated', () => {
  assert.ok(LAYERS.length >= 4);
  for (const layer of LAYERS) {
    assert.ok(layer.id, 'layer needs an id');
    assert.ok(layer.label.fr && layer.label.en, `${layer.id} needs both languages`);
    assert.ok(layer.template.includes('{z}'), `${layer.id} needs a tile template`);
    assert.equal(typeof layer.dated, 'boolean');
  }
});

test('a dated layer gets the date substituted into its template', () => {
  const viirs = LAYERS.find((l) => l.id === 'viirs_noaa20');
  const url = tileUrl(viirs, '2026-07-27');
  assert.ok(url.includes('2026-07-27'));
  assert.ok(!url.includes('{date}'));
});

test('an undated layer ignores the date rather than corrupting its url', () => {
  // EOX Sentinel-2 cloudless is an annual composite. Passing it a date must not
  // produce a URL with a stray date in it.
  const s2 = LAYERS.find((l) => l.id === 's2cloudless');
  const url = tileUrl(s2, '2026-07-27');
  assert.ok(!url.includes('2026-07-27'));
  assert.ok(url.includes('{z}'));
});

test('available dates run backwards from today and cover three weeks', () => {
  const dates = availableDates('2026-07-29', 22);
  assert.equal(dates[0], '2026-07-29');
  assert.equal(dates.length, 22);
  assert.equal(dates.at(-1), '2026-07-08');
  // Strictly descending, no duplicates, no gaps.
  for (let i = 1; i < dates.length; i++) assert.ok(dates[i] < dates[i - 1]);
});

test('dates cross a month boundary correctly', () => {
  const dates = availableDates('2026-08-02', 4);
  assert.deepEqual(dates, ['2026-08-02', '2026-08-01', '2026-07-31', '2026-07-30']);
});

test('a thermal anomaly layer exists so past fire activity can be seen', () => {
  const thermal = LAYERS.find((l) => l.id === 'thermal');
  assert.ok(thermal, 'MODIS thermal anomalies must be selectable');
  assert.equal(thermal.dated, true);
});
