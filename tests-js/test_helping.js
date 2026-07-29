// tests-js/test_helping.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OFFICIAL_CHANNELS, SKILLS, actionsFor } from '../public/js/helping.js';

const CALM = { level: 2, nearestFireKm: null, underOrder: false };
const CLOSE = { level: 4, nearestFireKm: 6, underOrder: false };
const ORDERED = { level: 4, nearestFireKm: 2, underOrder: true };

test('every skill is offered in both languages', () => {
  assert.ok(SKILLS.length >= 6);
  for (const s of SKILLS) {
    assert.ok(s.id && s.label.fr && s.label.en, `${s.id} incomplete`);
  }
});

test('someone under an evacuation order is told to leave, whatever their skills', () => {
  const actions = actionsFor(['medical', 'vehicle_4x4', 'chainsaw'], ORDERED);
  assert.ok(actions.length >= 1);
  // The first thing said must be to go. A trained person under an order is
  // still a civilian under an order.
  assert.match(actions[0].do, /partez|quittez/i);
});

test('no action ever sends an untrained person toward the fire', () => {
  for (const situation of [CALM, CLOSE, ORDERED]) {
    for (const skill of SKILLS) {
      for (const action of actionsFor([skill.id], situation)) {
        assert.doesNotMatch(action.do, /approchez|allez vers le feu|éteignez le feu/i,
          `${skill.id} produced an action sending someone at the fire`);
      }
    }
  }
});

test('every action names why it helps and who to contact', () => {
  for (const action of actionsFor(['vehicle_4x4', 'local_knowledge'], CLOSE)) {
    assert.ok(action.why, 'an action without a reason is an order');
    assert.ok(action.channel, 'an action with no channel is a dead end');
  }
});

test('calm conditions produce preparation actions, not emergency ones', () => {
  const actions = actionsFor(['property_owner'], CALM);
  assert.ok(actions.some((a) => /débroussaill/i.test(a.do)),
    'the legal obligation is the single most useful calm-weather action');
});

test('declaring no skill still returns what anyone can do', () => {
  const actions = actionsFor([], CLOSE);
  assert.ok(actions.length >= 1, 'everyone can do something');
});

test('an unknown skill id is ignored rather than crashing', () => {
  assert.doesNotThrow(() => actionsFor(['not_a_skill'], CLOSE));
});

test('the official channels are real and named', () => {
  assert.ok(OFFICIAL_CHANNELS.emergency.includes('112'));
  assert.ok(OFFICIAL_CHANNELS.emergency.includes('18'));
  // Reserve communale de securite civile is the actual legal route for a
  // civilian volunteer in France. Anything else is freelancing.
  assert.ok(/réserve communale/i.test(OFFICIAL_CHANNELS.volunteer.fr));
});
