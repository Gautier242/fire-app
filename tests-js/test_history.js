import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  hourToDate, inCanada, observedPasses, passLabel, pointsForPass, windAt, windToward,
} from '../public/js/history.js';

const HISTORY = {
  generated_at: '2026-07-28T20:00:00Z',
  hours: 72,
  points: [
    [-120.0, 50.0, 24, 0],
    [-121.0, 51.0, 48, 1],
    [-122.0, 52.0, 71, 2],
    [-121.5, 45.5, 71, 1], // Oregon
  ],
  wind: [[24, 8, 0], [48, 15, 90], [71, 12, 69]],
};

test('observedPasses returns only the hours a satellite actually saw', () => {
  // 72 hours exist; 3 hold data. A slider must not offer the other 69.
  assert.deepEqual(observedPasses(HISTORY), [24, 48, 71]);
});

test('observedPasses survives an empty or missing history', () => {
  assert.deepEqual(observedPasses(null), []);
  assert.deepEqual(observedPasses({ points: [] }), []);
});

test('hour 71 is generated_at, and earlier hours step back one hour each', () => {
  assert.equal(hourToDate(HISTORY, 71).toISOString(), '2026-07-28T20:00:00.000Z');
  assert.equal(hourToDate(HISTORY, 47).toISOString(), '2026-07-27T20:00:00.000Z');
});

test('a pass carries its own points plus a short dimmed trail', () => {
  const passes = observedPasses(HISTORY);
  const newest = pointsForPass(HISTORY, passes, 2);
  assert.equal(newest.filter((p) => p.age === 0).length, 2); // both hour-71 points
  assert.equal(newest.filter((p) => p.age === 1).length, 1);
  assert.equal(newest.filter((p) => p.age === 2).length, 1);
});

test('the oldest pass shows no trail because none exists before it', () => {
  const passes = observedPasses(HISTORY);
  const oldest = pointsForPass(HISTORY, passes, 0);
  assert.equal(oldest.length, 1);
  assert.equal(oldest[0].age, 0);
});

test('points south of the border are flagged rather than dropped', () => {
  const passes = observedPasses(HISTORY);
  const newest = pointsForPass(HISTORY, passes, 2);
  assert.equal(newest.filter((p) => p.foreign).length, 1);
  assert.ok(inCanada(-120, 50));
  assert.ok(!inCanada(-121.5, 45.5));
});

test('wind is read per pass, and missing hours return null not a guess', () => {
  assert.deepEqual(windAt(HISTORY, 71), { speed: 12, direction: 69 });
  assert.equal(windAt(HISTORY, 30), null);
});

test('wind direction converts to the way it is blowing, not where it is from', () => {
  assert.equal(windToward(0), 'S');    // from the north, blowing south
  assert.equal(windToward(270), 'E');  // from the west, blowing east
  assert.equal(windToward(69), 'W');   // from 069 blows toward 249, nearest W
});

test('pass labels render in the viewer local time without crashing on bad input', () => {
  assert.ok(passLabel(HISTORY, 71).length > 0);
  assert.equal(passLabel({ generated_at: 'nonsense' }, 71), '');
  assert.equal(passLabel(null, 71), '');
});
