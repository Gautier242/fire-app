import test from 'node:test';
import assert from 'node:assert/strict';
import { aqhiBand, fireState } from '../public/js/status.js';

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
