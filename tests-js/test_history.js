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

// France's trail is 168 hours, not Canada's 72, and its border cannot be
// guessed from a latitude. Both were hardcoded for Canada.
const FR_HISTORY = {
  generated_at: '2026-07-30T14:00:00Z',
  hours: 168,
  points: [
    [-0.88, 44.86, 167, 2, false],  // Gironde, newest
    [-0.90, 44.80, 143, 1, false],  // a day earlier
    [-5.41, 42.66, 167, 2, true],   // Leon, Spain: in the bbox, not in France
  ],
  wind: [],
};

test('the newest hour comes from the window length, not a hardcoded 71', () => {
  // Canada is unchanged: its window is 72 hours, so its newest hour is 71.
  assert.equal(hourToDate(HISTORY, 71).toISOString(), '2026-07-28T20:00:00.000Z');
  // France's window is 168 hours. Reading 71 as newest would date every French
  // detection 96 hours early -- a four-day-old fire shown as happening now.
  assert.equal(hourToDate(FR_HISTORY, 167).toISOString(), '2026-07-30T14:00:00.000Z');
  assert.equal(hourToDate(FR_HISTORY, 143).toISOString(), '2026-07-29T14:00:00.000Z');
});

test('a server-tagged border beats the client guess', () => {
  const passes = observedPasses(FR_HISTORY);
  const newest = pointsForPass(FR_HISTORY, passes, passes.length - 1);
  const leon = newest.find((p) => p.lon === -5.41);
  const gironde = newest.find((p) => p.lon === -0.88);
  // inCanada() would call Leon Canadian (lat 42.66 < 45 -> foreign is true by
  // luck) but Gironde French-and-foreign is the real failure: lat 44.86 < 45,
  // so the Canada heuristic flags the whole Gironde front as foreign.
  assert.equal(inCanada(-0.88, 44.86), false, 'the Canada guess misreads France');
  assert.equal(gironde.foreign, false, 'a French detection must not be faded');
  assert.equal(leon.foreign, true, 'a Spanish detection must stay flagged');
});

test('a payload with no border tag still falls back to the Canada test', () => {
  const passes = observedPasses(HISTORY);
  const oregon = pointsForPass(HISTORY, passes, 2).find((p) => p.lat === 45.5);
  assert.equal(oregon.foreign, true);
});
