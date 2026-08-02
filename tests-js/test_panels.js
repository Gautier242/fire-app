// The floating panels open at a size the reader can use, and folding the rail
// does not move or nail them shut.
//
// None of this can be asserted against a live DOM: the suite is stdlib node with
// no jsdom, and adding one is a dependency this repo does not take. So what is
// testable here is the arithmetic and the stylesheet — the two places where the
// numbers silently drift out of step with each other. The DOM behaviour itself is
// verified in a browser, which is how every measurement in the briefs was taken.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  FILM_DATES, THUMB_W, THUMB_GAP, SHEET_CHROME, holdsGeometry,
} from '../public/js/local-page.js';

const CSS = readFileSync('public/css/app.css', 'utf8');

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

// 1036 px is the widest a panel may be on a 1440 px window with the rail open
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

// Folding the rail pins every visible panel to pixels so the toggle cannot resize
// them underneath the reader. A hidden panel measures 0x0, and pinning that wrote
// `width: 0` onto it, so the satellite sheet later opened at the 224x64 floor
// instead of its default -- two thumbnails of fourteen. Folding the rail once
// before opening a panel was enough to trigger it.
test('a panel that is not on screen is not pinned across a rail fold', () => {
  assert.equal(holdsGeometry({ width: 0, height: 0 }), false, 'a hidden panel');
  assert.equal(holdsGeometry({ width: 909, height: 0 }), false, 'a collapsed panel');
  assert.equal(holdsGeometry({ width: 909, height: 234 }), true, 'a panel on screen');
});

// Folding the rail widens the map, and the toolbar was being shoved sideways to
// clear the reopen button. A control that jumps 36 px when the reader folds an
// unrelated panel reads as a bug, and the reader loses the chip they were aiming
// at. The button moves out of the way instead.
test('folding the rail does not shift the toolbar sideways', () => {
  assert.doesNotMatch(CSS, /\[data-rail="off"\]\s*\.toolbar\s*{[^}]*left:/,
    'the toolbar must keep its position when the rail folds');
});
