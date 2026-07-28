// Wiring: loads data, resolves a location, renders the rail and the map,
// and remembers the detail level. Everything it decides lives elsewhere.
import { t, STRINGS } from './i18n.js';
import { locateBrowser, provinceAt, savePlace, savedPlace, searchPlaces } from './location.js';
import { createMap } from './mapview.js';
import { describe } from './rail.js';

const MODE_KEY = 'fire-near-me.mode';
const LANG_KEY = 'fire-near-me.lang';
const ADVANCED_ONLY = ['satellite', 'closures'];

const $ = (id) => document.getElementById(id);

let lang = load(LANG_KEY) || ((navigator.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en');
let mode = load(MODE_KEY) || 'simple';
let summary = null;
let coverage = null;
let places = null;
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

/* ---------------- rendering ---------------- */

function renderFreshness() {
  if (!summary) return;
  const ages = (summary.sources || [])
    .map((s) => (s.fetched_at ? Math.round((Date.now() - new Date(s.fetched_at).getTime()) / 60000) : null))
    .filter((m) => m !== null);
  const age = ages.length ? Math.max(...ages) : null;
  const stale = age === null || age > 60;
  $('freshness').className = stale ? 'live stale' : 'live';
  $('freshness-text').textContent = age === null
    ? t(lang, 'stale_warning')
    : t(lang, 'updated', { minutes: age }) + (stale ? ` — ${t(lang, 'stale_warning')}` : '');
  $('source-count').textContent = t(lang, 'sources_count', { n: (summary.sources || []).length });
}

function renderRail() {
  renderFreshness();
  if (!summary || !point) return;
  const province = coverage ? provinceAt(point, coverage) : null;
  const d = describe({ summary, point, province, lang });

  $('answer').hidden = false;
  $('tag').className = `tag ${d.level}`;
  $('tag-text').textContent = d.tag;
  $('headline').textContent = d.headline;
  $('subline').textContent = d.sub;

  const facts = $('facts');
  facts.innerHTML = '';
  facts.hidden = (mode === 'minimal');
  const rows = mode === 'minimal' ? [] : d.facts;
  for (const f of rows) {
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
  if (d.note && mode !== 'minimal') {
    const row = document.createElement('div');
    row.className = 'fact';
    const p = document.createElement('div');
    p.className = 'note';
    p.textContent = d.note;
    row.append(p);
    facts.append(row);
  }

  const official = $('official');
  if (d.official) {
    official.hidden = false;
    $('official-text').textContent = d.official.text;
    $('official-link').textContent = d.official.label;
    $('official-link').href = d.official.url;
  } else {
    official.hidden = true;
  }

  $('freshness').className = d.stale ? 'live stale' : 'live';
  $('freshness-text').textContent = d.age === null
    ? t(lang, 'stale_warning')
    : t(lang, 'updated', { minutes: d.age }) + (d.stale ? ` — ${t(lang, 'stale_warning')}` : '');
  $('source-count').textContent = t(lang, 'sources_count', { n: (summary.sources || []).length });
}

function applyMode() {
  $('shell').dataset.mode = mode;
  document.querySelectorAll('#modes button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  });
  document.querySelectorAll('.chip[data-adv]').forEach((c) => {
    const available = c.dataset.layer !== 'closures'
      || (summary && view && view.hasClosures(summary));
    c.hidden = (mode !== 'advanced') || !available;
    if (c.hidden) view && view.toggle(c.dataset.layer, false);
  });
  // Advanced-only layers switch off entirely when we leave advanced.
  if (mode !== 'advanced' && view) ADVANCED_ONLY.forEach((n) => view.toggle(n, false));
  else if (view) {
    document.querySelectorAll('.chip[data-adv]').forEach((c) => {
      if (!c.hidden) view.toggle(c.dataset.layer, c.getAttribute('aria-pressed') === 'true');
    });
  }
  if (view && mode !== 'minimal') setTimeout(() => view.invalidate(), 0);
  renderRail();
}

function applyLanguage() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-t]').forEach((el) => {
    el.textContent = t(lang, el.dataset.t);
  });
  $('locate').textContent = t(lang, 'check_button');
  $('picker-label').textContent = t(lang, 'choose_place');
  $('lang').textContent = lang === 'en' ? 'Français' : 'English';
  $('change-place').textContent = lang === 'en' ? 'Change' : 'Changer';
  renderRail();
}

/* ---------------- location ---------------- */

function adopt(p, label) {
  point = p;
  $('locate').hidden = true;
  $('picker').hidden = true;
  $('place').hidden = false;
  $('place-name').textContent = label
    || `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`;
  if (view) view.setYou(p);
  renderRail();
}

async function showPicker() {
  $('picker').hidden = false;
  $('locate').hidden = true;
  if (!places) places = await loadJSON('static/places.json');
  const input = $('place-search');
  const results = $('place-results');
  input.value = '';
  results.innerHTML = '';
  input.oninput = () => {
    results.innerHTML = '';
    for (const place of searchPlaces(input.value, places, 8)) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.innerHTML = `${place.n} <span>${place.p}</span>`;
      button.onclick = () => {
        savePlace(place);
        adopt({ lat: place.lat, lon: place.lon }, `${place.n}, ${place.p}`);
      };
      li.append(button);
      results.append(li);
    }
  };
  input.focus();
}

async function locate() {
  $('locate').textContent = t(lang, 'checking');
  try {
    const p = await locateBrowser();
    adopt(p, null);
  } catch {
    await showPicker();
  } finally {
    $('locate').textContent = t(lang, 'check_button');
  }
}

/* ---------------- boot ---------------- */

async function boot() {
  view = createMap('map');

  document.querySelectorAll('#modes button').forEach((b) => {
    b.onclick = () => { mode = b.dataset.mode; store(MODE_KEY, mode); applyMode(); };
  });
  document.querySelectorAll('#basemap button').forEach((b) => {
    b.onclick = () => {
      view.setBase(b.dataset.base);
      document.querySelectorAll('#basemap button').forEach((x) => {
        x.setAttribute('aria-pressed', String(x === b));
      });
    };
  });
  document.querySelectorAll('.chip').forEach((c) => {
    c.onclick = () => {
      const on = c.getAttribute('aria-pressed') !== 'true';
      c.setAttribute('aria-pressed', String(on));
      view.toggle(c.dataset.layer, on);
    };
  });
  $('lang').onclick = () => {
    lang = lang === 'en' ? 'fr' : 'en';
    store(LANG_KEY, lang);
    applyLanguage();
  };
  $('locate').onclick = locate;
  $('change-place').onclick = showPicker;

  // OS themes flip at sunset. Without this the rail follows and the basemap
  // does not, leaving a dark panel against a white map.
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const onThemeChange = () => view.refreshBase();
  if (darkQuery.addEventListener) darkQuery.addEventListener('change', onThemeChange);
  else darkQuery.addListener(onThemeChange);

  applyLanguage();
  applyMode();

  [summary, coverage] = await Promise.all([
    loadJSON('data/summary.json'),
    loadJSON('static/coverage.geojson'),
  ]);

  view.draw(summary);
  ['fires', 'orders', 'alerts'].forEach((n) => view.toggle(n, true));
  applyMode();
  renderFreshness();

  // Label the satellite layer with the date it actually shows.
  view.resolveImagery().then((date) => {
    const label = document.querySelector('.chip[data-layer="satellite"] span');
    if (label) label.textContent = `${t(lang, 'layer_satellite')} · ${date.slice(5)}`;
  });

  const saved = savedPlace();
  if (saved) adopt({ lat: saved.lat, lon: saved.lon }, `${saved.n}, ${saved.p}`);
}

boot().catch((err) => {
  $('freshness-text').textContent = t(lang, 'stale_warning');
  console.error(err);
});
