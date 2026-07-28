import test from 'node:test';
import assert from 'node:assert/strict';
import { haversineKm, bearingDeg, compassPoint, pointInPolygon, pointInMultiPolygon, nearest } from '../public/js/geo.js';

const VANCOUVER = { lat: 49.2827, lon: -123.1207 };
const KAMLOOPS  = { lat: 50.6745, lon: -120.3273 };

test('haversineKm matches a known distance', () => {
  // Vancouver to Kamloops is 252.7 km great-circle (verified independently).
  assert.ok(Math.abs(haversineKm(VANCOUVER, KAMLOOPS) - 252.7) < 1);
});

test('haversineKm is zero for identical points', () => {
  assert.equal(haversineKm(VANCOUVER, VANCOUVER), 0);
});

test('bearingDeg points northeast from Vancouver to Kamloops', () => {
  const b = bearingDeg(VANCOUVER, KAMLOOPS);
  assert.ok(b > 45 && b < 90, `expected NE-ish, got ${b}`);
});

test('compassPoint maps degrees to eight points', () => {
  assert.equal(compassPoint(0), 'N');
  assert.equal(compassPoint(22), 'N');    // N sector runs 337.5 to 22.5
  assert.equal(compassPoint(23), 'NE');   // boundary into NE
  assert.equal(compassPoint(46), 'NE');
  assert.equal(compassPoint(180), 'S');
  assert.equal(compassPoint(359), 'N');   // wraps past 360 back to N
});

test('pointInPolygon detects inside and outside', () => {
  // Unit square, [lon, lat] pairs.
  const square = [[0, 0], [0, 2], [2, 2], [2, 0]];
  assert.equal(pointInPolygon({ lat: 1, lon: 1 }, square), true);
  assert.equal(pointInPolygon({ lat: 3, lon: 1 }, square), false);
});

test('pointInMultiPolygon handles holes and multiple rings', () => {
  // One polygon with an outer ring and a hole in the middle.
  const withHole = [[
    [[0, 0], [0, 4], [4, 4], [4, 0]],
    [[1, 1], [1, 3], [3, 3], [3, 1]],
  ]];
  assert.equal(pointInMultiPolygon({ lat: 0.5, lon: 0.5 }, withHole), true);
  assert.equal(pointInMultiPolygon({ lat: 2, lon: 2 }, withHole), false, 'point in hole is outside');
});

test('nearest returns the closest item and its distance', () => {
  const items = [
    { id: 'far', lat: 60, lon: -120 },
    { id: 'near', lat: 49.3, lon: -123.1 },
  ];
  const result = nearest(VANCOUVER, items);
  assert.equal(result.item.id, 'near');
  assert.ok(result.km < 5);
});

test('nearest returns null for an empty list', () => {
  assert.equal(nearest(VANCOUVER, []), null);
});
