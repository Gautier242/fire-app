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
