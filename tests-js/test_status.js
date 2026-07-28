import test from 'node:test';
import assert from 'node:assert/strict';
import { aqhiBand, fireState, evacuationState } from '../public/js/status.js';

test('aqhiBand uses the official Canadian bands', () => {
  assert.equal(aqhiBand(1), 'low');
  assert.equal(aqhiBand(3), 'low');
  assert.equal(aqhiBand(4), 'moderate');
  assert.equal(aqhiBand(6), 'moderate');
  assert.equal(aqhiBand(7), 'high');
  assert.equal(aqhiBand(10), 'high');
  assert.equal(aqhiBand(11), 'very_high');
});

test('aqhiBand rounds to the nearest integer like ECCC does', () => {
  assert.equal(aqhiBand(1.48), 'low');   // real observed value from the API
  assert.equal(aqhiBand(3.6), 'moderate');
  assert.equal(aqhiBand(6.5), 'high');
});

test('aqhiBand clamps values below 1 to the lowest band', () => {
  assert.equal(aqhiBand(0.2), 'low');
});

test('aqhiBand returns null for missing or unusable values', () => {
  assert.equal(aqhiBand(null), null);
  assert.equal(aqhiBand(undefined), null);
  assert.equal(aqhiBand(NaN), null);
  assert.equal(aqhiBand('7'), null);
});

const HERE = { lat: 50.0, lon: -120.0 };

test('fireState reports the nearest fire within the threshold', () => {
  const fires = [
    { id: 'a', lat: 50.09, lon: -120.0, named: true, name: 'Smith Creek' }, // ~10 km N
    { id: 'b', lat: 52.0, lon: -120.0, named: false },                      // ~222 km N
  ];
  const s = fireState({ point: HERE, fires, nearKm: 25 });
  assert.equal(s.level, 'amber');
  assert.equal(s.fire.id, 'a');
  assert.equal(s.direction, 'N');
  assert.equal(s.km, 10);
});

test('fireState is green when the nearest fire is beyond the threshold', () => {
  const fires = [{ id: 'b', lat: 52.0, lon: -120.0, named: false }];
  const s = fireState({ point: HERE, fires, nearKm: 25 });
  assert.equal(s.level, 'green');
  assert.equal(s.fire, null);
});

test('fireState is green when there are no fires at all', () => {
  const s = fireState({ point: HERE, fires: [], nearKm: 25 });
  assert.equal(s.level, 'green');
  assert.equal(s.fire, null);
});

test('fireState rounds distance to whole kilometres', () => {
  const fires = [{ id: 'a', lat: 50.045, lon: -120.0, named: false }];
  const s = fireState({ point: HERE, fires, nearKm: 25 });
  assert.equal(Number.isInteger(s.km), true);
});

// A square evacuation zone around HERE, as GeoJSON MultiPolygon coordinates.
const ZONE = [[[[-120.1, 49.9], [-120.1, 50.1], [-119.9, 50.1], [-119.9, 49.9]]]];
const ORDER = { id: 1, kind: 'order', name: 'Highway 3', polygons: ZONE };
const ALERT = { id: 2, kind: 'alert', name: 'Highway 3 north', polygons: ZONE };

test('evacuationState reports an order when the point is inside one', () => {
  const s = evacuationState({ point: HERE, evacuations: [ORDER], covered: true, stale: false });
  assert.equal(s.state, 'order');
  assert.equal(s.zone.name, 'Highway 3');
});

test('evacuationState prefers an order over an alert when both contain the point', () => {
  const s = evacuationState({ point: HERE, evacuations: [ALERT, ORDER], covered: true, stale: false });
  assert.equal(s.state, 'order');
});

test('evacuationState reports none_found only where we actually have coverage', () => {
  const far = { lat: 55, lon: -125 };
  const s = evacuationState({ point: far, evacuations: [ORDER], covered: true, stale: false });
  assert.equal(s.state, 'none_found');
});

test('SAFETY RULE: outside coverage it must never say none_found', () => {
  const alberta = { lat: 53.5, lon: -113.5 };
  const s = evacuationState({ point: alberta, evacuations: [ORDER], covered: false, stale: false });
  assert.equal(s.state, 'cannot_check');
});

test('SAFETY RULE: stale evacuation data degrades to cannot_check, never to none_found', () => {
  const far = { lat: 55, lon: -125 };
  const s = evacuationState({ point: far, evacuations: [], covered: true, stale: true });
  assert.equal(s.state, 'cannot_check');
});

test('SAFETY RULE: a stale feed still reports a zone the user is inside', () => {
  // Degrading a positive hit to "cannot check" would hide a real danger.
  const s = evacuationState({ point: HERE, evacuations: [ORDER], covered: true, stale: true });
  assert.equal(s.state, 'order');
});
