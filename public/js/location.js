import { pointInMultiPolygon } from './geo.js';

const STORAGE_KEY = 'fire-near-me.place';
const MIN_QUERY = 2;

// Returns the province code containing the point, or null. Null is meaningful:
// the caller must treat an unknown province as "we cannot check here".
export function provinceAt(point, coverage) {
  for (const feature of coverage.features) {
    const { type, coordinates } = feature.geometry;
    const polygons = type === 'MultiPolygon' ? coordinates : [coordinates];
    if (pointInMultiPolygon(point, polygons)) return feature.properties.province;
  }
  return null;
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
