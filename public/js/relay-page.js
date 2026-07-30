// DOM wiring for the relay page. Every decision about what to say lives in
// relay.js; this file only puts it on the screen.
//
// Nothing here reads, quotes, counts or caches a linked page. The only network
// call is for our own curated file. Facebook cannot be read at all — measured
// 2026-07-30, a public prefecture page returns 309,942 bytes whose only content
// is "Login" and "Cookie" — and that is why this is a list of addresses.
import { describeRelay } from './relay.js';

const LANG_KEY = 'fire-near-me.fr.lang';

const $ = (id) => document.getElementById(id);

function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function store(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private browsing */ }
}

let lang = load(LANG_KEY) === 'en' ? 'en' : 'fr';
let payload = null;

const COPY = {
  fr: {
    lang: 'English',
    title: "Où trouver de l'aide",
    map: 'Voir la carte',
    lede: "Les pages où l'aide s'organise. Ce site ne lit aucune de ces pages et "
      + "n'en republie rien : ce sont des adresses, vous les ouvrez vous-même et "
      + 'vous jugez vous-même ce que vous y trouvez.',
    emergency: "Pour une urgence, appelez le 18 ou le 112. Cette page sert à la "
      + "logistique autour des secours, pas à appeler les secours.",
    down: 'ne répond pas',
    unknown: 'lien non vérifié',
    back: 'Carte France', zone: 'Vue locale', sources: 'Sources',
    // A statement about our file, never about the reader's situation.
    failed: "Nous n'avons pas pu charger cette liste. Les numéros ci-dessus, eux, "
      + 'fonctionnent toujours.',
  },
  en: {
    lang: 'Français',
    title: 'Where to find help',
    map: 'View the map',
    lede: 'The pages where help is being organised. This site reads none of them '
      + 'and republishes nothing from them: these are addresses, you open them '
      + 'yourself and you judge for yourself what you find there.',
    emergency: 'In an emergency call 18 or 112. This page is the logistics around '
      + 'rescue, not the way to call for it.',
    down: 'not responding',
    unknown: 'link not checked',
    back: 'France map', zone: 'Local view', sources: 'Sources',
    failed: 'We could not load this list. The numbers above still work.',
  },
};

const c = () => COPY[lang];

function entryLink(entry, t) {
  const link = document.createElement('a');
  link.className = 'link';
  link.href = entry.url;
  link.target = '_blank';
  // These are pages we do not control.
  link.rel = 'noopener noreferrer';

  const name = document.createElement('b');
  name.textContent = entry.area ? `${entry.name} — ${entry.area}` : entry.name;
  link.append(name);

  if (entry.note) {
    const note = document.createElement('span');
    note.className = 'note';
    note.textContent = entry.note;
    link.append(note);
  }

  // Three states, and the third is said out loud. Silence on an unchecked link
  // would read as "we checked it", which we did not.
  if (entry.reachable === false || entry.reachable === null) {
    const state = document.createElement('span');
    state.className = entry.reachable === false ? 'state down' : 'state unknown';
    state.textContent = entry.reachable === false ? t.down : t.unknown;
    link.append(state);
  }
  return link;
}

function render() {
  const t = c();
  document.documentElement.lang = lang;
  document.title = `${t.title} — Feux Près De Moi`;
  $('lang').textContent = t.lang;
  $('title').textContent = t.title;
  $('lede').textContent = t.lede;
  $('emergency').textContent = t.emergency;
  $('map-link').textContent = t.map;
  $('back-link').textContent = t.back;
  $('zone-link').textContent = t.zone;
  $('src-link').textContent = t.sources;

  const out = describeRelay(payload, lang);
  $('stale').hidden = !out.stale;
  if (out.stale) $('stale').textContent = out.staleNote;

  const host = $('tiers');
  host.replaceChildren();

  if (!out.groups.length) {
    const empty = document.createElement('p');
    empty.className = 'note';
    empty.style.color = 'var(--muted)';
    empty.textContent = t.failed;
    host.append(empty);
    return;
  }

  for (const group of out.groups) {
    const section = document.createElement('section');
    section.className = 'tier';

    const heading = document.createElement('h2');
    heading.textContent = group.label;
    section.append(heading);

    // Unconditional: the warning belongs to the tier, not to any entry in it,
    // so it cannot be dropped by editing the data file.
    if (group.warning) {
      const warn = document.createElement('p');
      warn.className = 'warn';
      warn.textContent = group.warning;
      section.append(warn);
    }

    for (const entry of group.entries) section.append(entryLink(entry, t));
    host.append(section);
  }
}

$('lang').onclick = () => {
  lang = lang === 'fr' ? 'en' : 'fr';
  store(LANG_KEY, lang);
  render();
};

// Render before the fetch so a stored language and the emergency number are on
// screen immediately, then again with whatever the file gave us.
render();

fetch('data/relay.json', { cache: 'no-cache' })
  .then((response) => (response.ok ? response.json() : null))
  .then((data) => { payload = data; render(); })
  .catch(() => { payload = null; render(); });
