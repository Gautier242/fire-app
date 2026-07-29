// France wiring: address search, danger forecast, air quality.
//
// Deliberately its own entry point rather than a country flag inside app.js.
// The two pages load different data, answer different questions and have
// different layers; one file trying to be both would make the Canadian
// evacuation path harder to read, and that path is the safety-critical one.
import { createMap, FRANCE_CENTRE, FRANCE_ZOOM } from './mapview.js';
import { describeFr, DANGER_LABELS } from './rail-fr.js';
import { searchAddress } from './geocode.js';

const MODE_KEY = 'fire-near-me.fr.mode';
const LANG_KEY = 'fire-near-me.fr.lang';
const MIN_QUERY = 3;

const $ = (id) => document.getElementById(id);

let lang = load(LANG_KEY) || 'fr';
let mode = load(MODE_KEY) || 'simple';
let summary = null;
let departements = null;
let communes = null;
let point = null;
let view = null;

function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function store(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private browsing */ }
}

async function loadJSON(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

const COPY = {
  fr: {
    locate: 'Vérifier près de chez moi', checking: 'Vérification…',
    picker: 'Ou cherchez une adresse', hint: 'Adresse, ville ou village',
    change: 'Changer', other: 'Canada', lang: 'English',
    updated: (m) => `Mis à jour il y a ${m} min`,
    stale: "Cette information date de plus d'une heure.",
    loading: 'Chargement…', failed: 'Données indisponibles.',
    today: "Aujourd'hui", tomorrow: 'Demain', air: "Qualité de l'air",
    unavailable: 'Niveau non disponible',
  },
  en: {
    locate: 'Check near me', checking: 'Checking…',
    picker: 'Or search an address', hint: 'Address, town or village',
    change: 'Change', other: 'Canada', lang: 'Français',
    updated: (m) => `Updated ${m} min ago`,
    stale: 'This information is more than an hour old.',
    loading: 'Loading…', failed: 'Data unavailable.',
    today: 'Today', tomorrow: 'Tomorrow', air: 'Air quality',
    unavailable: 'Level not available',
  },
};

const c = () => COPY[lang === 'en' ? 'en' : 'fr'];

/* ---------------- rendering ---------------- */

function renderFreshness() {
  if (!summary) return;
  const ages = (summary.sources || [])
    .map((s) => (s.fetched_at ? Math.round((Date.now() - new Date(s.fetched_at).getTime()) / 60000) : null))
    .filter((m) => m !== null);
  const age = ages.length ? Math.min(...ages) : null;
  // Météo des forêts publishes once a day around 14:50 UTC, so a bulletin many
  // hours old is normal rather than stale. Freshness tracks the build, not the
  // bulletin, and the bulletin carries its own issued_at in the rail.
  const stale = age === null || age > 120;
  $('freshness').className = stale ? 'live stale' : 'live';
  $('freshness-text').textContent = age === null ? c().failed
    : c().updated(age) + (stale ? ` — ${c().stale}` : '');
}

function renderRail() {
  renderFreshness();
  if (!summary) return;

  // FR-Alert is stated whether or not we know where the reader is. It is the
  // one thing the app must always say.
  const always = describeFr({ summary, point: point || {}, lang });
  $('alert-text').textContent = always.alert.text;
  $('alert-link').textContent = always.alert.label;
  $('alert-link').href = always.alert.url;

  if (!point) return;
  const d = describeFr({ summary, point, lang });

  $('answer').hidden = false;
  $('tag').className = `tag ${d.tone}`;
  $('tag-text').textContent = d.level === null ? c().unavailable : `${d.level}/4`;
  $('headline').textContent = d.headline;
  $('subline').textContent = mode === 'minimal' ? '' : d.sub;

  const facts = $('facts');
  facts.innerHTML = '';
  facts.hidden = (mode === 'minimal');
  if (mode !== 'minimal') {
    for (const f of d.facts) {
      const row = document.createElement('div');
      row.className = 'fact';
      const dt = document.createElement('dt');
      dt.textContent = f.label;
      const dd = document.createElement('dd');
      dd.textContent = f.value;
      if (f.tone) dd.className = f.tone;
      row.append(dt, dd);
      facts.append(row);
    }
  }
}

function applyMode() {
  $('shell').dataset.mode = mode;
  $(mode === 'minimal' ? 'rail' : 'map').append($('dial'));
  document.querySelectorAll('#modes button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  });
  document.querySelectorAll('.chip[data-adv]').forEach((chip) => {
    chip.hidden = mode !== 'advanced';
    if (chip.hidden && view) view.toggle(chip.dataset.layer, false);
  });
  if (view && mode !== 'minimal') setTimeout(() => view.invalidate(), 0);
  renderRail();
}

function applyLanguage() {
  document.documentElement.lang = lang;
  const t = c();
  $('locate').textContent = t.locate;
  $('picker-label').textContent = t.picker;
  $('place-search').placeholder = t.hint;
  $('change-place').textContent = t.change;
  $('lang').textContent = t.lang;
  $('ca-link').textContent = t.other;
  if (summary && departements) drawMap();
  renderRail();
}

function drawMap() {
  view.drawFrance(summary, departements, {
    today: c().today, tomorrow: c().tomorrow, air: c().air,
    unavailable: c().unavailable,
    level: DANGER_LABELS[lang === 'en' ? 'en' : 'fr'],
  });
}

/* ---------------- location ---------------- */

// INSEE codes carry the département in their first two characters, or three
// overseas (971-976). Deriving it here means no extra lookup.
function depFromInsee(code) {
  if (!code) return null;
  return code.startsWith('97') ? code.slice(0, 3) : code.slice(0, 2);
}

function adopt(p, label) {
  point = p;
  $('locate').hidden = true;
  $('place').hidden = false;
  $('place-name').textContent = label;
  $('place-search').value = '';
  $('place-results').innerHTML = '';
  if (view) view.setYou(p);
  renderRail();
}

function loadCommunes() {
  if (!communes) communes = loadJSON('../static/fr/communes.json').catch(() => null);
  return communes;
}

// BAN is the primary search because France publishes street-level geocoding and
// a resident thinks in addresses. The commune list is the offline fallback for
// when BAN is unreachable — a search box that dies with the network is worse
// than a coarser one that works.
async function runSearch(query) {
  const results = $('place-results');
  const hits = await searchAddress(query, { limit: 6 });
  if (hits.length) return hits.map((h) => ({
    label: h.label, lat: h.lat, lon: h.lon, dep: depFromInsee(h.citycode || h.postcode),
  }));

  const data = await loadCommunes();
  if (!data) return [];
  const idx = Object.fromEntries(data.fields.map((f, i) => [f, i]));
  const needle = query.trim().toLowerCase();
  return data.communes
    .filter((row) => String(row[idx.nom]).toLowerCase().startsWith(needle))
    .slice(0, 6)
    .map((row) => ({
      label: `${row[idx.nom]} (${row[idx.departement]})`,
      lat: row[idx.lat], lon: row[idx.lon], dep: String(row[idx.departement]),
    }));
}

function wirePicker() {
  const input = $('place-search');
  const results = $('place-results');
  let seq = 0;
  input.oninput = async () => {
    const mine = ++seq;
    const query = input.value;
    if (query.trim().length < MIN_QUERY) { results.innerHTML = ''; return; }
    const hits = await runSearch(query);
    // A slower earlier keystroke must not overwrite a newer result.
    if (mine !== seq) return;
    results.innerHTML = '';
    for (const hit of hits) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.textContent = hit.label;
      button.onclick = () => adopt({ lat: hit.lat, lon: hit.lon, dep: hit.dep }, hit.label);
      li.append(button);
      results.append(li);
    }
  };
}

async function locate() {
  $('locate').textContent = c().checking;
  try {
    const pos = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 }));
    const { latitude: lat, longitude: lon } = pos.coords;
    // Reverse-geocode to get the INSEE code, and so the département.
    const hits = await searchAddress(`${lat},${lon}`, { limit: 1 }).catch(() => []);
    const dep = hits.length ? depFromInsee(hits[0].citycode) : null;
    adopt({ lat, lon, dep }, hits.length ? hits[0].label : `${lat.toFixed(3)}, ${lon.toFixed(3)}`);
  } catch {
    $('place-search').focus();
  } finally {
    $('locate').textContent = c().locate;
  }
}

/* ---------------- boot ---------------- */

async function boot() {
  view = createMap('map', { center: FRANCE_CENTRE, zoom: FRANCE_ZOOM });

  document.querySelectorAll('#modes button').forEach((b) => {
    b.onclick = () => { mode = b.dataset.mode; store(MODE_KEY, mode); applyMode(); };
  });
  document.querySelectorAll('#basemap button').forEach((b) => {
    b.onclick = () => {
      view.setBase(b.dataset.base);
      document.querySelectorAll('#basemap button').forEach((x) =>
        x.setAttribute('aria-pressed', String(x === b)));
    };
  });
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.onclick = () => {
      const on = chip.getAttribute('aria-pressed') !== 'true';
      chip.setAttribute('aria-pressed', String(on));
      view.toggle(chip.dataset.layer, on);
    };
  });
  $('lang').onclick = () => {
    lang = lang === 'fr' ? 'en' : 'fr';
    store(LANG_KEY, lang);
    applyLanguage();
  };
  $('locate').onclick = locate;
  $('change-place').onclick = () => $('place-search').focus();
  wirePicker();

  applyLanguage();
  applyMode();

  [summary, departements] = await Promise.all([
    loadJSON('data/summary.json'),
    loadJSON('../static/fr/departements.geojson').catch(() => null),
  ]);

  drawMap();
  view.toggle('danger', true);
  renderRail();
}

boot().catch((err) => {
  $('freshness-text').textContent = c().failed;
  console.error(err);
});
