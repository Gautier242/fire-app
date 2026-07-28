import test from 'node:test';
import assert from 'node:assert/strict';
import { aqhiBand } from '../public/js/status.js';

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
