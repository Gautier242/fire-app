// public/js/relay.js
// Where help is being organised, as links this page never reads.
//
// Pure: no DOM, no Leaflet, no fetch. Decides what to say; entraide.html decides
// where to put it.
//
// A tier states who publishes a page. It is never a claim that a particular post
// on that page is true, and no label here may imply otherwise — an official page
// can carry an out-of-date notice, and a neighbourhood group can carry the most
// useful message of the day.

export const TIERS = ['official', 'institutional', 'community'];

// Unconditional on every community group. The same sentence the coordination
// worker enforces server-side, so a reader meets it whether they post with us or
// leave for a group we cannot see.
export const SCAM_WARNING = {
  fr: "Personne ne vérifie ce qui est publié sur ces pages. Une aide réelle ne "
    + "demande jamais d'argent, de numéro de carte ni de mot de passe.",
  en: 'Nobody checks what is posted on these pages. Real help never asks for '
    + 'money, card numbers or passwords.',
};

const LABELS = {
  fr: {
    official: 'Source officielle',
    institutional: 'Organisation identifiée, non officielle',
    community: 'Nous ne pouvons pas lire cette page',
  },
  en: {
    official: 'Official source',
    institutional: 'Named organisation, not official',
    community: 'We cannot read this page',
  },
};

const STALE = {
  fr: "Cette liste n'a pas été revue récemment. Certains liens peuvent être morts.",
  en: 'This list has not been reviewed recently. Some links may be dead.',
};

export function describeRelay(payload, lang = 'fr') {
  const key = lang === 'en' ? 'en' : 'fr';
  const entries = payload && Array.isArray(payload.entries) ? payload.entries : [];
  const groups = [];

  for (const tier of TIERS) {
    const mine = entries.filter((e) => e && e.tier === tier);
    if (!mine.length) continue;
    groups.push({
      tier,
      label: LABELS[key][tier],
      // Only the community tier warns, and it warns every time it appears.
      warning: tier === 'community' ? SCAM_WARNING[key] : null,
      entries: mine.map((e) => ({
        name: e.name,
        url: e.url,
        area: e.area || null,
        note: e.note || null,
        // null means we could not check, which is not the same as down. An entry
        // that did not answer is marked and still shown: a prefecture page down
        // during a fire is information.
        reachable: e.reachable === undefined ? null : e.reachable,
      })),
    });
  }

  const stale = Boolean(payload && payload.stale);
  return { stale, staleNote: stale ? STALE[key] : null, groups };
}
