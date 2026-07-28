// The answer rail: turns state into the sentence a person reads.
// Pure — takes data, returns a plain description. No DOM, no fetch.
import { nearest } from './geo.js';
import { t } from './i18n.js';
import { aqhiBand, evacuationState, fireState, NEAR_KM } from './status.js';

export const STALE_MINUTES = 60;
const DISTANT_STATION_KM = 100;

// 109 of 138 BC fires carry their fire number as their "name" (N50921, C40923),
// and some real names arrive with trailing spaces. "N50921 is burning 12 km north
// of you" reads like a machine talking; fall back to unnamed phrasing for those,
// while still showing the status and official link we do have.
const FIRE_CODE = /^[A-Z]\d+$/;

export function humanName(fire) {
  const name = (fire && fire.name || '').trim();
  return name && !FIRE_CODE.test(name) ? name : null;
}

export function minutesSince(iso, now = Date.now()) {
  if (!iso) return null;
  return Math.round((now - new Date(iso).getTime()) / 60000);
}

function sourceInfo(summary, id) {
  return (summary.sources || []).find((s) => s.id === id)
    || { id, ok: false, stale: true, fetched_at: null };
}

function ageOf(summary, ids, now) {
  const ages = ids.map((id) => minutesSince(sourceInfo(summary, id).fetched_at, now))
    .filter((m) => m !== null);
  return ages.length ? Math.max(...ages) : null;
}

/**
 * Build the whole rail description for a point.
 * Returns { level, tag, headline, sub, facts:[{label,value,tone}], note,
 *           official, evac, fire, aqhi } — all strings already localised.
 */
export function describe({ summary, point, province, lang, now = Date.now() }) {
  const provinceRow = (summary.coverage || []).find((c) => c.province === province);
  const covered = Boolean(provinceRow && provinceRow.evacuations);
  const evacStale = sourceInfo(summary, 'bc_evac').stale;

  const evac = evacuationState({
    point,
    evacuations: summary.evacuations || [],
    covered,
    stale: evacStale,
  });
  const fire = fireState({ point, fires: summary.fires || [], nearKm: NEAR_KM });
  const station = nearest(point, summary.aqhi || []);
  const band = station ? aqhiBand(station.item.value) : null;

  const facts = [];
  let level, tag, headline, sub, note = null, official = null;

  // Evacuation is the most urgent thing we can say, so it leads.
  if (evac.state === 'order') {
    level = 'danger';
    tag = t(lang, 'badge_danger');
    headline = t(lang, 'evac_order');
    sub = evac.zone.name;
  } else if (evac.state === 'alert') {
    level = 'caution';
    tag = t(lang, 'badge_caution');
    headline = t(lang, 'evac_alert');
    sub = evac.zone.name;
  } else if (fire.level === 'amber') {
    const direction = t(lang, `dir_${fire.direction}`);
    const name = humanName(fire.fire);
    level = 'caution';
    tag = t(lang, 'badge_caution');
    headline = name
      ? t(lang, 'fire_near_named', { name, km: fire.km, direction })
      : t(lang, 'fire_near', { km: fire.km, direction });
    sub = evac.state === 'none_found'
      ? t(lang, 'evac_none_found')
      : t(lang, 'evac_cannot_check', { province: province || '—' });
  } else if (evac.state === 'cannot_check') {
    // No fire nearby, but we cannot speak to evacuations here. Say so rather
    // than showing an all-clear that we have not actually verified.
    level = 'caution';
    tag = t(lang, 'badge_caution');
    headline = t(lang, 'evac_cannot_check', { province: province || '—' });
    sub = t(lang, 'fire_none', { km: NEAR_KM });
  } else {
    level = 'safe';
    tag = t(lang, 'badge_safe');
    headline = t(lang, 'fire_none', { km: NEAR_KM });
    sub = t(lang, 'evac_none_found');
  }

  if (evac.zone && evac.zone.agency) {
    facts.push({ label: t(lang, 'evac_heading'),
                 value: t(lang, 'evac_issued_by', { agency: evac.zone.agency }),
                 tone: 'bad' });
  } else if (evac.state === 'cannot_check') {
    facts.push({ label: t(lang, 'evac_heading'), value: t(lang, 'no_data'), tone: 'bad' });
  } else if (evac.state === 'none_found') {
    facts.push({ label: t(lang, 'evac_heading'), value: t(lang, 'none_found_short'), tone: 'ok' });
  }

  if (fire.fire) {
    facts.push({ label: t(lang, 'fact_nearest_fire'),
                 value: `${fire.km} km ${fire.direction}`, tone: 'hot' });
    if (fire.fire.status) {
      facts.push({ label: t(lang, 'fact_status'), value: fire.fire.status, tone: 'hot' });
    }
    if (fire.fire.size_ha) {
      facts.push({ label: t(lang, 'fact_size'),
                   value: `${Math.round(fire.fire.size_ha).toLocaleString(lang)} ha` });
    }
    if (!fire.fire.named) note = t(lang, 'fire_estimate_note');
  }

  if (band) {
    facts.push({ label: t(lang, 'aqhi_heading'),
                 value: `${Math.max(1, Math.round(station.item.value))} — ${t(lang, `aqhi_${band}`)}`,
                 tone: band === 'low' ? 'ok' : band === 'very_high' ? 'bad' : 'air' });
    note = t(lang, `aqhi_${band}_advice`);
    if (station.km > DISTANT_STATION_KM) {
      facts.push({ label: t(lang, 'fact_station'),
                   value: t(lang, 'aqhi_distant', {
                     name: station.item.name[lang] || station.item.name.en,
                     km: Math.round(station.km),
                   }) });
    }
  } else {
    facts.push({ label: t(lang, 'aqhi_heading'), value: t(lang, 'no_data'), tone: 'bad' });
  }

  if (evac.state === 'cannot_check' && provinceRow) {
    official = {
      text: t(lang, 'evac_cannot_check', { province: province }),
      label: t(lang, 'official_link', { province: province }),
      url: provinceRow.official_url,
    };
  }

  const age = ageOf(summary, ['cwfis_perimeters', 'bc_fires', 'bc_evac', 'aqhi'], now);

  return {
    level, tag, headline, sub, facts, note, official,
    evac, fire, aqhi: station && band ? { station: station.item, band } : null,
    age,
    stale: age === null || age > STALE_MINUTES,
  };
}
