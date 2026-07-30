import test from 'node:test';
import assert from 'node:assert/strict';
import { haversineKm, bearingDeg, compassPoint, pointInPolygon, pointInMultiPolygon, nearest, offsetPoint } from '../public/js/geo.js';

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

// A wind arrow has to point the way the wind is GOING, not where it comes from.
// Meteorology reports the direction it blows FROM, and drawing that unflipped puts
// the arrow 180 degrees wrong -- straight at the reader instead of away.
test('an arrow tip is offset along the direction the wind is blowing toward', () => {
  const from = { lat: 44.86, lon: -0.88 };

  // Wind FROM the west (270) blows toward the east: longitude must increase.
  const east = offsetPoint(from, 270 + 180, 5);
  assert.ok(east.lon > from.lon, 'a westerly must push the tip east');
  assert.ok(Math.abs(east.lat - from.lat) < 0.01, 'and barely change latitude');

  // Wind FROM the north (0) blows south: latitude must decrease.
  const south = offsetPoint(from, 180, 5);
  assert.ok(south.lat < from.lat, 'a northerly must push the tip south');

  // The offset is a real distance, not a fixed degree step.
  const near = offsetPoint(from, 90, 1);
  const far = offsetPoint(from, 90, 10);
  assert.ok(Math.abs(far.lon - from.lon) > Math.abs(near.lon - from.lon) * 5);
});

test('a bad bearing or distance yields no point rather than a wrong one', () => {
  const from = { lat: 44.86, lon: -0.88 };
  assert.equal(offsetPoint(from, null, 5), null);
  assert.equal(offsetPoint(from, 90, 0), null);
  assert.equal(offsetPoint(null, 90, 5), null);
});
