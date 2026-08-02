// The floating panels open at a size the reader can use, and the map's own
// chrome stays out of the way of the map.
//
// None of this can be asserted against a live DOM: the suite is stdlib node with
// no jsdom, and adding one is a dependency this repo does not take. So what is
// testable here is the arithmetic and the stylesheet — the two places where the
// numbers silently drift out of step with each other. The DOM behaviour itself is
// verified in a browser, which is how every measurement in the briefs was taken.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { FILM_DATES, THUMB_W, THUMB_GAP, SHEET_CHROME } from '../public/js/local-page.js';

const CSS = readFileSync('public/css/app.css', 'utf8');
const ZONE = readFileSync('public/fr/zone.html', 'utf8');

// The contact sheet's whole purpose is comparing days against each other: cloud
// is what a reader is choosing around, and they cannot choose against a strip
// that shows five of thirty. Measured on the real page, the panel spends 88 px on
// padding, two nav arrows and their gaps before the first thumbnail.
test('the contact sheet opens wide enough to hold every date it offers', () => {
  const needed = FILM_DATES * THUMB_W + (FILM_DATES - 1) * THUMB_GAP + SHEET_CHROME;
  const declared = CSS.match(/--sheet-w:\s*(\d+)px/);
  assert.ok(declared, '--sheet-w must be declared in app.css');
  assert.equal(Number(declared[1]), needed,
    `--sheet-w must hold ${FILM_DATES} thumbnails (${needed}px), not ${declared[1]}px`);
});

// 1036 px is the widest a panel may be on a 1440 px window with the rail showing
// (map 1060, max-width calc(100% - 24px)). A default that cannot fit inside that
// would open clipped on the machine the owner actually uses.
test('the default sheet width fits the space a 1440px window actually gives it', () => {
  const needed = FILM_DATES * THUMB_W + (FILM_DATES - 1) * THUMB_GAP + SHEET_CHROME;
  assert.ok(needed <= 1036,
    `${needed}px cannot fit the 1036px a 1440px window allows; ask for fewer dates`);
});

// The panel must never be pinned to a number alone: on a narrow window the
// declared width has to give way rather than push the strip off the map.
test('the sheet width yields to a narrow map instead of overflowing it', () => {
  assert.match(CSS, /\.scrubber\.sheet\s*{[^}]*width:\s*min\(\s*var\(--sheet-w\)/,
    '.scrubber.sheet must clamp its declared width against the available space');
});

// Only the two scrubbers float. Giving the layer chips and the legend the same
// movable-panel treatment gathered the chips into a surface that covered 205px of
// the map along its whole width, and moved the legend out of the corner Leaflet
// leaves free. The chips are the control a reader uses most and they belong on
// the map, not in a box on top of it.
test('the layer chips and the legend are not floating panels', () => {
  assert.doesNotMatch(CSS, /^\.scrubber,\s*\.toolbar,\s*\.map \.legend\s*{/m,
    'the toolbar and legend must not share the scrubbers\' panel rules');
  assert.doesNotMatch(ZONE, /<details[^>]*class="toolbar"/,
    'the layer bar must be a plain container, not a foldable panel');
  assert.match(ZONE, /<div class="toolbar" id="toolbar">/,
    'the layer bar must be a plain div');
});

// Leaflet puts both the zoom buttons and the scale bar bottom-right, and the
// scale bar drew straight through the legend text once already -- "10 km"
// printed across "Route coupée (autre cause)".
test('the legend keeps the corner that clears Leaflet controls', () => {
  const rule = CSS.match(/\.map \.legend\s*{([^}]*)}/);
  assert.ok(rule, '.map .legend must be declared');
  assert.match(rule[1], /right:\s*3\.4rem/, 'the legend sits clear of the zoom buttons');
  assert.match(rule[1], /bottom:/, 'the legend is anchored to the bottom edge');
});

// A close control has to read as a control, but the filled block read as a second
// panel sitting inside the header. The glyph carries the weight instead.
test('the panel close button is a bold glyph rather than a filled block', () => {
  const rule = CSS.match(/\.panel-close\s*{([^}]*)}/);
  assert.ok(rule, '.panel-close must be declared');
  assert.match(rule[1], /background:\s*none/, 'no filled background behind the cross');
  assert.match(rule[1], /font-weight:\s*[6-9]00/, 'the cross must be bold enough to find');
});

// The chips sit straight on the map, so a chip with no background and no border
// is faint text over terrain. The layers a reader had switched OFF became exactly
// the ones they could no longer find to switch back on -- the failure mode is
// that the control for a layer disappears when the layer does.
test('every layer chip is visible whether it is on or off', () => {
  const base = CSS.match(/^\.chip\s*{([^}]*)}/m);
  assert.ok(base, '.chip must be declared');
  assert.doesNotMatch(base[1], /border:\s*1px solid transparent/,
    'a chip must carry a visible outline in both states');
  assert.match(base[1], /border:\s*1px solid var\(--line\)/, 'the outline is on the base chip');
  assert.doesNotMatch(base[1], /background:\s*none/,
    'a chip needs its own surface to be read over the map');
  // Off is dimmer, never invisible. --faint on this surface vanished.
  const off = CSS.match(/\.chip\[aria-pressed="false"\]\s*{([^}]*)}/);
  assert.ok(off, 'the off state must be declared');
  assert.doesNotMatch(off[1], /color:\s*var\(--faint\)/, 'off must stay legible');
});

// The bar folds to the top, leaving only the button that folded it -- otherwise
// there is nothing left to press to bring the layers back.
test('the layer bar folds to a single button that can restore it', () => {
  assert.match(ZONE, /id="toolbar-fold"/, 'the bar needs a fold button');
  assert.match(CSS, /\.toolbar\.folded\s*>\s*\*:not\(\.toolbar-fold\)\s*{[^}]*display:\s*none/,
    'folding hides every child except the button that unfolds it');
  assert.match(CSS, /\.toolbar\.folded\s*{[^}]*right:\s*auto\s*!important/,
    'folded, the bar shrinks to its button rather than holding its width');
});

// The rail folds and comes back, and the way back has to exist on screen: a fold
// with no visible restore is a panel the reader has lost.
test('the rail folds away and can be brought back', () => {
  assert.match(ZONE, /id="rail-hide"/, 'the rail needs a fold control');
  assert.match(ZONE, /id="rail-show"/, 'and a visible way back');
  assert.match(CSS, /\.shell\[data-rail="off"\]\s*\.rail-toggle\s*{[^}]*display:\s*inline-flex/,
    'the restore tab shows exactly when the rail is folded');
  // Grid, not "0 1fr": the rail leaves the grid when folded, so the map became
  // the first child and rendered in a zero-width track.
  assert.match(CSS, /\.shell\[data-rail="off"\]\s*{[^}]*grid-template-columns:\s*1fr/,
    'the map must take the single remaining column');
});

// The day slider spans its panel. It had no width rule and fell back to the
// browser default, so it stopped halfway across and looked as though it had more
// travel left than it did -- on a control that picks which day's heat is drawn.
test('both scrubber sliders span the full width of their panel', () => {
  assert.match(CSS, /#scrub,\s*#day\s*{[^}]*width:\s*100%/,
    'the image and day sliders must both be full width');
});
