import test from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, t } from '../public/js/i18n.js';

test('every English key has a French counterpart', () => {
  const en = Object.keys(STRINGS.en).sort();
  const fr = Object.keys(STRINGS.fr).sort();
  assert.deepEqual(en, fr, 'EN and FR key sets must match exactly');
});

test('t substitutes variables', () => {
  assert.equal(t('en', 'fire_near', { km: 12, direction: 'north' }),
    'There is a wildfire 12 km north of you.');
  assert.equal(t('fr', 'fire_near', { km: 12, direction: 'nord' }),
    'Il y a un feu de forêt à 12 km au nord de vous.');
});

test('t returns the key itself when a string is missing, never blank', () => {
  assert.equal(t('en', 'no_such_key'), 'no_such_key');
});

test('compass points are translated', () => {
  assert.equal(t('en', 'dir_NE'), 'northeast');
  assert.equal(t('fr', 'dir_NE'), 'nord-est');
});

test('every AQHI band has advice in both languages', () => {
  for (const band of ['low', 'moderate', 'high', 'very_high']) {
    assert.ok(STRINGS.en[`aqhi_${band}_advice`]);
    assert.ok(STRINGS.fr[`aqhi_${band}_advice`]);
  }
});

test('every evacuation state has copy in both languages', () => {
  for (const state of ['order', 'alert', 'none_found', 'cannot_check']) {
    assert.ok(STRINGS.en[`evac_${state}`]);
    assert.ok(STRINGS.fr[`evac_${state}`]);
  }
});

test('status badges are distinct from air quality wording', () => {
  // A fire card must not be labelled "Good" — that word belongs to air quality.
  for (const lang of ['en', 'fr']) {
    for (const level of ['safe', 'caution', 'danger']) {
      assert.ok(STRINGS[lang][`badge_${level}`]);
    }
    assert.notEqual(STRINGS[lang].badge_safe, STRINGS[lang].aqhi_low);
  }
});
