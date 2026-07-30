// Which way leads away from the modelled spread, and which road leads into it.
//
// This is the most dangerous module in the repository, because a reader under
// stress will act on it. So it is deliberately weaker than it could be:
//
//   * It never says take a road. It says what a direction of travel does
//     relative to a model, and the reader decides.
//   * It never says a road is safe. The strongest verdict available is
//     `away_from_modelled_spread`, which is a statement about the Rothermel arcs
//     and not about the road, the fire, or the reader. Those arcs run one fuel
//     type (FM5, garrigue basse) for every zone in France and are validated
//     against nothing, so `away` means only "the model does not point here".
//   * When it cannot assess, it says cannot assess. A blank verdict must never
//     reach a page as "no danger this way", so there is no neutral value: every
//     road carries one of four explicit assessments, one of which is ignorance.
//
// Pure: no network, no DOM, no Leaflet. Roads arrive in the shape overpass.js
// returns — { id, name, kind, points: [[lat, lon], ...] }. Spread arrives in the
// shape build/fire_spread.project writes — { id, lat, lon, model, arcs: [{ basis,
// bearing, distance_m }] }, whose lat/lon is the incident centre.
import { bearingDeg, compassPoint, haversineKm } from './geo.js';

export const TOWARD = 'toward_modelled_spread';
export const ACROSS = 'across_modelled_spread';
export const AWAY = 'away_from_modelled_spread';
export const CANNOT_ASSESS = 'cannot_assess';

// Worst wins, everywhere a verdict is combined: across the two ways along one
// road, across the fires a direction is tested against. Ignorance outranks both
// of the non-alarming verdicts, so a road that could not be assessed never rolls
// up as leading away.
const RANK = { [TOWARD]: 4, [CANNOT_ASSESS]: 3, [ACROSS]: 2, [AWAY]: 1 };
const worst = (a, b) => (RANK[b] > RANK[a] ? b : a);

// Must match SPREAD_HALF_ANGLE in mapview.js. The wedge tested here has to be
// the wedge the reader sees drawn, or the text contradicts the map. Duplicated
// rather than imported because mapview.js is a Leaflet module and this one is
// pure.
const ARC_HALF_ANGLE_DEG = 25;

// Within this of the arc bearing, travel runs with the modelled spread — ahead
// of it, over ground the model points at. Beyond 120 degrees it runs against it.
// In between it crosses, and crossing is never reported as away: a wind forecast
// is not precise enough for perpendicular to mean clear.
const WITH_SPREAD_DEG = 60;
const AGAINST_SPREAD_DEG = 120;

// A direction only counts as closing on the heat once it closes by more than
// this, so a wiggle in an OSM way cannot flip a verdict.
const CLOSING_KM = 0.2;

const REASONS = ['enters_modelled_arc', 'closes_on_detected_heat',
                 'runs_with_modelled_spread', 'crosses_modelled_spread',
                 'runs_against_modelled_spread'];

const COPY = {
  fr: {
    official: 'Les consignes officielles priment sur cette page.',
    caveat: "Modèle Rothermel avec un seul type de combustible (FM5, garrigue basse) "
      + "pour toutes les zones, non validé contre un feu réel. Ce n'est pas une prévision "
      + "de la position du feu.",
    enters_modelled_arc: "Cette direction entre dans l'arc de propagation modélisé.",
    closes_on_detected_heat: 'Cette direction se rapproche de la chaleur détectée.',
    runs_with_modelled_spread: 'Cette direction suit le sens de propagation modélisé.',
    crosses_modelled_spread: 'Cette direction coupe le sens de propagation modélisé.',
    runs_against_modelled_spread: "Cette direction s'éloigne du sens de propagation modélisé.",
    [CANNOT_ASSESS]: 'Direction non évaluable avec les données disponibles.',
    no_roads: 'Aucun segment routier chargé : rien à évaluer ici.',
    no_position: 'Aucune position de lecture : rien à évaluer ici.',
    no_modelled_spread: 'Aucune propagation modélisée disponible : rien à évaluer ici.',
    unusable_geometry: 'Tracé inexploitable : rien à évaluer pour ce segment.',
  },
  en: {
    official: 'Official instructions supersede this page.',
    caveat: 'Rothermel model with a single fuel type (FM5, low garrigue) for every zone, '
      + 'not validated against a real fire. It is not a prediction of where the fire will be.',
    enters_modelled_arc: 'This direction enters the modelled spread arc.',
    closes_on_detected_heat: 'This direction closes on the detected heat.',
    runs_with_modelled_spread: 'This direction runs with the modelled spread direction.',
    crosses_modelled_spread: 'This direction crosses the modelled spread direction.',
    runs_against_modelled_spread: 'This direction leads away from the modelled spread direction.',
    [CANNOT_ASSESS]: 'This direction cannot be assessed from the available data.',
    no_roads: 'No road segments loaded: nothing to assess here.',
    no_position: 'No reader position: nothing to assess here.',
    no_modelled_spread: 'No modelled spread available: nothing to assess here.',
    unusable_geometry: 'Unusable geometry: nothing to assess for this segment.',
  },
};

const angleDiff = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const isPoint = (p) => !!p && finite(p.lat) && finite(p.lon);
const round2 = (n) => Math.round(n * 100) / 100;

// One arc per fire, the longest reaching one — the gust arc in practice. A fire
// runs on the gust, not on the mean, and the mean arc lies inside it.
function usableArc(projection) {
  let best = null;
  for (const arc of (projection && projection.arcs) || []) {
    if (!arc || !finite(arc.bearing) || !finite(arc.distance_m) || arc.distance_m <= 0) continue;
    if (!best || arc.distance_m > best.distance_m) best = arc;
  }
  return best;
}

// ponytail: even stride, so a wedge crossing between two kept vertices can be
// stepped over. The `sampled` flag says so on the road it happened to. Upgrade
// to a densifying sampler if roads with thousands of nodes start mattering.
function sampleVertices(points, cap) {
  if (points.length <= cap) return points;
  const step = Math.ceil(points.length / (cap - 1));
  const out = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function cleanPoints(road, maxVertices) {
  const raw = (road && Array.isArray(road.points) ? road.points : [])
    .filter((p) => Array.isArray(p) && finite(p[0]) && finite(p[1]))
    .map((p) => ({ lat: p[0], lon: p[1] }));
  const points = sampleVertices(raw, maxVertices);
  return { points, sampled: points.length < raw.length };
}

// Local metres about `origin`. Only ever used over the few kilometres an arc
// spans, where the flat-earth error is far below the width of a VIIRS pixel.
function planar(origin, p) {
  const M_PER_DEG = 111320;
  return { x: (p.lon - origin.lon) * M_PER_DEG * Math.cos((origin.lat * Math.PI) / 180),
           y: (p.lat - origin.lat) * M_PER_DEG };
}

// The point of segment a→b closest to `origin`, and where along it that falls.
// Vertices alone are not enough: a road can run straight past a fire with no
// vertex near it, and that road must never read as leading away.
function closestOnSegment(origin, a, b) {
  const A = planar(origin, a);
  const B = planar(origin, b);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { point: a, t: 0 };
  const t = Math.max(0, Math.min(1, -(A.x * dx + A.y * dy) / len2));
  return { point: { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t }, t };
}

function inArc(fire, arc, p) {
  if (haversineKm(fire, p) * 1000 > arc.distance_m) return false;
  return angleDiff(bearingDeg(fire, p), arc.bearing) <= ARC_HALF_ANGLE_DEG;
}

// One direction of travel against one fire. Every trigger is recorded and the
// worst of them decides.
function assessAgainstFire(leg, fire) {
  const { arc } = fire;
  const join = leg[0];
  const endpoint = leg[leg.length - 1];
  const joinKm = haversineKm(join, fire);
  const deltaDeg = Math.round(angleDiff(bearingDeg(join, endpoint), arc.bearing));

  let entersArc = false;
  let minKm = joinKm;
  for (let i = 0; i < leg.length - 1; i += 1) {
    const closest = closestOnSegment(fire, leg[i], leg[i + 1]);
    minKm = Math.min(minKm, haversineKm(fire, closest.point), haversineKm(fire, leg[i + 1]));
    // The join itself is excluded from the arc test. A reader already standing
    // inside the arc would otherwise have every direction flagged as entering
    // it, which is exactly the case where the module has to stay useful.
    const candidates = [leg[i + 1]];
    if (!(i === 0 && closest.t === 0)) candidates.push(closest.point);
    if (candidates.some((p) => inArc(fire, arc, p))) entersArc = true;
  }

  const reasons = [];
  let verdict = AWAY;
  if (entersArc) {
    reasons.push('enters_modelled_arc');
    verdict = worst(verdict, TOWARD);
  }
  if (joinKm - minKm > CLOSING_KM) {
    reasons.push('closes_on_detected_heat');
    verdict = worst(verdict, TOWARD);
  }
  if (deltaDeg <= WITH_SPREAD_DEG) {
    reasons.push('runs_with_modelled_spread');
    verdict = worst(verdict, TOWARD);
  } else if (deltaDeg <= AGAINST_SPREAD_DEG) {
    reasons.push('crosses_modelled_spread');
    verdict = worst(verdict, ACROSS);
  } else {
    reasons.push('runs_against_modelled_spread');
  }
  reasons.sort((a, b) => REASONS.indexOf(a) - REASONS.indexOf(b));
  return { verdict, reasons, deltaDeg, basis: arc.basis || null,
           fire: fire.id ?? null, nearestKm: round2(minKm) };
}

function assessDirection(leg, fires, t) {
  const join = leg[0];
  const endpoint = leg[leg.length - 1];
  const bearing = bearingDeg(join, endpoint);
  const base = {
    bearing: Math.round(bearing) % 360,
    compass: compassPoint(bearing),
    km: round2(haversineKm(join, endpoint)),
    validated: false,
  };
  if (!fires.length) {
    return { ...base, assessment: CANNOT_ASSESS, statement: t[CANNOT_ASSESS],
             reasons: ['no_modelled_spread'], deltaDeg: null, basis: null,
             fire: null, nearestKm: null };
  }
  let chosen = null;
  for (const fire of fires) {
    const result = assessAgainstFire(leg, fire);
    if (!chosen || RANK[result.verdict] > RANK[chosen.verdict]) chosen = result;
  }
  return { ...base, assessment: chosen.verdict, statement: t[chosen.reasons[0]],
           reasons: chosen.reasons, deltaDeg: chosen.deltaDeg, basis: chosen.basis,
           fire: chosen.fire, nearestKm: chosen.nearestKm };
}

// Where the reader would join this road, and the one or two ways they could then
// travel along it. Joining at an end leaves one direction, not two.
function legsFrom(points, point) {
  let at = 0;
  let joinKm = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const km = haversineKm(point, points[i]);
    if (km < joinKm) { joinKm = km; at = i; }
  }
  const back = points.slice(0, at + 1).reverse();
  const forward = points.slice(at);
  return { joinKm, legs: [back, forward].filter((leg) => leg.length >= 2) };
}

/**
 * Assess each road segment, in both directions of travel, against the modelled
 * spread arcs. Returns assessments only; it recommends nothing.
 *
 * @param point   reader position, { lat, lon }
 * @param spread  fire_spread projections, each { id, lat, lon, model, arcs }
 * @param roads   overpass.js roads, each { id, name, kind, points }
 * @param lang    'fr' | 'en'
 * @param maxRoads     cap on segments considered; a truncated run says so
 * @param maxVertices  cap on vertices tested per segment
 */
export function assessEgress({ point, spread, roads, lang = 'fr',
                               maxRoads = 250, maxVertices = 120 } = {}) {
  const t = COPY[lang === 'en' ? 'en' : 'fr'];
  const supplied = Array.isArray(roads) ? roads.length : 0;
  const projections = Array.isArray(spread) ? spread : [];
  const fires = projections
    .filter(isPoint)
    .map((p) => ({ id: p.id ?? null, lat: p.lat, lon: p.lon, arc: usableArc(p) }))
    .filter((f) => f.arc);

  const shell = {
    validated: false,
    model: (projections.find((p) => p && p.model) || {}).model || null,
    basis: fires.find((f) => f.arc.basis === 'gust') ? 'gust'
      : (fires[0] && fires[0].arc.basis) || null,
    official: t.official,
    caveat: t.caveat,
    supplied,
    considered: 0,
    truncated: false,
    cannotAssess: true,
    reason: null,
    reasonText: null,
    roads: [],
  };

  if (!supplied) return { ...shell, reason: 'no_roads', reasonText: t.no_roads };
  if (!isPoint(point)) return { ...shell, reason: 'no_position', reasonText: t.no_position };

  const considered = roads.slice(0, Math.max(0, maxRoads));
  const out = [];
  for (const road of considered) {
    if (!road) continue;
    const { points, sampled } = cleanPoints(road, maxVertices);
    const base = {
      id: road.id === undefined ? null : road.id,
      name: road.name || null,
      kind: road.kind || null,
      validated: false,
      sampled,
      verticesUsed: points.length,
    };
    if (points.length < 2) {
      out.push({ ...base, joinKm: null, assessment: CANNOT_ASSESS,
                 statement: t.unusable_geometry, reasons: ['unusable_geometry'],
                 directions: [] });
      continue;
    }
    const { joinKm, legs } = legsFrom(points, point);
    const directions = legs.map((leg) => assessDirection(leg, fires, t));
    out.push({
      ...base,
      joinKm: round2(joinKm),
      // Worst of the two ways along the road. A road with one direction into the
      // arc is not a road that leads away, whatever its other end does.
      assessment: directions.reduce((acc, d) => worst(acc, d.assessment), AWAY),
      reasons: [...new Set(directions.flatMap((d) => d.reasons))],
      directions,
    });
  }

  return {
    ...shell,
    considered: considered.length,
    truncated: considered.length < supplied,
    cannotAssess: !fires.length,
    reason: fires.length ? null : 'no_modelled_spread',
    reasonText: fires.length ? null : t.no_modelled_spread,
    roads: out,
  };
}
