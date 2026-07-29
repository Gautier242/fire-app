import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeFr, DANGER_LABELS } from '../public/js/rail-fr.js';

const SUMMARY = {
  generated_at: '2026-07-29T12:00:00Z',
  country: 'fr',
  sources: [{ id: 'mdf', ok: true, stale: false, fetched_at: '2026-07-29T12:00:00Z' }],
  coverage: [{ country: 'FR', evacuations: false, alert_channel: 'FR-Alert',
               official_url: 'https://www.interieur.gouv.fr/Alerte/FR-Alert' }],
  danger: [
    { dep: '83', name: 'Var', level_today: 4, level_tomorrow: 3 },
    { dep: '29', name: 'Finistère', level_today: 1, level_tomorrow: 1 },
  ],
  air_quality: [
    { id: '83137', lat: 43.12, lon: 5.93, name: { fr: 'Toulon' }, value: 3, pm25: 2 },
  ],
};

const TOULON = { lat: 43.12, lon: 5.93, dep: '83' };
const BREST = { lat: 48.39, lon: -4.48, dep: '29' };

test('the headline is the official danger level for the departement', () => {
  const d = describeFr({ summary: SUMMARY, point: TOULON, lang: 'fr' });
  assert.equal(d.level, 4);
  assert.match(d.headline, /très élevé/i);
  assert.equal(d.tone, 'danger');
});

test('a low danger level is stated plainly without inventing reassurance', () => {
  const d = describeFr({ summary: SUMMARY, point: BREST, lang: 'fr' });
  assert.equal(d.level, 1);
  assert.equal(d.tone, 'safe');
  // "Risque faible" is Meteo-France's own wording for the forecast. It must not
  // become a claim that the person is safe.
  assert.doesNotMatch(d.headline, /en sécurité|aucun danger/i);
});

test('a departement with no bulletin says so rather than defaulting to level 1', () => {
  const d = describeFr({ summary: SUMMARY, point: { lat: -20.9, lon: 55.5, dep: '974' }, lang: 'fr' });
  assert.equal(d.level, null);
  assert.match(d.headline, /non disponible/i);
  assert.notEqual(d.tone, 'safe');
});

test('tomorrow is carried separately because the forecast is the point', () => {
  const d = describeFr({ summary: SUMMARY, point: TOULON, lang: 'fr' });
  assert.equal(d.tomorrow, 3);
  assert.ok(d.facts.some((f) => /demain/i.test(f.label)));
});

test('evacuations are never claimed and FR-Alert is always named', () => {
  const d = describeFr({ summary: SUMMARY, point: TOULON, lang: 'fr' });
  assert.ok(d.alert, 'the FR-Alert statement is mandatory, not conditional');
  assert.match(d.alert.text, /FR-Alert/);
  assert.equal(d.alert.url, 'https://www.interieur.gouv.fr/Alerte/FR-Alert');
  // Nothing anywhere in the rail may assert the absence of an evacuation order.
  const everything = [d.headline, d.sub, ...d.facts.map((f) => `${f.label} ${f.value}`)].join(' ');
  assert.doesNotMatch(everything, /aucun ordre|pas d'évacuation/i);
});

test('air quality uses the ATMO scale, not the Canadian AQHI scale', () => {
  const d = describeFr({ summary: SUMMARY, point: TOULON, lang: 'fr' });
  const air = d.facts.find((f) => /air/i.test(f.label));
  assert.ok(air);
  // ATMO runs 1-6. Reading a 3 through the Canadian 1-10+ bands would call
  // "Dégradé" good air.
  assert.match(air.value, /3/);
  assert.doesNotMatch(air.value, /\/10/);
});

test('an empty or missing payload degrades instead of throwing', () => {
  for (const summary of [{}, { danger: [] }, { danger: null }]) {
    const d = describeFr({ summary, point: TOULON, lang: 'fr' });
    assert.equal(d.level, null);
    assert.ok(d.alert, 'FR-Alert must survive an empty payload');
  }
});

test('every danger level has an official label in both languages', () => {
  for (const level of [1, 2, 3, 4]) {
    assert.ok(DANGER_LABELS.fr[level], `missing fr label for ${level}`);
    assert.ok(DANGER_LABELS.en[level], `missing en label for ${level}`);
  }
});

test('a nearby fire is reported with distance and direction', () => {
  const s = { ...SUMMARY, fires: [
    { id: 'a', lat: 43.20, lon: 5.93, frp_total: 900, detections: 12,
      industrial: false, in_country: true },
  ] };
  const d = describeFr({ summary: s, point: TOULON, lang: 'fr' });
  assert.ok(d.fire, 'a fire 9 km away must be reported');
  assert.equal(d.fire.km, 9);
  // "Chaleur", not "feu": a satellite detects heat. Calling every detection a
  // fire is the overclaim the industrial mask exists to prevent.
  assert.ok(d.facts.some((f) => /chaleur/i.test(f.label) && /km/.test(f.value)));
});

test('an industrial source is never reported as a nearby fire', () => {
  const s = { ...SUMMARY, fires: [
    { id: 'b', lat: 43.13, lon: 5.94, frp_total: 400, detections: 90,
      industrial: true, in_country: true },
  ] };
  const d = describeFr({ summary: s, point: TOULON, lang: 'fr' });
  assert.equal(d.fire, null, 'a refinery next door is not a wildfire');
});

test('a fire outside France is not the fire near you', () => {
  const s = { ...SUMMARY, fires: [
    { id: 'c', lat: 43.13, lon: 5.94, frp_total: 900, detections: 12,
      industrial: false, in_country: false },
  ] };
  assert.equal(describeFr({ summary: s, point: TOULON, lang: 'fr' }).fire, null);
});

test('no detected fire never renders as being safe', () => {
  const d = describeFr({ summary: { ...SUMMARY, fires: [] }, point: TOULON, lang: 'fr' });
  assert.equal(d.fire, null);
  const all = [d.headline, d.sub, ...d.facts.map((f) => `${f.label} ${f.value}`)].join(' ');
  assert.doesNotMatch(all, /en sécurité|aucun danger|rien à craindre/i);
});

test('an evacuation order covering you is the headline, above danger', () => {
  const s = { ...SUMMARY,
    evacuations: [{ insee: '83137', kind: 'order', name: 'Toulon',
                    polygons: [[[[5.9, 43.1], [6.0, 43.1], [6.0, 43.2], [5.9, 43.2], [5.9, 43.1]]]],
                    source_url: 'https://www.var.gouv.fr/x' }],
    evacuation_curation: { curated: true, departements: ['83'], stale: false } };
  const d = describeFr({ summary: s, point: TOULON, lang: 'fr' });
  assert.match(d.headline, /évacuation/i);
  assert.equal(d.tone, 'danger');
});

test('a watched departement with no order may say so', () => {
  const s = { ...SUMMARY, evacuations: [],
    evacuation_curation: { curated: true, departements: ['83'], stale: false } };
  const d = describeFr({ summary: s, point: TOULON, lang: 'fr' });
  assert.ok(d.facts.some((f) => /évacuation/i.test(f.label)));
});

test('an unwatched departement never claims there is no order', () => {
  const s = { ...SUMMARY, evacuations: [],
    evacuation_curation: { curated: true, departements: ['33'], stale: false } };
  const d = describeFr({ summary: s, point: TOULON, lang: 'fr' });
  const all = [d.headline, d.sub, ...d.facts.map((f) => `${f.label} ${f.value}`)].join(' ');
  assert.doesNotMatch(all, /aucun ordre/i);
  // The FR-Alert statement carries the whole weight here and stays mandatory.
  assert.ok(d.alert);
});

test('stale curation is not trusted as a negative', () => {
  const s = { ...SUMMARY, evacuations: [],
    evacuation_curation: { curated: true, departements: ['83'], stale: true } };
  const d = describeFr({ summary: s, point: TOULON, lang: 'fr' });
  const all = d.facts.map((f) => `${f.label} ${f.value}`).join(' ');
  assert.doesNotMatch(all, /aucun ordre/i);
});
