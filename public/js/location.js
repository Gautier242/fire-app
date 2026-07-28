import { pointInMultiPolygon } from './geo.js';

const STORAGE_KEY = 'fire-near-me.place';
const MIN_QUERY = 2;

// Coastlines in the source data are generalized, so waterfront cities can sit
// just outside the land polygon — Vancouver by 1.3 km, Halifax by 1.2 km. This
// margin (~5 km) recovers them. It is only ever applied when the point is
// inside NO province, so it cannot affect interprovincial borders, where every
// point is already inside a polygon.
const COASTAL_MARGIN_DEG = 0.05;

// Returns the province code containing the point, or null. Null is meaningful:
// the caller must treat an unknown province as "we cannot check here".
export function provinceAt(point, coverage) {
  for (const feature of coverage.features) {
    const { type, coordinates } = feature.geometry;
    const polygons = type === 'MultiPolygon' ? coordinates : [coordinates];
    if (pointInMultiPolygon(point, polygons)) return feature.properties.province;
  }

  // Offshore or just off a generalized coast. Accept the nearby province only
  // when exactly one is in range: in a bay between two provinces the answer is
  // genuinely ambiguous, and null (which renders as "we cannot check") is the
  // safe reading.
  const nearby = new Set();
  for (const feature of coverage.features) {
    const box = feature.properties && feature.properties.bbox;
    if (!box) continue;
    const [minLon, minLat, maxLon, maxLat] = box;
    if (point.lon >= minLon - COASTAL_MARGIN_DEG
      && point.lon <= maxLon + COASTAL_MARGIN_DEG
      && point.lat >= minLat - COASTAL_MARGIN_DEG
      && point.lat <= maxLat + COASTAL_MARGIN_DEG) {
      nearby.add(feature.properties.province);
    }
  }
  return nearby.size === 1 ? [...nearby][0] : null;
}

export function searchPlaces(query, places, limit = 20) {
  const needle = query.trim().toLowerCase();
  if (needle.length < MIN_QUERY) return [];
  const results = [];
  for (const place of places) {
    if (place.n.toLowerCase().startsWith(needle)) {
      results.push(place);
      if (results.length >= limit) break;
    }
  }
  return results;
}

export function savedPlace() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function savePlace(place) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(place));
  } catch {
    // Private browsing can refuse storage. Losing the saved place is harmless.
  }
}

// Resolves to {lat, lon} or rejects. The caller falls back to the place picker.
export function locateBrowser({ timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('geolocation unavailable'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(err),
      { timeout: timeoutMs, maximumAge: 300000, enableHighAccuracy: false },
    );
  });
}
