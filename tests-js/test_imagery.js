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

// "VIIRS NOAA-20 · 375 m · quotidien" is accurate and tells a member of the public
// nothing about when to pick it. Every layer carries a plain sentence saying what
// it is good for, in both languages.
test('every imagery layer says what it is for, not only what it is', () => {
  for (const layer of LAYERS) {
    for (const lang of ['fr', 'en']) {
      const why = layer.purpose && layer.purpose[lang];
      assert.ok(why, `${layer.id} has no purpose in ${lang}`);
      assert.ok(why.length > 15, `${layer.id} purpose in ${lang} is too short to help`);
      // A resolution or a sensor name is not a purpose.
      assert.ok(!/^\d|VIIRS|MODIS|Landsat|Sentinel/i.test(why),
        `${layer.id} purpose in ${lang} repeats the sensor instead of the use`);
    }
  }
});

test('a purpose never promises to show a fire that may not be visible', () => {
  for (const layer of LAYERS) {
    for (const lang of ['fr', 'en']) {
      const why = layer.purpose[lang].toLowerCase();
      assert.ok(!/\bvoir les feux\b|\bsee the fires\b/.test(why),
        `${layer.id} promises fires are visible; cloud and pass timing decide that`);
    }
  }
});
