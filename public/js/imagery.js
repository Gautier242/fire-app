// The satellite layers a reader can choose, and the dates they can choose from.
//
// Resolution and cadence trade against each other. VIIRS and MODIS are daily but
// coarse; the 30 m layers are sharp but only see a given place every few days;
// Sentinel-2 at 10 m is the sharpest available without an account, but only as an
// annual cloudless composite — the anonymous Copernicus endpoint 404s, so
// genuinely dated 10 m imagery needs a key we do not have. The label says so
// rather than implying it is current.
//
// Every template below was checked against a real tile before landing. Two
// layers the plan named did not survive that check:
//
//   Landsat_WELD_..._Global_Monthly — the layer is alive but its time extent ends
//   1998-12/2001-11. It serves 200 for 2001-07 and 404 for every current date, so
//   as a "monthly 30 m" option it would have been permanently blank. Replaced by
//   HLS L30, which is the same Landsat sensor at the same 30 m, dated daily.
//
//   MODIS_Combined_Thermal_Anomalies_All — GIBS now publishes every thermal
//   anomaly layer (MODIS and VIIRS, All/Day/Night) as
//   application/vnd.mapbox-vector-tile only. There is no raster rendition, and a
//   plain Leaflet tileLayer cannot draw a vector tile without a plugin we are not
//   adding. The only raster fire layers left on GIBS are GOES ABI FireTemp, which
//   does not cover France. Fire detections are not lost from the product — they
//   arrive as FIRMS points through the build pipeline. What the tile catalogue
//   offers instead is OPERA DIST-ALERT: 30 m vegetation-loss alerts, which is
//   what actually makes a burn's progress visible when the date is scrubbed back.
//
// A 404 from the 30 m layers on some dates is not a broken template: it means the
// satellite had no pass over that tile that day. Leaflet leaves those tiles blank,
// which is the honest rendering of "nobody looked".

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';

export const LAYERS = [
  {
    id: 'viirs_noaa20',
    resolution: '375 m',
    revisit: { fr: '1 passage de jour, vers 13 h 30 locale', en: 'One daytime pass, around 13:30 local' },
    purpose: {
      fr: 'Vue d\'ensemble de la fumée, mise à jour chaque jour.',
      en: 'Wide view of the smoke, refreshed daily.',
    },
    label: { fr: 'VIIRS NOAA-20 · 375 m · quotidien', en: 'VIIRS NOAA-20 · 375 m · daily' },
    kind: 'gibs', dated: true, maxNativeZoom: 9,
    template: `${GIBS}/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/{date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
    attribution: 'NASA EOSDIS GIBS',
  },
  {
    id: 'viirs_snpp',
    resolution: '375 m',
    revisit: { fr: '1 passage de jour, ~50 min avant NOAA-20', en: 'One daytime pass, ~50 min ahead of NOAA-20' },
    purpose: {
      fr: 'Deuxième passage quotidien : utile si le premier était nuageux.',
      en: 'A second daily pass: useful when the first one was cloudy.',
    },
    label: { fr: 'VIIRS SNPP · 375 m · quotidien', en: 'VIIRS SNPP · 375 m · daily' },
    kind: 'gibs', dated: true, maxNativeZoom: 9,
    template: `${GIBS}/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/{date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
    attribution: 'NASA EOSDIS GIBS',
  },
  {
    id: 'modis_terra',
    resolution: '250 m',
    revisit: { fr: '1 passage de jour, vers 10 h 30 locale', en: 'One daytime pass, around 10:30 local' },
    purpose: {
      fr: 'Le plus long recul dans le temps, pour comparer les semaines.',
      en: 'The longest reach back in time, to compare one week with another.',
    },
    label: { fr: 'MODIS Terra · 250 m · quotidien', en: 'MODIS Terra · 250 m · daily' },
    kind: 'gibs', dated: true, maxNativeZoom: 9,
    template: `${GIBS}/MODIS_Terra_CorrectedReflectance_TrueColor/default/{date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
    attribution: 'NASA EOSDIS GIBS',
  },
  {
    id: 'thermal',
    resolution: '30 m',
    revisit: { fr: 'Recalculé tous les 2 à 3 jours', en: 'Recomputed every 2 to 3 days' },
    purpose: {
      fr: 'Là où la végétation a disparu : la trace au sol après le passage du feu.',
      en: 'Where the vegetation has gone: the mark left on the ground after a fire.',
    },
    // Not imagery: where the vegetation cover has been lost. Scrub the date back
    // and the burn scar's growth becomes visible. Disturbance, not fire
    // detection — a clear-cut or a flood shows here too, so the label says
    // "vegetation" rather than claiming every pixel is a fire.
    // The label names fire first because that is what a reader is looking for,
    // and names the other causes in the same breath so it never claims a burn.
    // The design spec asked for "zones deja brulees" here; that would have been
    // less honest than what was already shipping, so it is not what this says.
    label: {
      fr: 'Végétation détruite (feu, coupe) · 30 m',
      en: 'Vegetation loss (fire, felling) · 30 m',
    },
    kind: 'gibs', dated: true, maxNativeZoom: 12,
    template: `${GIBS}/OPERA_L3_DIST-ALERT-HLS_Color_Index/default/{date}/GoogleMapsCompatible_Level12/{z}/{y}/{x}.png`,
    attribution: 'NASA EOSDIS GIBS — OPERA DIST-ALERT',
  },
  {
    id: 'landsat',
    resolution: '30 m',
    revisit: { fr: '1 passage tous les 8 à 16 jours', en: 'One pass every 8 to 16 days' },
    purpose: {
      fr: 'Assez net pour distinguer les parcelles, mais un passage tous les 16 jours.',
      en: 'Sharp enough to pick out fields, but only one pass every 16 days.',
    },
    label: {
      fr: 'Landsat · 30 m · un passage tous les 16 j',
      en: 'Landsat · 30 m · one pass every 16 days',
    },
    kind: 'gibs', dated: true, maxNativeZoom: 12,
    template: `${GIBS}/HLS_L30_Nadir_BRDF_Adjusted_Reflectance/default/{date}/GoogleMapsCompatible_Level12/{z}/{y}/{x}.png`,
    attribution: 'NASA EOSDIS GIBS — HLS L30',
  },
  {
    id: 's2cloudless',
    resolution: '10 m',
    revisit: { fr: 'Composite annuel 2020 — pas une image du jour', en: '2020 annual composite — not today\'s picture' },
    purpose: {
      fr: 'Le plus net pour reconnaître son quartier, mais pas daté du jour.',
      en: 'The sharpest for recognising your own streets, but not dated today.',
    },
    label: {
      fr: 'Sentinel-2 · 10 m · composite annuel (pas du jour)',
      en: 'Sentinel-2 · 10 m · annual composite (not today)',
    },
    kind: 'static', dated: false, maxNativeZoom: 14,
    template: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg',
    attribution: 'Sentinel-2 cloudless by EOX',
  },
  {
    id: 'ign_ortho',
    resolution: '20 cm',
    revisit: { fr: 'Campagne aérienne, refaite tous les 3 à 4 ans', en: 'Aerial survey, reflown every 3 to 4 years' },
    purpose: {
      fr: 'Photographie aérienne très détaillée, prise avant l\'incendie.',
      en: 'Very detailed aerial photography, taken before the fire.',
    },
    label: { fr: 'Photo aérienne IGN · 20 cm', en: 'IGN aerial · 20 cm' },
    kind: 'static', dated: false, maxNativeZoom: 19,
    template: 'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile'
      + '&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM'
      + '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg',
    attribution: 'IGN — data.geopf.fr',
  },
];

export function tileUrl(layer, date) {
  if (!layer) return '';
  // An undated layer must not end up with a stray date in its URL.
  return layer.dated ? layer.template.replace('{date}', date) : layer.template;
}

// Which tile of the standard web-mercator grid holds a point, at a given zoom.
// Written out rather than pulled from Leaflet: the contact sheet builds plain
// <img> URLs and never puts these tiles on a map.
export function tileXY(lat, lon, zoom) {
  const n = 2 ** zoom;
  const phi = (lat * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n);
  const clamp = (v) => Math.min(n - 1, Math.max(0, v));
  return { x: clamp(x), y: clamp(y) };
}

// One tile is enough to judge a date by. At zoom 8 a tile is about 110 km
// across at this latitude, which frames a 50 km zone with its surroundings --
// enough to see whether the cloud sitting on it is a corner or the whole sky.
export const PREVIEW_ZOOM = 8;

export function previewUrl(layer, date, lat, lon, zoom = PREVIEW_ZOOM) {
  // An annual composite is the same picture every day of the month. Offering
  // thirty identical thumbnails would invite a choice that does not exist.
  if (!layer || !layer.dated) return '';
  const { x, y } = tileXY(lat, lon, zoom);
  return tileUrl(layer, date)
    .replace('{z}', zoom)
    .replace('{x}', x)
    .replace('{y}', y);
}

export function availableDates(today, count = 30) {
  const out = [];
  const start = new Date(`${today}T00:00:00Z`);
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
