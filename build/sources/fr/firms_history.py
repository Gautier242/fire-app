"""Seven days of satellite fire detections over France — where fire has been.

The 24-hour feed in `firms.py` answers "what is burning". This answers "what has
already burned through here", the question a reader asks when deciding which way
to drive. It is a separate module and a separate file because it is bulk data
lazy-loaded by one view, and because a failure here must never touch the
summary.

**This layer is not a burn scar, and must never be labelled one.** Every point is
a 375 m VIIRS pixel that was hot at the moment a satellite happened to look.
Between looks there is nothing, and cloud removes a look entirely: the fixture's
2026-07-24 and 07-25 are simply missing. So the trail has holes that did burn,
and its edges are pixel corners, not a fire's edge. The honest label is what it
is — heat detected over seven days. `effis` historical polygons are the mapped
perimeters; this is not them.

**Absence in the trail is never safety.** `generated_at` is the hour of the
newest detection inside the France box, never the build clock. It is the last
time we saw heat here, which is weaker than "the last time a satellite looked" —
FIRMS publishes detections, not passes, so a pass that saw nothing is
indistinguishable from no pass. Measured 2026-07-30 04:27Z, the newest row in the
Europe file was 22:57Z and the newest inside the France box was 14:00Z: an
eight-hour difference, which the UI must present as the age of our data and never
as eight quiet hours. Anchoring on the wall clock instead would turn a hole in
our observation into a claim about the reader's ground.

Keyless, like the 24-hour feed: the `api/area` endpoint needs a key, these bulk
CSVs do not.

**Cost.** Measured 2026-07-30: the two 7d files are 1,532,784 + 1,616,227 =
3.00 MB against the 24h pair's 526 KB, so 144 MB/day across 48 builds instead of
24.7 MB. Accepted — they are static files NASA publishes for exactly this, one
request each per build. The 48h pair costs 775 KB if it ever needs cutting, at
the price of losing the early trail of a week-old fire.

**Bands come from FRP, never from confidence.** Confidence is the words
low/nominal/high and says how sure the detector is, not how much fire there is;
a low-confidence 200 MW pixel is the hottest thing on the map. Canada bands on
head fire intensity, which FIRMS does not carry, so the cuts are derived from
fire radiative power:

    1 MW FRP  ~ 0.368 kg/s of dry fuel (Wooster 2005)
              ~ 0.368 x 18 000 kJ/kg = 6 624 kW of total heat release
              (a 15% radiative fraction, matching the published 15-17%)

Spread along a front the full 375 m width of the pixel — the assumption that
yields the *lowest* intensity for a given FRP, so the bands understate rather
than overstate:

    band 1 at  10 MW -> ~180 kW/m, above the ~500 kW/m where hand tools hold a
                        line only once the pixel is partly involved
    band 2 at 100 MW -> ~1 770 kW/m, at the ~2 000 kW/m limit where water and
                        hand crews stop being able to hold anything

Checked against the distribution rather than adopted blind: of 9 583 detections
in the France box over the measured week, 62% band 0, 33% band 1, 4% band 2.
Round numbers on purpose — the front-length assumption is not good to two
significant figures and the cuts must not pretend otherwise.
"""
import csv

from build import flares
from build.http import TIMEOUT_SECONDS
from build.sources.fr import firms

BASE = "https://firms.modaps.eosdis.nasa.gov/data/active_fire"
URLS = (
    f"{BASE}/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Europe_7d.csv",
    f"{BASE}/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Europe_7d.csv",
)

# 7 x 24. The index runs 0..167 with 167 the newest hour observed, matching the
# 72-hour Canadian payload the frontend already decodes.
HOURS = 168

# A pinned window is a fortnight, counted from its own start rather than from
# the newest detection. The national trail keeps rolling; this is for a payload
# that has to still show the same fortnight when it is read months afterwards.
WINDOW_HOURS = 14 * 24

# Fire radiative power in MW per 375 m pixel. Derivation and the arithmetic
# behind the two numbers are in the module docstring.
BAND_CUTS = (10.0, 100.0)

# Measured 2026-07-30 across both live 7d feeds: 9 583 detections inside the
# France box, 7 886 inside the border, in a week whose worst day held 2 933. The
# default is a little over double that, so a season twice as bad still publishes
# whole. It is a fuse against a feed that changes shape, not a tuning knob.
MAX_POINTS = 20000

# Three decimals, ~110 m. Finer is noise against a 375 m pixel and this file is
# ten thousand points wide. The 24-hour feed keeps five because the industrial
# mask has to recognise a refinery as the same site across days; nothing here
# does that matching.
PRECISION = 3


def fetch(session):
    """Both satellites, concatenated. The second file's header line lands
    mid-payload and falls out of normalize() as a malformed row."""
    payloads = []
    for url in URLS:
        response = session.get(url, timeout=TIMEOUT_SECONDS)
        response.raise_for_status()
        payloads.append(response.text)
    return "\n".join(payloads)


def _band(frp):
    return sum(frp >= cut for cut in BAND_CUTS)


def _hour_floor(stamp):
    return stamp.replace(minute=0, second=0, microsecond=0)


def _empty():
    return {"generated_at": None, "hours": HOURS, "points": [], "wind": []}


def normalize(payload, now, shapes=None, registry=None, cap=MAX_POINTS,
              window_start=None):
    """The 7-day trail as [lon, lat, hour, band, foreign] rows.

    `now` is required and the clock is never read here: the future-timestamp
    guard and the window have to be reproducible in a test, and the trail must
    agree with the summary built from the same instant.

    `shapes` is France's departement geojson and `registry` the published flare
    record. Both are injected because both are files the caller already has open,
    and because a test must be able to hand over a two-day record.

    `foreign` is computed here, against real borders, because the frontend's
    decoder guesses it from a hardcoded Canadian latitude test that calls all of
    Provence foreign and Leon French.

    `wind` is always empty: FIRMS carries no weather column, and per-hour wind
    invented from a forecast would put modelled data on an observed layer.

    On unusable input the payload is empty rather than partial. A half-drawn
    trail is read as ground that did not burn.
    """
    detections = []
    for row in csv.DictReader((payload or "").splitlines()):
        # Borrowed rather than copied: same feed, same columns, same two traps
        # (acq_time is HHMM and not always four characters, and a row dated
        # after the build clock is broken). Two copies would diverge the first
        # time FIRMS changed shape.
        detection = firms._detection(row, now)
        if detection is not None:
            detections.append(detection)

    if not detections:
        return _empty()

    # Anchored on the newest hour observed, before masking: a refinery detection
    # is still proof a satellite looked, and dropping it from the anchor would
    # backdate generated_at and understate how fresh the last look was.
    anchor = _hour_floor(max(d[3] for d in detections))

    # With a window the grid is pinned to the event instead. `hours` and the
    # index origin both come from the window, so the same detections produce the
    # same indices whether the build runs during the fire or a year later.
    pinned = window_start is not None
    span = WINDOW_HOURS if pinned else HOURS
    origin = _hour_floor(window_start) if pinned else None

    # The mask flags rather than deletes in the summary, where an incident has a
    # popup that can explain itself. A trail point is a non-interactive dot with
    # nowhere to say "refinery", and a permanent seven-day smear over
    # Fos-sur-Mer teaches readers to ignore the layer — so here it drops.
    # is_industrial() masks nothing below three days of record on its own.
    if registry is not None:
        detections = [d for d in detections
                      if not registry.is_industrial(d[1], d[0])]

    # Worst first, so the cap sheds the coldest pixels rather than whichever
    # ones the feed happened to list last. It is deliberately blind to country:
    # a 300 MW fire ten kilometres into Spain outranks a 1 MW French pixel.
    detections.sort(key=lambda d: -d[2])
    detections = detections[:max(0, cap)]

    # A bounding box is not a border. Absent shapes, claim nothing foreign —
    # the same fallback build.main uses for the summary, and the alternative
    # would fade the entire French trail to a quarter opacity.
    tagged = (flares.tag_country([{"lon": d[0], "lat": d[1]} for d in detections],
                                 shapes)
              if shapes else None)

    points = []
    for index, (lon, lat, frp, stamp, _confidence) in enumerate(detections):
        if pinned:
            hour = int((_hour_floor(stamp) - origin).total_seconds() // 3600)
        else:
            hour = span - 1 - int((anchor - _hour_floor(stamp)).total_seconds() // 3600)
        # Outside the window is dropped, never clamped. Clamping would date
        # week-old heat to the start of the trail and draw it as part of it --
        # and on a pinned window it would take heat from six months after the
        # fire and file it under the fire's last hour.
        if not 0 <= hour < span:
            continue
        foreign = not tagged[index]["in_country"] if tagged else False
        points.append([round(lon, PRECISION), round(lat, PRECISION),
                       hour, _band(frp), foreign])

    out = {
        "generated_at": anchor.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "hours": span,
        "points": points,
        "wind": [],
    }
    # Stated in the payload rather than assumed by the reader: without it the
    # frontend has to guess the index origin, and its only other guess is the
    # newest observation, which is exactly the rolling behaviour being replaced.
    if pinned:
        out["window_start"] = origin.strftime("%Y-%m-%dT%H:%M:%SZ")
    return out
