// tests-js/test_effis.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  YEARS, LAYERS, EFFIS_SERVED_COLOURS, SCAR_COLD, SCAR_FILTER, SCAR_CLASS,
  getMapUrl, probeYear,
} from '../public/js/effis.js';

// The live fire heat ramp, copied from mapview.js:11 rather than imported —
// importing mapview.js pulls in the Leaflet global, which does not exist here.
// If that constant moves, this test still holds the values it was written against.
const HEAT = ['#FFC061', '#FF7A3D', '#E23A1E'];

function hue(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return ((h * 60) + 360) % 360;
}

test('the catalogue covers the ten seasons EFFIS actually holds, newest first', () => {
  assert.deepEqual(YEARS, [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016]);
  assert.equal(LAYERS.length, 10);
  assert.deepEqual(LAYERS.map((l) => l.year), YEARS);
  for (const entry of LAYERS) {
    assert.equal(entry.wms.layers, `modis.ba.${entry.year}`);
    assert.ok(entry.id.includes(String(entry.year)));
  }
});

test('every entry produces a URL carrying the empty STYLES= EFFIS refuses without', () => {
  // Measured 2026-07-30: omitting STYLES entirely returns a 678-byte
  // ServiceExceptionReport, not a raster. MapServer 8 requires the parameter
  // to be present and empty.
  for (const entry of LAYERS) {
    const url = getMapUrl(entry, { bbox: '0,0,1,1', width: 8, height: 8 });
    assert.match(url, /[?&]STYLES=(&|$)/, `${entry.id} must send an empty STYLES=`);
    assert.ok(url.includes(`LAYERS=modis.ba.${entry.year}`));
    assert.ok(url.includes('REQUEST=GetMap'));
  }
});

test('Leaflet gets the empty STYLES= in its own wms options too', () => {
  // L.tileLayer.wms builds its own query string; it only sends STYLES if the
  // option is present. An empty string is falsy-looking and easy to drop.
  for (const entry of LAYERS) {
    assert.ok('styles' in entry.wms, `${entry.id} must declare styles`);
    assert.equal(entry.wms.styles, '');
    assert.equal(entry.wms.transparent, true);
    assert.equal(entry.wms.format, 'image/png');
  }
});

test('the label for any year names that year, in both languages', () => {
  for (const entry of LAYERS) {
    for (const lang of ['fr', 'en']) {
      const label = entry.label[lang];
      assert.ok(label, `${entry.id} needs a ${lang} label`);
      assert.ok(label.includes(String(entry.year)),
        `${entry.id} ${lang} label must state the year: ${label}`);
    }
  }
});

test('nothing says burnt without saying when', () => {
  // "zones brûlées" beside a live fire reads as this fire. With the year it
  // reads as an archive.
  for (const entry of LAYERS) {
    for (const label of Object.values(entry.label)) {
      if (/brûl|burnt|burned/i.test(label)) {
        assert.ok(label.includes(String(entry.year)),
          `undated burn wording: ${label}`);
      }
    }
  }
});

test('no entry claims to be current or near-real-time', () => {
  // effis.nrt.ba.poly returned 0 drawn pixels across the whole continent on
  // 2026-07-30. A layer that is always blank teaches a reader that blank means
  // nothing is burning, so it is not in the catalogue and no label implies it.
  const forbidden = /nrt|near.?real|temps.?r[eé]el|\bactuel|en cours|\bcurrent\b|\blive\b|aujourd|today|maintenant/i;
  for (const entry of LAYERS) {
    assert.doesNotMatch(entry.wms.layers, /nrt/, `${entry.id} must not use an NRT layer`);
    for (const label of Object.values(entry.label)) {
      assert.doesNotMatch(label, forbidden, `${entry.id} implies currency: ${label}`);
    }
  }
});

test('a blank but valid raster resolves to no data for that year, never to no burns', async () => {
  // Measured 2026-07-30 over Normandy: a 1,096-byte valid PNG with 0
  // non-transparent pixels — identical byte size for 2016 and 2025. Status
  // code and byte size prove nothing; only the pixels do.
  const verdict = await probeYear(2016, {
    fetch: async () => ({ ok: true, headers: new Map([['content-type', 'image/png']]),
      blob: async () => 'blank-png' }),
    countDrawn: async () => 0,
    bbox: '0,0,1,1',
  });
  assert.equal(verdict.status, 'no-data');
  assert.equal(verdict.pixels, 0);
  for (const note of Object.values(verdict.note)) {
    assert.ok(note.includes('2016'), `note must state the year: ${note}`);
    // The strongest permitted negative is about the archive, not the reader.
    assert.doesNotMatch(note, /en s[eé]curit|rien n.a br[uû]l|no burns|nothing burn|pas de risque|safe/i,
      `a blank raster must not read as safety: ${note}`);
  }
});

test('a raster with pixels reports the burns it found', async () => {
  const verdict = await probeYear(2025, {
    fetch: async () => ({ ok: true, headers: new Map([['content-type', 'image/png']]),
      blob: async () => 'png' }),
    countDrawn: async () => 24431,
    bbox: '0,0,1,1',
  });
  assert.equal(verdict.status, 'burns');
  assert.equal(verdict.pixels, 24431);
  assert.ok(verdict.note.fr.includes('2025'));
});

test('a service exception is unavailable, not an empty archive', async () => {
  // EFFIS answers a malformed request with a text/xml ServiceExceptionReport
  // under HTTP 200 — a 554-byte one for modis.ba.2015, a 678-byte one when
  // STYLES is missing. That is our request being wrong, and must never be
  // reported to a reader as "nothing burned that year".
  const verdict = await probeYear(2022, {
    fetch: async () => ({ ok: true, headers: new Map([['content-type', 'text/xml; charset=UTF-8']]),
      blob: async () => 'xml' }),
    countDrawn: async () => { throw new Error('must not decode an exception report as a raster'); },
    bbox: '0,0,1,1',
  });
  assert.equal(verdict.status, 'unavailable');
  assert.notEqual(verdict.status, 'no-data');
});

test('a failed fetch is unavailable, and never silently a clean year', async () => {
  for (const broken of [
    async () => { throw new Error('network down'); },
    async () => ({ ok: false, status: 500, headers: new Map(), blob: async () => '' }),
  ]) {
    const verdict = await probeYear(2022, { fetch: broken, countDrawn: async () => 0, bbox: '0,0,1,1' });
    assert.equal(verdict.status, 'unavailable');
  }
});

test('the probe asks for the year it was asked about, with STYLES=', async () => {
  let seen = '';
  await probeYear(2019, {
    fetch: async (url) => {
      seen = url;
      return { ok: true, headers: new Map([['content-type', 'image/png']]), blob: async () => 'p' };
    },
    countDrawn: async () => 5,
    bbox: '-1,1,2,3',
  });
  assert.ok(seen.includes('LAYERS=modis.ba.2019'), seen);
  assert.match(seen, /[?&]STYLES=(&|$)/);
  assert.ok(seen.includes('REQUEST=GetMap'));
});

test('an unknown year is refused rather than guessed at', async () => {
  await assert.rejects(() => probeYear(1999, { fetch: async () => { throw new Error('no'); } }),
    /1999/);
});

test('what EFFIS serves is on the live heat ramp, which is why it is filtered', () => {
  // Measured 2026-07-30 by decoding the PNGs: the polygon sublayer draws
  // rgb(253,191,111) and the point sublayer rgb(106,61,154). #FDBF6F sits 14
  // units from HEAT[0] #FFC061 in RGB — 3% of the RGB diagonal. Unfiltered,
  // an archival 2016 scar renders in the same amber as a fire burning now.
  const dist = (a, b) => Math.hypot(...[1, 3, 5].map(
    (i) => parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)));
  assert.ok(EFFIS_SERVED_COLOURS.includes('#FDBF6F'), 'the measured amber must stay documented');
  assert.ok(dist('#FDBF6F', HEAT[0]) < 20,
    'if this ever stops being true the filter rationale needs rewriting');
});

test('the archival scar renders cold, off the heat ramp entirely', () => {
  const cold = hue(SCAR_COLD);
  assert.ok(cold > 180 && cold < 260, `${SCAR_COLD} must be a cold blue, got hue ${cold}`);
  // Distance is asserted against the warm colours only. EFFIS's purple point
  // sublayer is already cold and lands 46° away, which is fine — the rule is
  // that an archival scar cannot be confused with fire, not that it must differ
  // from everything.
  for (const warm of [...HEAT, '#FDBF6F']) {
    const gap = Math.abs(cold - hue(warm));
    assert.ok(Math.min(gap, 360 - gap) > 90,
      `${SCAR_COLD} is only ${gap}° from ${warm}`);
  }
  // sepia() collapses every input hue to one warm brown before the rotation,
  // so both the amber and the purple land on the same cold blue. Without it
  // the two sublayers would rotate to different hues.
  assert.match(SCAR_FILTER, /^sepia\(1\)/);
  assert.ok(SCAR_FILTER.includes('hue-rotate'));
});

test('every entry carries the cold class so no scar can ship unfiltered', () => {
  for (const entry of LAYERS) {
    assert.equal(entry.wms.className, 'effis-scar');
  }
});

// The filter is the only thing keeping an archival scar from rendering in
// live-fire amber, and it lives in CSS while the class that carries it lives in
// JS. Nothing else checks that those two still agree.
test('the cold filter that ships is the one the module specifies', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../public/css/app.css', import.meta.url), 'utf8');

  const rule = css.match(/\.effis-scar\s*\{([^}]*)\}/);
  assert.ok(rule, 'app.css must carry a .effis-scar rule or every scar ships amber');
  const declared = rule[1].match(/filter:\s*([^;]+)/);
  assert.ok(declared, '.effis-scar must set a filter');
  assert.equal(declared[1].trim(), SCAR_FILTER,
    'the stylesheet and the module disagree about the scar filter');

  // And every catalogue entry must actually ask for that class.
  for (const entry of LAYERS) {
    assert.equal(entry.wms.className, SCAR_CLASS, `${entry.id} would ship unfiltered`);
  }
});

test('the served colour really is close enough to live fire to need filtering', () => {
  // The reason the rule above exists, as arithmetic rather than a comment.
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [sr, sg, sb] = rgb(EFFIS_SERVED_COLOURS[0]);   // what EFFIS draws
  const [hr, hg, hb] = rgb('#FFC061');                 // HEAT[0] in mapview.js
  const distance = Math.hypot(sr - hr, sg - hg, sb - hb);
  assert.ok(distance < 20,
    `served scar is ${distance.toFixed(1)} from live-fire amber; if this ever grows `
    + 'past 20 the filter may no longer be load-bearing, but check before removing it');
});
