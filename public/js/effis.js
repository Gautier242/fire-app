// Where France has burned in a past season — and nothing else.
//
// EFFIS (Copernicus Emergency Management Service) publishes MODIS burnt-area
// polygons per season at maps.effis.emergency.copernicus.eu/effis. This module
// offers those seasons as Leaflet WMS overlays, and probes whether a given year
// has anything to show in the view a reader is actually looking at.
//
// What this layer answers: "has my area burned in a past season."
// What it does NOT answer: "what has burned in the fire burning now."
//
// Measured 2026-07-30 by decoding the returned PNGs and counting
// non-transparent pixels — byte size and HTTP 200 prove nothing here, the same
// trap GIBS sets:
//
//   modis.ba.2016 … modis.ba.2025, France 512x512 : 3,455 … 24,431 drawn pixels
//   modis.ba.2022, Gironde/Landes                 : 2,744  (the 2022 megafires)
//   modis.ba (the undated "current" layer), France:     0
//   effis.nrt.ba.poly, France and all Europe      :     0
//   modis.ba.2025, Normandy                       :     0  in a valid 1,096-byte PNG
//
// The near-real-time layers are empty across the whole continent, so they are
// deliberately absent from the catalogue: a layer that is always blank teaches
// a reader that blank means nothing is burning.
//
// Two server behaviours the catalogue is built around:
//
//   Omitting STYLES entirely returns a 678-byte ServiceExceptionReport, not a
//   raster. MapServer 8 wants the parameter present and empty. Both the probe
//   URL and the Leaflet options carry STYLES=.
//
//   modis.ba.<year> is a group: modis.ba.poly.<year> draws below scale
//   denominator 10^6 and modis.ba.point.<year> above it. Requesting the group
//   means a reader sees polygons zoomed in on their own commune and points at
//   national scale, with no client-side scale logic.

export const ENDPOINT = 'https://maps.effis.emergency.copernicus.eu/effis';

// EFFIS holds 2016 onwards; modis.ba.2015 answers with a ServiceExceptionReport.
export const YEARS = [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016];

// What the server actually draws, sampled from the decoded PNGs. The polygon
// amber sits 14 units in RGB from HEAT[0] (#FFC061) in mapview.js — 3% of the
// RGB diagonal. Left alone, a scar from 2016 renders in very nearly the colour
// this map uses for a fire burning now.
export const EFFIS_SERVED_COLOURS = ['#FDBF6F', '#6A3D9A'];

// So the tiles are forced cold in the browser. sepia() collapses every input
// hue to one warm brown, which is the point: the rotation then lands the amber
// polygons and the purple points on the same blue instead of two different
// hues. Verified against the measured colours: #FDBF6F -> rgb(189,213,230)
// (hue 205) and #6A3D9A -> rgb(73,95,152) (hue 223).
export const SCAR_FILTER = 'sepia(1) hue-rotate(185deg) saturate(2.5) brightness(0.9)';
export const SCAR_CLASS = 'effis-scar';

// The representative filtered output, for legends and swatches. Nothing on the
// heat ramp comes within 60 degrees of it.
export const SCAR_COLD = '#495F98';

export const LAYERS = YEARS.map((year) => ({
  id: `effis_ba_${year}`,
  year,
  label: {
    fr: `Zones brûlées en ${year} · saison passée · EFFIS`,
    en: `Areas burnt in ${year} · past season · EFFIS`,
  },
  // Passed straight to L.tileLayer.wms(ENDPOINT, entry.wms). Leaflet only
  // emits STYLES if the option exists, so it is set explicitly.
  wms: {
    layers: `modis.ba.${year}`,
    styles: '',
    format: 'image/png',
    transparent: true,
    version: '1.3.0',
    className: SCAR_CLASS,
    opacity: 0.75,
    attribution: 'Copernicus EMS — EFFIS, MODIS burnt areas',
  },
}));

export function layerForYear(year) {
  return LAYERS.find((l) => l.year === year);
}

// The France box, EPSG:3857, from lon/lat -5.2,41.3 to 9.6,51.1. The default
// probe extent when no map bounds are to hand.
export const FRANCE_BBOX_3857 = '-578861,5056693,1068667,6639002';

export function getMapUrl(entry, { bbox = FRANCE_BBOX_3857, width = 256, height = 256,
  crs = 'EPSG:3857' } = {}) {
  const q = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: entry.wms.version,
    REQUEST: 'GetMap',
    LAYERS: entry.wms.layers,
    STYLES: '',
    CRS: crs,
    BBOX: bbox,
    WIDTH: String(width),
    HEIGHT: String(height),
    FORMAT: 'image/png',
    TRANSPARENT: 'TRUE',
  });
  return `${ENDPOINT}?${q}`;
}

// Counts pixels the server actually drew. EFFIS answers a year and place it has
// nothing for with a structurally valid, fully transparent PNG, so only the
// alpha channel distinguishes "no burns recorded here" from "the layer works".
// Injected in tests; this is the browser path.
export async function countDrawnPixels(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  let drawn = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) drawn++;
  return drawn;
}

// Three verdicts, and the difference between the last two matters more than the
// first: 'no-data' is a statement about the EFFIS archive over this view,
// 'unavailable' is a statement about our request failing. Neither is ever a
// statement about whether the reader's surroundings have burned, and neither is
// a statement about safety. There is deliberately no 'no-burns'.
function note(status, year) {
  if (status === 'burns') {
    return {
      fr: `Zones brûlées relevées par EFFIS pendant la saison ${year}.`,
      en: `Areas EFFIS recorded as burnt during the ${year} season.`,
    };
  }
  if (status === 'no-data') {
    return {
      fr: `L'archive EFFIS ne contient aucun polygone pour ${year} dans cette vue. `
        + `MODIS ne cartographie que les grandes surfaces, et une saison absente de `
        + `l'archive n'est pas une saison sans feu.`,
      en: `The EFFIS archive holds no polygon for ${year} in this view. MODIS maps `
        + `large burns only, and a season missing from the archive is not a season `
        + `without fire.`,
    };
  }
  return {
    fr: `L'archive EFFIS pour ${year} n'a pas répondu. Aucune information sur cette saison.`,
    en: `The EFFIS archive for ${year} did not answer. No information about that season.`,
  };
}

export async function probeYear(year, {
  fetch: fetchImpl = fetch,
  countDrawn = countDrawnPixels,
  bbox = FRANCE_BBOX_3857,
  width = 256,
  height = 256,
} = {}) {
  const entry = layerForYear(year);
  if (!entry) throw new Error(`EFFIS holds no burnt-area layer for ${year}`);
  const url = getMapUrl(entry, { bbox, width, height });
  let pixels;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return { year, status: 'unavailable', pixels: null, note: note('unavailable', year) };
    // A ServiceExceptionReport arrives as text/xml with HTTP 200. Decoding it as
    // a raster would fail; reporting it as an empty archive would be a lie.
    const type = res.headers.get('content-type') || '';
    if (!type.includes('image/')) {
      return { year, status: 'unavailable', pixels: null, note: note('unavailable', year) };
    }
    pixels = await countDrawn(await res.blob());
  } catch {
    return { year, status: 'unavailable', pixels: null, note: note('unavailable', year) };
  }
  const status = pixels > 0 ? 'burns' : 'no-data';
  return { year, status, pixels, note: note(status, year) };
}
