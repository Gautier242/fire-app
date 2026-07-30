// Wiring for the local view. Owns the DOM; every decision about what to say
// lives in local.js, helping.js and rail-fr.js.
//
// The five questions, in the order somebody in danger asks them: am I in danger,
// where is it going, where must I not go, who is fighting it, what can I do.
import { createMap } from './mapview.js';
import { describeLocal } from './local.js';
import { describeFr } from './rail-fr.js';
import { actionsFor, SKILLS } from './helping.js';
import { LAYERS, availableDates } from './imagery.js';
import { fetchViewport, MIN_ZOOM } from './overpass.js';
import { haversineKm } from './geo.js';

const LANG_KEY = 'fire-near-me.fr.lang';
const SKILLS_KEY = 'fire-near-me.fr.skills';

const $ = (id) => document.getElementById(id);

let lang = load(LANG_KEY) || 'fr';
let skills = (load(SKILLS_KEY) || '').split(',').filter(Boolean);
let zone = null;
let summary = null;
let point = null;
let view = null;
let dates = [];
let detailAbort = null;

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
    lang: 'English', zonePick: 'Zone', back: 'Carte France', sources: 'Sources',
    loading: 'Chargement…', failed: 'Données indisponibles.',
    updated: (m) => `Mis à jour il y a ${m} min`,
    stale: "Cette information date de plus d'une heure.",
    urgency: { high: 'Proche', medium: 'À surveiller', low: 'Éloigné', none: 'Rien de détecté' },
    spreadTitle: 'Où le feu se dirige',
    arc: { mean: 'Vent moyen', gust: 'Rafales' },
    arcLine: (basis, km, h) => `${basis} : jusqu'à ${km} km en ${h} h`,
    avoidTitle: 'Où ne pas aller',
    avoidPath: "N'entrez pas dans la zone hachurée : c'est le trajet que le modèle donne au feu.",
    avoidNone: 'Aucune route coupée signalée dans cette zone. Bison Futé ne voit que le réseau national.',
    forcesTitle: 'Moyens visibles',
    aircraft: (n) => `${n} aéronef(s) observé(s) à proximité.`,
    noAircraftDay: "Aucun aéronef observé dans les dernières minutes. Cela ne veut pas dire qu'il n'y en a pas.",
    noAircraftNight: "Aucun aéronef : les moyens aériens ne volent pas de nuit.",
    skillsSummary: 'Ce que je peux faire',
    noImagery: 'Aucune image', imageryLabel: 'Image satellite',
    scrubLabel: "Date de l'image",
    scrubNote: 'Une date sans passage reste vide. Personne n\'a regardé ce jour-là.',
    detailHint: `Zoomez (niveau ${MIN_ZOOM}) pour voir bâtiments et rues.`,
    detailLoading: 'Chargement des bâtiments et rues…',
    detailEmpty: 'Bâtiments et rues indisponibles (service OpenStreetMap saturé). Réessayez dans un instant.',
  },
  en: {
    lang: 'Français', zonePick: 'Zone', back: 'France map', sources: 'Sources',
    loading: 'Loading…', failed: 'Data unavailable.',
    updated: (m) => `Updated ${m} min ago`,
    stale: 'This information is more than an hour old.',
    urgency: { high: 'Close', medium: 'Watch', low: 'Distant', none: 'Nothing detected' },
    spreadTitle: 'Where the fire is going',
    arc: { mean: 'Mean wind', gust: 'Gusts' },
    arcLine: (basis, km, h) => `${basis}: up to ${km} km in ${h} h`,
    avoidTitle: 'Where not to go',
    avoidPath: 'Do not enter the hatched area: that is the path the model gives the fire.',
    avoidNone: 'No closed roads reported in this zone. Bison Futé only sees the national network.',
    forcesTitle: 'Visible response',
    aircraft: (n) => `${n} aircraft observed nearby.`,
    noAircraftDay: 'No aircraft observed in the last few minutes. That does not mean there are none.',
    noAircraftNight: 'No aircraft: air support does not fly at night.',
    skillsSummary: 'What I can do',
    noImagery: 'No imagery', imageryLabel: 'Satellite imagery',
    scrubLabel: 'Image date',
    scrubNote: 'A date with no pass stays blank. Nobody looked that day.',
    detailHint: `Zoom in (level ${MIN_ZOOM}) to see buildings and streets.`,
    detailLoading: 'Loading buildings and streets…',
    detailEmpty: 'Buildings and streets unavailable (OpenStreetMap service busy). Try again shortly.',
  },
};

const c = () => COPY[lang === 'en' ? 'en' : 'fr'];

// Without an address, the zone centre is the reader's position. Every distance
// on the page is measured from here.
const at = () => point
  || (zone ? { lat: zone.lat, lon: zone.lon } : { lat: 46.6, lon: 2.5 });

/* ---------------- rendering ---------------- */

function renderFreshness() {
  const ages = ((summary && summary.sources) || [])
    .map((s) => (s.fetched_at ? Math.round((Date.now() - new Date(s.fetched_at).getTime()) / 60000) : null))
    .filter((m) => m !== null);
  const age = ages.length ? Math.min(...ages) : null;
  const stale = age === null || age > 120;
  $('freshness').className = stale ? 'live stale' : 'live';
  $('freshness-text').textContent = age === null ? c().failed
    : c().updated(age) + (stale ? ` — ${c().stale}` : '');
}

function renderFacts(facts) {
  const box = $('facts');
  box.innerHTML = '';
  for (const f of facts) {
    const row = document.createElement('div');
    row.className = 'fact';
    const dt = document.createElement('dt');
    dt.textContent = f.label;
    const dd = document.createElement('dd');
    dd.textContent = f.value;
    if (f.tone) dd.className = f.tone;
    row.append(dt, dd);
    box.append(row);
  }
}

function renderSpread(spread) {
  const block = $('spread-block');
  block.hidden = !spread;
  if (!spread) return;
  $('spread-title').textContent = c().spreadTitle;
  $('spread-verdict').textContent = spread.verdict;
  $('spread-verdict').className = `verdict${spread.towardYou ? ' toward' : ''}`;

  // Both arcs reach the reader. One number would imply a precision the model
  // does not have.
  const list = $('spread-arcs');
  list.innerHTML = '';
  for (const arc of spread.arcs) {
    const li = document.createElement('li');
    li.textContent = c().arcLine(
      c().arc[arc.basis] || arc.basis,
      (arc.distance_m / 1000).toFixed(1),
      3);
    list.append(li);
  }
  // The build stamps validated=false and the interface must say so.
  $('spread-caveat').textContent = spread.caveat;
}

// Closures near the zone, plus the projected path. Bison Futé publishes points
// on the national network only, so its silence is not an all-clear.
function renderAvoid(closures) {
  $('avoid-title').textContent = c().avoidTitle;
  $('avoid-note').textContent = closures.length ? c().avoidPath : c().avoidNone;
  const list = $('avoid-list');
  list.innerHTML = '';
  for (const closure of closures.slice(0, 8)) {
    const li = document.createElement('li');
    li.textContent = `${closure.road} — ${closure.place}`;
    list.append(li);
  }
}

// Aircraft are an observation. Ground units are never published, so an empty
// count must not read as nobody coming.
function renderForces(forces) {
  $('forces-title').textContent = c().forcesTitle;
  const hour = new Date().getHours();
  $('forces-air').textContent = forces.aircraft
    ? `${c().aircraft(forces.aircraft)} ${forces.caveat}`
    : (hour >= 21 || hour < 6 ? c().noAircraftNight : c().noAircraftDay);
  $('forces-ground').textContent = forces.groundNote;
}

function renderActions(nearestKm) {
  const list = $('actions');
  list.innerHTML = '';
  for (const action of actionsFor(skills, { nearestFireKm: nearestKm }, lang)) {
    const li = document.createElement('li');
    li.textContent = action.do;
    const why = document.createElement('span');
    why.className = 'why';
    why.textContent = action.why;
    const chan = document.createElement('span');
    chan.className = 'chan';
    chan.textContent = action.channel;
    li.append(why, chan);
    list.append(li);
  }
}

function renderSkills() {
  const box = $('skills-list');
  box.innerHTML = '';
  for (const skill of SKILLS) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = skill.id;
    input.checked = skills.includes(skill.id);
    input.onchange = () => {
      skills = input.checked
        ? [...skills, skill.id]
        : skills.filter((id) => id !== skill.id);
      store(SKILLS_KEY, skills.join(','));
      renderActions(describeLocal({ zone, point: at(), lang }).nearestKm);
    };
    label.append(input, document.createTextNode(skill.label[lang === 'en' ? 'en' : 'fr']));
    box.append(label);
  }
}

function nearbyClosures() {
  if (!zone || !summary) return [];
  return (summary.closures || []).filter((closure) =>
    closure.lat !== null && closure.lat !== undefined
    && haversineKm(zone, closure) <= zone.radius_km);
}

function render() {
  renderFreshness();
  if (!zone) return;

  const d = describeLocal({ zone, point: at(), lang });

  $('tag').className = `tag ${d.urgency === 'high' ? 'danger'
    : d.urgency === 'medium' ? 'caution' : 'safe'}`;
  $('tag-text').textContent = c().urgency[d.urgency];
  $('headline').textContent = d.headline;
  // Absence is never safety: with nothing detected, the satellite-lag line is
  // the answer rather than an all-clear.
  $('subline').textContent = d.sub;

  renderFacts(d.facts);
  renderSpread(d.spread);
  renderAvoid(nearbyClosures());
  renderForces(d.forces);
  renderActions(d.nearestKm);

  const always = describeFr({ summary, point: at(), lang });
  $('alert-text').textContent = always.alert.text;
  $('alert-link').textContent = always.alert.label;
  $('alert-link').href = always.alert.url;

  drawMap(d);
}

function drawMap(d) {
  view.drawLocal({ ...zone, closures: nearbyClosures() }, {
    fire: lang === 'en' ? 'Heat detected by satellite' : 'Chaleur détectée par satellite',
    detections: lang === 'en' ? 'detections' : 'détections',
    lastSeen: lang === 'en' ? 'Last seen' : 'Vu à',
    spreadMean: c().arc.mean,
    spreadGust: c().arc.gust,
    inHours: (h) => (lang === 'en' ? `in ${h} h` : `en ${h} h`),
    // The same caveat the rail carries. A wedge clicked on the map must not be
    // the one place the model's status goes missing.
    spreadCaveat: d.spread ? d.spread.caveat : '',
  });
}

/* ---------------- imagery ---------------- */

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function currentLayer() {
  return LAYERS.find((l) => l.id === $('imagery').value) || null;
}

function applyImagery() {
  const layer = currentLayer();
  const date = dates[Number($('scrub').value)] || dates[0];
  $('scrubber').hidden = !(layer && layer.dated);
  $('scrub-date').textContent = date;
  view.setImagery(layer, date);
}

function fillImagery() {
  const select = $('imagery');
  const chosen = select.value;
  select.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = c().noImagery;
  select.append(none);
  for (const layer of LAYERS) {
    const option = document.createElement('option');
    option.value = layer.id;
    option.textContent = layer.label[lang === 'en' ? 'en' : 'fr'];
    select.append(option);
  }
  select.value = chosen;
  select.setAttribute('aria-label', c().imageryLabel);
}

/* ---------------- buildings and streets ---------------- */

// By viewport, never by radius. Measured density near Lacanau is 123
// buildings/km2, so a 50 km radius would be about 966,000 buildings; the same
// data by viewport is roughly 7,400 at zoom 13.
function hint(message) {
  $('detail-hint').hidden = !message;
  $('detail-hint').textContent = message || '';
}

async function loadDetail() {
  if (!view.isOn('detail')) return;
  if (view.map.getZoom() < MIN_ZOOM) {
    view.drawDetail({});
    hint(c().detailHint);
    return;
  }
  if (detailAbort) detailAbort.abort();
  const mine = new AbortController();
  detailAbort = mine;
  hint(c().detailLoading);
  const b = view.map.getBounds();
  const detail = await fetchViewport({
    south: b.getSouth(), west: b.getWest(),
    north: b.getNorth(), east: b.getEast(),
  }, { signal: mine.signal });
  // A newer viewport already superseded this one; its result is the stale one.
  if (detailAbort !== mine) return;
  view.drawDetail(detail);
  // fetchViewport returns empty both for genuinely empty ground and for a
  // refused request, and Overpass refuses often — it is a free volunteer
  // service. Saying nothing would let a rate-limit read as open country.
  hint(detail.buildings.length || detail.roads.length ? '' : c().detailEmpty);
}

/* ---------------- language ---------------- */

function applyLanguage() {
  document.documentElement.lang = lang;
  $('lang').textContent = c().lang;
  $('zone-label').textContent = c().zonePick;
  $('back-link').textContent = c().back;
  $('src-link').textContent = c().sources;
  $('skills-summary').textContent = c().skillsSummary;
  $('scrub-label').textContent = c().scrubLabel;
  $('scrub-note').textContent = c().scrubNote;
  // A hint already on screen follows the language. Re-deriving it costs nothing;
  // refetching it would cost Overpass a query.
  if (!$('detail-hint').hidden) {
    hint(view.map.getZoom() < MIN_ZOOM ? c().detailHint : c().detailEmpty);
  }
  fillImagery();
  renderSkills();
  render();
}

/* ---------------- boot ---------------- */

async function selectZone(id) {
  zone = await loadJSON(`data/zones/${id}.json`);
  if (!point) view.setYou({ lat: zone.lat, lon: zone.lon }, 10);
  else view.setYou(point, 11);
  render();
  loadDetail();
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  if (Number.isFinite(lat) && Number.isFinite(lon) && params.get('lat')) {
    point = { lat, lon };
  }

  view = createMap('map', { center: [46.6, 2.5], zoom: 6 });
  view.setBase('plan_ign');
  ['fires', 'spread', 'closures', 'detail'].forEach((n) => view.toggle(n, true));

  dates = availableDates(todayUTC(), 22);

  document.querySelectorAll('#basemap button').forEach((b) => {
    b.onclick = () => {
      view.setBase(b.dataset.base);
      document.querySelectorAll('#basemap button').forEach((x) =>
        x.setAttribute('aria-pressed', String(x === b)));
    };
  });
  document.querySelectorAll('.chip[data-layer]').forEach((chip) => {
    chip.onclick = () => {
      const on = chip.getAttribute('aria-pressed') !== 'true';
      chip.setAttribute('aria-pressed', String(on));
      view.toggle(chip.dataset.layer, on);
      if (chip.dataset.layer === 'detail' && on) loadDetail();
    };
  });
  $('imagery').onchange = applyImagery;
  $('scrub').oninput = applyImagery;
  $('lang').onclick = () => {
    lang = lang === 'fr' ? 'en' : 'fr';
    store(LANG_KEY, lang);
    applyLanguage();
  };
  // One Overpass query per settled viewport, never one per frame.
  let pending = null;
  view.map.on('moveend zoomend', () => {
    clearTimeout(pending);
    pending = setTimeout(loadDetail, 900);
  });

  applyLanguage();

  const [index, loaded] = await Promise.all([
    loadJSON('data/zones/index.json'),
    loadJSON('data/summary.json').catch(() => null),
  ]);
  summary = loaded;

  const select = $('zone-select');
  for (const z of index.zones || []) {
    const option = document.createElement('option');
    option.value = z.id;
    option.textContent = z.label;
    select.append(option);
  }
  const wanted = params.get('zone');
  // With a point but no zone named, the zone whose centre is nearest is the one
  // the reader means.
  const chosen = (index.zones || []).some((z) => z.id === wanted) ? wanted
    : point && (index.zones || []).length
      ? [...index.zones].sort((a, b) => haversineKm(point, a) - haversineKm(point, b))[0].id
      : (index.zones || [])[0] && index.zones[0].id;
  if (!chosen) throw new Error('no zones published');
  select.value = chosen;
  select.onchange = () => selectZone(select.value);

  await selectZone(chosen);
}

boot().catch((err) => {
  $('headline').textContent = c().failed;
  $('freshness-text').textContent = c().failed;
  console.error(err);
});
