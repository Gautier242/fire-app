// France wiring: address search, danger forecast, air quality.
//
// Deliberately its own entry point rather than a country flag inside app.js.
// The two pages load different data, answer different questions and have
// different layers; one file trying to be both would make the Canadian
// evacuation path harder to read, and that path is the safety-critical one.
import { createMap, FRANCE_CENTRE, FRANCE_ZOOM } from './mapview.js';
import { describeFr, DANGER_LABELS } from './rail-fr.js';
import { searchAddress } from './geocode.js';
import { observedPasses, pointsForPass } from './history.js';
import { LAYERS as SCAR_LAYERS, layerForYear, probeYear } from './effis.js';

const MODE_KEY = 'fire-near-me.fr.mode';
const LANG_KEY = 'fire-near-me.fr.lang';
const MIN_QUERY = 3;

const $ = (id) => document.getElementById(id);

let lang = load(LANG_KEY) || 'fr';
let mode = load(MODE_KEY) || 'simple';
let summary = null;
let departements = null;
// null = not asked for yet, false = asked for and unavailable. The distinction
// matters: a failed fetch must never render as a week with no fire in it.
let trail = null;
// The last burn-season verdict, kept so the language toggle can re-render its
// sentence without probing EFFIS again.
let scarVerdict = null;
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
    change: 'Changer', other: 'Canada', lang: 'English', local: 'Vue locale',
    updated: (m) => `Mis à jour il y a ${m} min`,
    stale: "Cette information date de plus d'une heure.",
    loading: 'Chargement…', failed: 'Données indisponibles.',
    today: "Aujourd'hui", tomorrow: 'Demain', air: "Qualité de l'air",
    unavailable: 'Niveau non disponible',
    fire: 'Chaleur détectée par satellite', detections: 'détections',
    wind: 'Vent', aircraftNear: 'aéronef(s) à proximité',
    aircraftNote: "Vole bas près d'un feu. Son rôle n'est pas confirmé.",
    industrial: 'Source industrielle',
    industrialNote: 'Brûle au même endroit tous les jours. Ce n\'est pas un feu de forêt.',
    outside: 'Hors de France',
    evacOrder: "ORDRE D'ÉVACUATION", evacAlert: "ALERTE d'évacuation",
    trailChip: 'Chaleur sur 7 jours',
    // Never "zones brûlées": these are 375 m pixels that were hot when a
    // satellite passed, not a mapped perimeter, and cloud leaves holes in them.
    trailNote: 'Chaleur détectée par satellite sur 7 jours. Ce n\'est pas un '
      + 'périmètre de feu : les nuages masquent la détection et un satellite ne '
      + 'passe que quelques fois par jour.',
    trailUnavailable: 'Historique sur 7 jours indisponible.',
    // Deliberately neutral while nothing is selected. A label reading "Zones
    // brûlées" beside an option reading "Aucune" would say "burnt areas: none",
    // which is the one thing this layer must never appear to claim.
    scarLabel: 'Saison passée', scarNone: 'Aucune',
    scarChecking: 'Vérification…',
    scarBurnt: (y) => `Brûlé pendant la saison ${y}`,
  },
  en: {
    locate: 'Check near me', checking: 'Checking…',
    picker: 'Or search an address', hint: 'Address, town or village',
    change: 'Change', other: 'Canada', lang: 'Français', local: 'Local view',
    updated: (m) => `Updated ${m} min ago`,
    stale: 'This information is more than an hour old.',
    loading: 'Loading…', failed: 'Data unavailable.',
    today: 'Today', tomorrow: 'Tomorrow', air: 'Air quality',
    unavailable: 'Level not available',
    fire: 'Heat detected by satellite', detections: 'detections',
    wind: 'Wind', aircraftNear: 'aircraft nearby',
    aircraftNote: 'Flying low near a fire. What it is doing is not confirmed.',
    industrial: 'Industrial source',
    industrialNote: 'Burns at the same spot every day. Not a wildfire.',
    outside: 'Outside France',
    evacOrder: 'EVACUATION ORDER', evacAlert: 'Evacuation ALERT',
    trailChip: 'Heat over 7 days',
    trailNote: 'Heat detected by satellite over 7 days. This is not a fire '
      + 'perimeter: cloud blocks detection and a satellite passes only a few '
      + 'times a day.',
    trailUnavailable: 'The 7-day history is unavailable.',
    scarLabel: 'Past season', scarNone: 'None',
    scarChecking: 'Checking…',
    scarBurnt: (y) => `Burnt during the ${y} season`,
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
  // Controls that are not chips: the burn-season picker. Leaving a scar drawn
  // after its control disappears would strand an archival layer on the map with
  // nothing on screen to say which year it is.
  document.querySelectorAll('[data-adv]:not(.chip)').forEach((el) => {
    el.hidden = mode !== 'advanced';
    if (el.hidden && view) {
      const pick = $('scar-year');
      if (pick) pick.value = '';
      view.setBurnScar(null);
      setScarNote('');
    }
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
  $('zone-link').textContent = t.local;
  // The trail chip carries an unavailability message when a fetch failed, so it
  // is only relabelled while it still reads as a working control.
  if (trail !== false) $('chip-trail').querySelector('span').textContent = t.trailChip;
  const scarPick = $('scar-year');
  if (scarPick) {
    [...scarPick.options].forEach((option) => {
      if (!option.value) { option.textContent = t.scarNone; return; }
      const entry = layerForYear(Number(option.value));
      if (entry) option.title = entry.label[lang] || entry.label.fr;
    });
    setScarNote(scarSentence());
  }
  if (summary && departements) drawMap();
  renderRail();
}

function setScarNote(text) {
  const label = $('scar-label');
  if (label) label.textContent = text || c().scarLabel;
}

// The sentence for a verdict, in the current language. Separate from the probe so
// the language toggle can re-render it without another request.
function scarSentence() {
  if (!scarVerdict) return '';
  if (scarVerdict.status === 'burns') return c().scarBurnt(scarVerdict.year);
  return scarVerdict.note?.[lang] || scarVerdict.note?.fr || '';
}

// Seven days of detections, loaded only when a reader asks for the layer. It is
// 223 KB, well outside the summary's budget, and most readers never open it.
async function showTrail(on) {
  if (!on) {
    view.drawHistory([]);
    view.toggle('history', false);
    return;
  }
  if (trail === null) {
    trail = await loadJSON('data/history.json').catch(() => false);
  }
  if (!trail || !trail.points || !trail.points.length) {
    // A failed fetch must not leave an empty layer looking like an empty week.
    $('chip-trail').setAttribute('aria-pressed', 'false');
    $('chip-trail').querySelector('span').textContent = c().trailUnavailable;
    return;
  }
  const passes = observedPasses(trail);
  // The whole window, not a three-pass slice: this is a trail, not a scrubber.
  view.drawHistory(pointsForPass(trail, passes, passes.length - 1, passes.length));
  view.toggle('history', true);
}

async function showScar(year) {
  if (!year) {
    view.setBurnScar(null);
    scarVerdict = null;
    setScarNote('');
    return;
  }
  const entry = layerForYear(Number(year));
  if (!entry) return;
  view.setBurnScar(entry);
  scarVerdict = null;
  setScarNote(c().scarChecking);
  // EFFIS serves a valid blank raster for a view with no burns, and an XML fault
  // for a year it does not hold. Both must say so rather than leave a silent
  // empty layer that reads as "nothing burned here".
  //
  // When there ARE burns the layer speaks for itself and the short dated label is
  // enough; the long note is reserved for the two cases where the map is blank,
  // because that is where silence would be read as an absence of fire.
  try {
    scarVerdict = await probeYear(Number(year));
  } catch {
    // A probe that could not run says nothing about the archive, so it falls back
    // to the dated statement rather than to a claim about what did not burn.
    scarVerdict = { year: Number(year), status: 'burns' };
  }
  setScarNote(scarSentence());
}

function drawMap() {
  view.drawFrance(summary, departements, {
    today: c().today, tomorrow: c().tomorrow, air: c().air,
    unavailable: c().unavailable, fire: c().fire, detections: c().detections,
    wind: c().wind, aircraftNear: c().aircraftNear, aircraftNote: c().aircraftNote,
    industrial: c().industrial, industrialNote: c().industrialNote,
    outside: c().outside,
    evacOrder: c().evacOrder, evacAlert: c().evacAlert,
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
      // The trail is lazy-loaded, so it owns its own toggle path.
      if (chip.dataset.layer === 'history') { showTrail(on); return; }
      view.toggle(chip.dataset.layer, on);
    };
  });

  const scarPick = $('scar-year');
  // The year alone in the option; the control's own label and aria-label carry
  // what the years mean. The catalogue's full sentence is the option title, so
  // the provenance stays reachable without truncating the toolbar.
  SCAR_LAYERS.forEach((entry) => {
    const option = document.createElement('option');
    option.value = String(entry.year);
    option.textContent = String(entry.year);
    option.title = entry.label[lang] || entry.label.fr;
    scarPick.append(option);
  });
  scarPick.onchange = () => showScar(scarPick.value);
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
  ['danger', 'fires', 'closures', 'aircraft', 'orders', 'alerts']
    .forEach((n) => view.toggle(n, true));
  renderRail();
}

boot().catch((err) => {
  $('freshness-text').textContent = c().failed;
  console.error(err);
});
