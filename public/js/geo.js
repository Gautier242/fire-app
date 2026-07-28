const R_KM = 6371;
const toRad = (d) => (d * Math.PI) / 180;

export function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDeg(a, b) {
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function compassPoint(deg) {
  return POINTS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

// Ray casting. `ring` is an array of [lon, lat] pairs.
export function pointInPolygon(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const straddles = (yi > point.lat) !== (yj > point.lat);
    if (straddles) {
      const xCross = ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
      if (point.lon < xCross) inside = !inside;
    }
  }
  return inside;
}

// GeoJSON MultiPolygon coordinates: [ polygon ][ ring ][ position ].
// Ring 0 of each polygon is the outer boundary; later rings are holes.
export function pointInMultiPolygon(point, polygons) {
  for (const rings of polygons) {
    if (!rings.length) continue;
    if (!pointInPolygon(point, rings[0])) continue;
    const inHole = rings.slice(1).some((hole) => pointInPolygon(point, hole));
    if (!inHole) return true;
  }
  return false;
}

export function nearest(point, items) {
  let best = null;
  for (const item of items) {
    const km = haversineKm(point, item);
    if (best === null || km < best.km) best = { item, km };
  }
  return best;
}
