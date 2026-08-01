// How this fire changed, from the only two records that are honestly dated.
//
// Almost nothing upstream carries a timestamp. All 116 Gironde closures publish
// `since: null`, the evacuated communes publish no date, and FIRMS serves a
// rolling seven-day window that forgets the eighth day. There is therefore no
// history to recover after the fact: there is only what we wrote down while it
// was being served, which is what archive/timeline.json holds.
//
// Two rules run through everything here.
//
// A day the feed did not answer produces no events. Six months from now nobody
// will remember that the Gironde ArcGIS was down on a Tuesday, and a silent gap
// would otherwise read as eleven communes being released that day. It is the
// archive's version of UNAVAILABLE IS NOT NONE and it is the reason `gironde`
// is null rather than zeroed.
//
// The record's first day is not the day the fire started. That is the single
// most misleading thing this page could imply, so it is stated outright rather
// than left for a reader to assume from the top row.

const COPY = {
  fr: {
    limitsEmpty: "Aucune journée enregistrée pour l'instant. L'archive commence à "
      + "la première exécution : les sources ne publient que l'état courant, sans "
      + "date, et rien ne permet de reconstituer le passé après coup.",
    limits: (first) => `L'enregistrement commence le ${first}. Ce n'est pas la date `
      + `de départ du feu : c'est le jour où nous avons commencé à noter ce qui `
      + `était publié. Avant le ${first}, nous n'avons aucun relevé — les flux ne `
      + `datent pas leurs entrées.`,
    gap: "Flux du Département indisponible ce jour-là. Aucun événement ne peut en "
      + "être déduit : ce n'est pas l'absence de fermetures.",
    evacAdded: (c) => `Évacuation étendue : ${c.join(', ')}.`,
    evacLifted: (c) => `Ne figure plus dans la liste des communes évacuées : ${c.join(', ')}. `
      + `La levée d'un ordre est publiée par la préfecture, pas par cette page.`,
    burnGrew: (km2, added, when) => `Périmètre relevé à ${km2} km² (+${added} km²), `
      + `relevé du ${when}.`,
    closures: (n, fire) => `${n} routes coupées par le Département, dont ${fire} `
      + `pour cause d'incendie.`,
    firesFr: (n) => `${n} foyers détectés en France par satellite.`,
    evacNow: (c) => `Communes évacuées ce jour-là : ${c.join(', ')}.`,
    evacNone: 'Aucune commune évacuée dans la liste du Département ce jour-là.',
    burnNow: (km2, when) => `${km2} km² brûlés, relevé du ${when}.`,
  },
  en: {
    limitsEmpty: 'No days recorded yet. The archive starts at its first run: the '
      + 'sources publish only current state, undated, and nothing lets us '
      + 'reconstruct the past after the fact.',
    limits: (first) => `The record begins on ${first}. That is not when the fire `
      + `started: it is the day we began writing down what was being published. `
      + `Before ${first} we hold no reading at all — the feeds do not date their `
      + `entries.`,
    gap: 'The département feed was unavailable that day. No event can be inferred '
      + 'from it: that is not the absence of closures.',
    evacAdded: (c) => `Evacuation extended: ${c.join(', ')}.`,
    evacLifted: (c) => `No longer listed as evacuated: ${c.join(', ')}. Lifting an `
      + `order is published by the préfecture, not by this page.`,
    burnGrew: (km2, added, when) => `Perimeter surveyed at ${km2} km² (+${added} km²), `
      + `survey of ${when}.`,
    closures: (n, fire) => `${n} roads closed by the département, ${fire} of them `
      + `because of the fire.`,
    firesFr: (n) => `${n} fire clusters detected across France by satellite.`,
    evacNow: (c) => `Communes evacuated that day: ${c.join(', ')}.`,
    evacNone: 'No commune on the département evacuation list that day.',
    burnNow: (km2, when) => `${km2} km² burnt, survey of ${when}.`,
  },
};

const t = (lang) => COPY[lang === 'en' ? 'en' : 'fr'];

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * What changed between two recorded days.
 *
 * Either day missing its `gironde` block yields no département events at all.
 * A gap is not an observation, and the first reading after a gap is not growth
 * we watched happen.
 */
export function eventsBetween(before, after, lang = 'fr') {
  const c = t(lang);
  const events = [];
  const a = before && before.gironde;
  const b = after && after.gironde;
  if (!a || !b) return events;

  const was = new Set(a.evacuated || []);
  const now = new Set(b.evacuated || []);
  const added = [...now].filter((x) => !was.has(x));
  const lifted = [...was].filter((x) => !now.has(x));

  if (added.length) {
    events.push({ kind: 'evacuation-added', communes: added, text: c.evacAdded(added) });
  }
  if (lifted.length) {
    events.push({ kind: 'evacuation-lifted', communes: lifted, text: c.evacLifted(lifted) });
  }

  // Dated to the survey, never to the day we read it: the département surveys
  // the perimeter every few days, and stamping it with our fetch date would
  // claim a measurement nobody made.
  if (Number.isFinite(a.burn_km2) && Number.isFinite(b.burn_km2)
      && b.burn_km2 > a.burn_km2) {
    events.push({
      kind: 'burn-grew',
      km2: b.burn_km2,
      added: round1(b.burn_km2 - a.burn_km2),
      surveyed: b.surveyed || null,
      text: c.burnGrew(b.burn_km2, round1(b.burn_km2 - a.burn_km2), b.surveyed || '—'),
    });
  }
  return events;
}

/**
 * The whole record, as rows a page can render.
 *
 * `limits` is not a footnote. It is the sentence that stops a reader taking the
 * first row as the day the fire began.
 */
export function describeChronology(payload, { lang = 'fr' } = {}) {
  const c = t(lang);
  const days = (payload && payload.days) || [];
  if (!days.length) {
    return { first: null, last: null, days: 0, rows: [], limits: c.limitsEmpty };
  }

  const rows = days.map((day, i) => {
    const events = i === 0 ? [] : eventsBetween(days[i - 1], day, lang);
    const state = [];
    if (day.gironde) {
      state.push(c.closures(day.gironde.closures, day.gironde.fire_closures));
      // Named, every day, not only on the day one changes. A reader opening
      // this in six months wants to know who was out on a given date, and a
      // diff-only record answers that only for whoever reads every row.
      const out = day.gironde.evacuated || [];
      state.push(out.length ? c.evacNow(out) : c.evacNone);
      if (Number.isFinite(day.gironde.burn_km2)) {
        state.push(c.burnNow(day.gironde.burn_km2, day.gironde.surveyed || '—'));
      }
    } else {
      state.push(c.gap);
    }
    if (day.fr) state.push(c.firesFr(day.fr.fires));
    return { date: day.date, events, state, recorded: Boolean(day.gironde) };
  });

  return {
    first: days[0].date,
    last: days[days.length - 1].date,
    days: days.length,
    rows,
    limits: c.limits(days[0].date),
  };
}
