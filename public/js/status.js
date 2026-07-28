import { bearingDeg, compassPoint, nearest, pointInMultiPolygon } from './geo.js';

// AQHI is published on a 1-10+ scale. ECCC reports fractional values; the
// public-facing index is the rounded value, with anything under 1 shown as 1.
export function aqhiBand(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  const v = Math.max(1, Math.round(value));
  if (v <= 3) return 'low';
  if (v <= 6) return 'moderate';
  if (v <= 10) return 'high';
  return 'very_high';
}

export const NEAR_KM = 25;

export function fireState({ point, fires, nearKm = NEAR_KM }) {
  const best = nearest(point, fires);
  if (best === null || best.km > nearKm) {
    return { level: 'green', fire: null, km: null, direction: null };
  }
  return {
    level: 'amber',
    fire: best.item,
    km: Math.round(best.km),
    direction: compassPoint(bearingDeg(point, best.item)),
  };
}

// Order of evaluation matters. A containing zone is always reported, even from a
// stale feed, because hiding a known danger is worse than reporting an old one.
// Only the *negative* answer depends on coverage and freshness: we may say
// "nothing found" only when we genuinely checked a live feed that covers here.
export function evacuationState({ point, evacuations, covered, stale }) {
  const containing = evacuations.filter((e) => pointInMultiPolygon(point, e.polygons));
  const order = containing.find((e) => e.kind === 'order');
  if (order) return { state: 'order', zone: order };
  const alert = containing.find((e) => e.kind === 'alert');
  if (alert) return { state: 'alert', zone: alert };
  if (!covered || stale) return { state: 'cannot_check', zone: null };
  return { state: 'none_found', zone: null };
}
