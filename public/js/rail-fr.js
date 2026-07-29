// The French answer rail. Pure — takes data, returns a description.
//
// Deliberately separate from rail.js rather than a country branch inside it.
// The two countries answer different questions: Canada answers "are you inside
// an evacuation order", France answers "how dangerous is it today and what does
// that require of you". Sharing one function would mean every future change to
// Canadian evacuation logic risks the French path, and that logic is the part
// most worth keeping simple.
import { bearingDeg, compassPoint, nearest, pointInMultiPolygon } from './geo.js';

// How close a detection has to be before the rail leads with it.
const NEAR_KM = 30;

// Météo-France's own wording. Not paraphrased: this is an official scale and
// the public recognises the colours.
export const DANGER_LABELS = {
  fr: { 1: 'Risque faible', 2: 'Risque modéré', 3: 'Risque élevé', 4: 'Risque très élevé' },
  en: { 1: 'Low risk', 2: 'Moderate risk', 3: 'High risk', 4: 'Very high risk' },
};

const TONE = { 1: 'safe', 2: 'caution', 3: 'caution', 4: 'danger' };

// What the level actually requires of a resident. Levels 3 and 4 carry real
// legal restrictions in most départements — the précise arrêté varies, so this
// states the common obligation and sends people to the préfecture for detail.
const ADVICE = {
  fr: {
    1: 'Restez prudent avec le feu. Le débroussaillement reste obligatoire autour des habitations en zone exposée.',
    2: 'Évitez tout feu à proximité de la végétation. Vérifiez votre débroussaillement.',
    3: "N'allumez aucun feu. Barbecues et travaux générant des étincelles sont à proscrire. L'accès à certains massifs peut être réglementé.",
    4: "Aucun feu, aucun travail sur végétation. L'accès aux massifs forestiers est généralement interdit. Suivez les consignes de la préfecture.",
  },
  en: {
    1: 'Stay careful with fire. Clearing vegetation around homes remains a legal duty in exposed areas.',
    2: 'Avoid any fire near vegetation. Check your clearance work.',
    3: 'Light no fires. No barbecues or spark-producing work. Access to some forest areas may be restricted.',
    4: 'No fires, no work on vegetation. Forest access is generally forbidden. Follow préfecture instructions.',
  },
};

// ATMO runs 1-6, unlike the Canadian AQHI which runs 1-10+. Reading one scale
// through the other would call "Dégradé" good air.
const ATMO_LABELS = {
  fr: { 1: 'Bon', 2: 'Moyen', 3: 'Dégradé', 4: 'Mauvais', 5: 'Très mauvais', 6: 'Extrêmement mauvais' },
  en: { 1: 'Good', 2: 'Fair', 3: 'Degraded', 4: 'Poor', 5: 'Very poor', 6: 'Extremely poor' },
};

function pick(table, lang) {
  return table[lang === 'en' ? 'en' : 'fr'];
}

const DIR_FR = { N: 'nord', NE: 'nord-est', E: 'est', SE: 'sud-est',
                 S: 'sud', SW: 'sud-ouest', W: 'ouest', NW: 'nord-ouest' };
const DIR_EN = { N: 'north', NE: 'northeast', E: 'east', SE: 'southeast',
                 S: 'south', SW: 'southwest', W: 'west', NW: 'northwest' };

function t_dir(d, lang) {
  return (lang === 'en' ? DIR_EN : DIR_FR)[d] || d;
}

// Mandatory and unconditional. France broadcasts evacuation orders by FR-Alert
// straight to phones; this map cannot see them, and must never let its own
// silence read as "no order exists".
function alertStatement(summary, L) {
  const coverage = ((summary && summary.coverage) || [])[0] || {};
  return {
    text: L === 'en'
      ? 'Evacuation orders in France are sent by FR-Alert directly to your phone. This map cannot show them.'
      : "Les ordres d'évacuation sont diffusés par FR-Alert directement sur votre téléphone. Cette carte ne peut pas les afficher.",
    label: L === 'en' ? 'How FR-Alert works' : 'Comment fonctionne FR-Alert',
    url: coverage.official_url || 'https://www.interieur.gouv.fr/Alerte/FR-Alert',
  };
}

/**
 * Describe the situation for a point in France.
 * `point` carries lat/lon and, when known, the département code.
 */
export function describeFr({ summary, point, lang = 'fr' }) {
  const L = lang === 'en' ? 'en' : 'fr';
  const danger = (summary && summary.danger) || [];
  const row = point && point.dep
    ? danger.find((d) => d.dep === point.dep)
    : null;

  const level = row && Number.isInteger(row.level_today) ? row.level_today : null;
  const tomorrow = row && Number.isInteger(row.level_tomorrow) ? row.level_tomorrow : null;

  const facts = [];
  let headline;
  let sub = '';

  // Evacuation comes first when we have it, because it is the only thing on this
  // map that says "leave now". France publishes no feed, so this is a curated
  // list and its three states must stay distinct: an order covering you, a
  // watched departement with none, and silence.
  const curation = (summary && summary.evacuation_curation) || {};
  const watched = curation.curated && !curation.stale
    && (curation.departements || []).includes(point && point.dep);
  const covering = ((summary && summary.evacuations) || [])
    .find((z) => z.polygons && z.polygons.length && pointInMultiPolygon(point, z.polygons));

  if (covering) {
    const isOrder = covering.kind === 'order';
    return {
      level, tomorrow, fire: null,
      tone: isOrder ? 'danger' : 'caution',
      headline: isOrder
        ? (L === 'en'
            ? 'You are in an area under an EVACUATION ORDER. Leave now and follow official instructions.'
            : "Vous êtes dans une zone sous ORDRE D'ÉVACUATION. Partez maintenant et suivez les consignes officielles.")
        : (L === 'en'
            ? 'You are in an area under an evacuation ALERT. Be ready to leave quickly.'
            : "Vous êtes dans une zone sous ALERTE d'évacuation. Soyez prêt à partir rapidement."),
      sub: covering.note || covering.name,
      facts: [{ label: L === 'en' ? 'Source' : 'Source',
                value: covering.source_url ? (L === 'en' ? 'Préfecture' : 'Préfecture') : '—',
                tone: 'bad' }],
      evacuation: covering,
      alert: alertStatement(summary, L),
    };
  }

  if (watched) {
    // Only sayable because somebody is actually reading this departement's
    // prefecture announcements and touched the list within 12 hours.
    facts.push({
      label: L === 'en' ? 'Evacuations' : 'Évacuations',
      value: L === 'en' ? 'None known' : 'Aucun ordre connu',
      tone: 'ok',
    });
  }

  if (level === null) {
    // Overseas départements and any gap in publication land here. Saying
    // "niveau non disponible" is the honest answer; defaulting to 1 would
    // invent an all-clear for exactly the places we know least about.
    headline = L === 'en' ? 'Fire danger not available here' : 'Niveau de danger non disponible';
    sub = L === 'en'
      ? 'Météo des forêts covers metropolitan France. Check your préfecture.'
      : 'La Météo des forêts couvre la France métropolitaine. Consultez votre préfecture.';
  } else {
    headline = pick(DANGER_LABELS, L)[level];
    sub = pick(ADVICE, L)[level];
    facts.push({
      label: L === 'en' ? 'Today' : "Aujourd'hui",
      value: `${level}/4 — ${pick(DANGER_LABELS, L)[level]}`,
      tone: TONE[level] === 'danger' ? 'bad' : TONE[level] === 'safe' ? 'ok' : 'hot',
    });
    if (tomorrow !== null) {
      facts.push({
        label: L === 'en' ? 'Tomorrow' : 'Demain',
        value: `${tomorrow}/4 — ${pick(DANGER_LABELS, L)[tomorrow]}`,
        tone: TONE[tomorrow] === 'danger' ? 'bad' : TONE[tomorrow] === 'safe' ? 'ok' : 'hot',
      });
    }
    if (row.name) {
      facts.push({ label: L === 'en' ? 'Département' : 'Département', value: row.name });
    }
  }

  // The nearest real wildfire. Industrial heat and fires across the border are
  // excluded here and nowhere else — the map still draws them, but neither is
  // the answer to "is there a fire near me".
  const burning = ((summary && summary.fires) || [])
    .filter((f) => !f.industrial && f.in_country !== false);
  const near = nearest(point, burning);
  let fire = null;
  if (near && near.km <= NEAR_KM) {
    fire = { km: Math.round(near.km), item: near.item,
             direction: compassPoint(bearingDeg(point, near.item)) };
    facts.unshift({
      label: L === 'en' ? 'Nearest heat' : 'Chaleur la plus proche',
      value: `${fire.km} km ${L === 'en' ? '' : 'au '}${t_dir(fire.direction, L)}`,
      tone: 'bad',
    });
  }

  const station = nearest(point, (summary && summary.air_quality) || []);
  if (station && Number.isInteger(station.item.value)) {
    const v = station.item.value;
    facts.push({
      label: L === 'en' ? 'Air quality' : "Qualité de l'air",
      value: `${v}/6 — ${pick(ATMO_LABELS, L)[v] || '—'}`,
      tone: v >= 5 ? 'bad' : v >= 3 ? 'air' : 'ok',
    });
  }

  const alert = alertStatement(summary, L);

  return {
    level,
    fire,
    tomorrow,
    tone: level === null ? 'caution' : TONE[level],
    headline,
    sub,
    facts,
    alert,
  };
}
