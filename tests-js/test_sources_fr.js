// The provenance page's water section, guarded structurally.
//
// sources-fr.js renders on import and wires listeners to a live document, so it
// cannot be imported here without a DOM. These are source-level assertions of
// the same kind test_pro_water.js ends with: narrower than a behavioural test,
// but they catch the one failure that matters on this page, which is a national
// total quietly becoming zero.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync('public/js/sources-fr.js', 'utf8');

test('the national water total is derived from the coverage counts', () => {
  // water.json publishes coverage and no longer publishes the points: they were
  // 9.1 MB of coordinates for a page that draws no map. Reading `.points`
  // here would render "0 water points, roughly 7% of France's 800,000" — a
  // confident wrong number, in the direction that understates what we hold, on
  // the page whose whole job is saying what we do and do not know.
  assert.doesNotMatch(SOURCE, /water\.points/,
    'the register no longer ships its points; sum the coverage counts instead');
  assert.match(SOURCE, /coverage\s*\|\|\s*\[\]\)\.reduce/,
    'the total must come from the coverage rows');
});

test('a register that fails to load says so instead of rendering nothing', () => {
  // UNAVAILABLE IS NOT NONE. A 404 on water.json must not leave a page that
  // silently omits the coverage list, because an absent list reads as "no
  // register covers anywhere in France".
  assert.match(SOURCE, /water_failed/,
    'the page must keep a branch that reports the register could not be read');
});

test('the register is no longer described to the reader as a large file', () => {
  // It is 0.36 KB gzipped now and loads with the page, so the sentence that
  // asked the reader to click before it downloaded would be untrue.
  assert.doesNotMatch(SOURCE, /data-water/,
    'the click-to-load button is gone; the file arrives with the page');
});
