// Wiring: loads data, resolves a location, renders the rail and the map,
// and remembers the detail level. Everything it decides lives elsewhere.
import { t, STRINGS } from './i18n.js';
import { locateBrowser, provinceAt, savePlace, savedPlace, searchPlaces } from './location.js';
import { createMap } from './mapview.js';
import { describe } from './rail.js';
import { observedPasses, passLabel, pointsForPass, windAt, windToward } from './history.js';

const MODE_KEY = 'fire-near-me.mode';
const LANG_KEY = 'fire-near-me.lang';
const ADVANCED_ONLY = ['satellite', 'closures', 'aqhi', 'aircraft', 'history'];

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

}

function applyMode() {
  $('shell').dataset.mode = mode;
  // Minimal hides the map, and the dial lives over the map. Move it into the
  // rail rather than leaving the only way out of minimal inside the thing
  // minimal hides.
  $(mode === 'minimal' ? 'rail' : 'map').append($('dial'));
  document.querySelectorAll('#modes button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  });
  document.querySelectorAll('.chip[data-adv]').forEach((c) => {
    // A chip for a layer with nothing in it is a promise the data cannot keep.
    const section = { closures: 'closures', aircraft: 'aircraft' }[c.dataset.layer];
    const available = !section || (summary && (summary[section] || []).length > 0);
    c.hidden = (mode !== 'advanced') || !available;
    if (c.hidden) view && view.toggle(c.dataset.layer, false);
  });
  // The scrubber belongs to the history layer and follows it out of Advanced.
  if (mode !== 'advanced') $('scrubber').hidden = true;
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
  $('place-search').placeholder = t(lang, 'search_hint');
  $('lang').textContent = lang === 'en' ? 'Français' : 'English';
  $('change-place').textContent = lang === 'en' ? 'Change' : 'Changer';
  renderRail();
}

/* ---------------- location ---------------- */

function adopt(p, label) {
  point = p;
  $('locate').hidden = true;
  $('place').hidden = false;
  $('place-name').textContent = label
    || `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`;
  $('place-search').value = '';
  $('place-results').innerHTML = '';
  if (view) view.setYou(p);
  renderRail();
}

// The gazetteer is 1.9 MB, so it is fetched on the first keystroke rather than
// at page load. Caching the promise, not the result, keeps fast typing from
// starting a second download.
function loadPlaces() {
  if (!places) places = loadJSON('static/places.json');
  return places;
}

/* ---------------- spread scrubber ---------------- */

let historyLoad = null;   // the in-flight or settled fetch
let history = null;       // the parsed payload, once it arrives
let passes = [];

// 45 KB gzipped, and only the Advanced view ever draws it, so it is fetched the
// first time the layer is switched on rather than at page load. The promise is
// cached, not the result, so toggling twice cannot start a second download.
function ensureHistory() {
  if (!historyLoad) historyLoad = loadJSON('data/history.json').catch(() => null);
  return historyLoad;
}

function renderPass(index) {
  if (!passes.length || !history) return;
  const hour = passes[index];
  const points = pointsForPass(history, passes, index);
  view.drawHistory(points);

  $('scrub-when').textContent = passLabel(history, hour, lang);
  $('scrub-count').textContent = t(lang, 'scrub_count',
    { n: points.filter((p) => p.age === 0).length });

  // Wind belongs to the pass being shown, not to now.
  const wind = windAt(history, hour);
  $('scrub-wind').textContent = wind
    ? t(lang, 'scrub_wind', {
        speed: Math.round(wind.speed),
        toward: t(lang, `dir_${windToward(wind.direction)}`),
      })
    : '';
}

async function showScrubber(on) {
  const box = $('scrubber');
  if (!on) { box.hidden = true; return; }

  const data = await ensureHistory();
  if (!data || !data.points) {
    box.hidden = false;
    $('scrub-when').textContent = t(lang, 'scrub_none');
    return;
  }
  history = data;
  passes = observedPasses(data);
  if (!passes.length) {
    box.hidden = false;
    $('scrub-when').textContent = t(lang, 'scrub_none');
    return;
  }

  const slider = $('scrub');
  slider.max = String(passes.length - 1);
  slider.value = String(passes.length - 1); // newest pass first
  slider.oninput = () => renderPass(Number(slider.value));
  box.hidden = false;
  renderPass(passes.length - 1);
}

function wirePicker() {
  const input = $('place-search');
  const results = $('place-results');
  input.oninput = async () => {
    const list = await loadPlaces();
    // Re-read the value after the await: the first keystroke waits on a 1.9 MB
    // download, by which time the query has usually moved on.
    const matches = searchPlaces(input.value, list, 8);
    results.innerHTML = '';
    for (const place of matches) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.textContent = place.n;
      const prov = document.createElement('span');
      prov.textContent = ` ${place.p}`;
      button.append(prov);
      button.onclick = () => {
        savePlace(place);
        adopt({ lat: place.lat, lon: place.lon }, `${place.n}, ${place.p}`);
      };
      li.append(button);
      results.append(li);
    }
  };
}

function showPicker() {
  $('place-search').focus();
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
      if (c.dataset.layer === 'history') showScrubber(on);
    };
  });
  $('lang').onclick = () => {
    lang = lang === 'en' ? 'fr' : 'en';
    store(LANG_KEY, lang);
    applyLanguage();
  };
  $('locate').onclick = locate;
  $('change-place').onclick = showPicker;
  wirePicker();

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
