// Wiring for the chronology. Every decision about what to say lives in
// chronology.js; this owns the DOM and nothing else.
import { describeChronology } from './chronology.js';

const LANG_KEY = 'fire-near-me.fr.lang';
const $ = (id) => document.getElementById(id);

let lang = load(LANG_KEY) || 'fr';
let record = null;
// null = not fetched yet, false = the fetch failed. Never collapsed into an
// empty record: empty means we have watched and written nothing down, failed
// means we could not read what we wrote.
let failed = false;

function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function store(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private browsing */ }
}

const COPY = {
  fr: {
    lang: 'English', title: 'Chronologie', map: 'Voir la carte',
    lede: "Ce que nous avons relevé, jour par jour, tant que les sources le publiaient. "
      + "Les communes évacuées et les routes coupées sont republiées par le Département "
      + "sans date : nous notons ce qui était affiché le jour où nous avons regardé.",
    failed: "Impossible de charger l'enregistrement. Cela ne veut pas dire qu'il n'y a "
      + "rien à montrer : nous n'avons pas pu lire notre propre archive.",
    back: 'Carte France', zone: 'Vue locale', src: 'Sources',
  },
  en: {
    lang: 'Français', title: 'Chronology', map: 'See the map',
    lede: 'What we recorded, day by day, for as long as the sources published it. '
      + 'The evacuated communes and closed roads are republished by the département '
      + 'without dates: we note what was showing on the day we looked.',
    failed: 'Could not load the record. That does not mean there is nothing to show: '
      + 'we could not read our own archive.',
    back: 'France map', zone: 'Local view', src: 'Sources',
  },
};
const c = () => COPY[lang === 'en' ? 'en' : 'fr'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function render() {
  document.documentElement.lang = lang;
  $('lang').textContent = c().lang;
  $('title').textContent = c().title;
  $('lede').textContent = c().lede;
  $('map-link').textContent = c().map;
  $('back-link').textContent = c().back;
  $('zone-link').textContent = c().zone;
  $('src-link').textContent = c().src;

  if (failed) {
    $('limits').textContent = c().failed;
    $('days').innerHTML = '';
    return;
  }

  const out = describeChronology(record, { lang });
  $('limits').textContent = out.limits;

  // Newest first: somebody opening this wants the latest state, and reading
  // upward into the past is the natural direction for a record.
  // "gap" means a feed we were reading did not answer. A satellite-only day is not
  // that: we were not reading anything yet, so it must not borrow the colour that
  // says an outage happened.
  const dayClass = (row) => {
    if (row.kind === 'observed') return 'day observed';
    return row.recorded ? 'day' : 'day gap';
  };
  $('days').innerHTML = [...out.rows].reverse().map((row) => `
    <div class="${dayClass(row)}">
      <h2>${esc(row.date)}</h2>
      ${row.events.map((e) => `
        <div class="ev${e.kind === 'evacuation-lifted' ? ' lifted' : ''}">
          <p>${esc(e.text)}</p>
        </div>`).join('')}
      <div class="state">${row.state.map((s) => `<span>${esc(s)}</span>`).join('')}</div>
    </div>`).join('') || `<p class="empty">${esc(c().lede)}</p>`;
}

$('lang').addEventListener('click', () => {
  lang = lang === 'en' ? 'fr' : 'en';
  store(LANG_KEY, lang);
  render();
});

render();

// Page-relative: on a project page the site lives under /fire-app/, where
// '/fr/data/timeline.json' 404s.
fetch('data/timeline.json', { cache: 'no-cache' })
  .then((r) => {
    // 404 is the honest state before the archive workflow has ever run, and it
    // is not a failure: describeChronology says there is nothing recorded yet.
    if (r.status === 404) return { days: [] };
    if (!r.ok) throw new Error(`timeline.json: ${r.status}`);
    return r.json();
  })
  .then((data) => { record = data; render(); })
  .catch(() => { failed = true; render(); });
