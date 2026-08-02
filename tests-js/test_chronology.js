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

// --- days we only have satellite for -----------------------------------------

// The archive began on 1 August. The satellite detections reach further back,
// because FIRMS timestamps them, so the record has two kinds of day in it and
// they must not be shown as the same thing.
const MIXED = {
  first: '2026-07-23',
  last: '2026-08-01',
  days: [
    { date: '2026-07-23', fr: null, ca: null, gironde: null,
      observed: { detections: 65, partial: true } },
    { date: '2026-07-24', fr: null, ca: null, gironde: null,
      observed: { detections: 1705, partial: false } },
    { date: '2026-08-01',
      fr: { generated_at: '2026-08-01T07:21:07Z', fires: 119, closures: 54,
            danger: 96, evacuations: 0, stale: [] },
      ca: { generated_at: '2026-08-01T07:21:02Z', fires: 755, evacuations: 70, stale: [] },
      gironde: { closures: 119, fire_closures: 16, evacuations: 8,
                 evacuated: ['Lacanau'], burn_km2: 405.2, surveyed: '2026-07-27' } },
  ],
};

test('a satellite-only day is not reported as a feed that failed', () => {
  const out = describeChronology(MIXED, { lang: 'fr' });
  const row = out.rows.find((r) => r.date === '2026-07-23');

  assert.equal(row.kind, 'observed');
  // The gap sentence blames the departement's feed for being down. On these days
  // we were not reading it at all, which is a different fact about a different
  // thing, and saying the wrong one invents an outage.
  for (const line of row.state) {
    assert.ok(!/indisponible/.test(line), `must not claim an outage: ${line}`);
  }
  assert.ok(row.state.some((s) => /65/.test(s)), 'the count is the whole content');
});

test('a partial day says so, so a low count is not read as a quiet one', () => {
  const out = describeChronology(MIXED, { lang: 'fr' });
  const partial = out.rows.find((r) => r.date === '2026-07-23');
  const whole = out.rows.find((r) => r.date === '2026-07-24');

  assert.equal(partial.partial, true);
  assert.equal(whole.partial, false);
  assert.ok(partial.state.some((s) => /partielle/i.test(s)));
});

test('a recorded day still reads as a recorded day', () => {
  const out = describeChronology(MIXED, { lang: 'fr' });
  const row = out.rows.find((r) => r.date === '2026-08-01');

  assert.equal(row.kind, 'recorded');
  assert.ok(row.state.some((s) => /Lacanau/.test(s)));
});

// The two starts are different dates and mean different things. Collapsing them
// into one "the record begins on" sentence would date the archive to a day it
// was not keeping anything.
test('the limits separate when we started recording from how far the satellite reaches', () => {
  const out = describeChronology(MIXED, { lang: 'fr' });

  assert.ok(out.limits.includes('2026-08-01'), 'the record begins when it begins');
  assert.ok(out.observedFrom === '2026-07-23');
  assert.ok(/sept jours|FIRMS/.test(out.limits),
    'and why nothing exists before that: the feed keeps seven days');
});

test('English says the same things', () => {
  const out = describeChronology(MIXED, { lang: 'en' });
  const row = out.rows.find((r) => r.date === '2026-07-23');

  assert.equal(row.kind, 'observed');
  assert.ok(row.state.some((s) => /partial/i.test(s)));
});

// The page is about one fire. France's total moves with this fire while hiding
// it -- the Gironde is roughly half the country's detections right now -- so a
// national figure here would be both redundant and misleading.
test('the record reports the zone, never the country', () => {
  for (const lang of ['fr', 'en']) {
    const out = describeChronology(MIXED, { lang });
    const text = out.rows.flatMap((r) => r.state).join(' ');
    assert.ok(!/France|across France|en France/.test(text),
      `no national count belongs on this page: ${text}`);
  }
});

// A feed that does not carry fire counts must not be read as counting none. The
// archived zone payload is the roads-and-evacuations one; it has no fires key.
test('a day whose feed never counted fires does not report zero fires', () => {
  const noCount = { days: [{ date: '2026-08-01', fr: null, ca: null,
    gironde: { closures: 105, fire_closures: 10, evacuations: 3,
               evacuated: ['Lacanau'], burn_km2: 405.2, surveyed: '2026-07-27',
               fires: null } }] };

  const row = describeChronology(noCount, { lang: 'fr' }).rows[0];

  assert.ok(row.state.some((s) => /pas zéro|non relevé/i.test(s)),
    'absence has to be said, not shown as a zero');
  assert.ok(!row.state.some((s) => /^0 foyer/.test(s)));
});

// The closures are the only feed that reaches further back than the satellite
// window, on the minority of rows that carry a start date. 22 July has closures
// and no detections at all.
const WITH_CLOSURES = { days: [
  { date: '2026-07-22', fr: null, ca: null, gironde: null,
    observed: { detections: null, partial: false, closed: ['D107', 'D3'] } },
  { date: '2026-07-23', fr: null, ca: null, gironde: null,
    observed: { detections: 65, partial: true, closed: ['D807'] } },
] };

test('a day with closures and no detections says both, and neither as silence', () => {
  const rows = describeChronology(WITH_CLOSURES, { lang: 'fr' }).rows;
  const first = rows.find((r) => r.date === '2026-07-22');

  assert.ok(first.state.some((s) => /D107/.test(s) && /D3/.test(s)), 'names the roads');
  // A day before our observation window is not a day nothing burned.
  assert.ok(first.state.some((s) => /pas l'absence de feu/i.test(s)),
    'absence of detections must be stated, not left blank');
  assert.ok(!first.state.some((s) => /^0 détection/.test(s)));
});

test('a day with both carries both', () => {
  const row = describeChronology(WITH_CLOSURES, { lang: 'fr' }).rows
    .find((r) => r.date === '2026-07-23');

  assert.ok(row.state.some((s) => /D807/.test(s)));
  assert.ok(row.state.some((s) => /65/.test(s)));
});
