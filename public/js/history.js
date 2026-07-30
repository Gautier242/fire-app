// Satellite hotspot history: turning a 72-hour window into the handful of
// moments a satellite actually looked. Pure — no DOM, no Leaflet.

// Polar-orbiting satellites pass overhead a few times a day, so detections
// arrive in clumps and most clock hours hold nothing at all. A slider with one
// stop per hour would spend most of its travel on empty hours, and an empty
// hour drawn as "no fire" reads as the fire having gone out. Stepping through
// observed passes instead means every stop shows real data.
export function observedPasses(history) {
  if (!history || !history.points || !history.points.length) return [];
  return [...new Set(history.points.map((p) => p[2]))].sort((a, b) => a - b);
}

// The last hour of the window is the newest observed, and generated_at is its
// timestamp. The window length comes from the payload: Canada's is 72 hours and
// France's is 168, so a hardcoded 71 would date every French detection 96 hours
// early -- a four-day-old burn shown as happening now.
export function hourToDate(history, hour) {
  if (!history || !history.generated_at) return null;
  const newest = new Date(history.generated_at);
  if (Number.isNaN(newest.getTime())) return null;
  const last = (history.hours || 72) - 1;
  return new Date(newest.getTime() - (last - hour) * 3600 * 1000);
}

export function passLabel(history, hour, lang = 'en') {
  const when = hourToDate(history, hour);
  if (!when) return '';
  // Viewer's local time: someone deciding whether to drive tonight thinks in
  // their own clock, not UTC.
  return when.toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA', {
    weekday: 'short', hour: 'numeric', minute: '2-digit',
  });
}

// The bounding box the fetch uses reaches into Oregon, Idaho and Montana, so a
// good share of the points are American. They are kept because a fire does not
// stop at the border and smoke certainly does not, but they are drawn faded so
// the Canadian picture stays the subject.
// ponytail: 49th parallel west of -95 only; the border east of there dips and
// this will call some Ontario/Quebec border points foreign. Swap in a real
// point-in-polygon against coverage.geojson if that ever matters.
export function inCanada(lon, lat) {
  return lon < -95 ? lat >= 49 : lat >= 45;
}

// Points for one pass, plus the two before it drawn faintly so direction of
// growth is visible rather than inferred from memory.
// How bright a pass of a given age draws, against the oldest age on screen.
//
// This was a three-element lookup, which is right for a scrubber stepping through
// a few passes and wrong for a trail: France's window holds 41 observed passes
// over seven days, and indexing a three-element array rendered 38 of them at the
// same floor value. Computed from the age instead, so the ramp stretches to
// however many passes are actually shown.
//
// The floor is deliberate. The oldest pass stays visible because the point of the
// layer is where the fire has been, and a detection that fades to nothing says
// nothing was there.
export function trailOpacity(age, oldest) {
  if (!oldest) return 1;
  return Math.max(0.15, 1 - 0.85 * (age / oldest));
}

export function pointsForPass(history, passes, index, trail = 2) {
  if (!history || !passes.length) return [];
  const shown = passes.slice(Math.max(0, index - trail), index + 1);
  const ageOf = new Map(shown.map((hour, i) => [hour, shown.length - 1 - i]));
  return history.points
    .filter((p) => ageOf.has(p[2]))
    .map(([lon, lat, hour, band, foreign]) => ({
      lon,
      lat,
      band,
      age: ageOf.get(hour),
      // The server tags the border where it can, against real département
      // polygons. Trust that over inCanada(), whose lat >= 45 test calls the
      // whole Gironde front foreign and Leon in Spain domestic.
      foreign: foreign === undefined ? !inCanada(lon, lat) : foreign,
    }));
}

export function windAt(history, hour) {
  if (!history || !history.wind) return null;
  const row = history.wind.find((w) => w[0] === hour);
  return row ? { speed: row[1], direction: row[2] } : null;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

// Meteorological convention: a wind "from 069" blows toward the southwest.
// Saying which way it is blowing is the useful half for a fire.
export function windToward(direction) {
  return COMPASS[Math.round(((direction + 180) % 360) / 45) % 8];
}
