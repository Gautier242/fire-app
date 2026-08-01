// tests-js/test_imagery.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { LAYERS, availableDates, previewUrl, tileUrl, tileXY } from '../public/js/imagery.js';

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

// --- choosing a date by eye -------------------------------------------------
//
// The newest image is often the worst one: cloud, or a pass that missed. A
// reader had a bare slider and no way to tell a clear day from a cloudy one
// without scrubbing onto it. These back a contact sheet -- one small real tile
// per date -- so the choice is made by looking.

test('a month of dates is offered, not three weeks', () => {
  const dates = availableDates('2026-07-30');
  assert.equal(dates.length, 30);
  assert.equal(dates[0], '2026-07-30');
  assert.equal(dates.at(-1), '2026-07-01');
});

test('a tile always contains the point it was asked for', () => {
  // The invariant worth testing, rather than a hardcoded tile number: whatever
  // x/y we compute, the point must fall inside that tile's own bounds. A
  // swapped x/y or a missing Mercator term fails this everywhere.
  const places = [
    { lat: 44.8378, lon: -0.5792 },   // Bordeaux
    { lat: 44.0, lon: -0.7667 },      // Landes
    { lat: 51.5, lon: 0.0 },          // prime meridian
    { lat: -33.9, lon: 151.2 },       // southern, eastern
  ];
  for (const zoom of [0, 4, 8, 12]) {
    const n = 2 ** zoom;
    for (const p of places) {
      const { x, y } = tileXY(p.lat, p.lon, zoom);
      assert.ok(Number.isInteger(x) && x >= 0 && x < n, `x out of range: ${x}`);
      assert.ok(Number.isInteger(y) && y >= 0 && y < n, `y out of range: ${y}`);
      // West edge of tile x, and east edge of tile x+1.
      const west = (x / n) * 360 - 180;
      const east = ((x + 1) / n) * 360 - 180;
      assert.ok(west <= p.lon && p.lon < east, `lon ${p.lon} outside tile ${x}`);
      const latOf = (row) => {
        const t = Math.PI * (1 - 2 * row / n);
        return (180 / Math.PI) * Math.atan(Math.sinh(t));
      };
      assert.ok(latOf(y + 1) <= p.lat && p.lat <= latOf(y), `lat ${p.lat} outside tile ${y}`);
    }
  }
});

test('a preview is one real tile of the layer, at the asked-for date', () => {
  const viirs = LAYERS.find((l) => l.id === 'viirs_noaa20');
  const url = previewUrl(viirs, '2026-07-14', 44.8378, -0.5792);

  assert.ok(url.includes('2026-07-14'), 'the preview must be that date, not today');
  for (const placeholder of ['{z}', '{x}', '{y}', '{date}']) {
    assert.ok(!url.includes(placeholder), `${placeholder} was left unsubstituted`);
  }
  assert.ok(url.startsWith('https://'));
});

test('a preview keeps the tile axes the layer template asked for', () => {
  // GIBS writes /{z}/{y}/{x} and most other services write /{z}/{x}/{y}. A
  // substitution that ignores the order silently previews the wrong ground,
  // which is worse than no preview: the reader picks a date on a lie.
  const fake = {
    id: 'fake', dated: true,
    template: 'https://example.test/{z}/{y}/{x}.png?d={date}',
  };
  const { x, y } = tileXY(44.8378, -0.5792, 8);

  assert.equal(previewUrl(fake, '2026-07-14', 44.8378, -0.5792),
    `https://example.test/8/${y}/${x}.png?d=2026-07-14`);
});

test('an undated layer has no contact sheet to offer', () => {
  // An annual composite is the same picture on all thirty days. Thirty
  // identical thumbnails would invite a reader to choose between them.
  const s2 = LAYERS.find((l) => l.id === 's2cloudless');
  assert.equal(previewUrl(s2, '2026-07-14', 44.8378, -0.5792), '');
});

test('a tile that never arrived is never rendered as clear sky', () => {
  // The one rendering this cannot use is blank white: that is what a cloudless
  // morning looks like, so a reader would pick the single day nobody looked.
  // The page marks those thumbnails and the stylesheet hatches them.
  const page = readFileSync('public/js/local-page.js', 'utf8');
  const css = readFileSync('public/css/app.css', 'utf8');

  assert.match(page, /image\.onerror/, 'a failed preview must be caught');
  assert.match(page, /classList\.add\('nopass'\)/, 'and marked');
  assert.match(css, /\.film button\.nopass .thumb\s*\{[^}]*repeating-linear-gradient/,
    'and hatched, so it cannot read as a clear day');
});

test('the imagery copy tells a reader to choose against cloud', () => {
  // The whole point of the contact sheet: the newest pass is often the worst.
  const page = readFileSync('public/js/local-page.js', 'utf8');
  assert.match(page, /nuages|dégagée/, 'the French copy must mention cloud');
  assert.match(page, /cloud/, 'and the English copy');
});

// --- what each sensor actually gives you ------------------------------------

test('every layer states its resolution and how often it looks', () => {
  // "VIIRS NOAA-20 · 375 m · quotidien" crams three facts into a dropdown line.
  // Resolution and revisit are the two that decide whether a layer can answer
  // the question being asked, so they are their own fields and get their own
  // line in the panel.
  for (const layer of LAYERS) {
    assert.ok(layer.resolution, `${layer.id} must state its ground resolution`);
    assert.match(layer.resolution, /\d/, `${layer.id} resolution needs a number`);
    for (const lang of ['fr', 'en']) {
      const revisit = layer.revisit && layer.revisit[lang];
      assert.ok(revisit, `${layer.id} must say how often it looks, in ${lang}`);
      assert.ok(revisit.length > 8, `${layer.id} revisit in ${lang} is too terse`);
    }
  }
});

test('an undated layer never claims a revisit that implies it is current', () => {
  // The annual composite and the IGN orthophoto are the two a reader is most
  // likely to mistake for today. Their revisit line has to say so itself,
  // because it sits next to six layers that genuinely are dated.
  for (const layer of LAYERS.filter((l) => !l.dated)) {
    for (const lang of ['fr', 'en']) {
      assert.match(layer.revisit[lang], /composite|annuel|annual|campagne|flown|20\d\d|ans|years/i,
        `${layer.id} revisit in ${lang} must say it is not today's picture`);
    }
  }
});
