// Leaflet map: basemaps, data layers, and the you-are-here marker.
// Owns nothing but the map — all decisions about what to say live in rail.js.
import { aqhiBand } from './status.js';

const CANADA_CENTRE = [56, -96];
const CANADA_ZOOM = 4;

// Fires are points; boundaries are outlines. That distinction, not colour, is
// what keeps "large fire far away" from reading like "leave now".
const HEAT = ['#FFC061', '#FF7A3D', '#E23A1E'];

const GIBS_LAYER = 'VIIRS_NOAA20_CorrectedReflectance_TrueColor';

// Air quality reads as a number, not a glow: a station is a reading, and the
// reading itself is the useful thing. Bands come from status.js so the map and
// the rail can never disagree about what counts as unhealthy.
const AQHI_CLASS = { low: 'b0', moderate: 'b1', high: 'b2', very_high: 'b3' };

function gibsUrl(date) {
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${GIBS_LAYER}`
    + `/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
}

function dayUTC(offset) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

// GIBS serves a valid-but-empty ~1.6 KB tile for a day it has not finished
// processing, so an unavailable date fails silently as a blank overlay rather
// than an error. Probe one tile and fall back a day; a real tile is ~20 KB.
const EMPTY_TILE_BYTES = 5000;

async function latestImageryDate() {
  for (let back = 0; back < 3; back++) {
    const date = dayUTC(back);
    try {
      const probe = gibsUrl(date).replace('{z}/{y}/{x}', '4/5/2');
      const response = await fetch(probe, { cache: 'no-cache' });
      if (!response.ok) continue;
      const blob = await response.blob();
      if (blob.size > EMPTY_TILE_BYTES) return date;
    } catch { /* try the previous day */ }
  }
  return dayUTC(1);
}

function basemaps() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark'
    || (!document.documentElement.getAttribute('data-theme')
        && matchMedia('(prefers-color-scheme: dark)').matches);

  return {
    plain: L.tileLayer(
      `https://{s}.basemaps.cartocdn.com/${dark ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`,
      { maxZoom: 19, subdomains: 'abcd',
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO' }),
    imagery: L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 19, attribution: 'Imagery &copy; Esri' }),
  };
}

export function createMap(elementId) {
  const map = L.map(elementId, {
    center: CANADA_CENTRE, zoom: CANADA_ZOOM,
    // Default control positions collide with our own chrome: zoom lands on top
    // of the layer chips, and the scale bar lands on the detail dial.
    zoomControl: false, attributionControl: true,
  });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);

  const bases = basemaps();
  bases.plain.addTo(map);

  // NASA GIBS: the most recent satellite pass, which is where smoke plumes and
  // fresh burn scars become visible. Caps at zoom 9, so it is an overlay on a
  // sharp basemap rather than the basemap itself. The date is resolved after
  // construction because it depends on what GIBS has actually processed.
  const gibs = L.tileLayer(gibsUrl(dayUTC(1)), {
    maxNativeZoom: 9, maxZoom: 19, opacity: 0.8,
    attribution: 'Imagery courtesy NASA EOSDIS GIBS',
  });
  let imageryDate = dayUTC(1);

  const layers = {
    fires: L.layerGroup(),
    orders: L.layerGroup(),
    alerts: L.layerGroup(),
    closures: L.layerGroup(),
    aqhi: L.layerGroup(),
    satellite: gibs,
  };

  let currentBase = 'plain';
  let youMarker = null;

  return {
    map,

    // Resolve the newest date GIBS has real pixels for. Returns that date so the
    // label can state it: claiming "today" when showing yesterday would be a lie
    // about how current the picture is.
    async resolveImagery() {
      const date = await latestImageryDate();
      if (date !== imageryDate) {
        imageryDate = date;
        gibs.setUrl(gibsUrl(date));
      }
      return date;
    },

    setBase(name) {
      if (name === currentBase || !bases[name]) return;
      map.removeLayer(bases[currentBase]);
      bases[name].addTo(map);
      currentBase = name;
      // Keep data above imagery after a base swap.
      Object.values(layers).forEach((l) => {
        if (map.hasLayer(l) && l.bringToFront) l.bringToFront();
      });
    },

    refreshBase() {
      // Called when the theme flips, so the plain basemap follows it.
      const rebuilt = basemaps();
      const wasPlain = currentBase === 'plain';
      map.removeLayer(bases[currentBase]);
      bases.plain = rebuilt.plain;
      bases.imagery = rebuilt.imagery;
      bases[currentBase].addTo(map);
      if (wasPlain) bases.plain.bringToBack();
    },

    toggle(name, on) {
      const layer = layers[name];
      if (!layer) return;
      if (on) { layer.addTo(map); if (layer.bringToFront) layer.bringToFront(); }
      else map.removeLayer(layer);
    },

    isOn(name) {
      return layers[name] ? map.hasLayer(layers[name]) : false;
    },

    draw(summary) {
      layers.fires.clearLayers();
      layers.orders.clearLayers();
      layers.alerts.clearLayers();
      layers.closures.clearLayers();
      layers.aqhi.clearLayers();

      for (const fire of summary.fires || []) {
        const tone = fire.named
          ? (/out of control/i.test(fire.status || '') ? HEAT[2] : HEAT[1])
          : HEAT[0];
        const marker = L.circleMarker([fire.lat, fire.lon], {
          radius: fire.named ? 7 : 5,
          color: tone, fillColor: tone,
          weight: 1, opacity: 0.9, fillOpacity: 0.75,
        });
        const label = fire.named
          ? `<b>${fire.name}</b><br>${fire.status || ''}`
            + (fire.size_ha ? `<br>${Math.round(fire.size_ha).toLocaleString()} ha` : '')
          : '<b>Estimated fire area</b><br>From satellite heat detection';
        marker.bindPopup(label);
        marker.addTo(layers.fires);
      }

      for (const zone of summary.evacuations || []) {
        const isOrder = zone.kind === 'order';
        const shape = L.polygon(
          zone.polygons.map((rings) => rings.map((ring) => ring.map(([lon, lat]) => [lat, lon]))),
          {
            color: isOrder ? '#E4344F' : '#E8A33D',
            weight: 3,
            // Order is solid, alert is dashed: the boundary type is legible
            // without relying on the colour difference.
            dashArray: isOrder ? null : '9 7',
            fillOpacity: isOrder ? 0.18 : 0.10,
          });
        shape.bindPopup(`<b>${zone.name}</b><br>${isOrder ? 'Evacuation ORDER' : 'Evacuation ALERT'}`
          + (zone.agency ? `<br>${zone.agency}` : ''));
        shape.addTo(isOrder ? layers.orders : layers.alerts);
      }

      for (const station of summary.aqhi || []) {
        const band = aqhiBand(station.value);
        if (!band) continue;
        // The published index is the rounded value, and anything under 1 reads
        // as 1 — the same rule status.js applies to the rail.
        const shown = Math.max(1, Math.round(station.value));
        const marker = L.marker([station.lat, station.lon], {
          icon: L.divIcon({
            className: '', iconSize: [22, 22], iconAnchor: [11, 11],
            html: `<div class="aqhi-pill ${AQHI_CLASS[band]}">${shown}</div>`,
          }),
          alt: `Air quality ${shown}`,
        });
        // Resolved when the popup opens, so it follows the language toggle.
        marker.bindPopup(() => {
          const lang = document.documentElement.lang === 'fr' ? 'fr' : 'en';
          const name = (station.name && (station.name[lang] || station.name.en)) || station.id;
          return `<b>${name}</b><br>${lang === 'fr' ? 'Cote air santé' : 'Air Quality Health Index'}: ${shown}`;
        });
        marker.addTo(layers.aqhi);
      }

      for (const closure of summary.closures || []) {
        const geo = L.geoJSON(closure.geometry, {
          style: { color: '#FF4D6D', weight: 5, dashArray: '12 8' },
          pointToLayer: (f, latlng) => L.circleMarker(latlng,
            { radius: 6, color: '#FF4D6D', fillColor: '#FF4D6D', fillOpacity: 0.8 }),
        });
        geo.bindPopup(`<b>${closure.name || 'Road closure'}</b><br>${closure.headline || ''}`);
        geo.addTo(layers.closures);
      }
    },

    setYou(point) {
      if (youMarker) map.removeLayer(youMarker);
      youMarker = L.marker([point.lat, point.lon], {
        icon: L.divIcon({
          className: '', iconSize: [16, 16], iconAnchor: [8, 8],
          html: '<div class="you-dot" style="width:16px;height:16px"></div>',
        }),
        keyboard: false,
        alt: 'Your location',
      }).addTo(map);
      map.setView([point.lat, point.lon], 8);
    },

    hasClosures(summary) {
      return Array.isArray(summary.closures) && summary.closures.length > 0;
    },

    invalidate() { map.invalidateSize(); },
  };
}
