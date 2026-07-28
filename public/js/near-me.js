import { nearest } from './geo.js';
import { t } from './i18n.js';
import { locateBrowser, provinceAt, savePlace, savedPlace, searchPlaces } from './location.js';
import { aqhiBand, evacuationState, fireState, NEAR_KM } from './status.js';

const STALE_MINUTES = 60;
const DISTANT_STATION_KM = 100;

// 109 of 138 BC fires carry their fire number as their "name" (N50921, C40923),
// and some real names arrive with trailing spaces. "N50921 is burning 12 km north
// of you" reads like a machine talking; fall back to the unnamed phrasing for
// those, while still showing the status and official link we do have.
const FIRE_CODE = /^[A-Z]\d+$/;

function humanName(fire) {
  const name = (fire.name || '').trim();
  return name && !FIRE_CODE.test(name) ? name : null;
}

let lang = (navigator.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en';
let summary = null;
let coverage = null;
let places = null;
// The point currently on screen. A located user never touches localStorage, so
// savedPlace() cannot answer "what is being displayed" — without this the
// language toggle leaves the three cards in the old language.
let shownPoint = null;

const $ = (id) => document.getElementById(id);

async function loadJSON(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

function minutesSince(iso) {
  if (!iso) return null;
  return Math.round((Date.now() - new Date(iso).getTime()) / 60000);
}

function sourceInfo(id) {
  return (summary.sources || []).find((s) => s.id === id) || { stale: true, fetched_at: null };
}

function card(level, heading, badge, lines, meta) {
  const el = document.createElement('div');
  el.className = `card ${level}`;
  const parts = [`<h2>${heading}</h2>`, `<p class="badge">${badge}</p>`];
  for (const line of lines.filter(Boolean)) parts.push(`<p>${line}</p>`);
  if (meta) parts.push(`<p class="meta">${meta}</p>`);
  el.innerHTML = parts.join('');
  return el;
}

function ageMeta(sourceIds) {
  const ages = sourceIds.map((id) => minutesSince(sourceInfo(id).fetched_at)).filter((m) => m !== null);
  if (!ages.length) return t(lang, 'stale_warning');
  const oldest = Math.max(...ages);
  return oldest > STALE_MINUTES
    ? `${t(lang, 'updated', { minutes: oldest })} — ${t(lang, 'stale_warning')}`
    : t(lang, 'updated', { minutes: oldest });
}

function fireCard(point) {
  const state = fireState({ point, fires: summary.fires, nearKm: NEAR_KM });
  const age = ageMeta(['cwfis_perimeters', 'bc_fires']);
  if (state.level === 'green') {
    return card('green', t(lang, 'fire_heading'), t(lang, 'badge_safe'),
      [t(lang, 'fire_none', { km: NEAR_KM })], age);
  }
  const direction = t(lang, `dir_${state.direction}`);
  const name = humanName(state.fire);
  const line = name
    ? t(lang, 'fire_near_named', { name, km: state.km, direction })
    : t(lang, 'fire_near', { km: state.km, direction });
  const status = state.fire.status ? t(lang, 'fire_status', { status: state.fire.status }) : null;
  const note = state.fire.named ? null : t(lang, 'fire_estimate_note');
  return card('amber', t(lang, 'fire_heading'), t(lang, 'badge_caution'),
    [line, status, note], age);
}

function evacCard(point, province) {
  const evacSource = sourceInfo('bc_evac');
  const provinceRow = (summary.coverage || []).find((c) => c.province === province);
  const covered = Boolean(provinceRow && provinceRow.evacuations);
  const state = evacuationState({
    point,
    evacuations: summary.evacuations,
    covered,
    stale: evacSource.stale,
  });

  if (state.state === 'order' || state.state === 'alert') {
    const level = state.state === 'order' ? 'red' : 'amber';
    const badge = state.state === 'order' ? t(lang, 'badge_danger') : t(lang, 'badge_caution');
    const agency = state.zone.agency ? t(lang, 'evac_issued_by', { agency: state.zone.agency }) : null;
    return card(level, `${t(lang, 'evac_heading')} — ${state.zone.name}`, badge,
      [t(lang, `evac_${state.state}`), agency], ageMeta(['bc_evac']));
  }
  if (state.state === 'none_found') {
    return card('green', t(lang, 'evac_heading'), t(lang, 'badge_safe'),
      [t(lang, 'evac_none_found')], ageMeta(['bc_evac']));
  }
  const name = province || '—';
  const link = provinceRow
    ? `<a href="${provinceRow.official_url}">${t(lang, 'official_link', { province: name })}</a>`
    : null;
  return card('amber', t(lang, 'evac_heading'), t(lang, 'badge_caution'),
    [t(lang, 'evac_cannot_check', { province: name }), link], null);
}

function aqhiCard(point) {
  const best = nearest(point, summary.aqhi);
  if (!best) return card('green', t(lang, 'aqhi_heading'), '—', [t(lang, 'aqhi_unavailable')], null);
  const band = aqhiBand(best.item.value);
  if (!band) return card('green', t(lang, 'aqhi_heading'), '—', [t(lang, 'aqhi_unavailable')], null);
  const level = band === 'low' ? 'green' : band === 'very_high' ? 'red' : 'amber';
  const distant = best.km > DISTANT_STATION_KM
    ? t(lang, 'aqhi_distant', { name: best.item.name[lang], km: Math.round(best.km) })
    : null;
  return card(level, t(lang, 'aqhi_heading'), t(lang, `aqhi_${band}`),
    [t(lang, `aqhi_${band}_advice`), distant], ageMeta(['aqhi']));
}

function render(point) {
  shownPoint = point;
  const province = provinceAt(point, coverage);
  const cards = $('cards');
  cards.innerHTML = '';
  cards.append(evacCard(point, province), fireCard(point), aqhiCard(point));
}

async function showPicker() {
  $('picker').classList.remove('hidden');
  if (!places) places = await loadJSON('/static/places.json');
  const input = $('place-search');
  const results = $('place-results');
  input.oninput = () => {
    results.innerHTML = '';
    for (const place of searchPlaces(input.value, places, 8)) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.textContent = `${place.n}, ${place.p}`;
      button.onclick = () => {
        savePlace(place);
        $('picker').classList.add('hidden');
        render(place);
      };
      li.append(button);
      results.append(li);
    }
  };
  input.focus();
}

async function check() {
  $('check').textContent = t(lang, 'checking');
  try {
    if (!summary) [summary, coverage] = await Promise.all([
      loadJSON('/data/summary.json'),
      loadJSON('/static/coverage.geojson'),
    ]);
    const point = await locateBrowser();
    render(point);
  } catch {
    const saved = savedPlace();
    if (saved && summary) render(saved);
    else await showPicker();
  } finally {
    $('check').textContent = t(lang, 'check_button');
  }
}

function applyLanguage() {
  document.documentElement.lang = lang;
  $('title').textContent = t(lang, 'title');
  $('check').textContent = t(lang, 'check_button');
  $('picker-label').textContent = t(lang, 'choose_place');
  $('map-link').textContent = t(lang, 'map_link');
  $('sources-link').textContent = t(lang, 'sources_link');
  $('lang-toggle').textContent = lang === 'en' ? 'Français' : 'English';
}

$('lang-toggle').onclick = () => {
  lang = lang === 'en' ? 'fr' : 'en';
  applyLanguage();
  if (summary && shownPoint) render(shownPoint);
};
$('check').onclick = check;
applyLanguage();
