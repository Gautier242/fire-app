// The local view: one address and the fifty kilometres around it.
//
// Answers five questions in the order somebody in danger asks them: am I in
// danger, where is it going, where must I not go, who is fighting it, what can I
// do. Pure — no DOM, no Leaflet.
import { bearingDeg, compassPoint, nearest } from './geo.js';

const URGENT_KM = 10;
const NEAR_KM = 30;

const COPY = {
  fr: {
    heat: (km, dir) => `Chaleur détectée à ${km} km au ${dir}`,
    none: 'Aucune chaleur détectée dans cette zone',
    lag: 'Les satellites passent quelques fois par jour et les nuages masquent la détection.',
    caveat: "Estimation par modèle (Rothermel), non validée pour ce feu. Suivez les consignes officielles.",
    forces: "Aéronefs observés à proximité. Leur rôle n'est pas confirmé.",
    ground: 'Les moyens au sol ne sont pas publiés. Leur absence ici ne signifie pas leur absence sur le terrain.',
    wind: 'Vent', gust: 'Rafales', humidity: 'Humidité', temp: 'Température',
    toward: 'Se dirige vers vous', away: 'Ne se dirige pas vers vous',
  },
  en: {
    heat: (km, dir) => `Heat detected ${km} km ${dir}`,
    none: 'No heat detected in this zone',
    lag: 'Satellites pass a few times a day and cloud blocks detection.',
    caveat: 'Model estimate (Rothermel), not validated for this fire. Follow official instructions.',
    forces: 'Aircraft observed nearby. What they are doing is not confirmed.',
    ground: 'Ground units are not published. Their absence here does not mean their absence on the ground.',
    wind: 'Wind', gust: 'Gusts', humidity: 'Humidity', temp: 'Temperature',
    toward: 'Heading toward you', away: 'Not heading toward you',
  },
};

const DIR = {
  fr: { N: 'nord', NE: 'nord-est', E: 'est', SE: 'sud-est',
        S: 'sud', SW: 'sud-ouest', W: 'ouest', NW: 'nord-ouest' },
  en: { N: 'north', NE: 'northeast', E: 'east', SE: 'southeast',
        S: 'south', SW: 'southwest', W: 'west', NW: 'northwest' },
};

// Within 60 degrees of the bearing from the fire to the reader counts as coming
// toward them. Tighter than that pretends a wind forecast is more precise than
// it is.
const TOWARD_TOLERANCE_DEG = 60;

function headingToward(fire, point, bearing) {
  if (bearing === null || bearing === undefined) return false;
  const toReader = bearingDeg(fire, point);
  const delta = Math.abs(((toReader - bearing + 540) % 360) - 180);
  return delta <= TOWARD_TOLERANCE_DEG;
}

export function describeLocal({ zone, point, lang = 'fr' }) {
  const L = lang === 'en' ? 'en' : 'fr';
  const t = COPY[L];
  const fires = (zone && zone.fires) || [];
  const facts = [];

  const near = fires.length ? nearest(point, fires) : null;
  const km = near ? Math.round(near.km) : null;
  const urgency = km === null ? 'none'
    : km <= URGENT_KM ? 'high'
    : km <= NEAR_KM ? 'medium' : 'low';

  const headline = near
    ? t.heat(km, DIR[L][compassPoint(bearingDeg(point, near.item))])
    : t.none;

  // Wind first among the facts: it is the reason the fire will or will not come.
  const hour = ((zone && zone.wind) || [])[0];
  if (hour) {
    if (hour.wind_kmh !== null && hour.wind_kmh !== undefined) {
      facts.push({ label: t.wind,
                   value: `${hour.wind_kmh} km/h → ${DIR[L][hour.wind_toward] || '—'}`,
                   tone: 'hot' });
    }
    if (hour.gust_kmh !== null && hour.gust_kmh !== undefined) {
      // Gusts drive fire runs. Measured at Lacanau: mean 8.8 against gusts 32.
      facts.push({ label: t.gust, value: `${hour.gust_kmh} km/h`, tone: 'bad' });
    }
    if (hour.humidity_pct !== null && hour.humidity_pct !== undefined) {
      facts.push({ label: t.humidity, value: `${hour.humidity_pct} %` });
    }
    if (hour.temp_c !== null && hour.temp_c !== undefined) {
      facts.push({ label: t.temp, value: `${hour.temp_c} °C` });
    }
  }

  let spread = null;
  const projection = near
    ? ((zone && zone.spread) || []).find((s) => s.id === near.item.id)
    : null;
  if (projection && projection.arcs && projection.arcs.length) {
    const towardYou = headingToward(near.item, point, projection.arcs[0].bearing);
    spread = {
      validated: false,
      caveat: t.caveat,
      model: projection.model,
      fuel_model: projection.fuel_model,
      arcs: projection.arcs,
      towardYou,
      verdict: towardYou ? t.toward : t.away,
    };
  }

  return {
    urgency,
    headline,
    sub: near ? '' : t.lag,
    facts,
    spread,
    forces: {
      aircraft: (near && near.item.aircraft) || 0,
      caveat: t.forces,
      // Never let an empty ground count read as nobody being there.
      groundUnknown: true,
      groundNote: t.ground,
    },
    nearestKm: km,
  };
}
