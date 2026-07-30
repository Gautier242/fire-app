// The responder view. A different trust level from the public map: it is allowed
// to show modelled numbers, so every one of them has to carry how little the
// model has been validated. These tests exist to stop that provenance being
// dropped for tidiness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MODELLED_NOTE, triage, waterStatement, groundStatement, airStatement,
  scheduledClosures,
} from '../public/js/pro-page.js';

// Shaped on the live payload: public/fr/data/zones/gironde.json, 2026-07-30.
// slope_deg is deliberately absent here because the deployed zone files do not
// carry it yet — build/fire_spread.py emits it, the published JSON predates it.
const ZONE = {
  id: 'gironde', label: 'Bordeaux et Gironde', lat: 44.8378, lon: -0.5792,
  radius_km: 50,
  fires: [
    { id: 'f1', lat: 44.86279, lon: -0.88013, detections: 79,
      frp_total: 3265.35, frp_max: 290.34, confidence: 'high', aircraft: 2,
      first_seen: '2026-07-28T01:13:00Z', last_seen: '2026-07-29T13:59:00Z' },
    { id: 'f2', lat: 44.21505, lon: -0.29534, detections: 22,
      frp_total: 320.57, frp_max: 93.42, confidence: 'nominal',
      first_seen: '2026-07-28T12:19:00Z', last_seen: '2026-07-29T02:34:00Z' },
  ],
  wind: [{ time: '2026-07-29T18:00', wind_kmh: 12.1, gust_kmh: 26.6,
           wind_dir: 265, wind_toward: 'E', humidity_pct: 51, temp_c: 36.5 }],
  spread: [
    { id: 'f1', model: 'rothermel-1972', validated: false, fuel_model: 'FM5',
      hours: 3, moisture: 0.081,
      arcs: [{ basis: 'mean', bearing: 85, ros_m_min: 14.99, distance_m: 2697.5, wind_kmh: 12.1 },
             { basis: 'gust', bearing: 85, ros_m_min: 43.25, distance_m: 7785.4, wind_kmh: 26.6 }] },
    { id: 'f2', model: 'rothermel-1972', validated: false, fuel_model: 'FM5',
      hours: 3, moisture: 0.114, slope_deg: 0.0, arcs: [] },
  ],
  terrain: null,
};

// Shaped on public/fr/data/water.json: a coverage list of surveyed areas plus
// the points themselves. Gironde has neither.
const WATER = {
  coverage: [
    { dep: '64', area: 'Pyrénées-Atlantiques', scope: 'departement', count: 14059 },
    { dep: '81', area: 'Tarn', scope: 'departement', count: 6691 },
    { dep: '35', area: 'Rennes Métropole', scope: 'local', count: 5133 },
  ],
  points: [
    // Inside a 50 km radius of the Landes centre, tagged 64: the neighbouring
    // register spilling north, not a survey of this zone.
    { id: 'p1', lat: 43.9, lon: -0.8, kind: 'borne', dep: '64', source: 'pei' },
    { id: 'p2', lat: 40.0, lon: 2.0, kind: 'borne', dep: '81', source: 'pei' },
  ],
};

const LANGS = ['fr', 'en'];

/* ---------------- modelled provenance ---------------- */

test('every modelled cell carries validated=false provenance', () => {
  for (const lang of LANGS) {
    const { rows } = triage({ zone: ZONE, lang });
    assert.ok(rows.length, 'no rows built');
    let modelled = 0;
    for (const row of rows) {
      for (const cell of row.cells) {
        if (!cell.modelled) continue;
        modelled++;
        // The mark is what a reader sees in a dense table; the note is what the
        // legend and the accessible name spell out.
        assert.equal(cell.mark, MODELLED_NOTE.mark, `${lang}: ${cell.label} lost its mark`);
        assert.match(cell.note, /validated=false/,
          `${lang}: ${cell.label} does not state validated=false`);
      }
    }
    assert.ok(modelled >= 4, `${lang}: only ${modelled} modelled cells found`);
  }
});

test('observed cells are never marked as modelled', () => {
  const { rows } = triage({ zone: ZONE, lang: 'fr' });
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.modelled) continue;
      assert.equal(cell.mark, '', `${cell.label} is observed but carries a model mark`);
      assert.equal(cell.note, '');
    }
  }
});

test('the model panel states its validation numerically and names what is untested', () => {
  for (const lang of LANGS) {
    const { model } = triage({ zone: ZONE, lang });
    const text = model.notes.join(' ');
    assert.match(text, /RMRS-GTR-371/);
    assert.match(text, /0[.,]0193\s*%/);        // the measured deviation, not "accurate"
    assert.match(text, /FM5/);
    assert.match(text, /571\s*m/);              // the slope sampling spacing
    assert.match(text, /2[.,]95/);              // scale dependence, both ends
    assert.match(text, /28[.,]43/);
    // The published check is a no-slope synthetic fuel bed, so neither FM5 nor
    // the slope term is covered by it. Saying so is the whole point of the page.
    assert.match(text, /tan/i);
    assert.equal(model.validated, false);
  }
});

test('a projection with no slope in the payload never renders as flat ground', () => {
  const { rows } = triage({ zone: ZONE, lang: 'fr' });
  const cell = rows.find((r) => r.id === 'f1').cells.find((c) => c.key === 'slope');
  assert.ok(cell, 'no slope cell');
  assert.doesNotMatch(cell.value, /^0/, 'absent slope rendered as zero');
  assert.match(cell.value, /non indiqué/i);
});

test('a zero slope is reported as flat-or-fallback, because the build cannot tell', () => {
  const { rows } = triage({ zone: ZONE, lang: 'fr' });
  const cell = rows.find((r) => r.id === 'f2').cells.find((c) => c.key === 'slope');
  assert.match(cell.value, /0/);
  assert.match(cell.note, /repli|plat/i);
});

test('a fire with no projection is listed, not dropped', () => {
  const bare = { ...ZONE, spread: [] };
  const { rows } = triage({ zone: bare, lang: 'fr' });
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.ok(row.cells.some((c) => c.key === 'ros'));
    assert.match(row.cells.find((c) => c.key === 'ros').value, /—|non/i);
  }
});

test('rows are ranked by radiative power so the biggest fire is first', () => {
  const { rows } = triage({ zone: ZONE, lang: 'fr' });
  assert.equal(rows[0].id, 'f1');
});

/* ---------------- what we cannot see ---------------- */

test('a zone with no water coverage says so in a sentence, never as zero or blank', () => {
  for (const lang of LANGS) {
    const w = waterStatement({ zone: ZONE, water: WATER, lang });
    assert.equal(w.visible, 0);
    assert.ok(w.text.length > 40, `${lang}: too terse to be honest: ${w.text}`);
    assert.notEqual(w.text.trim(), '0');
    // Absence of published points is absence of a published register.
    assert.match(w.text, /registre|register/i);
    // And it must name what is covered, so a reader can see this is not it.
    assert.match(w.text, /Pyrénées-Atlantiques/);
  }
});

test('points that spill in from a neighbouring register are not counted as coverage', () => {
  const landes = { ...ZONE, id: 'landes', lat: 44.0, lon: -0.7667 };
  const w = waterStatement({ zone: landes, water: WATER, lang: 'fr' });
  assert.equal(w.visible, 1);
  assert.equal(w.covered, false);
  assert.match(w.text, /Pyrénées-Atlantiques/);
});

test('unavailable water data reads as unknown, never as no water', () => {
  for (const lang of LANGS) {
    const w = waterStatement({ zone: ZONE, water: null, lang });
    assert.equal(w.visible, null);
    assert.ok(w.text.length > 20);
    assert.doesNotMatch(w.text, /^0/);
  }
});

test('the absent-ground-units statement is unconditional', () => {
  for (const lang of LANGS) {
    // Present with aircraft overhead, with none, and at any hour.
    for (const aircraft of [0, 2, 40]) {
      const ground = groundStatement({ lang });
      const air = airStatement({ aircraft, lang });
      assert.ok(ground.length > 30, `${lang}: ground statement missing`);
      assert.match(ground, /sol|ground/i);
      assert.ok(air.length > 0);
      // The two are separate sentences: a non-zero aircraft count must never
      // stand in for what is on the ground.
      assert.notEqual(ground, air);
    }
  }
});

test('the ground statement quantifies the gap rather than calling it partial', () => {
  const ground = groundStatement({ lang: 'fr' });
  assert.match(ground, /4/);    // OSM fire stations in the Gironde bbox
  assert.match(ground, /22/);   // SDIS datasets on data.gouv, none of them live
});

/* ---------------- closures ---------------- */

test('a closure with no in_force flag is reported as unstated, never as shut now', () => {
  const summary = {
    closures: [{ id: 'c1', road: 'N118', place: 'Sèvres', lat: 44.85, lon: -0.6,
                 since: '2026-01-13T12:38', until: '2027-01-13T11:00',
                 headline: 'N118 — PR0+176' }],
  };
  for (const lang of LANGS) {
    const { rows } = scheduledClosures({ zone: ZONE, summary, lang });
    assert.equal(rows.length, 1);
    assert.match(rows[0].state, /non indiqué|not stated/i);
  }
});

test('a closure that has not started yet is dated and marked not in force', () => {
  const summary = {
    closures: [{ id: 'c2', road: 'D3', place: 'Lacanau', lat: 44.85, lon: -0.6,
                 since: '2026-12-01T08:00', until: '2026-12-20T18:00',
                 in_force: false, headline: 'D3' }],
  };
  const { rows } = scheduledClosures({ zone: ZONE, summary, lang: 'fr' });
  assert.equal(rows[0].in_force, false);
  assert.match(rows[0].state, /pas encore|programm/i);
  assert.match(rows[0].dates, /2026-12-01/);
});

test('closures outside the zone radius are not listed', () => {
  const summary = {
    closures: [{ id: 'c3', road: 'N118', place: 'Sèvres', lat: 48.82, lon: 2.21,
                 in_force: true }],
  };
  const { rows } = scheduledClosures({ zone: ZONE, summary, lang: 'fr' });
  assert.equal(rows.length, 0);
});

/* ---------------- safety ---------------- */

// Everything the module can put on screen, both languages, gathered in one place
// so a new string cannot dodge the safety assertion.
function everyString() {
  const out = [];
  const summary = {
    closures: [{ id: 'c1', road: 'D3', place: 'Lacanau', lat: 44.85, lon: -0.6,
                 since: '2026-01-01T08:00', until: '2026-12-20T18:00',
                 in_force: true, headline: 'D3' }],
  };
  for (const lang of LANGS) {
    for (const zone of [ZONE, { ...ZONE, fires: [], spread: [] }]) {
      const { rows, model, emptyText } = triage({ zone, lang });
      out.push(...model.notes, model.title, emptyText);
      for (const row of rows) {
        for (const cell of row.cells) out.push(cell.label, cell.value, cell.note);
      }
      out.push(waterStatement({ zone, water: WATER, lang }).text);
      out.push(waterStatement({ zone, water: null, lang }).text);
      out.push(groundStatement({ lang }));
      for (const n of [0, 3]) out.push(airStatement({ aircraft: n, lang }));
      const c = scheduledClosures({ zone, summary, lang });
      out.push(c.text, ...c.rows.map((r) => `${r.state} ${r.dates} ${r.label}`));
    }
  }
  return out.filter(Boolean);
}

test('no string asserts safety, in either language', () => {
  const forbidden = [
    /en s[ée]curit[ée]/i, /aucun danger/i, /sans danger/i, /pas de risque/i,
    /vous êtes en s/i, /you are safe/i, /\bis safe\b/i, /\bno danger\b/i,
    /\ball clear\b/i, /rien à craindre/i,
  ];
  for (const s of everyString()) {
    for (const pattern of forbidden) {
      assert.doesNotMatch(s, pattern, `safety claim in: ${s}`);
    }
  }
  // "zones brûlées" is the other forbidden label: a detection is not a perimeter.
  for (const s of everyString()) {
    assert.doesNotMatch(s, /zones? br[ûu]l/i, `detection labelled as burned area: ${s}`);
  }
});

test('the page itself makes no safety claim and keeps page-relative paths', () => {
  const html = readFileSync('public/fr/pro.html', 'utf8');
  for (const pattern of [/en s[ée]curit[ée]/i, /aucun danger/i, /zones? br[ûu]l/i]) {
    assert.doesNotMatch(html, pattern);
  }
  // Page-relative only: a root-absolute path 404s on GitHub Pages.
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const url = match[1];
    if (/^(https?:|#|mailto:)/.test(url)) continue;
    assert.doesNotMatch(url, /^\//, `root-absolute path: ${url}`);
  }
});

test('the responder page is reachable and names who it is for', () => {
  // It shipped unlinked while the owner decided whether it should exist. That
  // decision has been taken, so the assertion that replaced it is the opposite
  // one: a reader arriving from the public map must learn immediately that this
  // page shows modelled figures the public page deliberately withholds.
  const zone = readFileSync('public/fr/zone.html', 'utf8');
  assert.match(zone, /pro\.html/, 'the local view must link the responder page');

  const page = readFileSync('public/fr/pro.html', 'utf8');
  const js = readFileSync('public/js/pro-page.js', 'utf8');
  assert.match(page + js, /pompier|responder|secours/i, 'the page must name its audience');
});

// The pure half above is covered directly. The DOM half fails silently: one
// typo'd id and a block renders blank, which on this surface means a modelled
// number quietly loses its provenance line. Check the contract instead.
test('every element the script writes to exists in the page', () => {
  const js = readFileSync('public/js/pro-page.js', 'utf8');
  const html = readFileSync('public/fr/pro.html', 'utf8');
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const wanted = [...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(wanted.length > 15, 'id extraction found nothing — check the pattern');
  for (const id of wanted) assert.ok(ids.has(id), `pro.html has no #${id}`);
  // The blocks the safety requirements hang on, named explicitly so removing one
  // from the markup fails here rather than shipping a page missing a caveat.
  for (const id of ['model-notes', 'legend', 'water-note', 'ground-note', 'air-note']) {
    assert.ok(ids.has(id), `pro.html lost #${id}`);
  }
});

test('a missing or empty zone degrades instead of throwing', () => {
  for (const zone of [null, {}, { fires: null }, { fires: [], spread: null }]) {
    assert.doesNotThrow(() => triage({ zone, lang: 'fr' }));
    assert.doesNotThrow(() => waterStatement({ zone, water: WATER, lang: 'fr' }));
    assert.doesNotThrow(() => scheduledClosures({ zone, summary: null, lang: 'fr' }));
  }
});
