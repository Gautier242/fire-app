// The audit page. Everything here is read live from summary.json — no timestamp,
// no source list and no coverage claim is written into this file, so the page
// cannot drift away from what the app is actually serving.
//
// Page-specific copy lives in PAGE below rather than in i18n.js: these ~40
// strings are used by nothing else, and i18n.js is shared with the map shell.
// tt() falls back English-first, so a missing French string shows readable
// English instead of a raw key.
import { t } from './i18n.js';

const LANG_KEY = 'fire-near-me.lang';
const $ = (id) => document.getElementById(id);

// What each source is, in plain language. Keyed by the id in summary.json.
// An id we do not recognise still renders — with an honest "we cannot describe
// this" instead of nothing.
const SOURCES = {
  aqhi: {
    publisher: { en: 'Environment and Climate Change Canada', fr: 'Environnement et Changement climatique Canada' },
    licence: { en: 'Open Government Licence – Canada', fr: 'Licence du gouvernement ouvert – Canada' },
    licence_url: 'https://open.canada.ca/en/open-government-licence-canada',
    home: 'https://weather.gc.ca/airquality/pages/index_e.html',
    what: {
      en: 'Air quality readings from monitoring stations across Canada. This is the Air Quality Health Index — the 1 to 10+ number the government publishes for smoke and pollution.',
      fr: "Mesures de la qualité de l'air prises par des stations partout au Canada. C'est la Cote air santé — le chiffre de 1 à 10+ publié par le gouvernement pour la fumée et la pollution.",
    },
  },
  bc_evac: {
    publisher: { en: 'Province of British Columbia', fr: 'Province de la Colombie-Britannique' },
    licence: { en: 'Open Government Licence – British Columbia', fr: 'Licence du gouvernement ouvert – Colombie-Britannique' },
    licence_url: 'https://www2.gov.bc.ca/gov/content/data/open-data/open-government-licence-bc',
    home: 'https://www2.gov.bc.ca/gov/content/safety/wildfire-status/wildfire-evacuations',
    what: {
      en: 'Evacuation orders and alerts in British Columbia, gathered by the province from local governments and First Nations. This is the only evacuation feed we have.',
      fr: "Ordres et alertes d'évacuation en Colombie-Britannique, rassemblés par la province auprès des administrations locales et des Premières Nations. C'est notre seule source d'évacuations.",
    },
  },
  bc_fires: {
    publisher: { en: 'BC Wildfire Service', fr: 'BC Wildfire Service' },
    licence: { en: 'Open Government Licence – British Columbia', fr: 'Licence du gouvernement ouvert – Colombie-Britannique' },
    licence_url: 'https://www2.gov.bc.ca/gov/content/data/open-data/open-government-licence-bc',
    home: 'https://wildfiresituation.nrs.gov.bc.ca/',
    what: {
      en: 'Wildfires burning in British Columbia, with their name, size and how much of the fire is under control. Fires the service reports as out are not shown.',
      fr: "Feux de forêt en Colombie-Britannique, avec leur nom, leur superficie et leur état de maîtrise. Les feux déclarés éteints ne sont pas affichés.",
    },
  },
  cwfis_perimeters: {
    publisher: { en: 'Natural Resources Canada — Canadian Wildland Fire Information System', fr: 'Ressources naturelles Canada — Système canadien d’information sur les feux de végétation' },
    licence: { en: 'Open Government Licence – Canada', fr: 'Licence du gouvernement ouvert – Canada' },
    licence_url: 'https://open.canada.ca/en/open-government-licence-canada',
    home: 'https://cwfis.cfs.nrcan.gc.ca/home',
    what: {
      en: 'Estimated fire areas for the rest of Canada, worked out from satellite heat detections. These have no name and no fire crew attached to them, and they can be a few hours behind what is happening on the ground.',
      fr: "Zones de feu estimées pour le reste du Canada, calculées à partir des points chauds détectés par satellite. Elles n'ont ni nom ni équipe rattachée, et peuvent avoir quelques heures de retard sur la réalité.",
    },
  },
};

const PROVINCE_NAMES = {
  AB: { en: 'Alberta', fr: 'Alberta' },
  BC: { en: 'British Columbia', fr: 'Colombie-Britannique' },
  MB: { en: 'Manitoba', fr: 'Manitoba' },
  NB: { en: 'New Brunswick', fr: 'Nouveau-Brunswick' },
  NL: { en: 'Newfoundland and Labrador', fr: 'Terre-Neuve-et-Labrador' },
  NS: { en: 'Nova Scotia', fr: 'Nouvelle-Écosse' },
  NT: { en: 'Northwest Territories', fr: 'Territoires du Nord-Ouest' },
  NU: { en: 'Nunavut', fr: 'Nunavut' },
  ON: { en: 'Ontario', fr: 'Ontario' },
  PE: { en: 'Prince Edward Island', fr: 'Île-du-Prince-Édouard' },
  QC: { en: 'Quebec', fr: 'Québec' },
  SK: { en: 'Saskatchewan', fr: 'Saskatchewan' },
  YT: { en: 'Yukon', fr: 'Yukon' },
};

const PAGE = {
  en: {
    page_title: 'Where this information comes from',
    page_intro: 'This page tells you exactly what this app knows, who it comes from, and when we last checked it. If anything below is out of date, trust the official page instead.',

    h_sources: 'The data we use',
    sources_intro: 'We check all of these every 30 minutes. If a check fails we keep the last good copy and say so, rather than showing you nothing.',
    lbl_publisher: 'Published by',
    lbl_licence: 'Licence',
    lbl_checked: 'Last checked',
    lbl_state: 'Right now',
    lbl_source_page: 'Source page',
    state_fresh: 'Up to date',
    state_stale: 'Old',
    state_failed: 'Check failed',
    stale_note: 'Our last check of this source did not work. What you see is the copy from the time above, and it is getting older.',
    unknown_source: 'This source is in the data file but this page has no description for it. Treat it as unverified.',
    never_fetched: 'Never fetched',

    h_coverage: 'Which provinces we can check',
    coverage_intro: 'This is the app’s biggest limitation. We only have an evacuation feed for one province. Everywhere else, we can show you fires and air quality, but we cannot tell you whether you are inside an evacuation order — and we will never claim you are not.',
    can_check: 'We can check evacuation orders here',
    cannot_check: 'We cannot check evacuation orders here',
    cannot_check_note: 'In these {n} provinces and territories the app cannot see evacuation orders at all. If you live here, the official page is the only thing that can tell you to leave.',
    named_fires_note: 'Fires here are named, with a size and a stage of control, straight from the province.',
    estimated_fires_note: 'Fires here are estimated from satellite images. They have no name and may be a few hours old.',
    official_page: 'Official page',

    h_limits: 'What this app does not do',
    not_official_h: 'It is not an official source',
    not_official_p: 'Nobody at a fire centre or an emergency office checks this app. It re-publishes government data. When this app and the official page disagree, the official page is right and this one is wrong.',
    no_alerts_h: 'It does not send alerts',
    no_alerts_p: 'There are no notifications, no texts and no sirens. Nothing will reach you if you are not looking at the page. To be warned, sign up for your local emergency alerts and keep Alert Ready turned on for your phone.',
    out_of_date_h: 'It can be out of date',
    out_of_date_p: 'We check every 30 minutes, and the government sources we read are themselves behind real events. An evacuation order can be issued and announced long before it reaches this page. The times above are when we last fetched the data, not when the fire moved.',
    rounding_h: 'The shapes on the map are approximate',
    rounding_p: 'Evacuation boundaries are simplified by up to about 55 metres so the map loads on a slow connection, and fire areas outside British Columbia are satellite estimates. Never use this app to judge whether your own house is inside or outside a line.',
    emergency_p: 'If you are in danger right now, call 911 and follow your local officials.',

    footer_generated: 'Data file built {stamp}',
  },
  fr: {
    page_title: "D'où vient cette information",
    page_intro: "Cette page vous dit exactement ce que l'application sait, d'où cela vient et quand nous l'avons vérifié pour la dernière fois. Si quelque chose ci-dessous n'est plus à jour, fiez-vous plutôt à la page officielle.",

    h_sources: 'Les données que nous utilisons',
    sources_intro: "Nous vérifions chacune de ces sources toutes les 30 minutes. Si une vérification échoue, nous gardons la dernière bonne copie et nous le disons, au lieu de ne rien afficher.",
    lbl_publisher: 'Publié par',
    lbl_licence: 'Licence',
    lbl_checked: 'Dernière vérification',
    lbl_state: 'En ce moment',
    lbl_source_page: 'Page de la source',
    state_fresh: 'À jour',
    state_stale: 'Ancien',
    state_failed: 'Échec de la vérification',
    stale_note: "Notre dernière vérification de cette source a échoué. Ce que vous voyez est la copie datant de l'heure ci-dessus, et elle vieillit.",
    unknown_source: "Cette source figure dans le fichier de données, mais cette page n'en a aucune description. Considérez-la comme non vérifiée.",
    never_fetched: 'Jamais récupéré',

    h_coverage: 'Les provinces que nous pouvons vérifier',
    coverage_intro: "C'est la plus grande limite de l'application. Nous n'avons une source d'évacuations que pour une seule province. Ailleurs, nous pouvons montrer les feux et la qualité de l'air, mais nous ne pouvons pas vous dire si vous êtes visé par un ordre d'évacuation — et nous ne prétendrons jamais que vous ne l'êtes pas.",
    can_check: "Nous pouvons vérifier les ordres d'évacuation ici",
    cannot_check: "Nous ne pouvons pas vérifier les ordres d'évacuation ici",
    cannot_check_note: "Dans ces {n} provinces et territoires, l'application ne voit aucun ordre d'évacuation. Si vous y habitez, seule la page officielle peut vous dire de partir.",
    named_fires_note: "Ici, les feux sont nommés, avec leur superficie et leur état de maîtrise, directement de la province.",
    estimated_fires_note: "Ici, les feux sont estimés par images satellites. Ils n'ont pas de nom et peuvent avoir quelques heures de retard.",
    official_page: 'Page officielle',

    h_limits: "Ce que cette application ne fait pas",
    not_official_h: "Ce n'est pas une source officielle",
    not_official_p: "Personne dans un centre de lutte contre les feux ou un bureau des mesures d'urgence ne surveille cette application. Elle republie des données gouvernementales. Quand cette application et la page officielle se contredisent, c'est la page officielle qui a raison.",
    no_alerts_h: "Elle n'envoie pas d'alertes",
    no_alerts_p: "Aucune notification, aucun message texte, aucune sirène. Rien ne vous joindra si vous ne regardez pas la page. Pour être averti, inscrivez-vous aux alertes d'urgence de votre municipalité et gardez En Alerte activé sur votre téléphone.",
    out_of_date_h: 'Elle peut être dépassée',
    out_of_date_p: "Nous vérifions toutes les 30 minutes, et les sources gouvernementales que nous lisons ont elles-mêmes du retard sur les événements réels. Un ordre d'évacuation peut être émis et annoncé bien avant d'apparaître ici. Les heures ci-dessus sont celles de notre dernière récupération des données, pas celles du déplacement du feu.",
    rounding_h: 'Les formes sur la carte sont approximatives',
    rounding_p: "Les limites d'évacuation sont simplifiées d'environ 55 mètres pour que la carte se charge sur une connexion lente, et les zones de feu hors de la Colombie-Britannique sont des estimations satellites. N'utilisez jamais cette application pour juger si votre maison est d'un côté ou de l'autre d'une ligne.",
    emergency_p: "Si vous êtes en danger en ce moment, composez le 911 et suivez les consignes des autorités locales.",

    footer_generated: 'Fichier de données produit le {stamp}',
  },
};

let lang = load(LANG_KEY) || ((navigator.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en');
let summary = null;

function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function store(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private browsing */ }
}

// Page copy first, then the app's shared strings, then English, then the key.
function tt(key, vars = {}) {
  const template = (PAGE[lang] || {})[key] ?? PAGE.en[key];
  if (template === undefined) return t(lang, key, vars);
  return template.replace(/\{(\w+)\}/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m);
}

const esc = (value) => String(value).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pick = (field) => (field ? (field[lang] ?? field.en) : '');

function minutesSince(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : Math.round((Date.now() - ms) / 60000);
}

// Local wall-clock time, plus the raw UTC stamp from the file. The relative age
// is what people read; the exact stamp is what makes the claim auditable.
function stamp(iso) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return esc(iso);
  const local = new Date(ms).toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA');
  return `${esc(local)}`;
}

function fact(label, valueHtml, cls = '') {
  return `<div class="fact"><dt>${esc(label)}</dt><dd class="${cls}">${valueHtml}</dd></div>`;
}

function link(href, text) {
  return `<a href="${esc(href)}" rel="noopener noreferrer" target="_blank">${esc(text)}</a>`;
}

/* ---------------- sections ---------------- */

function renderSource(source) {
  const info = SOURCES[source.id];
  const age = minutesSince(source.fetched_at);
  const stale = source.stale || !source.ok || age === null || age > 60;
  const state = !source.ok ? tt('state_failed') : (stale ? tt('state_stale') : tt('state_fresh'));

  const checked = source.fetched_at
    ? `${stamp(source.fetched_at)}<br><span style="color:var(--faint)">${esc(source.fetched_at)}</span>`
    : `<span class="bad">${esc(tt('never_fetched'))}</span>`;

  const rows = [
    fact(tt('lbl_publisher'), esc(info ? pick(info.publisher) : source.id)),
    info ? fact(tt('lbl_licence'), link(info.licence_url, pick(info.licence))) : '',
    fact(tt('lbl_checked'), checked),
    fact(tt('lbl_state'),
      `<span class="tag ${stale ? 'caution' : 'safe'}"><i></i>${esc(state)}</span>` +
      (age !== null ? `<br><span style="color:var(--faint)">${esc(t(lang, 'updated', { minutes: age }))}</span>` : '')),
    info ? fact(tt('lbl_source_page'), link(info.home, new URL(info.home).hostname)) : '',
  ].join('');

  return `
    <section class="src">
      <div class="prose">
        <h3>${esc(info ? pick(info.publisher) : source.id)}</h3>
        <p>${esc(info ? pick(info.what) : tt('unknown_source'))}</p>
        ${stale ? `<p class="bad" style="color:var(--caution)">${esc(tt('stale_note'))}</p>` : ''}
      </div>
      <dl class="facts">${rows}</dl>
    </section>`;
}

function provinceRow(entry) {
  const name = PROVINCE_NAMES[entry.province]
    ? pick(PROVINCE_NAMES[entry.province])
    : entry.province;
  return `<div class="fact prov">
      <dt><b>${esc(entry.province)}</b> ${esc(name)}</dt>
      <dd>${link(entry.official_url, tt('official_page'))}</dd>
    </div>`;
}

function renderCoverage(coverage) {
  const covered = coverage.filter((c) => c.evacuations);
  const uncovered = coverage.filter((c) => !c.evacuations);
  const named = coverage.filter((c) => c.named_fires).map((c) => c.province);

  return `
    <div class="prose">
      <h2>${esc(tt('h_coverage'))}</h2>
      <p>${esc(tt('coverage_intro'))}</p>
      <h3>${esc(tt('can_check'))} (${covered.length})</h3>
      <p>${esc(named.length ? tt('named_fires_note') : '')}</p>
    </div>
    <dl class="facts">${covered.map(provinceRow).join('')}</dl>
    <div class="prose">
      <h3>${esc(tt('cannot_check'))} (${uncovered.length})</h3>
      <p>${esc(tt('cannot_check_note', { n: uncovered.length }))}</p>
      <p>${esc(tt('estimated_fires_note'))}</p>
    </div>
    <dl class="facts">${uncovered.map(provinceRow).join('')}</dl>`;
}

function renderLimits() {
  const block = (h, p) => `<h3>${esc(tt(h))}</h3><p>${esc(tt(p))}</p>`;
  return `
    <div class="prose">
      <h2>${esc(tt('h_limits'))}</h2>
      ${block('not_official_h', 'not_official_p')}
      ${block('no_alerts_h', 'no_alerts_p')}
      ${block('out_of_date_h', 'out_of_date_p')}
      ${block('rounding_h', 'rounding_p')}
    </div>
    <div class="official">
      <p>${esc(tt('emergency_p'))}</p>
    </div>`;
}

function render() {
  document.documentElement.lang = lang;
  document.title = `${tt('page_title')} — ${t(lang, 'title')}`;
  $('lang').textContent = lang === 'fr' ? 'English' : 'Français';
  $('back').textContent = t(lang, 'map_link');

  if (!summary) return;
  const sources = summary.sources || [];
  const coverage = summary.coverage || [];

  $('content').innerHTML = `
    <div class="prose">
      <h1>${esc(tt('page_title'))}</h1>
      <p>${esc(tt('page_intro'))}</p>
      <h2>${esc(tt('h_sources'))}</h2>
      <p>${esc(tt('sources_intro'))}</p>
    </div>
    ${sources.map(renderSource).join('')}
    ${renderCoverage(coverage)}
    ${renderLimits()}`;

  // Same freshness rule as the map shell: the oldest source decides.
  const ages = sources.map((s) => minutesSince(s.fetched_at)).filter((m) => m !== null);
  const age = ages.length ? Math.max(...ages) : null;
  const stale = age === null || age > 60 || sources.some((s) => s.stale || !s.ok);
  $('freshness').className = stale ? 'live stale' : 'live';
  $('freshness-text').textContent = age === null
    ? t(lang, 'stale_warning')
    : t(lang, 'updated', { minutes: age }) + (stale ? ` — ${t(lang, 'stale_warning')}` : '');
  $('generated').textContent = tt('footer_generated', { stamp: summary.generated_at || '?' });
}

$('lang').addEventListener('click', () => {
  lang = lang === 'fr' ? 'en' : 'fr';
  store(LANG_KEY, lang);
  render();
});

render();
// Relative to the page, not the domain root: on a project page the site lives
// under /fire-app/, where '/data/summary.json' 404s.
fetch('data/summary.json', { cache: 'no-cache' })
  .then((r) => { if (!r.ok) throw new Error(`summary.json: ${r.status}`); return r.json(); })
  .then((data) => { summary = data; render(); })
  .catch((error) => {
    // Failing loudly beats a page that silently claims nothing is wrong.
    $('content').innerHTML =
      `<div class="prose"><h1>${esc(tt('page_title'))}</h1><p class="bad">${esc(String(error.message))}</p></div>`;
  });
