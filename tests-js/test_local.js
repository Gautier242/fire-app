import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeLocal, officialNear } from '../public/js/local.js';

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

// A département's feed covers its own ground. Showing it to a reader outside that
// ground is worse than showing nothing: on 2026-07-30 the Landes zone page rendered
// "236 routes coupées publiées par le Département de la Gironde", which invites
// somebody 80 km away to believe roads near them are shut.
test('official data is narrowed to what is near the reader', () => {
  const feed = {
    available: true,
    source: 'Département de la Gironde',
    covers: ['33'],
    closures: [
      { road: 'D807', fire_related: true,
        geometry: { type: 'LineString', coordinates: [[-0.88, 44.86], [-0.87, 44.87]] } },
      { road: 'D1', fire_related: false,
        geometry: { type: 'LineString', coordinates: [[2.21, 48.82], [2.22, 48.83]] } },
    ],
    evacuations: [
      { name: 'Lacanau', geometry: { type: 'Polygon',
        coordinates: [[[-1.08, 44.97], [-1.06, 44.97], [-1.06, 44.99], [-1.08, 44.97]]] } },
    ],
    burn_area: { observed: true, area_km2: 405.2, surveyed: '2026-07-27',
      geometry: { type: 'Polygon',
        coordinates: [[[-1.1, 44.8], [-0.9, 44.8], [-0.9, 45.0], [-1.1, 44.8]]] } },
  };

  // A reader in Bordeaux is inside the coverage.
  const near = officialNear(feed, { lat: 44.84, lon: -0.58 }, 50);
  assert.equal(near.covered, true);
  assert.equal(near.closures.length, 1, 'the Paris closure is not near Bordeaux');
  assert.equal(near.closures[0].road, 'D807');
  assert.equal(near.evacuations.length, 1);
  assert.ok(near.burn_area, 'the perimeter overlaps this reader');

  // A reader in the Landes, 80 km south, is outside it.
  const far = officialNear(feed, { lat: 44.0, lon: -0.77 }, 50);
  assert.equal(far.covered, false, 'nothing of this feed is near a Landes reader');
  assert.deepEqual(far.closures, []);
  assert.deepEqual(far.evacuations, []);
  assert.equal(far.burn_area, null);
});

test('an unavailable feed stays unavailable rather than becoming empty', () => {
  const out = officialNear(false, { lat: 44.84, lon: -0.58 }, 50);
  assert.equal(out.available, false);
  assert.equal(out.covered, false);
  // The caller must be able to tell "could not ask" from "nothing near you".
  assert.deepEqual(out.closures, []);
  assert.equal(officialNear(null, { lat: 44.84, lon: -0.58 }, 50).available, false);
});
