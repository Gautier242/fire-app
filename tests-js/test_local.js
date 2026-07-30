import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeLocal } from '../public/js/local.js';

const ZONE = {
  id: 'gironde', label: 'Gironde', lat: 44.84, lon: -0.58, radius_km: 50,
  fires: [{ id: 'f1', lat: 44.86, lon: -0.88, frp_total: 3265, frp_max: 290,
            detections: 79, aircraft: 3,
            wind: { wind_kmh: 12.9, wind_toward: 'E' } }],
  wind: [{ time: '2026-07-29T18:00', wind_kmh: 12.9, gust_kmh: 32.0,
           wind_dir: 273, wind_toward: 'E', humidity_pct: 27, temp_c: 36.5 }],
  spread: [{ id: 'f1', model: 'rothermel-1972', validated: false, fuel_model: 'FM5',
             arcs: [{ basis: 'mean', bearing: 93, ros_m_min: 4.2, distance_m: 756 },
                    { basis: 'gust', bearing: 93, ros_m_min: 11.8, distance_m: 2124 }] }],
  terrain: null,
};

const NEAR = { lat: 44.87, lon: -0.85 };
const FAR = { lat: 44.40, lon: -0.20 };

test('a fire a few km away produces an urgent headline with distance and direction', () => {
  const d = describeLocal({ zone: ZONE, point: NEAR, lang: 'fr' });
  assert.equal(d.urgency, 'high');
  assert.match(d.headline, /\d+\s*km/);
});

test('the spread projection is labelled as a model and never as a measurement', () => {
  const d = describeLocal({ zone: ZONE, point: NEAR, lang: 'fr' });
  assert.ok(d.spread);
  assert.equal(d.spread.validated, false);
  assert.match(d.spread.caveat, /mod[eè]l|estimation/i);
  // Both arcs must survive to the UI: one number would imply a precision the
  // model does not have.
  assert.equal(d.spread.arcs.length, 2);
});

test('the reader is told whether the fire is coming toward them', () => {
  const d = describeLocal({ zone: ZONE, point: NEAR, lang: 'fr' });
  assert.equal(typeof d.spread.towardYou, 'boolean');
});

test('aircraft are reported as observed, never as a claim about the response', () => {
  const d = describeLocal({ zone: ZONE, point: NEAR, lang: 'fr' });
  assert.equal(d.forces.aircraft, 3);
  assert.match(d.forces.caveat, /confirm|observ/i);
  // Ground crews are not public data and the UI must say so rather than let an
  // empty count read as nobody being there.
  assert.ok(d.forces.groundUnknown);
});

test('a distant point in the same zone is not made urgent', () => {
  const d = describeLocal({ zone: ZONE, point: FAR, lang: 'fr' });
  assert.notEqual(d.urgency, 'high');
});

test('a zone with no fires still reports wind and says detection can lag', () => {
  const quiet = { ...ZONE, fires: [], spread: [] };
  const d = describeLocal({ zone: quiet, point: NEAR, lang: 'fr' });
  assert.equal(d.spread, null);
  assert.match(d.facts.map((f) => f.value).join(' '), /km\/h/);
  const all = [d.headline, ...d.facts.map((f) => `${f.label} ${f.value}`)].join(' ');
  assert.doesNotMatch(all, /en sécurité|aucun danger/i);
});

test('a missing zone degrades instead of throwing', () => {
  for (const zone of [null, {}, { fires: null }]) {
    assert.doesNotThrow(() => describeLocal({ zone, point: NEAR, lang: 'fr' }));
  }
});
