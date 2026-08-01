// The chronology of this fire.
//
// Almost nothing upstream is dated. All 116 Gironde closures carry
// `since: null`, the evacuated communes carry no date, and FIRMS serves a
// rolling seven-day window. So this page has exactly two honest sources: the
// FIRMS trail, which really is timestamped to the hour, and our own archive,
// which only knows what it has watched. Anything before the archive starts is
// unrecorded, and the page has to say that rather than starting its story at
// whatever day it happens to hold.
import test from 'node:test';
import assert from 'node:assert/strict';

import { describeChronology, eventsBetween } from '../public/js/chronology.js';

const DAYS = [
  {
    date: '2026-08-01',
    fr: { fires: 253, closures: 52, danger: 96, evacuations: 0, stale: [] },
    gironde: { closures: 116, fire_closures: 40, evacuations: 11,
               evacuated: ['Andernos-les-Bains', 'Lège-Cap-Ferret'],
               burn_km2: 405.2, surveyed: '2026-07-29' },
    ca: { fires: 776, evacuations: 68, stale: [] },
  },
  {
    date: '2026-08-02',
    fr: { fires: 260, closures: 55, danger: 96, evacuations: 0, stale: [] },
    gironde: { closures: 120, fire_closures: 44, evacuations: 12,
               evacuated: ['Andernos-les-Bains', 'Lège-Cap-Ferret', 'Le Porge'],
               burn_km2: 431.0, surveyed: '2026-08-01' },
    ca: { fires: 770, evacuations: 66, stale: [] },
  },
];

test('a commune joining the evacuation list is an event, not a number', () => {
  const events = eventsBetween(DAYS[0], DAYS[1]);
  const added = events.find((e) => e.kind === 'evacuation-added');

  assert.ok(added, 'a new evacuated commune must surface as its own event');
  assert.deepEqual(added.communes, ['Le Porge']);
});

test('a commune leaving the list is reported as its own kind of event', () => {
  // Lifting an evacuation order is the news somebody has been waiting for, and
  // it must never be silently folded into a falling count.
  const events = eventsBetween(DAYS[1], {
    ...DAYS[0], date: '2026-08-03',
    gironde: { ...DAYS[0].gironde, evacuations: 10,
               evacuated: ['Andernos-les-Bains'] },
  });
  const lifted = events.find((e) => e.kind === 'evacuation-lifted');

  assert.ok(lifted);
  // Both of the two that dropped off the list, not just the first.
  assert.deepEqual(lifted.communes, ['Lège-Cap-Ferret', 'Le Porge']);
});

test('the burnt area is reported with the survey date, not the archive date', () => {
  // The département surveys the perimeter every few days. Dating that figure to
  // the day we happened to read it would claim a measurement nobody made.
  const events = eventsBetween(DAYS[0], DAYS[1]);
  const burn = events.find((e) => e.kind === 'burn-grew');

  assert.ok(burn);
  assert.equal(burn.km2, 431.0);
  assert.equal(burn.surveyed, '2026-08-01');
  assert.ok(Math.abs(burn.added - 25.8) < 0.01, 'the growth is stated too');
});

test('a day the feed was down produces no events at all', () => {
  // UNAVAILABLE IS NOT NONE, six months later. A gap in the record must never
  // read as eleven communes being released on a Tuesday.
  const dark = { date: '2026-08-02', fr: DAYS[1].fr, gironde: null, ca: DAYS[1].ca };

  const events = eventsBetween(DAYS[0], dark);

  assert.ok(!events.some((e) => e.kind.startsWith('evacuation')),
    'a missing feed invented an evacuation event');
  assert.ok(!events.some((e) => e.kind === 'burn-grew'));
});

test('coming back after a dark day does not report the gap as a surge', () => {
  const dark = { date: '2026-08-02', fr: DAYS[1].fr, gironde: null, ca: DAYS[1].ca };

  const events = eventsBetween(dark, { ...DAYS[1], date: '2026-08-03' });

  assert.ok(!events.some((e) => e.kind === 'burn-grew'),
    'the first reading after a gap is not growth we observed');
});

test('the chronology says how far back the record actually goes', () => {
  const out = describeChronology({ days: DAYS }, { lang: 'en' });

  assert.equal(out.first, '2026-08-01');
  assert.equal(out.days, 2);
  assert.match(out.limits, /before/i);
});

test('an empty archive says so instead of rendering an empty page', () => {
  for (const payload of [null, { days: [] }]) {
    const out = describeChronology(payload, { lang: 'en' });
    assert.equal(out.days, 0);
    assert.ok(out.limits.length > 20, 'it must explain why there is nothing');
  }
});

test('the page never claims the fire started when our record did', () => {
  // The single most misleading thing this page could do: a reader takes the
  // first row as the day the fire began.
  for (const lang of ['fr', 'en']) {
    const out = describeChronology({ days: DAYS }, { lang });
    assert.match(out.limits, lang === 'fr'
      ? /avant le 2026-08-01|ne commence pas/i
      : /before 2026-08-01|not when the fire/i);
  }
});

test('no wording anywhere says anyone is safe', () => {
  for (const lang of ['fr', 'en']) {
    const out = describeChronology({ days: DAYS }, { lang });
    const text = [out.limits, ...out.rows.flatMap((r) => r.events.map((e) => e.text))].join(' ');
    assert.doesNotMatch(text, /en sécurité|hors de danger|is safe|all clear/i, text);
  }
});
