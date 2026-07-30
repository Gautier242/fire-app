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
import { hourToDate, observedPasses, pointsForPass, PAST_PALETTE } from './history.js';

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
// The departement's own crisis feeds. null = not fetched, false = fetch failed.
// Never collapsed into an empty object: empty means the departement says nothing is
// shut, failed means we could not ask, and those must not render the same.
let official = null;
let trail = null;

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
    avoidOfficial: (n, fire) => `${n} route(s) coupée(s) publiée(s) par le Département de la Gironde`
      + (fire ? `, dont ${fire} à cause de l'incendie.` : '.'),
    avoidUnavailable: 'Routes coupées du Département indisponibles. Cela ne veut pas dire que les routes sont ouvertes.',
    avoidOutside: 'Le Département de la Gironde publie ses routes coupées ; les autres départements non. Une carte vide ici ne veut pas dire des routes ouvertes.',
    evacTitle: 'Communes évacuées',
    evacList: (n) => `${n} commune(s) évacuée(s), en tout ou partie.`,
    evacSource: 'Source : Département de la Gironde. Les ordres d\'évacuation partent aussi par FR-Alert, directement sur votre téléphone.',
    evacUnavailable: 'Liste des communes évacuées indisponible. Cela ne veut pas dire qu\'il n\'y a aucun ordre.',
    burntArea: (km2) => `${km2} km² déjà brûlés (relevé du Département).`,
    trailChip: 'Chaleur sur 7 jours',
    trailUnavailable: 'Historique 7 jours indisponible.',
    dayLabel: 'Jour', dayAll: '7 jours',
    dayNote: 'Chaleur détectée par satellite. Ce n\'est pas un périmètre : les nuages masquent la détection.',
    legendTitle: 'Légende',
    legend: {
      fire: 'Feu détecté maintenant', trail: 'Chaleur les jours précédents',
      spread: 'Propagation modélisée (non validée)', closure: 'Route coupée (incendie)',
      closureOther: 'Route coupée (autre cause)', detour: 'Déviation officielle',
      evacuated: 'Commune évacuée', burnt: 'Déjà brûlé', wind: 'Vent',
    },
    imageryNote: 'Choisissez une image, puis la date.',
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
    avoidOfficial: (n, fire) => `${n} closed road(s) published by the Gironde département`
      + (fire ? `, ${fire} of them because of the fire.` : '.'),
    avoidUnavailable: 'Département road closures unavailable. That does not mean the roads are open.',
    avoidOutside: 'The Gironde département publishes its closed roads; other départements do not. An empty map here does not mean open roads.',
    evacTitle: 'Evacuated communes',
    evacList: (n) => `${n} commune(s) evacuated, wholly or partly.`,
    evacSource: 'Source: Gironde département. Evacuation orders also go out over FR-Alert, straight to your phone.',
    evacUnavailable: 'The evacuated commune list is unavailable. That does not mean there is no order.',
    burntArea: (km2) => `${km2} km² already burnt (département survey).`,
    trailChip: 'Heat over 7 days',
    trailUnavailable: 'The 7-day history is unavailable.',
    dayLabel: 'Day', dayAll: '7 days',
    dayNote: 'Heat detected by satellite. Not a perimeter: cloud blocks detection.',
    legendTitle: 'Legend',
    legend: {
      fire: 'Fire detected now', trail: 'Heat on earlier days',
      spread: 'Modelled spread (not validated)', closure: 'Closed road (fire)',
      closureOther: 'Closed road (other cause)', detour: 'Official detour',
      evacuated: 'Evacuated commune', burnt: 'Already burnt', wind: 'Wind',
    },
    imageryNote: 'Pick an image, then the date.',
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
  const list = $('avoid-list');
  list.innerHTML = '';

  // The departement's own list, where it exists, is the real answer: 236 closed
  // roads with a named cause against Bison Fute's zero for the same ground. It is
  // published for Gironde alone, so the note has to say which of three situations
  // a reader is in -- covered, outside the coverage, or unable to ask.
  const local = official && official.available ? official : null;
  const notes = [];

  if (local) {
    const fire = local.closures.filter((x) => x.fire_related).length;
    if (local.closures.length) {
      notes.push(c().avoidOfficial(local.closures.length, fire));
      for (const cut of local.closures.filter((x) => x.fire_related).slice(0, 6)) {
        const li = document.createElement('li');
        li.textContent = `${cut.road || '?'} — ${cut.kind || ''}`.trim();
        list.append(li);
      }
    }
    if (local.evacuations.length) notes.push(c().evacList(local.evacuations.length));
    if (local.burn_area && local.burn_area.area_km2) {
      notes.push(c().burntArea(local.burn_area.area_km2));
    }
  } else if (official === false) {
    // Could not ask. This must never render as open roads.
    notes.push(c().avoidUnavailable);
  } else if (zone && !inGironde()) {
    notes.push(c().avoidOutside);
  }

  // Bison Fute's national-network points still apply everywhere.
  for (const closure of closures.slice(0, 8)) {
    const li = document.createElement('li');
    li.textContent = `${closure.road} — ${closure.place}`;
    list.append(li);
  }
  if (!notes.length) notes.push(closures.length ? c().avoidPath : c().avoidNone);
  $('avoid-note').textContent = notes.join(' ');
}

// The Gironde feeds cover departement 33 only, and a reader in Landes must not
// read their silence as calm.
function inGironde() {
  return Boolean(official && (official.covers || []).includes('33')
    && zone && zone.id === 'gironde');
}

// What every colour on the map means. A reader cannot be expected to know whether
// an orange dot is a fire now or a fire on Tuesday, and that difference is the
// whole point of the layer.
function renderLegend() {
  $('legend-title').textContent = c().legendTitle;
  const rows = [
    ['#E23A1E', c().legend.fire],
    [PAST_PALETTE[1], c().legend.trail],
    ['#E8A33D', c().legend.spread, true],
    ['#E4344F', c().legend.closure],
    ['#7A8894', c().legend.closureOther],
    ['#2E7D5B', c().legend.detour],
    ['#5B4636', c().legend.burnt],
    ['#1B6C8C', c().legend.wind],
  ];
  const list = $('legend-list');
  list.innerHTML = '';
  for (const [colour, text, dashed] of rows) {
    const li = document.createElement('li');
    const swatch = document.createElement('i');
    swatch.className = dashed ? 'lg dashed' : 'lg';
    swatch.style.setProperty('--lg', colour);
    li.append(swatch, document.createTextNode(text));
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
    // A cut scheduled for December is not a road that is shut now. Compared
    // against false because Canada's records carry no in_force at all.
    closure.in_force !== false
    && closure.lat !== null && closure.lat !== undefined
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
    windArrow: lang === 'en' ? 'Wind' : 'Vent',
    gusts: lang === 'en' ? 'Gusts' : 'Rafales',
  });
  view.drawOfficial(official || null, {
    burnt: lang === 'en' ? 'Already burnt' : 'Déjà brûlé',
    evacuated: lang === 'en' ? 'Evacuated commune' : 'Commune évacuée',
    detour: lang === 'en' ? 'Official detour' : 'Déviation officielle',
  });
  renderLegend();
}

/* ---------------- the seven-day trail ---------------- */

// Which day of the trail is shown, and the slider that steps through it.
//
// The chip loads 7 days at once; the slider narrows it to one day so a reader can
// watch the fire move rather than see a week of dots at once. Both are needed: the
// week answers "where has it been", a single day answers "where was it yesterday".
function trailDays() {
  if (!trail || !trail.points) return [];
  const passes = observedPasses(trail);
  // Group passes by calendar day, oldest first.
  const byDay = new Map();
  for (const hour of passes) {
    const day = Math.floor(hour / 24);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(hour);
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]);
}

function applyTrail() {
  if (!trail || !trail.points) return;
  const days = trailDays();
  const slider = $('day');
  const index = Number(slider.value);
  const passes = observedPasses(trail);

  let shown;
  if (index >= days.length) {
    // The far right of the slider is the whole week.
    shown = pointsForPass(trail, passes, passes.length - 1, passes.length);
    $('day-date').textContent = c().dayAll;
  } else {
    const [, hours] = days[index];
    const newest = hours[hours.length - 1];
    const at = passes.indexOf(newest);
    shown = pointsForPass(trail, passes, at, hours.length - 1);
    const when = hourToDate(trail, newest);
    $('day-date').textContent = when
      ? when.toLocaleDateString(lang === 'en' ? 'en-GB' : 'fr-FR',
        { day: 'numeric', month: 'short' })
      : '';
  }
  view.drawHistory(shown, { palette: PAST_PALETTE });
}

async function showTrail(on) {
  const chip = $('chip-trail');
  if (!on) {
    view.drawHistory([]);
    view.toggle('history', false);
    $('day-scrubber').hidden = true;
    return;
  }
  if (trail === null) trail = await loadJSON('data/history.json').catch(() => false);
  if (!trail || !trail.points || !trail.points.length) {
    // A failed fetch must not leave an empty layer looking like an empty week.
    chip.setAttribute('aria-pressed', 'false');
    chip.querySelector('span').textContent = c().trailUnavailable;
    return;
  }
  const days = trailDays();
  const slider = $('day');
  slider.max = String(days.length);
  slider.value = String(days.length);
  $('day-scrubber').hidden = false;
  $('day-label').textContent = c().dayLabel;
  $('day-note').textContent = c().dayNote;
  view.toggle('history', true);
  applyTrail();
}

/* ---------------- imagery ---------------- */

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function currentLayer() {
  return LAYERS.find((l) => l.id === $('imagery').value) || null;
}

function showImageryPurpose() {
  const layer = currentLayer();
  $('imagery-note').textContent = layer
    ? layer.purpose[lang === 'en' ? 'en' : 'fr']
    : c().imageryNote;
}

function applyImagery() {
  const layer = currentLayer();
  const date = dates[Number($('scrub').value)] || dates[0];
  $('scrubber').hidden = !(layer && layer.dated);
  showImageryPurpose();
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
    // Why a reader would pick this one. The label states the sensor and the
    // resolution, which is accurate and useless to somebody deciding.
    option.title = layer.purpose[lang === 'en' ? 'en' : 'fr'];
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
  $('day-label').textContent = c().dayLabel;
  $('day-note').textContent = c().dayNote;
  showImageryPurpose();
  // The chip carries an unavailability message when a fetch failed, so it is only
  // relabelled while it still reads as a working control.
  if (trail !== false) $('chip-trail').querySelector('span').textContent = c().trailChip;
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
  ['fires', 'spread', 'closures', 'detail', 'official', 'evacuated', 'burnt']
    .forEach((n) => view.toggle(n, true));

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
      // The trail is lazy-loaded and owns its own toggle path.
      if (chip.dataset.layer === 'history') { showTrail(on); return; }
      view.toggle(chip.dataset.layer, on);
      if (chip.dataset.layer === 'detail' && on) loadDetail();
    };
  });
  $('imagery').onchange = applyImagery;
  $('scrub').oninput = applyImagery;
  $('day').oninput = applyTrail;
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

  // The departement feeds load with the summary: they carry closed roads and
  // evacuation orders, which are the two things a reader most needs and cannot get
  // anywhere else. `false` on failure, never {} -- an empty object would render as
  // "nothing is shut" when the truth is that we could not ask.
  const [index, loaded, local] = await Promise.all([
    loadJSON('data/zones/index.json'),
    loadJSON('data/summary.json').catch(() => null),
    loadJSON('data/gironde.json').catch(() => false),
  ]);
  summary = loaded;
  official = local;

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
