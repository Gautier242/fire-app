// tests-js/test_relay.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeRelay, SCAM_WARNING, TIERS } from '../public/js/relay.js';

const PAYLOAD = {
  curated_at: '2026-07-30',
  stale: false,
  covers: ['33'],
  entries: [
    { name: 'Préfecture', url: 'https://a.example/', tier: 'official',
      area: 'Gironde', note: 'Consignes.', reachable: true },
    { name: 'Croix-Rouge', url: 'https://b.example/', tier: 'institutional',
      area: 'France', note: 'Bénévolat.', reachable: true },
    { name: 'Groupe entraide', url: 'https://c.example/', tier: 'community',
      area: 'Gironde', note: 'Entre habitants.', reachable: null },
  ],
};

test('entries are grouped by tier, most accountable first', () => {
  assert.deepEqual(TIERS, ['official', 'institutional', 'community']);
  const out = describeRelay(PAYLOAD, 'fr');
  assert.deepEqual(out.groups.map((g) => g.tier),
    ['official', 'institutional', 'community']);
  assert.equal(out.groups[0].entries.length, 1);
});

test('the community tier always carries the scam warning', () => {
  const out = describeRelay(PAYLOAD, 'fr');
  const community = out.groups.find((g) => g.tier === 'community');
  assert.ok(community.warning, 'community must warn');
  assert.equal(community.warning, SCAM_WARNING.fr);
  // And it is not conditional on anything about the entries.
  const single = describeRelay({ ...PAYLOAD, entries: [PAYLOAD.entries[2]] }, 'fr');
  assert.equal(single.groups[0].warning, SCAM_WARNING.fr);
});

test('the scam warning survives an entry that looks entirely respectable', () => {
  // The failure this guards against is a future "only warn when something looks
  // wrong". A scam that looks wrong is not the one that costs somebody money.
  const polished = {
    ...PAYLOAD,
    entries: [{
      name: 'Entraide Gironde — groupe officiel des habitants',
      url: 'https://facebook.example/entraide',
      tier: 'community',
      area: 'Gironde',
      note: 'Groupe modéré depuis 2019.',
      reachable: true,
      verified: true,
      moderated: true,
    }],
  };
  for (const lang of ['fr', 'en']) {
    assert.equal(describeRelay(polished, lang).groups[0].warning, SCAM_WARNING[lang]);
  }
});

test('the scam warning names money, cards and passwords, as the worker does', () => {
  // worker/index.js refuses a submission with "no money and no credentials: real
  // help never asks for either". A reader who leaves for a page we cannot see
  // must meet the same sentence, not a softer one.
  assert.match(SCAM_WARNING.fr, /argent/i);
  assert.match(SCAM_WARNING.fr, /carte/i);
  assert.match(SCAM_WARNING.fr, /mot de passe/i);
  assert.match(SCAM_WARNING.en, /money/i);
  assert.match(SCAM_WARNING.en, /card/i);
  assert.match(SCAM_WARNING.en, /password/i);
});

test('the official tier carries no scam warning of its own', () => {
  const out = describeRelay(PAYLOAD, 'fr');
  assert.equal(out.groups.find((g) => g.tier === 'official').warning, null);
});

test('a tier label never claims a post is true', () => {
  // A tier says who publishes a page. Any word here that reaches past the
  // publisher and vouches for the content is the defect. Applied to labels only:
  // they are short noun phrases with no room to negate a word, unlike the
  // warning, which has to say "personne ne vérifie" out loud.
  const VOUCHES = new RegExp([
    'fiable', 'reliable', 'trust', 'confiance',
    'v[ée]rifi', 'verifi', 'certifi', 'authentiq', 'authentic',
    'garanti', 'guarantee', 'valid[ée]', 'validated',
    'approuv', 'approved', 'exact', '\\bvrai', '\\btrue\\b',
    '\\bs[ûu]re?\\b', '\\bsafe\\b',
  ].join('|'), 'i');
  for (const lang of ['fr', 'en']) {
    for (const group of describeRelay(PAYLOAD, lang).groups) {
      assert.doesNotMatch(group.label, VOUCHES,
        `${group.tier} label in ${lang} implies a post can be trusted: ${group.label}`);
    }
  }
});

test('nothing this module renders tells the reader they are safe', () => {
  // Absence is never safety. The strongest negative allowed is about our data.
  const SAFETY = /en s[ée]curit[ée]|hors de danger|aucun danger|\bsafe\b|out of danger|no danger/i;
  for (const lang of ['fr', 'en']) {
    const out = describeRelay({ ...PAYLOAD, stale: true }, lang);
    for (const text of [out.staleNote, ...out.groups.flatMap((g) => [g.label, g.warning])]) {
      if (text) assert.doesNotMatch(text, SAFETY, `claims safety: ${text}`);
    }
  }
});

test('an unreachable entry is shown and marked, not hidden', () => {
  const down = { ...PAYLOAD, entries: [{ ...PAYLOAD.entries[0], reachable: false }] };
  const out = describeRelay(down, 'fr');
  assert.equal(out.groups[0].entries.length, 1);
  assert.equal(out.groups[0].entries[0].reachable, false);
});

test('an unchecked entry is not reported as down', () => {
  // null is "we did not check", false is "it did not answer". Collapsing the two
  // would put a down mark on every entry the moment the check is skipped.
  const out = describeRelay(PAYLOAD, 'fr');
  assert.equal(out.groups.find((g) => g.tier === 'community').entries[0].reachable, null);
  const unfilled = describeRelay({ entries: [{ name: 'X', url: 'https://x.example/', tier: 'official' }] }, 'fr');
  assert.equal(unfilled.groups[0].entries[0].reachable, null);
});

test('an entry carrying an unknown tier is never shown under one of the three', () => {
  // The build validator is what rejects such an entry (Task 1). Here the rule is
  // only that a typo may not land a page under a tier it was not given.
  const typo = { ...PAYLOAD, entries: [{ ...PAYLOAD.entries[0], tier: 'offical' }] };
  const out = describeRelay(typo, 'fr');
  assert.deepEqual(out.groups, []);
});

test('stale curation is reported', () => {
  const fresh = describeRelay(PAYLOAD, 'fr');
  assert.equal(fresh.stale, false);
  assert.equal(fresh.staleNote, null);

  const old = describeRelay({ ...PAYLOAD, stale: true }, 'fr');
  assert.equal(old.stale, true);
  assert.ok(old.staleNote && old.staleNote.length > 20);
});

test('an empty, missing or malformed payload yields no groups rather than crashing', () => {
  assert.deepEqual(describeRelay(null, 'fr').groups, []);
  assert.deepEqual(describeRelay({ entries: [] }, 'fr').groups, []);
  assert.deepEqual(describeRelay({ entries: 'nope' }, 'fr').groups, []);
  assert.deepEqual(describeRelay(undefined, 'en').groups, []);
});

test('both languages define every tier label and the warning', () => {
  const fr = describeRelay(PAYLOAD, 'fr');
  const en = describeRelay(PAYLOAD, 'en');
  assert.equal(fr.groups.length, en.groups.length);
  assert.equal(fr.groups.length, TIERS.length);
  for (let i = 0; i < fr.groups.length; i += 1) {
    assert.ok(fr.groups[i].label && en.groups[i].label);
    assert.notEqual(fr.groups[i].label, en.groups[i].label);
  }
  assert.ok(SCAM_WARNING.fr && SCAM_WARNING.en);
  assert.notEqual(SCAM_WARNING.fr, SCAM_WARNING.en);
});

test('an unknown language falls back to French rather than to blank labels', () => {
  const out = describeRelay(PAYLOAD, 'de');
  assert.equal(out.groups[0].label, describeRelay(PAYLOAD, 'fr').groups[0].label);
});
