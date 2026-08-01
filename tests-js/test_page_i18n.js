// The language switch has to be total. It was not: nine controls on zone.html,
// four on pro.html and twelve on index.html stayed in French after switching to
// English, because the labels were typed into the HTML and nothing on the switch
// path ever went back to them.
//
// A test that asserted "these particular labels translate" would have gone stale
// the first time somebody added a tenth chip. So this file asserts the property
// instead: every control in the map region declares a translation key, and every
// declared key resolves in both languages. A new control typed in French fails
// here, whatever it is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { COPY as ZONE } from '../public/js/local-page.js';
import { COPY as PRO } from '../public/js/pro-page.js';
import { COPY as FRANCE } from '../public/js/app-fr.js';

const PAGES = [
  { name: 'zone.html', file: 'public/fr/zone.html', copy: ZONE },
  { name: 'pro.html', file: 'public/fr/pro.html', copy: PRO },
  { name: 'index.html', file: 'public/fr/index.html', copy: FRANCE },
];

// Elements inside the map region whose text is written by JS at render time, so
// there is nothing static to translate. Every one is a value rather than a label:
// a date, a percentage, a count. Anything else with text has to carry data-t.
//
// This list is the whole escape hatch, deliberately. Adding an id to it is a
// visible decision in a diff; leaving a French label in the HTML is not.
const JS_OWNED = new Set([
  'opacity-value', 'scrub-date', 'day-date', 'sensor-res', 'sensor-revisit',
]);

const strip = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

// The map column, which is where the toolbar, the scrubbers and the legend live.
// Sliced rather than parsed: this repo's HTML is hand-written and consistently
// indented, and the assertions below fail loudly if the slice misses.
function mapRegion(html) {
  const start = html.indexOf('    <div class="map">');
  const end = html.indexOf('\n    </div>', start);
  assert.ok(start !== -1 && end !== -1, 'could not find the map column');
  const region = html.slice(start, end);
  assert.match(region, /id="toolbar"/, 'map column slice missed the toolbar');
  return region;
}

// Opening tag, then its own text. Closing tags and comments cannot match.
const WITH_TEXT = /<(\w+)([^>]*)>([^<>]*[^\s<>][^<>]*)</g;

function controls(region) {
  return [...strip(region).matchAll(WITH_TEXT)].map(([, tag, attrs, text]) => ({
    tag, attrs, text: text.trim(),
    key: (attrs.match(/\bdata-t="([^"]+)"/) || [])[1] || null,
    id: (attrs.match(/\bid="([^"]+)"/) || [])[1] || null,
  }));
}

function keys(html, attribute) {
  const pattern = new RegExp(`\\b${attribute}="([^"]+)"`, 'g');
  return [...strip(html).matchAll(pattern)].map((m) => m[1]);
}

for (const page of PAGES) {
  const html = readFileSync(page.file, 'utf8');

  test(`${page.name}: French and English say the same things`, () => {
    assert.deepEqual(
      Object.keys(page.copy.fr).sort(),
      Object.keys(page.copy.en).sort(),
      'FR and EN key sets must match exactly',
    );
  });

  test(`${page.name}: every control in the map declares a translation key`, () => {
    const untranslatable = controls(mapRegion(html))
      .filter((el) => !el.key && !JS_OWNED.has(el.id))
      .map((el) => `<${el.tag}> ${JSON.stringify(el.text)}`);
    assert.deepEqual(untranslatable, [],
      'these controls have no data-t, so the language switch cannot reach them');
  });

  test(`${page.name}: every declared key exists in both languages`, () => {
    for (const key of [...keys(html, 'data-t'), ...keys(html, 'data-t-aria')]) {
      for (const lang of ['fr', 'en']) {
        const value = page.copy[lang][key];
        assert.equal(typeof value, 'string', `${lang}.${key} is not a string`);
        assert.ok(value.length, `${lang}.${key} is empty`);
      }
    }
  });

  // The text left in the HTML is what a reader sees before the module loads, and
  // it is the French label. If it drifts from COPY.fr the page changes wording on
  // boot for no reason a reader can understand.
  test(`${page.name}: the static text matches the French string`, () => {
    for (const el of controls(mapRegion(html))) {
      if (!el.key) continue;
      assert.equal(el.text, page.copy.fr[el.key],
        `<${el.tag} data-t="${el.key}"> does not match COPY.fr.${el.key}`);
    }
  });

  // Switching language must not leave a French accessible name behind a
  // translated visible one: a screen-reader user gets the aria-label, not the text.
  test(`${page.name}: no aria-label is left hardcoded in the map`, () => {
    const hardcoded = [...strip(mapRegion(html)).matchAll(/<(\w+)([^>]*\baria-label="[^"]+"[^>]*)>/g)]
      .filter(([, , attrs]) => !/\bdata-t-aria=/.test(attrs))
      .map(([, tag, attrs]) => `<${tag}> ${(attrs.match(/aria-label="([^"]+)"/) || [])[1]}`);
    assert.deepEqual(hardcoded, [],
      'these aria-labels have no data-t-aria, so they stay French in English');
  });
}
