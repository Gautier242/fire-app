import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessEgress, TOWARD, ACROSS, AWAY, CANNOT_ASSESS } from '../public/js/egress.js';

// One incident west of the reader, modelled to run due east — at the reader.
// Numbers chosen so the geometry can be checked by hand: at latitude 44.86 one
// degree of longitude is 78.9 km, so 0.01 deg is 789 m.
const FIRE = {
  id: 'f1', lat: 44.86, lon: -0.88,
  model: 'rothermel-1972', validated: false, fuel_model: 'FM5', hours: 3,
  arcs: [{ basis: 'mean', bearing: 90, ros_m_min: 4.4, distance_m: 800, wind_kmh: 12.9 },
         { basis: 'gust', bearing: 90, ros_m_min: 16.7, distance_m: 3000, wind_kmh: 32.0 }],
};

const READER = { lat: 44.86, lon: -0.87 };

// Runs due east from the reader, through the gust wedge (1 972 m from the fire
// on the arc bearing, inside the 3 000 m gust arc).
const EAST = { id: 1, name: 'D106', kind: 'secondary',
               points: [[44.86, -0.87], [44.86, -0.855], [44.86, -0.84]] };

// Due north/south at 14.2 km east of the fire: outside both arcs, exactly
// perpendicular to the modelled spread bearing.
const PERP = { id: 2, name: 'D5', kind: 'tertiary',
               points: [[44.82, -0.70], [44.86, -0.70], [44.90, -0.70]] };

// Runs west, on the far side of the fire, straight against the spread bearing
// and increasing its distance from the incident at every vertex.
const WEST = { id: 3, name: 'D3', kind: 'unclassified',
               points: [[44.86, -0.95], [44.86, -1.00], [44.86, -1.05]] };

const ROADS = [EAST, PERP, WEST];

function byId(out, id) {
  const road = out.roads.find((r) => r.id === id);
  assert.ok(road, `road ${id} missing from the assessment`);
  return road;
}

function strings(value, found = []) {
  if (typeof value === 'string') found.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, found);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, found);
  return found;
}

test('with no spread data every road is cannot-assess, never away', () => {
  for (const spread of [[], null, undefined,
                        // A projection that failed for want of wind carries no
                        // arcs. That is the shape fire_spread.project returns.
                        [{ id: 'f1', lat: 44.86, lon: -0.88, arcs: [], reason: 'no wind data' }]]) {
    const out = assessEgress({ point: READER, spread, roads: ROADS });
    assert.equal(out.cannotAssess, true, 'the whole assessment must declare itself unusable');
    assert.equal(out.roads.length, ROADS.length, 'roads must not be dropped silently');
    for (const road of out.roads) {
      assert.equal(road.assessment, CANNOT_ASSESS);
      assert.notEqual(road.assessment, AWAY);
      for (const dir of road.directions) assert.equal(dir.assessment, CANNOT_ASSESS);
    }
  }
});

test('no roads loaded is cannot-assess, not an empty all-clear', () => {
  for (const roads of [[], null, undefined]) {
    const out = assessEgress({ point: READER, spread: [FIRE], roads });
    assert.equal(out.cannotAssess, true);
    assert.deepEqual(out.roads, []);
    assert.match(out.reason, /road/);
  }
});

test('a missing or malformed input degrades instead of throwing', () => {
  const junk = [null, undefined, {}, { points: [] }, { points: [[44.9, -0.9]] },
                { points: [['x', 'y'], [1, 2]] }];
  assert.doesNotThrow(() => assessEgress({ point: READER, spread: [FIRE], roads: junk }));
  assert.doesNotThrow(() => assessEgress({}));
  assert.doesNotThrow(() => assessEgress({ point: { lat: null, lon: null }, spread: [FIRE], roads: ROADS }));
});

test('a road running into the gust arc is flagged as leading toward the modelled spread', () => {
  const out = assessEgress({ point: READER, spread: [FIRE], roads: ROADS });
  const road = byId(out, 1);
  assert.equal(road.assessment, TOWARD);
  const east = road.directions.find((d) => d.compass === 'E');
  assert.ok(east, 'the eastward direction of travel must be reported');
  assert.equal(east.assessment, TOWARD);
  assert.ok(east.reasons.includes('enters_modelled_arc'),
            `expected the arc-entry reason, got ${JSON.stringify(east.reasons)}`);
  // The gust arc is the one that matters: the mean arc reaches 800 m, the gust
  // arc 3 000 m, and a fire runs on the gust.
  assert.equal(east.basis, 'gust');
});

test('a road exactly perpendicular to the modelled spread is not classed as away', () => {
  const out = assessEgress({ point: READER, spread: [FIRE], roads: ROADS });
  const road = byId(out, 2);
  assert.notEqual(road.assessment, AWAY);
  assert.equal(road.assessment, ACROSS);
  assert.equal(road.directions.length, 2, 'a road joined at a middle vertex has two directions');
  for (const dir of road.directions) {
    assert.equal(dir.assessment, ACROSS);
    assert.equal(dir.deltaDeg, 90);
  }
});

test('a road running against the spread and away from the heat is the strongest positive available', () => {
  const out = assessEgress({ point: READER, spread: [FIRE], roads: ROADS });
  const road = byId(out, 3);
  assert.equal(road.assessment, AWAY);
  // And that positive is a statement about the model, not about the road.
  assert.match(road.directions[0].statement, /mod[eé]lis/i);
});

test('a road-level assessment takes the worst of its directions, never the best', () => {
  // Joined at its middle vertex 18 km northwest of the fire: northwest leads
  // away from the modelled spread, southeast runs back down it.
  const through = { id: 9, name: 'D9', kind: 'secondary',
                    points: [[45.05, -1.10], [45.00, -1.00], [44.90, -0.90]] };
  const out = assessEgress({ point: { lat: 45.00, lon: -1.005 },
                             spread: [FIRE], roads: [through] });
  const road = byId(out, 9);
  assert.equal(road.assessment, TOWARD);
  assert.deepEqual([...road.directions.map((d) => d.assessment)].sort(), [AWAY, TOWARD].sort());
});

test('a road that runs straight past the fire and out the far side is not away', () => {
  // Two vertices only, no vertex anywhere near the fire, and it passes over it.
  // A vertex-only test would call this away from the modelled spread.
  const past = { id: 8, name: 'D8', kind: 'primary',
                 points: [[44.86, -0.87], [44.86, -1.05]] };
  const out = assessEgress({ point: READER, spread: [FIRE], roads: [past] });
  const road = byId(out, 8);
  assert.equal(road.assessment, TOWARD);
  assert.ok(road.reasons.includes('closes_on_detected_heat'),
            `expected the closing reason, got ${JSON.stringify(road.reasons)}`);
  assert.ok(road.directions[0].nearestKm < 0.2,
            `the leg passes the incident at ${road.directions[0].nearestKm} km`);
});

test('every assessment derived from the model carries validated false', () => {
  const out = assessEgress({ point: READER, spread: [FIRE], roads: ROADS });
  assert.equal(out.validated, false);
  assert.equal(out.model, 'rothermel-1972');
  for (const road of out.roads) {
    assert.equal(road.validated, false);
    for (const dir of road.directions) assert.equal(dir.validated, false);
  }
  // Nothing anywhere in the payload may ever claim validation.
  const flat = JSON.stringify(out);
  assert.doesNotMatch(flat, /"validated":\s*true/);
});

test('official instructions supersede, and the payload says so', () => {
  for (const lang of ['fr', 'en']) {
    const out = assessEgress({ point: READER, spread: [FIRE], roads: ROADS, lang });
    assert.match(out.official, lang === 'fr' ? /consignes officielles/i : /official instructions/i);
    assert.match(out.caveat, /Rothermel/);
    // The single-fuel-type limit is the reason these arcs are not a prediction.
    assert.match(out.caveat, /FM5|garrigue|fuel|combustible/i);
  }
});

test('no output string is an instruction, and none asserts safety', () => {
  const outputs = [];
  for (const lang of ['fr', 'en']) {
    outputs.push(assessEgress({ point: READER, spread: [FIRE], roads: ROADS, lang }));
    outputs.push(assessEgress({ point: READER, spread: [], roads: ROADS, lang }));
    outputs.push(assessEgress({ point: READER, spread: [FIRE], roads: [], lang }));
  }
  const all = strings(outputs);
  assert.ok(all.length > 10, 'expected the copy to be present in the payload');
  for (const s of all) {
    assert.doesNotMatch(s, /\b(en s[ée]curit[ée]|sans danger|aucun danger|hors de danger|safe|no danger|out of danger)\b/i,
                        `asserts safety: ${s}`);
    // Imperatives and second-person directives, French and English.
    assert.doesNotMatch(s, /\b(prenez|empruntez|[ée]vitez|partez|fuyez|suivez|allez|utilisez|dirigez|sortez|quittez|rendez-vous)\b/i,
                        `imperative: ${s}`);
    assert.doesNotMatch(s, /^(take|go|avoid|use|drive|head|leave|follow|evacuate|do not|don't|never take)\b/i,
                        `imperative: ${s}`);
    assert.doesNotMatch(s, /\b(you should|your best|recommended|safest|best route|escape route)\b/i,
                        `recommends a route: ${s}`);
  }
});

test('the number of road segments considered is capped and the cap is reported', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({
    id: 100 + i, name: `R${i}`, kind: 'residential',
    points: [[44.86 + i * 0.001, -0.95], [44.86 + i * 0.001, -1.05]],
  }));
  const out = assessEgress({ point: READER, spread: [FIRE], roads: many, maxRoads: 5 });
  assert.equal(out.roads.length, 5);
  assert.equal(out.truncated, true);
  assert.equal(out.considered, 5);
  assert.equal(out.supplied, 40);
  // Roads that were never looked at must not be reported as anything.
  const full = assessEgress({ point: READER, spread: [FIRE], roads: many });
  assert.equal(full.truncated, false);
});

test('a road with many vertices is sampled, keeping both ends', () => {
  // 900 vertices running west from -0.95, so the far end is the true far end.
  const points = Array.from({ length: 900 }, (_, i) => [44.86, -0.95 - i * 0.00002]);
  const out = assessEgress({ point: READER, spread: [FIRE],
                             roads: [{ id: 7, name: 'long', kind: 'track', points }],
                             maxVertices: 20 });
  const road = byId(out, 7);
  assert.ok(road.verticesUsed <= 21, `sampled ${road.verticesUsed} vertices`);
  assert.ok(road.sampled, 'sampling must be declared, since it can step over an arc crossing');
  // The far end must survive sampling, or the direction of travel is wrong.
  assert.equal(road.assessment, AWAY);
  assert.equal(road.directions[0].compass, 'W');
});

test('a fire whose arcs are all zero-length cannot support an assessment', () => {
  // Rothermel returns 0 m/min above the moisture of extinction. A zero arc says
  // the model found no spread, which is not the same as spread away from here.
  const dead = { ...FIRE, arcs: [{ basis: 'mean', bearing: 90, ros_m_min: 0, distance_m: 0 },
                                 { basis: 'gust', bearing: 90, ros_m_min: 0, distance_m: 0 }] };
  const out = assessEgress({ point: READER, spread: [dead], roads: ROADS });
  assert.equal(out.cannotAssess, true);
  for (const road of out.roads) assert.equal(road.assessment, CANNOT_ASSESS);
});

test('the worst assessment across several fires wins', () => {
  // A second incident east of the reader, modelled to run west, back at them.
  const other = { id: 'f2', lat: 44.86, lon: -0.80, model: 'rothermel-1972',
                  arcs: [{ basis: 'gust', bearing: 270, ros_m_min: 10, distance_m: 4000 }] };
  const out = assessEgress({ point: READER, spread: [FIRE, other], roads: [WEST] });
  const road = byId(out, 3);
  // Away from f1's spread, but f1 is not the only fire and WEST runs with f2's.
  assert.equal(road.assessment, TOWARD);
});
