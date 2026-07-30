// Leaflet map: basemaps, data layers, and the you-are-here marker.
// Owns nothing but the map — all decisions about what to say live in rail.js.
import { aqhiBand } from './status.js';
import { tileUrl } from './imagery.js';
import { ENDPOINT as EFFIS_ENDPOINT } from './effis.js';

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
    // IGN Plan v2 is France's official street map: named streets, tracks and
    // hamlets, free and keyless. Better than CARTO once a reader zooms to their
    // own street, which is the whole point of the local view.
    plan_ign: L.tileLayer(
      'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile'
      + '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM'
      + '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png',
      { maxZoom: 19, attribution: 'IGN — data.geopf.fr' }),
  };
}

export const FRANCE_CENTRE = [46.6, 2.5];
export const FRANCE_ZOOM = 6;

// Météo des forêts colours, from the official scale. Kept out of the heat ramp
// on purpose: this is a forecast about conditions, not a detected fire, and the
// two must not look alike.
const DANGER_FILL = { 1: '#3FB98A', 2: '#E8C33D', 3: '#E8802D', 4: '#D2222D' };

// A projected spread is a wedge, not a line: the wind direction it rides on is
// a forecast with its own error. Half the opening angle, in degrees.
const SPREAD_HALF_ANGLE = 25;
const EARTH_M = 6371000;

function destination(lat, lon, bearing, metres) {
  const rad = Math.PI / 180;
  const d = metres / EARTH_M;
  const br = bearing * rad;
  const lat1 = lat * rad;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d)
    + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lon2 = lon * rad + Math.atan2(
    Math.sin(br) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [lat2 / rad, lon2 / rad];
}

function wedge(lat, lon, bearing, metres) {
  const points = [[lat, lon]];
  for (let a = -SPREAD_HALF_ANGLE; a <= SPREAD_HALF_ANGLE; a += 5) {
    points.push(destination(lat, lon, bearing + a, metres));
  }
  return points;
}

export function createMap(elementId, { center = CANADA_CENTRE, zoom = CANADA_ZOOM } = {}) {
  const map = L.map(elementId, {
    center, zoom,
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
    history: L.layerGroup(),
    aircraft: L.layerGroup(),
    danger: L.layerGroup(),
    // Local view only: the modelled spread wedges, and the buildings and streets
    // Overpass returns for the current viewport.
    spread: L.layerGroup(),
    detail: L.layerGroup(),
    satellite: gibs,
    // Rain matters to a fire: it is the thing that stops one. RainViewer
    // publishes a free radar mosaic, refreshed roughly every ten minutes.
    rain: L.tileLayer(
      'https://tilecache.rainviewer.com/v2/radar/nowcast_0/256/{z}/{x}/{y}/2/1_1.png',
      { opacity: 0.6, maxZoom: 18,
        attribution: 'Radar &copy; RainViewer' }),
  };

  let currentBase = 'plain';
  let youMarker = null;
  let imageryOverlay = null;
  let scarOverlay = null;

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

    // The imagery picker replaces one overlay rather than accumulating them:
    // two stacked satellite layers show neither.
    setImagery(layer, date) {
      if (imageryOverlay) map.removeLayer(imageryOverlay);
      imageryOverlay = null;
      if (!layer) return null;
      imageryOverlay = L.tileLayer(tileUrl(layer, date), {
        maxNativeZoom: layer.maxNativeZoom, maxZoom: 19, opacity: 0.85,
        attribution: layer.attribution,
      });
      imageryOverlay.addTo(map);
      Object.values(layers).forEach((l) => {
        if (map.hasLayer(l) && l.bringToFront) l.bringToFront();
      });
      return imageryOverlay;
    },

    // A past season's burn scars. Separate from setImagery because it answers a
    // different question — has this ground burned before, not what does it look
    // like today — and because the two must be able to show at once.
    //
    // The cold filter is not decoration. EFFIS serves its burnt-area polygons in
    // rgb(253,191,111), which is 14 units from HEAT[0] in this file: 3% of the RGB
    // diagonal. Unfiltered, a 2016 scar renders in effectively live-fire amber on
    // a map whose whole discipline is that archival and active never look alike.
    // The filter lives in app.css against the class the module already sets.
    setBurnScar(entry) {
      if (scarOverlay) map.removeLayer(scarOverlay);
      scarOverlay = null;
      if (!entry) return null;
      scarOverlay = L.tileLayer.wms(EFFIS_ENDPOINT, entry.wms);
      scarOverlay.addTo(map);
      // Below live detections always: a scar must never cover a current fire.
      if (scarOverlay.bringToBack) scarOverlay.bringToBack();
      Object.values(layers).forEach((l) => {
        if (map.hasLayer(l) && l.bringToFront) l.bringToFront();
      });
      return scarOverlay;
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
      layers.aircraft.clearLayers();

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

      // Aircraft are arrows pointing where they are heading — a third shape,
      // distinct from a fire's dot and a boundary's outline.
      for (const plane of summary.aircraft || []) {
        const marker = L.marker([plane.lat, plane.lon], {
          icon: L.divIcon({
            className: '', iconSize: [20, 20], iconAnchor: [10, 10],
            html: `<div class="plane" style="transform:rotate(${plane.track || 0}deg)">➤</div>`,
          }),
          alt: plane.callsign || plane.id,
        });
        const lang = document.documentElement.lang === 'fr' ? 'fr' : 'en';
        marker.bindPopup(
          `<b>${plane.callsign || plane.id}</b><br>`
          + `${plane.altitude_ft.toLocaleString()} ft`
          + (plane.speed_kt ? ` · ${plane.speed_kt} kt` : '')
          + `<br><i>${lang === 'fr'
            ? "Aéronef volant bas près d'un feu. Son rôle n'est pas confirmé."
            : 'Flying low near a fire. What it is doing is not confirmed.'}</i>`);
        marker.addTo(layers.aircraft);
      }
    },

    // France: the danger forecast as a choropleth, plus ATMO air quality.
    // A département with no bulletin is drawn hollow rather than green — the
    // absence of a forecast must not look like the safest forecast.
    drawFrance(summary, departements, labels) {
      layers.danger.clearLayers();
      layers.aqhi.clearLayers();

      const byDep = new Map((summary.danger || []).map((d) => [d.dep, d]));
      if (departements) {
        L.geoJSON(departements, {
          style: (feature) => {
            const row = byDep.get(feature.properties.code);
            const level = row && row.level_today;
            return level
              ? { color: DANGER_FILL[level], weight: 1, opacity: 0.9,
                  fillColor: DANGER_FILL[level], fillOpacity: 0.42 }
              : { color: '#90A5B2', weight: 1, opacity: 0.5,
                  fillOpacity: 0, dashArray: '4 4' };
          },
          onEachFeature: (feature, layer) => {
            const row = byDep.get(feature.properties.code);
            const name = feature.properties.nom;
            layer.bindPopup(row
              ? `<b>${name}</b><br>${labels.today}: ${row.level_today}/4 — ${labels.level[row.level_today]}`
                + (row.level_tomorrow ? `<br>${labels.tomorrow}: ${row.level_tomorrow}/4` : '')
              : `<b>${name}</b><br>${labels.unavailable}`);
          },
        }).addTo(layers.danger);
      }

      // Curated evacuation zones. Order is solid, alert is dashed — the same
      // form language as Canada, so the shape carries the meaning without colour.
      layers.orders.clearLayers();
      layers.alerts.clearLayers();
      for (const zone of summary.evacuations || []) {
        if (!zone.polygons || !zone.polygons.length) continue;
        const isOrder = zone.kind === 'order';
        L.polygon(
          zone.polygons.map((rings) => rings.map((r) => r.map(([lon, lat]) => [lat, lon]))),
          { color: isOrder ? '#E4344F' : '#E8A33D', weight: 3,
            dashArray: isOrder ? null : '9 7',
            fillOpacity: isOrder ? 0.22 : 0.12 })
          .bindPopup(`<b>${zone.name}</b><br>${isOrder ? labels.evacOrder : labels.evacAlert}`
            + (zone.note ? `<br>${zone.note}` : ''))
          .addTo(isOrder ? layers.orders : layers.alerts);
      }

      // Fire incidents. Size carries intensity, opacity carries whether this is
      // France's problem or a neighbour's — a fire does not stop at a border,
      // but the reader's question is about their own country.
      layers.fires.clearLayers();
      for (const fire of summary.fires || []) {
        const foreign = fire.in_country === false;
        // Industrial heat is drawn as a hollow square, never a glowing dot. It
        // is real heat and hiding it would be dishonest, but it must not read as
        // a wildfire at a glance.
        const radius = Math.min(18, 5 + Math.sqrt(fire.frp_total || 0) / 3);
        const marker = fire.industrial
          ? L.rectangle([[fire.lat - 0.02, fire.lon - 0.02], [fire.lat + 0.02, fire.lon + 0.02]],
              { color: '#90A5B2', weight: 1.5, fillOpacity: 0, dashArray: '3 3' })
          : L.circleMarker([fire.lat, fire.lon], {
              radius,
              color: HEAT[2], fillColor: HEAT[1],
              weight: 1, opacity: foreign ? 0.3 : 0.9,
              fillOpacity: foreign ? 0.12 : 0.55,
            });
        const w = fire.wind;
        marker.bindPopup(
          fire.industrial
            ? `<b>${labels.industrial}</b><br>${labels.industrialNote}`
            : `<b>${labels.fire}</b><br>${Math.round(fire.frp_total)} MW · ${fire.detections} ${labels.detections}`
              + (w ? `<br>${labels.wind}: ${w.wind_kmh} km/h → ${w.wind_toward}` : '')
              + (fire.aircraft ? `<br><b>${fire.aircraft} ${labels.aircraftNear}</b>` : '')
              + (foreign ? `<br><i>${labels.outside}</i>` : ''));
        marker.addTo(layers.fires);
      }

      // Road closures. Bison Futé gives a point, not a line.
      layers.closures.clearLayers();
      for (const closure of summary.closures || []) {
        // Bison Futé publishes cuts scheduled months ahead -- 25 of 47 on
        // 2026-07-30, running to December. A scheduled cut is not a shut road.
        // Tested against false rather than for truth: Canada's bc_roads records
        // carry no in_force at all, and truthiness would empty its whole layer.
        if (closure.in_force === false) continue;
        if (closure.lat === null || closure.lon === undefined) continue;
        L.circleMarker([closure.lat, closure.lon], {
          radius: 7, color: '#FF4D6D', fillColor: '#FF4D6D',
          weight: 2, fillOpacity: 0.75,
        }).bindPopup(`<b>${closure.road} — ${closure.place}</b><br>${closure.headline || ''}`)
          .addTo(layers.closures);
      }

      // Aircraft, as arrows pointing where they are heading.
      layers.aircraft.clearLayers();
      for (const plane of summary.aircraft || []) {
        L.marker([plane.lat, plane.lon], {
          icon: L.divIcon({
            className: '', iconSize: [20, 20], iconAnchor: [10, 10],
            html: `<div class="plane" style="transform:rotate(${plane.track || 0}deg)">➤</div>`,
          }),
        }).bindPopup(`<b>${plane.callsign || plane.id}</b>`
          + (plane.role ? ` — ${plane.role}` : '')
          + `<br>${plane.altitude_ft.toLocaleString()} ft`
          + `<br><i>${labels.aircraftNote}</i>`).addTo(layers.aircraft);
      }

      for (const station of summary.air_quality || []) {
        if (!Number.isInteger(station.value)) continue;
        // ATMO runs 1-6, not the Canadian 1-10+, so it gets its own banding.
        const band = station.value >= 5 ? 'b3' : station.value >= 4 ? 'b2'
          : station.value >= 3 ? 'b1' : 'b0';
        L.marker([station.lat, station.lon], {
          icon: L.divIcon({
            className: '', iconSize: [22, 22], iconAnchor: [11, 11],
            html: `<div class="aqhi-pill ${band}">${station.value}</div>`,
          }),
        }).bindPopup(`<b>${(station.name && (station.name.fr || station.name.en)) || station.id}</b>`
          + `<br>${labels.air}: ${station.value}/6`).addTo(layers.aqhi);
      }
    },

    // The local view: the fires inside one zone, where the model says they are
    // going, and the roads a reader must not take.
    drawLocal(zone, labels) {
      layers.fires.clearLayers();
      layers.spread.clearLayers();
      layers.closures.clearLayers();

      for (const fire of (zone && zone.fires) || []) {
        const radius = Math.min(18, 5 + Math.sqrt(fire.frp_total || 0) / 3);
        L.circleMarker([fire.lat, fire.lon], {
          radius, color: HEAT[2], fillColor: HEAT[1],
          weight: 1, opacity: 0.9, fillOpacity: 0.55,
        }).bindPopup(`<b>${labels.fire}</b><br>`
          + `${Math.round(fire.frp_total || 0)} MW · ${fire.detections} ${labels.detections}`
          + (fire.last_seen ? `<br>${labels.lastSeen}: ${fire.last_seen.slice(11, 16)} UTC` : ''))
          .addTo(layers.fires);
      }

      // Two wedges per fire, mean wind and gust, both dashed. Dashed because a
      // modelled shape must never look like an observed one, and both because
      // one alone would imply a precision the model does not have.
      for (const projection of (zone && zone.spread) || []) {
        for (const arc of projection.arcs || []) {
          const gust = arc.basis === 'gust';
          L.polygon(wedge(projection.lat, projection.lon, arc.bearing, arc.distance_m), {
            color: gust ? '#E8A33D' : HEAT[2],
            weight: 2, dashArray: '8 6',
            fillColor: gust ? '#E8A33D' : HEAT[2],
            fillOpacity: gust ? 0.06 : 0.12,
          }).bindPopup(`<b>${gust ? labels.spreadGust : labels.spreadMean}</b><br>`
            + `${(arc.distance_m / 1000).toFixed(1)} km ${labels.inHours(projection.hours || 3)}`
            + `<br>${arc.ros_m_min} m/min · ${arc.wind_kmh || '—'} km/h`
            + `<br><i>${labels.spreadCaveat}</i>`)
            .addTo(layers.spread);
        }
      }

      // Where not to go. Bison Futé gives a point, not a line.
      for (const closure of (zone && zone.closures) || []) {
        if (closure.in_force === false) continue;
        if (closure.lat === null || closure.lat === undefined) continue;
        L.circleMarker([closure.lat, closure.lon], {
          radius: 7, color: '#FF4D6D', fillColor: '#FF4D6D',
          weight: 2, fillOpacity: 0.75,
        }).bindPopup(`<b>${closure.road} — ${closure.place}</b><br>${closure.headline || ''}`)
          .addTo(layers.closures);
      }
    },

    // Buildings and streets for the current viewport. Its own method rather than
    // part of drawLocal: this redraws on every pan, and the fires must not.
    drawDetail({ buildings = [], roads = [] } = {}) {
      layers.detail.clearLayers();
      for (const road of roads) {
        const line = L.polyline(road.points, {
          color: '#90A5B2', weight: 2, opacity: 0.7, interactive: !!road.name,
        });
        // An unnamed track is still an escape route, so it is drawn — it just
        // has nothing to say when clicked.
        if (road.name) line.bindPopup(`<b>${road.name}</b>`);
        line.addTo(layers.detail);
      }
      for (const building of buildings) {
        L.polygon(building.points, {
          color: '#90A5B2', weight: 1, opacity: 0.55,
          fillOpacity: 0.12, interactive: false,
        }).addTo(layers.detail);
      }
    },

    // One satellite pass, with the passes before it faded so the direction of
    // growth is visible rather than remembered.
    drawHistory(points) {
      layers.history.clearLayers();
      for (const p of points) {
        const fade = [1, 0.45, 0.2][p.age] ?? 0.15;
        L.circleMarker([p.lat, p.lon], {
          radius: p.age === 0 ? 6 : 4,
          color: HEAT[p.band] || HEAT[0],
          fillColor: HEAT[p.band] || HEAT[0],
          weight: 0,
          fillOpacity: (p.foreign ? 0.25 : 1) * fade,
          interactive: false,
        }).addTo(layers.history);
      }
    },

    setYou(point, zoom = 8) {
      if (youMarker) map.removeLayer(youMarker);
      youMarker = L.marker([point.lat, point.lon], {
        icon: L.divIcon({
          className: '', iconSize: [16, 16], iconAnchor: [8, 8],
          html: '<div class="you-dot" style="width:16px;height:16px"></div>',
        }),
        keyboard: false,
        alt: 'Your location',
      }).addTo(map);
      map.setView([point.lat, point.lon], zoom);
    },

    invalidate() { map.invalidateSize(); },
  };
}
