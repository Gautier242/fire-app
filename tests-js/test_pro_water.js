// Water on the responder page, per tier.
//
// A register and a crowd source answer different questions and must never be
// added. A single total would let volunteer-mapped dots inflate a register's
// number and read as coverage, which is the failure the tiering exists to
// prevent. These tests exercise the two statements against the same zone with
// both layers populated, so a summing implementation fails here rather than
// shipping a reassuring number to somebody deciding where to draw water.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { waterStatement, crowdWaterStatement } from '../public/js/pro-page.js';

const ZONE = { id: 'gironde', lat: 44.8378, lon: -0.5792, radius_km: 50 };

// Three register points inside the radius, from a whole-département register.
const WATER = {
  coverage: [
    { dep: '33', area: 'Gironde', scope: 'departement', count: 3, tier: 'register' },
  ],
  points: [
    { id: 'r1', lat: 44.86, lon: -0.88, kind: 'PI', capacity_m3: null, dep: '33', source: 'pei', tier: 'register' },
    { id: 'r2', lat: 44.80, lon: -0.60, kind: 'PI', capacity_m3: null, dep: '33', source: 'pei', tier: 'register' },
    { id: 'r3', lat: 44.90, lon: -0.50, kind: 'PA', capacity_m3: 120, dep: '33', source: 'pei', tier: 'register' },
  ],
};

// Five crowd points inside the same radius. 3 + 5 = 8 must appear nowhere.
const HYDRANTS = {
  available: true,
  truncated: false,
  coverage: [{ dep: null, area: 'OpenStreetMap', scope: 'crowd', count: 5, tier: 'crowd' }],
  points: [1, 2, 3, 4, 5].map((n) => ({
    id: `osm-${n}`, lat: 44.85 + n / 1000, lon: -0.6, kind: null,
    capacity_m3: null, dep: null, source: 'osm', tier: 'crowd',
  })),
};

const LANGS = ['fr', 'en'];

test('the two tiers are counted separately and never summed', () => {
  for (const lang of LANGS) {
    const register = waterStatement({ zone: ZONE, water: WATER, lang });
    const crowd = crowdWaterStatement({ zone: ZONE, hydrants: HYDRANTS, lang });

    assert.equal(register.visible, 3);
    assert.equal(crowd.visible, 5);
    // The sum is the number that must not exist anywhere on this page.
    for (const { text } of [register, crowd]) {
      assert.doesNotMatch(text, /\b8\b/, `a combined total appeared in ${lang}: ${text}`);
    }
    assert.notEqual(register.text, crowd.text);
  }
});

test('a crowd point can never be counted as register coverage', () => {
  // The layers ship as separate files, but the rule is "no code path sums them",
  // not "no file mixes them". If a crowd point ever reaches water.json, the
  // register count must still be the register count.
  const polluted = { ...WATER, points: [...WATER.points, ...HYDRANTS.points] };

  const out = waterStatement({ zone: ZONE, water: polluted, lang: 'fr' });

  assert.equal(out.visible, 3, 'crowd points inflated the register count');
});

test('the crowd line says that no hydrant shown is not no water, in both languages', () => {
  const fr = crowdWaterStatement({ zone: ZONE, hydrants: HYDRANTS, lang: 'fr' });
  const en = crowdWaterStatement({ zone: ZONE, hydrants: HYDRANTS, lang: 'en' });

  assert.match(fr.text, /pas la même chose que l’absence d’eau/);
  assert.match(en.text, /not the same as no water/);
  // And it says outright that this is not a register, so the count cannot be
  // read as coverage of the zone.
  assert.match(fr.text, /pas un registre/i);
  assert.match(en.text, /not a register/i);
});

test('an empty crowd layer reads as nobody mapped one, never as no water', () => {
  for (const lang of LANGS) {
    const out = crowdWaterStatement({
      zone: ZONE, hydrants: { ...HYDRANTS, points: [], coverage: [] }, lang,
    });

    assert.equal(out.visible, 0);
    assert.equal(out.available, true);
    assert.match(out.text, lang === 'fr' ? /pas la même chose que l’absence d’eau/
      : /not the same as no water/);
  }
});

test('an unavailable crowd layer renders as unavailable, never as zero', () => {
  for (const lang of LANGS) {
    // Overpass answered 504, or the file never loaded. Both mean the same thing
    // to somebody looking for water: we could not ask, and that is not an answer.
    for (const payload of [null, { available: false, points: [], coverage: [] }]) {
      const out = crowdWaterStatement({ zone: ZONE, hydrants: payload, lang });

      assert.equal(out.visible, null, 'unavailable must not be a count');
      assert.equal(out.available, false);
      assert.doesNotMatch(out.text, /\b0\b/, `unavailable rendered as zero: ${out.text}`);
      assert.match(out.text, lang === 'fr' ? /absence d’eau/ : /absence of water/);
    }
  }
});

test('crowd points outside the radius are not counted for this zone', () => {
  const far = { ...HYDRANTS, points: [{ ...HYDRANTS.points[0], lat: 48.85, lon: 2.35 }] };

  assert.equal(crowdWaterStatement({ zone: ZONE, hydrants: far, lang: 'fr' }).visible, 0);
});

test('no statement claims the reader or the ground is safe', () => {
  // The same rule the rest of this page lives under: the strongest negative we
  // may state is about our data, never about somebody's safety.
  const texts = [];
  for (const lang of LANGS) {
    for (const payload of [HYDRANTS, null, { available: false, points: [] }]) {
      texts.push(crowdWaterStatement({ zone: ZONE, hydrants: payload, lang }).text);
    }
  }
  for (const text of texts) {
    assert.doesNotMatch(text, /en sécurité|aucun danger|safe|no danger/i, text);
  }
});

test('a missing or empty zone degrades instead of throwing', () => {
  for (const zone of [null, {}, { lat: null }]) {
    assert.doesNotThrow(() => crowdWaterStatement({ zone, hydrants: HYDRANTS, lang: 'fr' }));
  }
});

test('the page never adds a register count to a crowd count', () => {
  const source = readFileSync('public/js/pro-page.js', 'utf8');

  // A structural backstop for the behavioural tests above: an expression adding
  // the two visible counts would satisfy them only by accident of the fixture.
  assert.doesNotMatch(source, /register[\w.]*\s*\+\s*crowd|crowd[\w.]*\s*\+\s*register/i);
  assert.match(source, /crowd/, 'the page must know about the crowd tier');
});

test('both layers come from the zone file, not from the national registers', () => {
  // The registers are 9.1 MB of coordinates and this page draws no water
  // marker: every point existed to produce one sentence naming a count. The
  // build now narrows them to the zone radius, so fetching the whole file here
  // again would restore the download without changing a word on the page.
  const source = readFileSync('public/js/pro-page.js', 'utf8');

  assert.doesNotMatch(source, /data\/water\.json|data\/hydrants\.json/);
});

test('a zone written before the water keys existed reads as unknown', () => {
  // Zone files are cached in readers' browsers. Across the deploy that moved
  // the register into them, somebody holds a zone from before the key existed.
  // Undefined has to reach the same statement a failed fetch does, because the
  // alternative renders as a surveyed zero.
  for (const lang of LANGS) {
    const stale = { ...ZONE };

    const register = waterStatement({ zone: stale, water: stale.water, lang });
    const crowd = crowdWaterStatement({ zone: stale, hydrants: stale.hydrants, lang });

    assert.equal(register.visible, null, 'unknown must not be a count');
    assert.equal(crowd.visible, null, 'unknown must not be a count');
    for (const { text } of [register, crowd]) {
      assert.doesNotMatch(text, /\b0\b/, `unknown rendered as zero: ${text}`);
      assert.match(text, lang === 'fr' ? /absence d’eau/ : /absence of water/);
    }
  }
});
