// Wiring for the local view. Owns the DOM; every decision about what to say
// lives in local.js, helping.js and rail-fr.js.
//
// The five questions, in the order somebody in danger asks them: am I in danger,
// where is it going, where must I not go, who is fighting it, what can I do.
import { createMap } from './mapview.js';
import { describeLocal, officialNear } from './local.js';
import { describeFr } from './rail-fr.js';
import { actionsFor, SKILLS } from './helping.js';
import { LAYERS, availableDates, previewUrl } from './imagery.js';
import { fetchViewport, MIN_ZOOM } from './overpass.js';
import { haversineKm } from './geo.js';
import { assessEgress, TOWARD } from './egress.js';
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
// Which of `dates` the reader picked. Held here rather than read off a slider,
// because the contact sheet is the control now.
let dateIndex = 0;
// True once the reader has chosen a date themselves, after which nothing moves
// the selection for them.
let datePicked = false;

// 1x1 transparent GIF, so a tile that never arrived shows the "nobody looked"
// hatching rather than a broken-image glyph on top of it.
const BLANK_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
let detailAbort = null;
// The departement's own crisis feeds. null = not fetched, false = fetch failed.
// Never collapsed into an empty object: empty means the departement says nothing is
// shut, failed means we could not ask, and those must not render the same.
let official = null;
let trail = null;
// Crowd-mapped hydrants. null = not asked for, false = asked for and failed.
// The distinction is the whole point: an empty layer must never be the same
// thing on screen as a layer we could not fetch.
let hydrants = null;
// What was showing before the map was cleared, so restoring gives a reader their own
// layers back rather than a default they never chose.
let restore = [];

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

// Exported so the language tests can hold the strings against the HTML that
// declares them. Nothing in the browser imports this.
export const COPY = {
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
    burntArea: (km2, when) => `${km2} km² déjà brûlés`
      + (when ? ` (relevé du Département du ${when}).` : ' (relevé du Département).'),
    // The map's own controls. Declared here and named in the HTML by data-t, so
    // that adding a chip without a translation fails a test rather than shipping.
    layersToggle: 'Calques',
    chipFires: 'Feux détectés',
    chipWater: "Points d'eau — registre",
    chipAircraft: 'Moyens aériens',
    chipHydrants: 'Bornes OSM — pas un registre',
    chipSpread: 'Propagation modélisée',
    chipClosures: 'Routes coupées',
    chipDetail: 'Bâtiments et rues',
    chipEvacuated: 'Communes évacuées',
    chipBurnt: 'Déjà brûlé',
    chipEgress: 'Routes vers le feu',
    // IGN's own product name, so it is the same in both languages.
    baseIgn: 'Plan IGN', baseSatellite: 'Satellite', basePlain: 'Sobre',
    ariaBasemap: 'Fond de carte',
    ariaFilm: "Choisir la date de l'image",
    trailChip: 'Chaleur sur 7 jours',
    trailUnavailable: 'Historique 7 jours indisponible.',
    // L'eau, dite au public. Aucun registre SDIS ne publie pour la Gironde : ce
    // qui s'affiche ici est du bénévolat cartographique, et doit le dire.
    waterMap: {
      waterPoint: "Point d'eau",
      registerTier: 'Registre SDIS — zone réellement recensée',
      crowdTier: 'OpenStreetMap — pas un registre',
      capacityUnknown: 'Capacité inconnue',
      noFlowGuarantee: "Un registre ne garantit ni le débit ni l'accès.",
      crowdCaveat: "Recensement bénévole, complétude inconnue. Aucun point affiché ne veut pas dire aucune eau.",
      kinds: { borne: 'Borne ou poteau', citerne: 'Citerne ou réserve', naturel: "Point d'aspiration" },
    },
    waterCrowdOnly: "Aucun registre SDIS ne publie pour ce département. Les points affichés viennent d'OpenStreetMap : ce n'est pas un relevé, et l'absence de point n'est pas l'absence d'eau.",
    waterUnavailable: "Points d'eau indisponibles : nous n'avons pas pu interroger la base. Ce n'est pas l'absence d'eau.",
    dayLabel: 'Jour', dayAll: '7 jours',
    dayNote: 'Chaleur détectée par satellite. Ce n\'est pas un périmètre : les nuages masquent la détection.',
    legendTitle: 'Légende',
    legend: {
      fire: 'Feu détecté maintenant', trail: 'Chaleur les jours précédents',
      spread: 'Propagation modélisée (non validée)', closure: 'Route coupée (incendie)',
      closureOther: 'Route coupée (autre cause)', detour: 'Déviation officielle',
      evacuated: 'Commune évacuée', burnt: 'Déjà brûlé', wind: 'Vent',
    },
    imageryNote: 'Choisissez une image, puis la date la plus dégagée.',
    help: "Où trouver de l'aide", pro: 'Vue pompiers', chrono: 'Chronologie',
    egressTitle: 'Routes vers la propagation modélisée',
    egressSome: (n) => `${n} route(s) chargée(s) mènent vers la direction que le modèle donne au feu.`,
    // "Not flagged" is not "safe". Said outright, because a reader looking at an
    // unmarked road will otherwise supply that meaning themselves.
    egressNone: 'Aucune route chargée ne mène vers la direction modélisée. Cela ne rend aucune route sûre : le modèle ne voit ni les fumées, ni les coupures, ni le trafic.',
    egressCannot: 'Impossible d\'évaluer les routes ici.',
    egressToward: 'Mène vers la propagation modélisée',
    clearLayers: 'Tout masquer', showAll: 'Tout afficher',
    egressZoom: `Zoomez (niveau ${MIN_ZOOM}) pour évaluer les routes.`,
    forcesTitle: 'Moyens visibles',
    aircraft: (n) => `${n} aéronef(s) observé(s) à proximité.`,
    noAircraftDay: "Aucun aéronef observé dans les dernières minutes. Cela ne veut pas dire qu'il n'y en a pas.",
    noAircraftNight: "Aucun aéronef : les moyens aériens ne volent pas de nuit.",
    skillsSummary: 'Ce que je peux faire',
    noImagery: 'Aucune image', imageryLabel: 'Image satellite',
    scrubLabel: "Date de l'image",
    scrubNote: 'Vignette hachurée : aucun passage ce jour-là. Choisissez une date sans nuages.',
    noPass: 'aucun passage ce jour-là',
    opacityLabel: 'Opacité',
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
    burntArea: (km2, when) => `${km2} km² already burnt`
      + (when ? ` (département survey of ${when}).` : ' (département survey).'),
    layersToggle: 'Layers',
    chipFires: 'Fires detected',
    chipWater: 'Water points — register',
    chipAircraft: 'Air support',
    chipHydrants: 'OSM hydrants — not a register',
    chipSpread: 'Modelled spread',
    chipClosures: 'Closed roads',
    chipDetail: 'Buildings and streets',
    chipEvacuated: 'Evacuated communes',
    chipBurnt: 'Already burnt',
    chipEgress: 'Roads toward the fire',
    baseIgn: 'Plan IGN', baseSatellite: 'Satellite', basePlain: 'Plain',
    ariaBasemap: 'Base map',
    ariaFilm: 'Choose the image date',
    trailChip: 'Heat over 7 days',
    trailUnavailable: 'The 7-day history is unavailable.',
    waterMap: {
      waterPoint: 'Water point',
      registerTier: 'SDIS register — an actually surveyed area',
      crowdTier: 'OpenStreetMap — not a register',
      capacityUnknown: 'Capacity unknown',
      noFlowGuarantee: 'A register guarantees neither flow nor access.',
      crowdCaveat: 'Volunteer survey, completeness unknown. No point shown does not mean no water.',
      kinds: { borne: 'Hydrant or pillar', citerne: 'Tank or reserve', naturel: 'Draft point' },
    },
    waterCrowdOnly: 'No SDIS register publishes for this département. The points shown come from OpenStreetMap: that is not a survey, and the absence of a point is not the absence of water.',
    waterUnavailable: 'Water points unavailable: we could not query the database. That is not the absence of water.',
    dayLabel: 'Day', dayAll: '7 days',
    dayNote: 'Heat detected by satellite. Not a perimeter: cloud blocks detection.',
    legendTitle: 'Legend',
    legend: {
      fire: 'Fire detected now', trail: 'Heat on earlier days',
      spread: 'Modelled spread (not validated)', closure: 'Closed road (fire)',
      closureOther: 'Closed road (other cause)', detour: 'Official detour',
      evacuated: 'Evacuated commune', burnt: 'Already burnt', wind: 'Wind',
    },
    imageryNote: 'Pick an image, then the clearest date.',
    help: 'Where to find help', pro: 'Responder view', chrono: 'Chronology',
    egressTitle: 'Roads toward the modelled spread',
    egressSome: (n) => `${n} loaded road(s) lead toward the direction the model gives the fire.`,
    egressNone: 'No loaded road leads toward the modelled direction. That makes no road safe: the model sees neither smoke, nor cuts, nor traffic.',
    egressCannot: 'The roads here cannot be assessed.',
    egressToward: 'Leads toward the modelled spread',
    clearLayers: 'Hide all', showAll: 'Show all',
    egressZoom: `Zoom in (level ${MIN_ZOOM}) to assess roads.`,
    forcesTitle: 'Visible response',
    aircraft: (n) => `${n} aircraft observed nearby.`,
    noAircraftDay: 'No aircraft observed in the last few minutes. That does not mean there are none.',
    noAircraftNight: 'No aircraft: air support does not fly at night.',
    skillsSummary: 'What I can do',
    noImagery: 'No imagery', imageryLabel: 'Satellite imagery',
    scrubLabel: 'Image date',
    scrubNote: 'A hatched thumbnail means no pass that day. Pick a date without cloud.',
    noPass: 'no pass that day',
    opacityLabel: 'Opacity',
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
  const here = officialHere();
  const local = here.covered ? here : null;
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
      // The survey date, not today's date. The departement names each perimeter
      // for the day it walked the ground, and a three-day-old outline shown without
      // its date reads as the fire's current edge.
      const when = local.burn_area.surveyed
        ? new Date(`${local.burn_area.surveyed}T00:00:00Z`).toLocaleDateString(
          lang === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long' })
        : null;
      notes.push(c().burntArea(local.burn_area.area_km2, when));
    }
  } else if (!here.available) {
    // Could not ask. This must never render as open roads.
    notes.push(c().avoidUnavailable);
  } else {
    // The feed answered and none of it is near this reader, so they are outside the
    // one departement that publishes. Silence here is a coverage gap, not calm.
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

// Roads leading into the modelled spread, as a count and a caveat rather than a
// verdict per road. The model is one fuel type for every zone and validated against
// no real fire, so this can narrow a reader's attention and must never direct it.
function renderEgress(egress) {
  const block = $('egress-block');
  if (!block) return;
  $('egress-title').textContent = c().egressTitle;
  const flagged = egress.cannotAssess
    ? [] : egress.roads.filter((r) => r.assessment === TOWARD);
  block.hidden = false;
  $('egress-note').textContent = egress.cannotAssess
    ? egress.reasonText || c().egressCannot
    : (flagged.length ? c().egressSome(flagged.length) : c().egressNone);
  // Both strings ship on every render: the caveat and the supersede line are not
  // conditional on there being something to say.
  $('egress-caveat').textContent = `${egress.caveat} ${egress.official}`;
  const list = $('egress-list');
  list.innerHTML = '';
  for (const road of flagged.slice(0, 6)) {
    if (!road.name) continue;
    const li = document.createElement('li');
    li.textContent = road.name;
    list.append(li);
  }
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

// The departement feed, narrowed to this reader. Never the raw feed: it covers one
// departement and a reader elsewhere must not be shown its closures as theirs.
function officialHere() {
  return officialNear(official, at(), (zone && zone.radius_km) || 50);
}

// Aircraft near this zone, from the national list. The zone payload carries only
// a per-fire count, which is why the rail could say "3 aircraft observed nearby"
// while the map showed none: there were never any positions in it to draw.
function aircraftHere() {
  const centre = at();
  const radius = (zone && zone.radius_km) || 50;
  return ((summary && summary.aircraft) || [])
    .filter((p) => Number.isFinite(p.lat) && haversineKm(centre, p) <= radius);
}

function drawMap(d) {
  view.drawLocal({ ...zone, closures: nearbyClosures(), aircraft: aircraftHere() }, {
    aircraft: lang === 'en' ? 'Aircraft' : 'Aéronef',
    aircraftNote: lang === 'en'
      ? 'Flying low near a fire. What it is doing is not confirmed.'
      : "Vole bas près d'un feu. Son rôle n'est pas confirmé.",
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
  view.drawOfficial(officialHere(), {
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

// The control says what pressing it will do, not what state the map is in.
function applyClearLabel() {
  const button = $('clear-layers');
  if (!button) return;
  const anyOn = [...document.querySelectorAll('.chip[data-layer]')]
    .some((x) => x.getAttribute('aria-pressed') === 'true');
  button.querySelector('span').textContent = anyOn ? c().clearLayers : c().showAll;
}

function showImageryPurpose() {
  const layer = currentLayer();
  const key = lang === 'en' ? 'en' : 'fr';
  $('imagery-note').textContent = layer ? layer.purpose[key] : c().imageryNote;
  // Resolution and revisit, stated plainly. A reader choosing between a 375 m
  // daily pass and a 30 m one every 8-16 days is choosing between "today but
  // coarse" and "sharp but maybe last week", and nothing else on the page says
  // which they are getting.
  $('sensor-facts').hidden = !layer;
  if (layer) {
    $('sensor-res').textContent = layer.resolution;
    $('sensor-revisit').textContent = layer.revisit[key];
  }
}

// The date the reader is looking at, always one that exists.
function currentDate() {
  return dates[dateIndex] || dates[0];
}

function applyImagery() {
  const layer = currentLayer();
  const date = currentDate();
  $('scrubber').hidden = !(layer && layer.dated);
  showImageryPurpose();
  $('scrub-date').textContent = date;
  for (const button of $('film').children) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.i) === dateIndex));
  }
  view.setImagery(layer, date);
}

// The satellite sits over the basemap. Full opacity buries the IGN road names,
// low opacity buries the smoke; which one a reader wants depends on what they
// came to find out, so it is their dial.
function applyOpacity() {
  const percent = Number($('imagery-opacity').value);
  $('opacity-value').textContent = `${percent} %`;
  view.setImageryOpacity(percent / 100);
}

// One real tile per date, so a reader can see the cloud before choosing the
// day. Rebuilt whenever the layer or the zone changes, because a thumbnail of
// the wrong sensor over the wrong ground is worse than none: it would be a
// picture of somewhere else offered as a reason to pick a date.
function fillFilm() {
  const film = $('film');
  const layer = currentLayer();
  film.innerHTML = '';
  if (!layer || !layer.dated || !zone) return;

  const locale = lang === 'en' ? 'en-GB' : 'fr-FR';
  dates.forEach((date, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.i = i;
    button.setAttribute('aria-pressed', String(i === dateIndex));

    const image = document.createElement('img');
    image.className = 'thumb';
    image.loading = 'lazy';
    image.decoding = 'async';
    image.alt = '';
    image.src = previewUrl(layer, date, zone.lat, zone.lon);
    // A 404 means the satellite had no pass over this tile that day. It must
    // not render as an empty white square: white is what a cloudless morning
    // looks like, and a reader would pick the one day nobody looked.
    image.onerror = () => {
      button.classList.add('nopass');
      button.title = `${date} — ${c().noPass}`;
      // A transparent pixel rather than no src at all: an <img> with its source
      // removed draws the browser's broken-image glyph, which is noise on top
      // of the hatching that already says nobody looked.
      image.src = BLANK_PIXEL;
      // Today's tile is usually the missing one -- GIBS publishes a pass some
      // hours after it happens -- so the default selection would open on an
      // empty map. Step to the newest date that actually has an image, unless
      // the reader has already chosen for themselves.
      if (i === dateIndex && !datePicked) {
        dateIndex = Math.min(i + 1, dates.length - 1);
        applyImagery();
      }
    };

    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = new Date(`${date}T00:00:00Z`)
      .toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });

    button.append(image, when);
    button.title = date;
    button.onclick = () => { dateIndex = i; datePicked = true; applyImagery(); };
    film.append(button);
  });
}

// Left and right move through the days without thirty tab stops.
function filmKeys(event) {
  const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
  if (!step) return;
  const next = dateIndex + step;
  if (next < 0 || next >= dates.length) return;
  event.preventDefault();
  dateIndex = next;
  datePicked = true;
  applyImagery();
  const button = $('film').children[dateIndex];
  if (button) {
    button.focus();
    button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
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

  // Which of those roads lead into the modelled spread.
  //
  // Deliberately NOT a ranked list of every road. Downwind of a fire the model
  // points at almost every direction, so a per-road verdict would render mostly
  // red, and a map where everything is flagged tells a reader nothing. Only roads
  // heading into the arc are marked, and the note says in as many words that an
  // unmarked road is not thereby safe -- it is merely not flagged.
  const egress = assessEgress({
    point: at(), spread: (zone && zone.spread) || [], roads: detail.roads || [], lang,
  });
  view.drawEgress(egress.cannotAssess ? [] : egress.roads.filter(
    (r) => r.assessment === TOWARD), { toward: c().egressToward });
  renderEgress(egress);

  // fetchViewport returns empty both for genuinely empty ground and for a
  // refused request, and Overpass refuses often — it is a free volunteer
  // service. Saying nothing would let a rate-limit read as open country.
  hint(detail.buildings.length || detail.roads.length ? '' : c().detailEmpty);
}

/* ---------------- water ---------------- */

// Two sources, drawn differently and never added together. mapview draws the
// register solid and the crowd hollow and dashed, and that distinction is the
// reason this is one call rather than two loops here.
//
// For the Gironde specifically every point on screen is crowd-mapped: the
// published SDIS registers cover Pyrenees-Atlantiques, the Tarn, Rennes,
// Annecy, Angers and La Rochelle, and none of them is the Gironde. So the
// register array is usually empty here and the caveat is not decoration.
function renderWater() {
  if (!view) return;
  const register = ((zone && zone.water && zone.water.points) || [])
    .filter((p) => p.tier !== 'crowd');
  const centre = at();
  const radius = (zone && zone.radius_km) || 50;
  const crowd = hydrants && hydrants.available !== false
    ? (hydrants.points || []).filter((p) => haversineKm(centre, p) <= radius)
    : [];
  view.drawWater({ register, crowd }, c().waterMap);
}

// 52 KB, fetched only when a reader asks for it and never on the path to the
// numbers they came for. Until it lands the chip says so rather than showing an
// empty map, because an empty water layer reads as "no water here".
async function showWater(on) {
  if (!on) { view.drawWater({ register: [], crowd: [] }, c().waterMap); return; }
  if (hydrants === null) {
    hydrants = await loadJSON('data/hydrants.json').catch(() => false);
  }
  if (!hydrants || hydrants.available === false) {
    const chip = document.querySelector('.chip[data-layer="hydrants"]');
    if (chip) {
      chip.setAttribute('aria-pressed', 'false');
      chip.querySelector('span').textContent = c().waterUnavailable;
    }
    return;
  }
  renderWater();
}

/* ---------------- language ---------------- */

function applyLanguage() {
  document.documentElement.lang = lang;
  // Every control that declares its own key, in one pass. The map's chips used to
  // be relabelled one id at a time, which meant a chip added later was simply
  // forgotten and stayed French for anyone reading the page in English.
  document.querySelectorAll('[data-t]').forEach((el) => {
    el.textContent = c()[el.dataset.t];
  });
  // A French accessible name under an English label is worse than either: the
  // reader who depends on it is the one who cannot see the label.
  document.querySelectorAll('[data-t-aria]').forEach((el) => {
    el.setAttribute('aria-label', c()[el.dataset.tAria]);
  });
  $('lang').textContent = c().lang;
  $('zone-label').textContent = c().zonePick;
  $('back-link').textContent = c().back;
  $('src-link').textContent = c().sources;
  if ($('help-link')) $('help-link').textContent = c().help;
  if ($('pro-link')) $('pro-link').textContent = c().pro;
  $('skills-summary').textContent = c().skillsSummary;
  $('chrono-link').textContent = c().chrono;
  $('scrub-note').textContent = c().scrubNote;
  $('day-note').textContent = c().dayNote;
  showImageryPurpose();
  // Two controls say something other than their own label depending on state, so
  // they are set after the sweep rather than by it.
  //
  // The trail chip carries an unavailability message when the fetch failed. The
  // sweep would overwrite it with the working label, turning "we could not ask"
  // into what looks like a week with no fire in it.
  if (trail === false) {
    $('chip-trail').querySelector('span').textContent = c().trailUnavailable;
  }
  applyClearLabel();
  // A hint already on screen follows the language. Re-deriving it costs nothing;
  // refetching it would cost Overpass a query.
  if (!$('detail-hint').hidden) {
    hint(view.map.getZoom() < MIN_ZOOM ? c().detailHint : c().detailEmpty);
  }
  fillImagery();
  fillFilm();
  renderWater();
  renderSkills();
  render();
}

/* ---------------- boot ---------------- */

async function selectZone(id) {
  zone = await loadJSON(`data/zones/${id}.json`);
  if (!point) view.setYou({ lat: zone.lat, lon: zone.lon }, 10);
  else view.setYou(point, 11);
  // The previews are tiles of this zone's own ground, so they cannot be built
  // until there is a zone.
  fillFilm();
  renderWater();
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
  // Egress is off by default and opt-in through its chip. Measured downwind of the
  // Gironde fires it flagged 110 of the 250 roads considered -- 44 per cent -- and a
  // wall of amber over half the streets on screen tells a reader nothing while
  // looking authoritative. The count and the caveat are in the rail either way, so
  // nothing is hidden; only the overlay waits to be asked for.
  ['fires', 'spread', 'closures official', 'detail', 'evacuated', 'burnt', 'aircraft']
    .forEach((n) => view.toggle(n, true));

  dates = availableDates(todayUTC(), 30);

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
      if (chip.dataset.layer === 'hydrants') { showWater(on); view.toggle('hydrants', on); applyClearLabel(); return; }
      view.toggle(chip.dataset.layer, on);
      if (chip.dataset.layer === 'detail' && on) loadDetail();
      // Egress is computed from the Overpass roads, which only load past MIN_ZOOM.
      // Below that the layer is empty, so the chip appeared to do nothing at all --
      // it is the one control on this page whose data the reader has to go and get.
      applyClearLabel();
      if (chip.dataset.layer === 'egress' && on) {
        if (view.map.getZoom() < MIN_ZOOM) hint(c().egressZoom);
        else if (!view.isOn('detail')) {
          const detailChip = document.querySelector('.chip[data-layer="detail"]');
          if (detailChip) detailChip.setAttribute('aria-pressed', 'true');
          view.toggle('detail', true);
          loadDetail();
        } else loadDetail();
      }
    };
  });
  // One control to clear the map, so a reader can look at exactly one thing.
  // Remembers what was on, so pressing it again restores that rather than an
  // arbitrary default -- somebody who cleared the map to read the closures should
  // get their own layers back, not ours.
  $('clear-layers').onclick = () => {
    const chips = [...document.querySelectorAll('.chip[data-layer]')];
    const anyOn = chips.some((x) => x.getAttribute('aria-pressed') === 'true');
    if (anyOn) {
      restore = chips.filter((x) => x.getAttribute('aria-pressed') === 'true')
        .map((x) => x.dataset.layer);
      for (const chip of chips) {
        chip.setAttribute('aria-pressed', 'false');
        if (chip.dataset.layer === 'history') showTrail(false);
        else view.toggle(chip.dataset.layer, false);
      }
    } else {
      for (const chip of chips) {
        const on = restore.includes(chip.dataset.layer);
        chip.setAttribute('aria-pressed', String(on));
        if (chip.dataset.layer === 'history') showTrail(on);
        else view.toggle(chip.dataset.layer, on);
      }
    }
    applyClearLabel();
  };

  $('imagery').onchange = () => { fillFilm(); applyImagery(); };
  $('film').onkeydown = filmKeys;
  $('imagery-opacity').oninput = applyOpacity;
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

// Importable in node for its strings; only the browser boots the page.
if (typeof document !== 'undefined' && document.getElementById('map')) {
  boot().catch((err) => {
    $('headline').textContent = c().failed;
    $('freshness-text').textContent = c().failed;
    console.error(err);
  });
}
