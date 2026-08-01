// The responder view. A different trust level from the public map, and the only
// reason it exists.
//
// The public page must never show a modelled figure a reader could mistake for an
// observation, so it shows a distance and a caveat. A professional can use a
// modelled figure provided the uncertainty comes with it as a number. Everything
// here is therefore something /fr/zone.html cannot responsibly show: the rate of
// spread itself, the slope it was computed on, the scale that slope was sampled
// at, and the three things we cannot see at all.
//
// Unlinked on purpose. Nothing public points at this page.
//
// Strings live here rather than in i18n.js: the shared files are asserted to have
// equal key sets across languages and this page is not part of that contract.
import { createMap } from './mapview.js';
import { haversineKm, compassPoint } from './geo.js';

/* ---------------- what the model is, in numbers ---------------- */

// Verified against the build, 2026-07-30, not read from documentation:
//   build/main.py            SLOPE_RADIUS_KM = 2, SLOPE_STEP = 8,
//                            MAX_SLOPE_FETCHES = 4, DEFAULT_FUEL = "FM5"
//   build/sources/fr/terrain.py  spacing_m = 2 * radius_km * 1000 / (step - 1)
//   tests/test_fire_spread.py    the one published-reference assertion
const SLOPE_RADIUS_KM = 2;
const SLOPE_STEP = 8;
const SLOPE_SPACING_M = Math.round(2 * SLOPE_RADIUS_KM * 1000 / (SLOPE_STEP - 1)); // 571
const MAX_SLOPE_FETCHES = 4;

// Maximum slope over the Massif des Maures, centred 43.30/6.40, measured against
// IGN on 2026-07-29 at five sampling spacings. All five are arithmetically
// correct; they answer different questions.
const SLOPE_SCALE = [
  { spacing_m: 5714, deg: 2.95 },
  { spacing_m: 571, deg: 17.34 },
  { spacing_m: 143, deg: 28.43 },
];

// Rothermel's slope factor goes as tan squared, which is why the sampling scale
// is not a detail. Computed, not asserted.
const TAN2 = (deg) => Math.tan(deg * Math.PI / 180) ** 2;
const TAN2_LOW = TAN2(SLOPE_SCALE[0].deg);            // 0.0027
const TAN2_HIGH = TAN2(SLOPE_SCALE[2].deg);           // 0.2933
const TAN2_RATIO = Math.round(TAN2_HIGH / TAN2_LOW);  // 110

// The single published-reference check the implementation passes.
const REFERENCE = {
  source: 'Andrews 2018, RMRS-GTR-371',
  where: 'p. 59, table 17, ligne 1 / row 1',
  published_ft_min: 81.6,
  deviation_pct: 0.0193,
};

// The mark that follows every modelled number, and the sentence the mark means.
export const MODELLED_NOTE = {
  mark: '†',
  fr: 'Rothermel 1972, validated=false. Jamais validé sur un feu réel.',
  en: 'Rothermel 1972, validated=false. Never validated against a real fire.',
};

// Exported so the language tests can hold the strings against the HTML that
// declares them. Nothing in the browser imports this.
export const COPY = {
  fr: {
    title: 'Vue opérationnelle',
    subtitle: 'Chiffres modélisés avec leur incertitude. Pas une surface publique.',
    lang: 'English', zonePick: 'Zone', back: 'Carte France', sources: 'Sources',
    loading: 'Chargement…', failed: 'Données indisponibles.',
    updated: (m) => `Mis à jour il y a ${m} min`,
    modelTitle: 'Ce que vaut le modèle',
    triageTitle: 'Foyers, par puissance radiative décroissante',
    noFires: 'Aucune détection dans cette zone sur la fenêtre publiée. Les satellites passent quelques fois par jour et les nuages masquent la détection : c’est un état de nos données, pas du terrain.',
    resourcesTitle: 'Ce que nous ne voyons pas',
    closuresTitle: 'Coupures du réseau national dans le rayon',
    noClosures: 'Aucune coupure du réseau routier national dans ce rayon. Bison Futé ne voit que le réseau national : ni les voies communales, ni une route qu’une préfecture vient de fermer.',
    closuresNote: 'Toutes causes confondues, pas seulement le feu. Les coupures pas encore en vigueur sont listées ici avec leur date ; elles ne sont jamais tracées sur la carte.',
    legend: (mark, note) => `${mark} ${note}`,
    cols: {
      place: 'Position', frp: 'FRP total', frp_max: 'FRP max',
      detections: 'Détections', last: 'Dernier passage', confidence: 'Confiance',
      ros: 'Vitesse tête', reach: 'Portée 3 h', bearing: 'Cap', slope: 'Pente',
      moisture: 'Humidité combustible', fuel: 'Combustible',
    },
    mean: 'moyen', gust: 'rafale',
    map: {
      waterPoint: "Point d'eau",
      registerTier: 'Registre SDIS — zone réellement recensée',
      crowdTier: 'OpenStreetMap — pas un registre',
      capacityUnknown: 'Capacité inconnue',
      noFlowGuarantee: "Un registre ne garantit ni le débit ni l'accès.",
      crowdCaveat: "Recensement bénévole, complétude inconnue. Aucun point affiché ne veut pas dire aucune eau.",
      kinds: { borne: 'Borne ou poteau', citerne: 'Citerne ou réserve', naturel: "Point d'aspiration" },
    },
    none: '—', notStated: 'non indiqué par ce build',
    noProjection: 'non projeté : pas de vent utilisable',
    slopeZero: '0,0°',
    slopeZeroNote: 'Terrain plat, ou repli à plat faute de relief résolu : le build n’émet pas la différence. Voir build/main.py.',
    slopeNote: (m) => `Pente médiane sur une grille ${SLOPE_STEP}×${SLOPE_STEP} de rayon ${SLOPE_RADIUS_KM} km, soit un pas de ${m} m.`,
    slopeMissing: 'Le payload de cette zone ne porte pas slope_deg. La projection a été calculée sur une pente inconnue de cette page : ne pas la supposer nulle.',
    ageMin: (m) => `il y a ${m} min`,
    ageHours: (h) => `il y a ${h} h`,
    water: {
      none: (areas) => `Aucun point d’eau publié dans ce rayon. Ce n’est pas l’absence d’eau : c’est l’absence de registre publié pour cette zone. Les registres disponibles couvrent ${areas}.`,
      spill: (n, areas, from) => `${n} point(s) d’eau tombent dans ce rayon, mais ils viennent du registre ${from} — un département voisin, pas un relevé de cette zone. Les registres disponibles couvrent ${areas}.`,
      covered: (n, from) => `${n} point(s) d’eau publiés dans ce rayon, registre ${from}. Un registre n’est pas une garantie de débit ni d’accès.`,
      unknown: 'Couverture des points d’eau inconnue : le fichier n’a pas été chargé. Ne pas lire cela comme une absence d’eau.',
      scopes: (dep, loc) => `${dep} registre(s) à l’échelle d’un département entier, ${loc} à l’échelle d’une commune ou d’une métropole.`,
      // Le cinquième état, à côté des quatre ci-dessus et jamais à leur place :
      // une source bénévole, comptée séparément et jamais additionnée.
      crowd: (n) => `${n} bouche(s) d’incendie cartographiée(s) par OpenStreetMap dans ce rayon. Ce n’est pas un registre : personne ne garantit que la liste soit complète, et l’absence de point n’est pas la même chose que l’absence d’eau.`,
      crowdUnavailable: 'Couche OpenStreetMap indisponible : nous n’avons pas pu interroger la base. Ce n’est pas l’absence d’eau.',
    },
    ground: 'Aucune position d’unité au sol, jamais. Les 22 jeux de données SDIS sur data.gouv sont des budgets et des périmètres, aucun n’est en temps réel, et OpenStreetMap ne connaît que 4 casernes dans toute l’emprise Gironde contre une centaine réelles. Ce vide est celui de nos sources, pas celui du terrain.',
    air: {
      some: (n) => `${n} aéronef(s) observé(s) sous 1 500 m à moins de 10 km d’un foyer. Ce qu’ils font n’est pas confirmé : un passage n’est pas un largage.`,
      none: 'Aucun aéronef dans le dernier cycle. Les moyens aériens ne volent pas de nuit et OpenSky ne voit que les transpondeurs allumés.',
    },
    closureState: { yes: 'en vigueur', no: 'programmée, pas encore en vigueur', unknown: 'non indiqué par ce build' },
  },
  en: {
    title: 'Responder view',
    subtitle: 'Modelled numbers with their uncertainty. Not a public surface.',
    lang: 'Français', zonePick: 'Zone', back: 'France map', sources: 'Sources',
    loading: 'Loading…', failed: 'Data unavailable.',
    updated: (m) => `Updated ${m} min ago`,
    modelTitle: 'What the model is worth',
    triageTitle: 'Fires, by descending radiative power',
    noFires: 'No detection in this zone over the published window. Satellites pass a few times a day and cloud blocks detection: this is a statement about our data, not about the ground.',
    resourcesTitle: 'What we cannot see',
    closuresTitle: 'National-network cuts within the radius',
    noClosures: 'No national-network road cut in this radius. Bison Futé only sees the national network: not communal roads, not a road a préfecture has just shut.',
    closuresNote: 'All causes, not only fire. Cuts not yet in force are listed here with their dates; they are never drawn on the map.',
    legend: (mark, note) => `${mark} ${note}`,
    cols: {
      place: 'Position', frp: 'Total FRP', frp_max: 'Peak FRP',
      detections: 'Detections', last: 'Last pass', confidence: 'Confidence',
      ros: 'Head speed', reach: '3 h reach', bearing: 'Bearing', slope: 'Slope',
      moisture: 'Fuel moisture', fuel: 'Fuel',
    },
    mean: 'mean', gust: 'gust',
    map: {
      waterPoint: 'Water point',
      registerTier: 'SDIS register — area actually surveyed',
      crowdTier: 'OpenStreetMap — not a register',
      capacityUnknown: 'Capacity unknown',
      noFlowGuarantee: 'A register guarantees neither flow nor access.',
      crowdCaveat: 'Volunteer-mapped, completeness unknown. No point shown does not mean no water.',
      kinds: { borne: 'Hydrant', citerne: 'Tank or reserve', naturel: 'Draw point' },
    },
    none: '—', notStated: 'not stated by this build',
    noProjection: 'not projected: no usable wind',
    slopeZero: '0.0°',
    slopeZeroNote: 'Flat ground, or a flat fallback because terrain would not resolve: the build does not emit the difference. See build/main.py.',
    slopeNote: (m) => `Median slope over an ${SLOPE_STEP}×${SLOPE_STEP} grid of radius ${SLOPE_RADIUS_KM} km, a ${m} m sampling step.`,
    slopeMissing: 'This zone payload carries no slope_deg. The projection was computed on a slope this page cannot see: do not assume it was zero.',
    ageMin: (m) => `${m} min ago`,
    ageHours: (h) => `${h} h ago`,
    water: {
      none: (areas) => `No water point published in this radius. That is not the absence of water: it is the absence of a published register for this area. The available registers cover ${areas}.`,
      spill: (n, areas, from) => `${n} water point(s) fall inside this radius, but they come from the ${from} register — a neighbouring département, not a survey of this zone. The available registers cover ${areas}.`,
      covered: (n, from) => `${n} water point(s) published in this radius, ${from} register. A register is no guarantee of flow or of access.`,
      unknown: 'Water-point coverage unknown: the file did not load. Do not read that as the absence of water.',
      scopes: (dep, loc) => `${dep} register(s) at whole-département scale, ${loc} at commune or métropole scale.`,
      // The fifth state, beside the four above and never in place of one: a
      // volunteer source, counted separately and never added to a register.
      crowd: (n) => `${n} fire hydrant(s) mapped by OpenStreetMap in this radius. This is not a register: nobody guarantees the list is complete, and no point shown is not the same as no water.`,
      crowdUnavailable: 'OpenStreetMap layer unavailable: we could not query the database. That is not the absence of water.',
    },
    ground: 'No ground-unit position, ever. The 22 SDIS datasets on data.gouv are budgets and boundaries, none is real-time, and OpenStreetMap knows only 4 fire stations in the whole Gironde bbox against roughly 100 real ones. That gap is in our sources, not on the ground.',
    air: {
      some: (n) => `${n} aircraft observed below 1,500 m within 10 km of a fire. What they are doing is not confirmed: a pass is not a drop.`,
      none: 'No aircraft in the last cycle. Air support does not fly at night and OpenSky only sees transponders that are switched on.',
    },
    closureState: { yes: 'in force', no: 'scheduled, not yet in force', unknown: 'not stated by this build' },
  },
};

const t = (lang) => COPY[lang === 'en' ? 'en' : 'fr'];
const num = (lang, value, digits = 1) => {
  const s = value.toFixed(digits);
  return lang === 'en' ? s : s.replace('.', ',');
};

/* ---------------- pure: the triage table ---------------- */

function cell(key, label, value, { modelled = false, note = '', lang = 'fr' } = {}) {
  return {
    key, label, value,
    modelled,
    mark: modelled ? MODELLED_NOTE.mark : '',
    // Every modelled cell states validated=false, in its own accessible name.
    // A dagger alone in a dense table is a decoration; the sentence is the fact.
    note: modelled ? `${MODELLED_NOTE[lang === 'en' ? 'en' : 'fr']}${note ? ` ${note}` : ''}` : '',
  };
}

function age(lang, iso, now) {
  if (!iso) return t(lang).notStated;
  const minutes = Math.round((now - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(minutes)) return t(lang).notStated;
  return minutes < 90 ? t(lang).ageMin(minutes) : t(lang).ageHours(Math.round(minutes / 60));
}

// Absent is not zero. build/fire_spread.py emits slope_deg, but a zone file built
// before that lands does not carry it, and 0.0 is itself ambiguous — main.py falls
// back to flat ground when IGN will not resolve. Both cases say what they are.
function slopeCell(lang, projection) {
  const c = t(lang);
  const slope = projection && projection.slope_deg;
  if (slope === null || slope === undefined) {
    return cell('slope', c.cols.slope, c.notStated, { modelled: true, lang, note: c.slopeMissing });
  }
  if (slope === 0) {
    return cell('slope', c.cols.slope, c.slopeZero,
      { modelled: true, lang, note: `${c.slopeZeroNote} ${c.slopeNote(SLOPE_SPACING_M)}` });
  }
  return cell('slope', c.cols.slope, `${num(lang, slope, 1)}°`,
    { modelled: true, lang, note: c.slopeNote(SLOPE_SPACING_M) });
}

function modelPanel(lang) {
  const c = t(lang);
  const scale = SLOPE_SCALE
    .map((s) => `${s.spacing_m} m → ${num(lang, s.deg, 2)}°`)
    .join(' · ');
  const notes = lang === 'en' ? [
    `Rothermel 1972 as restated in ${REFERENCE.source}. validated=false on every projection.`,
    `Checked against one published value only: ${REFERENCE.where} — ${REFERENCE.published_ft_min} ft/min for a synthetic 1-hour fuel bed at 5 % moisture, 5 mph midflame wind and 0° slope. Measured deviation ${num(lang, REFERENCE.deviation_pct, 4)} %.`,
    `That check covers neither FM5 nor the slope term. The slope term has a directional test only, no published value. Nothing here has been validated against a real fire.`,
    `Fuel is FM5 (garrigue basse) for every fire in every zone. There is no fuel map: a pine plantation and low scrub are given the same fuel bed.`,
    `Slope: ${c.slopeNote(SLOPE_SPACING_M)} Slope is scale-dependent, measured over the Massif des Maures: ${scale}. Rothermel's slope factor goes as tan², so tan² runs ${num(lang, TAN2_LOW, 4)} to ${num(lang, TAN2_HIGH, 4)} over that range — a factor of ${TAN2_RATIO} from the sampling choice alone.`,
    `Only the first ${MAX_SLOPE_FETCHES} fires in a zone get their own slope sample; the rest inherit the zone median.`,
    `Fuel moisture is inferred from relative humidity as 0.03 + 0.001·RH, clamped to 0.02–0.35. It is not measured, and it ignores temperature, wind and solar exposure.`,
    `Wind is a forecast, averaged over the projection window and drawn as a ±25° wedge. Both the mean-wind and gust arcs are given because one number would imply a precision this has not got.`,
  ] : [
    `Rothermel 1972 dans la reformulation ${REFERENCE.source}. validated=false sur chaque projection.`,
    `Vérifié contre une seule valeur publiée : ${REFERENCE.where} — ${REFERENCE.published_ft_min} ft/min pour un lit de combustible synthétique 1 h à 5 % d’humidité, vent mi-flamme 5 mph, pente 0°. Écart mesuré ${num(lang, REFERENCE.deviation_pct, 4)} %.`,
    `Ce contrôle ne couvre ni FM5 ni le terme de pente. Le terme de pente n’a qu’un test de sens, aucune valeur publiée. Rien ici n’a été validé sur un feu réel.`,
    `Le combustible est FM5 (garrigue basse) pour chaque foyer de chaque zone. Il n’y a pas de carte de combustible : une pinède et un maquis bas reçoivent le même lit.`,
    `Pente : ${c.slopeNote(SLOPE_SPACING_M)} La pente dépend de l’échelle de mesure, relevé sur le Massif des Maures : ${scale}. Le facteur de pente de Rothermel va en tan², donc tan² passe de ${num(lang, TAN2_LOW, 4)} à ${num(lang, TAN2_HIGH, 4)} sur cette plage — un facteur ${TAN2_RATIO} dû au seul choix d’échantillonnage.`,
    `Seuls les ${MAX_SLOPE_FETCHES} premiers foyers d’une zone obtiennent leur propre relevé de pente ; les autres héritent de la médiane de zone.`,
    `L’humidité du combustible est déduite de l’humidité relative par 0,03 + 0,001·HR, bornée à 0,02–0,35. Elle n’est pas mesurée, et ignore température, vent et exposition solaire.`,
    `Le vent est une prévision, moyennée sur la fenêtre de projection et tracée en secteur ±25°. Les deux arcs, vent moyen et rafale, sont donnés parce qu’un seul chiffre suggérerait une précision inexistante.`,
  ];
  return {
    title: c.modelTitle,
    validated: false,
    model: 'rothermel-1972',
    fuel_model: 'FM5',
    reference: REFERENCE,
    slope_spacing_m: SLOPE_SPACING_M,
    notes,
  };
}

/**
 * One row per fire, ranked by total radiative power.
 *
 * A fire with no usable projection is listed rather than dropped: a responder
 * needs to know it is there, and the missing projection is itself information.
 */
export function triage({ zone, lang = 'fr', now = Date.now() } = {}) {
  const c = t(lang);
  const fires = (zone && zone.fires) || [];
  const spread = (zone && zone.spread) || [];
  const byId = new Map(spread.map((s) => [s.id, s]));

  const rows = [...fires]
    .sort((a, b) => (b.frp_total || 0) - (a.frp_total || 0))
    .map((fire) => {
      const projection = byId.get(fire.id) || null;
      const arcs = (projection && projection.arcs) || [];
      const mean = arcs.find((a) => a.basis === 'mean');
      const gust = arcs.find((a) => a.basis === 'gust');
      const hours = (projection && projection.hours) || 3;
      const pair = (pick, digits, unit) => (mean || gust
        ? [mean, gust].map((a, i) => (a
          ? `${num(lang, pick(a), digits)} ${unit} ${i ? c.gust : c.mean}`
          : null)).filter(Boolean).join(' / ')
        : c.noProjection);

      const cells = [
        cell('place', c.cols.place,
          `${num(lang, fire.lat, 4)}, ${num(lang, fire.lon, 4)}`, { lang }),
        cell('frp', c.cols.frp, `${Math.round(fire.frp_total || 0)} MW`, { lang }),
        cell('frp_max', c.cols.frp_max, `${Math.round(fire.frp_max || 0)} MW`, { lang }),
        cell('detections', c.cols.detections, String(fire.detections ?? 0), { lang }),
        cell('last', c.cols.last, age(lang, fire.last_seen, now), { lang }),
        cell('confidence', c.cols.confidence, fire.confidence || c.notStated, { lang }),
        // Everything below is modelled and says so.
        cell('ros', c.cols.ros, pair((a) => a.ros_m_min, 1, 'm/min'), { modelled: true, lang }),
        cell('reach', `${c.cols.reach}`,
          mean || gust ? pair((a) => a.distance_m / 1000, 1, 'km') : c.noProjection,
          { modelled: true, lang,
            note: lang === 'en' ? `Over ${hours} h.` : `Sur ${hours} h.` }),
        cell('bearing', c.cols.bearing,
          mean || gust
            ? `${(mean || gust).bearing}° ${compassPoint((mean || gust).bearing)}`
            : c.noProjection,
          { modelled: true, lang }),
        slopeCell(lang, projection),
        cell('moisture', c.cols.moisture,
          projection && projection.moisture !== undefined && projection.moisture !== null
            ? `${num(lang, projection.moisture * 100, 1)} %`
            : c.notStated,
          { modelled: true, lang }),
        cell('fuel', c.cols.fuel, (projection && projection.fuel_model) || c.notStated,
          { modelled: true, lang }),
      ];
      return { id: fire.id, lat: fire.lat, lon: fire.lon, cells };
    });

  return { model: modelPanel(lang), rows, empty: !rows.length, emptyText: c.noFires };
}

/* ---------------- pure: what we cannot see ---------------- */

/**
 * Water-point coverage for one zone.
 *
 * Keyed on the published coverage list, never on a point count. Measured
 * 2026-07-30: 0 points within 50 km of the Gironde centre, and 5 within 50 km of
 * the Landes centre — all of them tagged département 64, spill-over from the
 * Pyrénées-Atlantiques register. A count alone would read as coverage.
 */
export function waterStatement({ zone, water, lang = 'fr' } = {}) {
  const c = t(lang);
  const areas = ((water && water.coverage) || []);
  if (!water || !areas.length) {
    return { visible: null, covered: false, text: c.water.unknown, areas: [] };
  }
  const areaList = areas.map((a) => a.area).join(', ');
  const scopes = c.water.scopes(
    areas.filter((a) => a.scope === 'departement').length,
    areas.filter((a) => a.scope !== 'departement').length);

  const centre = zone && Number.isFinite(zone.lat) ? zone : null;
  const radius = (zone && zone.radius_km) || 50;
  // Register points only. The crowd layer ships in its own file today, but the
  // rule is that no code path sums the two, not that no file mixes them: a
  // volunteer-mapped dot must never inflate the number that reads as coverage.
  const near = centre
    ? ((water.points || []).filter((p) => p.tier !== 'crowd'
        && haversineKm(centre, p) <= radius))
    : [];

  if (!near.length) {
    return { visible: 0, covered: false, areas,
             text: `${c.water.none(areaList)} ${scopes}` };
  }

  // Which register did these points actually come from? Their own dep, joined to
  // the coverage list. A register for a neighbouring département is not coverage
  // of this one, and this is the only place that distinction can be made.
  const deps = [...new Set(near.map((p) => p.dep))];
  const from = deps
    .map((d) => (areas.find((a) => a.dep === d) || {}).area || d)
    .join(', ');
  // Covered only when a register exists whose scope is a whole département and
  // whose points dominate the radius. Anything else is reported as spill-over,
  // because that is the failure mode that would read as a survey.
  const covered = near.length >= 25 && deps.some((d) =>
    areas.some((a) => a.dep === d && a.scope === 'departement'));
  return {
    visible: near.length,
    covered,
    areas,
    text: covered
      ? `${c.water.covered(near.length, from)} ${scopes}`
      : `${c.water.spill(near.length, areaList, from)} ${scopes}`,
  };
}

/**
 * Crowd-sourced hydrants for the same zone, as their own count.
 *
 * Deliberately a second function rather than a branch inside waterStatement:
 * there is no shared total to compute, and the two answer different questions. A
 * register is complete for its area, so absence inside one means something. Here
 * absence means nobody has mapped that street — the same OSM extract holds 4 fire
 * stations in the Gironde bbox against roughly 100 real ones.
 *
 * `visible` is null rather than 0 when the layer could not be consulted. A layer
 * we could not ask is not a layer that answered nothing.
 */
export function crowdWaterStatement({ zone, hydrants, lang = 'fr' } = {}) {
  const c = t(lang);
  // Overpass answering 504, or the file never loading, mean the same thing to
  // somebody looking for water: we could not ask, and that is not an answer.
  if (!hydrants || hydrants.available === false) {
    return { visible: null, available: false, text: c.water.crowdUnavailable };
  }
  const centre = zone && Number.isFinite(zone.lat) ? zone : null;
  const radius = (zone && zone.radius_km) || 50;
  const near = centre
    ? ((hydrants.points || []).filter((p) => haversineKm(centre, p) <= radius))
    : [];
  return { visible: near.length, available: true, text: c.water.crowd(near.length) };
}

/** Unconditional. Never gated on an aircraft count or on anything else. */
export function groundStatement({ lang = 'fr' } = {}) {
  return t(lang).ground;
}

export function airStatement({ aircraft = 0, lang = 'fr' } = {}) {
  const c = t(lang);
  return aircraft ? c.air.some(aircraft) : c.air.none;
}

/**
 * National-network cuts inside the zone radius.
 *
 * The public map excludes a cut that has not started. This page lists it, dated
 * and stated: a scheduled closure is real information for a responder planning a
 * route, provided it can never be read as shut now. A payload with no in_force
 * field is reported as unstated rather than guessed either way.
 */
export function scheduledClosures({ zone, summary, lang = 'fr' } = {}) {
  const c = t(lang);
  const all = (summary && summary.closures) || [];
  const centre = zone && Number.isFinite(zone.lat) ? zone : null;
  const radius = (zone && zone.radius_km) || 50;
  const rows = all
    .filter((x) => centre && Number.isFinite(x.lat) && Number.isFinite(x.lon)
      && haversineKm(centre, x) <= radius)
    .map((x) => ({
      id: x.id,
      label: `${x.road || ''} — ${x.place || ''}`.trim(),
      headline: x.headline || '',
      in_force: x.in_force === undefined ? null : x.in_force,
      state: x.in_force === undefined ? c.closureState.unknown
        : x.in_force ? c.closureState.yes : c.closureState.no,
      dates: [x.since, x.until].filter(Boolean).join(' → ') || c.notStated,
    }));
  return { rows, text: rows.length ? c.closuresNote : c.noClosures };
}

/* ---------------- DOM ---------------- */

const $ = (id) => document.getElementById(id);
const LANG_KEY = 'fire-near-me.fr.lang';

let lang = 'fr';
let zone = null;
let summary = null;
let hydrants = null;
let crowdNote = null;
let view = null;

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

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderModel(model) {
  $('model-title').textContent = model.title;
  const list = $('model-notes');
  list.innerHTML = '';
  for (const note of model.notes) list.append(el('li', null, note));
  $('model-badge').textContent = 'validated=false';
}

function renderTriage({ rows, empty, emptyText }) {
  const c = t(lang);
  $('triage-title').textContent = c.triageTitle;
  $('triage-empty').hidden = !empty;
  $('triage-empty').textContent = emptyText;
  const body = $('triage-body');
  body.innerHTML = '';
  for (const row of rows) {
    const block = el('div', 'fire');
    for (const cl of row.cells) {
      const line = el('div', `cell${cl.modelled ? ' modelled' : ''}`);
      line.append(el('span', 'k', cl.label));
      const v = el('span', 'v', cl.value + (cl.mark ? ` ${cl.mark}` : ''));
      // The sentence, not just the dagger: a screen reader and a hover both get
      // validated=false rather than a decoration.
      if (cl.note) v.title = cl.note;
      line.append(v);
      block.append(line);
    }
    body.append(block);
  }
  $('legend').textContent = c.legend(MODELLED_NOTE.mark, MODELLED_NOTE[lang === 'en' ? 'en' : 'fr']);
}

function renderResources() {
  const c = t(lang);
  $('resources-title').textContent = c.resourcesTitle;
  // Both layers ride in the zone file, already narrowed to this radius. Absent
  // on a zone written before they existed, which reads as unknown rather than
  // as a surveyed zero.
  $('water-note').textContent = waterStatement(
    { zone, water: zone && zone.water, lang }).text;
  // Its own line, immediately beneath the register line and never merged into
  // it. Created here rather than in the markup so the two counts cannot end up
  // in one element by an edit to the page.
  if (!crowdNote) {
    crowdNote = el('p', 'crowd');
    $('water-note').insertAdjacentElement('afterend', crowdNote);
  }
  crowdNote.textContent = crowdWaterStatement({ zone, hydrants, lang }).text;
  // Unconditional, and rendered before the aircraft line so an aircraft count can
  // never be the last word on who is on the ground.
  $('ground-note').textContent = groundStatement({ lang });
  const aircraft = (zone && zone.fires || []).reduce((n, f) => n + (f.aircraft || 0), 0);
  $('air-note').textContent = airStatement({ aircraft, lang });
}

function renderClosures() {
  const c = t(lang);
  $('closures-title').textContent = c.closuresTitle;
  const { rows, text } = scheduledClosures({ zone, summary, lang });
  $('closures-note').textContent = text;
  const list = $('closures-list');
  list.innerHTML = '';
  for (const row of rows.slice(0, 20)) {
    const li = el('li');
    li.append(el('b', null, row.label));
    li.append(el('span', 'state', row.state));
    li.append(el('span', 'dates', row.dates));
    list.append(li);
  }
}

function renderFreshness() {
  const c = t(lang);
  const ages = ((summary && summary.sources) || [])
    .map((s) => (s.fetched_at
      ? Math.round((Date.now() - new Date(s.fetched_at).getTime()) / 60000) : null))
    .filter((m) => m !== null);
  const age = ages.length ? Math.min(...ages) : null;
  $('freshness').className = age === null || age > 120 ? 'live stale' : 'live';
  $('freshness-text').textContent = age === null ? c.failed : c.updated(age);
}

function render() {
  const c = t(lang);
  $('page-title').textContent = c.title;
  $('page-sub').textContent = c.subtitle;
  $('lang').textContent = c.lang;
  $('zone-label').textContent = c.zonePick;
  $('back-link').textContent = c.back;
  $('src-link').textContent = c.sources;
  renderFreshness();
  if (!zone) return;

  const built = triage({ zone, lang });
  renderModel(built.model);
  renderTriage(built);
  renderResources();
  renderClosures();

  // Reused as-is: fires solid, spread wedges dashed. The distinction between
  // observed and modelled is mapview's, and it must stay identical on both
  // surfaces.
  view.drawLocal({ ...zone, closures: [] }, {
    fire: lang === 'en' ? 'Heat detected by satellite' : 'Chaleur détectée par satellite',
    detections: lang === 'en' ? 'detections' : 'détections',
    lastSeen: lang === 'en' ? 'Last seen' : 'Vu à',
    spreadMean: c.mean, spreadGust: c.gust,
    inHours: (h) => (lang === 'en' ? `in ${h} h` : `en ${h} h`),
    spreadCaveat: MODELLED_NOTE[lang === 'en' ? 'en' : 'fr'],
  });

  // The water a crew can actually reach. Two layers, never one: the register
  // points come from the zone file already narrowed to this radius, the crowd
  // hydrants from their own national file filtered here. Nothing adds them.
  const centre = zone && Number.isFinite(zone.lat) ? zone : null;
  const radius = (zone && zone.radius_km) || 50;
  const inRadius = (points) => (centre
    ? (points || []).filter((p) => haversineKm(centre, p) <= radius)
    : []);
  view.drawWater({
    register: ((zone && zone.water && zone.water.points) || [])
      .filter((p) => p.tier !== 'crowd'),
    crowd: hydrants && hydrants.available !== false ? inRadius(hydrants.points) : [],
  }, c.map);
}

async function selectZone(id) {
  zone = await loadJSON(`data/zones/${id}.json`);
  view.setYou({ lat: zone.lat, lon: zone.lon }, 9);
  render();
}

async function boot() {
  view = createMap('map', { center: [46.6, 2.5], zoom: 6 });
  view.setBase('plan_ign');
  // Water is on by default here. This page exists for somebody deciding where
  // to send a tender, and a layer they have to discover is a layer they will
  // not have when it matters. The chips ship aria-pressed="true" to match.
  ['fires', 'spread', 'water', 'hydrants'].forEach((n) => view.toggle(n, true));

  lang = load(LANG_KEY) || 'fr';
  $('lang').onclick = () => {
    lang = lang === 'fr' ? 'en' : 'fr';
    store(LANG_KEY, lang);
    document.documentElement.lang = lang;
    render();
  };
  document.querySelectorAll('.chip[data-layer]').forEach((chip) => {
    chip.onclick = () => {
      const on = chip.getAttribute('aria-pressed') !== 'true';
      chip.setAttribute('aria-pressed', String(on));
      view.toggle(chip.dataset.layer, on);
    };
  });

  const params = new URLSearchParams(location.search);
  const [index, loaded] = await Promise.all([
    loadJSON('data/zones/index.json'),
    loadJSON('data/summary.json').catch(() => null),
  ]);
  summary = loaded;

  // 52 KB of crowd-mapped hydrants, fetched here rather than folded into the
  // zone file: that file is on the public evacuation path and 2,992 of these
  // inside the Gironde radius would take it from 2.9 KB gzipped to 40.0 KB.
  // Off the critical path, so it never blocks the numbers a responder came for,
  // and until it lands the crowd line reads as unavailable rather than as none.
  // Both the sentence and the markers: the fetch lands after the first render,
  // so a redraw that only updated the text would leave the map claiming there
  // is no crowd-mapped water when 2,992 points had just arrived.
  loadJSON('data/hydrants.json').then((h) => { hydrants = h; if (zone) render(); })
    .catch(() => { hydrants = null; });

  const select = $('zone-select');
  for (const z of index.zones || []) {
    const option = el('option', null, z.label);
    option.value = z.id;
    select.append(option);
  }
  const wanted = params.get('zone');
  const chosen = (index.zones || []).some((z) => z.id === wanted)
    ? wanted : ((index.zones || [])[0] || {}).id;
  if (!chosen) throw new Error('no zones published');
  select.value = chosen;
  select.onchange = () => selectZone(select.value);
  await selectZone(chosen);
}

// Importable in node for its pure half; only the browser boots the page.
if (typeof document !== 'undefined' && document.getElementById('map')) {
  boot().catch((err) => {
    $('page-sub').textContent = t(lang).failed;
    $('freshness-text').textContent = t(lang).failed;
    console.error(err);
  });
}
