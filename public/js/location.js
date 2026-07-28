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

// Ordered by the gazetteer's own "relevance at scale" rank (place.r, ascending:
// 0 is a name drawn on a map of all Canada), so typing "kam" offers Kamloops
// before Kamarsuk. Places with no rank sort last, and ties keep file order.
const UNRANKED = Number.MAX_SAFE_INTEGER;

// The picker calls this on every keystroke over the same 29k-place array, and
// lowercasing all of them each time costs 32 ms where reusing them costs 5 ms.
// Keyed on the array itself, so it is dropped with the places it describes.
// Assumes the array is not mutated in place after first search, which holds:
// it is fetched once and only ever read.
const lowercased = new WeakMap();

function lowerNames(places) {
  let names = lowercased.get(places);
  if (!names) {
    names = places.map((place) => place.n.toLowerCase());
    lowercased.set(places, names);
  }
  return names;
}

export function searchPlaces(query, places, limit = 20) {
  const needle = query.trim().toLowerCase();
  if (needle.length < MIN_QUERY) return [];
  const names = lowerNames(places);
  const results = [];
  for (let i = 0; i < places.length; i += 1) {
    if (names[i].startsWith(needle)) results.push(places[i]);
  }
  // Every match is collected before the cut: stopping at the first `limit`
  // hits would return whatever came first in the file, not the best-ranked.
  results.sort((a, b) => (a.r ?? UNRANKED) - (b.r ?? UNRANKED));
  return results.slice(0, limit);
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
