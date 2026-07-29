// Street-level address search against BAN, the Base Adresse Nationale.
//
// This is the French answer to a problem the Canadian version could not solve:
// there, a user picks from 29,213 place NAMES. Here they can type
// "12 rue de la République, Marseille" and get their actual street.
//
// Host: the documented `api-adresse.data.gouv.fr` still answers, but it now
// serves `deprecation` and `sunset: Sat, 31 Jan 2026` headers — both dates
// already past — and `x-api-migration: permanent` pointing at the
// Geoplateforme host used below. Same payload, same CORS, no deprecation
// headers. Building on the old host would be building on something already
// scheduled off.
//
// Rate limit, read off the live response headers: `ratelimit-limit: 50`,
// `x-ratelimit-limit-second: 1` — 50 requests per second per IP. One keystroke
// per request would still sit inside that, but debouncing is the caller's job
// (see the caller in location.js), which keeps this module pure and testable.
//
// Country restriction: BAN holds French addresses only — metropolitan France
// plus the DROM. There is no country parameter because there is nothing else
// in the index to exclude.
const URL = 'https://data.geopf.fr/geocodage/search/';

// Below three characters BAN matches most of the country, so the request costs
// a round trip to return noise.
const MIN_QUERY = 3;

// The address box is a convenience over the commune list, never a dependency of
// it. Every failure here — offline, 500, rate limited, aborted mid-keystroke,
// malformed body — returns [] so the page keeps working on the fallback.
export async function searchAddress(query, { signal, limit = 5 } = {}) {
  const q = typeof query === 'string' ? query.trim() : '';
  if (q.length < MIN_QUERY || signal?.aborted) return [];

  try {
    const response = await fetch(
      `${URL}?q=${encodeURIComponent(q)}&limit=${limit}`,
      { signal },
    );
    if (!response.ok) return [];
    const body = await response.json();
    return (body?.features ?? []).map(toResult).filter(Boolean);
  } catch {
    return [];
  }
}

// GeoJSON coordinates are [lon, lat]. A feature without a usable point or label
// is dropped rather than returned with NaN — an unplaceable result in a "where
// am I" box is worse than one fewer result.
function toResult(feature) {
  const [lon, lat] = feature?.geometry?.coordinates ?? [];
  const props = feature?.properties ?? {};
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !props.label) return null;
  return {
    label: props.label,
    lat,
    lon,
    postcode: props.postcode ?? '',
    city: props.city ?? '',
  };
}
