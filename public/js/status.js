import { bearingDeg, compassPoint, nearest } from './geo.js';

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
