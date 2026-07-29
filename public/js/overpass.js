// Buildings and streets for what is on screen.
//
// Bound to the viewport rather than to a radius, and that is arithmetic rather
// than preference. Measured density near Lacanau is 123 buildings/km2, so a
// 50 km radius is about 966,000 buildings and a 100 km radius about 3.85
// million — neither loadable by Overpass nor survivable by a browser. The same
// data by viewport is roughly 7,400 buildings at zoom 13 and 490 at zoom 15.
//
// Overpass is a free volunteer-run service. One query per viewport change, a
// timeout on every query, and never a query without a bounding box.

const ENDPOINT = 'https://overpass-api.de/api/interpreter';

// Below this, a viewport covers more ground than Overpass will return.
export const MIN_ZOOM = 13;

const SELECTORS = {
  building: 'way["building"]',
  road: 'way["highway"]',
};

export function buildQuery(bounds, kinds = ['building', 'road']) {
  const box = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  const parts = kinds
    .map((kind) => SELECTORS[kind])
    .filter(Boolean)
    .map((selector) => `${selector}(${box});`)
    .join('');
  // `out geom` returns coordinates inline, so no second lookup is needed.
  return `[out:json][timeout:25];(${parts});out geom;`;
}

export async function fetchViewport(bounds, { kinds, signal } = {}) {
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST', signal,
      body: `data=${encodeURIComponent(buildQuery(bounds, kinds))}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!response.ok) return { buildings: [], roads: [] };
    return parse(await response.json());
  } catch {
    // A failed detail fetch must never break the page. The fire, wind and
    // danger layers are what matter and they are already drawn.
    return { buildings: [], roads: [] };
  }
}

export function parse(payload) {
  const buildings = [];
  const roads = [];
  for (const el of (payload && payload.elements) || []) {
    const geometry = el && el.geometry;
    if (!Array.isArray(geometry) || geometry.length < 2) continue;
    const points = geometry
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
      .map((p) => [p.lat, p.lon]);
    if (points.length < 2) continue;
    const tags = el.tags || {};
    // An unnamed track is still an escape route, so a missing name is not a
    // reason to drop a road.
    const record = { id: el.id, name: tags.name || null, points };
    if (tags.building) buildings.push(record);
    else if (tags.highway) roads.push({ ...record, kind: tags.highway });
  }
  return { buildings, roads };
}
