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
    limits: (first) => `Cette page ne commence pas au départ du feu. L'enregistrement `
      + `des flux commence le ${first} : c'est le jour où nous avons commencé à noter ce `
      + `qui était publié. Les jours antérieurs affichés ici ne tiennent qu'aux détections `
      + `satellite, parce que FIRMS date les siennes alors que les autres flux ne datent `
      + `rien. Son flux ne conserve que sept jours : avant le premier jour affiché, il `
      + `n'existe plus aucune donnée, pas même une détection.`,
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
    observedDetections: (n) => `${n} détections de chaleur par satellite dans un rayon `
      + `de 50 km autour de Bordeaux. C'est ce que les satellites ont vu, pas un périmètre.`,
    observedOnly: "Nous n'enregistrions pas encore ce jour-là : aucun relevé des flux du "
      + "Département, ni des routes, ni des évacuations. La détection satellite est le seul "
      + "élément daté qui subsiste.",
    observedPartial: "Journée partielle : la fenêtre d'observation ne couvre pas les "
      + "24 heures, donc le total est plus bas pour une raison qui ne concerne pas le feu.",
  },
  en: {
    limitsEmpty: 'No days recorded yet. The archive starts at its first run: the '
      + 'sources publish only current state, undated, and nothing lets us '
      + 'reconstruct the past after the fact.',
    limits: (first) => `This page does not begin when the fire did. The feed record `
      + `begins on ${first}: the day we began writing down what was being published, `
      + `not when the fire started. The earlier days `
      + `shown here rest on satellite detections alone, because FIRMS dates its own `
      + `while the other feeds date nothing. FIRMS keeps seven days: before the first `
      + `day shown, no data survives at all, not even a detection.`,
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
    observedDetections: (n) => `${n} satellite heat detections within 50 km of Bordeaux. `
      + `That is what the satellites saw, not a perimeter.`,
    observedOnly: 'We were not recording yet that day: no reading of the département feeds, '
      + 'the roads or the evacuations. The satellite detection is the only dated thing left.',
    observedPartial: 'Partial day: the observation window does not cover all 24 hours, so the '
      + 'total is lower for a reason that has nothing to do with the fire.',
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

  // Where the archive itself starts, as opposed to where the satellite reaches.
  // The two are different dates meaning different things: one is the day we began
  // writing down what was served, the other is as far back as FIRMS still carried
  // timestamps when we first looked. Collapsing them would date the archive to a
  // day it was keeping nothing.
  const recordedDays = days.filter((d) => d.fr || d.gironde);
  const firstRecorded = recordedDays.length ? recordedDays[0].date : null;

  const rows = days.map((day, i) => {
    const events = i === 0 ? [] : eventsBetween(days[i - 1], day, lang);
    const state = [];
    // A day we only have satellite for is not a day a feed failed. Saying the gap
    // sentence here would invent an outage of something we were not reading.
    if (day.observed && !day.fr && !day.gironde) {
      state.push(c.observedDetections(day.observed.detections));
      if (day.observed.partial) state.push(c.observedPartial);
      state.push(c.observedOnly);
      return { date: day.date, kind: 'observed', events: [], state,
               partial: Boolean(day.observed.partial), recorded: false };
    }
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
    return { date: day.date, kind: 'recorded', events, state,
             partial: false, recorded: Boolean(day.gironde) };
  });

  const observedDays = days.filter((d) => d.observed);
  return {
    first: days[0].date,
    last: days[days.length - 1].date,
    days: days.length,
    rows,
    observedFrom: observedDays.length ? observedDays[0].date : null,
    limits: firstRecorded ? c.limits(firstRecorded) : c.limitsEmpty,
  };
}
