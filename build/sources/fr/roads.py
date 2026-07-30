"""Road closures on the reseau routier national, from Bison Fute.

The second question after "should I leave" is "which way can I drive", and
Bison Fute is the only national feed that answers it. It publishes an HTML
table of *coupures* -- cuts -- at
`Evenementiel-DIR/cnir/coupures.html`, refreshed by the CNIR. The sibling
`RecapChantiersEnCours.html` is roadworks and is deliberately not used: during
an evacuation a map covered in paving crews is worse than no road layer.

**This list is not exhaustive and must never be presented as one.** It covers
the reseau routier national -- autoroutes and routes nationales, plus the odd
departementale a DIR manages. A prefet closing a communal road beside a fire
does not appear here, and neither does anything the CNIR has not yet recorded.

On reading the table, established from the 72-row capture of 2026-07-29:

- The header has ten columns: Validite, Realite, Importance, Dep, Axe, Sens,
  Localisation, Constat, Fin, Evenements. *Importance* takes only "Haut" and
  "Moyen"; it is a severity, not a column of its own.
- *Validite* and *Realite* were empty on all 72 rows. Nothing can be read from
  them, so nothing is.
- *Constat* is when the closure was recorded, *Fin* its published end. A
  trailing "?" (20 rows) or "!" (8 rows) on Constat always accompanied a start
  in the future, so both mark a closure that has not begun rather than one
  observed. Neither marker belongs in the parsed datetime. 31 of the 54 rows
  that outlive the Fin filter start later -- some in October, some in December
  -- so `in_force` reports whether the cut had begun at the `now` the caller
  passed. A row that has not begun is kept, because a scheduled closure is real
  information; it simply is not a shut road, and must not be drawn as one. An
  unreadable Constat is never in force: no date is no evidence of a closed road.
- Fin is the publication's own statement that the closure is over, and 18 of
  the 72 rows had one already in the past -- stale entries the page has not
  dropped. Those are excluded. Fin is *not* trusted for anything else: 25 rows
  put it before Constat, mostly overnight works printed with the same date at
  both ends, so it cannot be used to compute a duration.
- The event codes in *Evenements* (RFer, EFer, SFer, Entr, FTun, Chan, Devt,
  Neig...) are published without a legend anywhere on the server, so they are
  not decoded here. RFer/EFer/SFer correlate with plain carriageway, entry slip
  and exit slip in the Localisation text, but not cleanly enough to assert.
- `.fini` is line-through in the page's own stylesheet, and it sits on
  individual event *spans*, not on rows -- one row in the capture struck one
  code of three while the closure stood. A row is therefore only finished when
  every event is struck (or when the row itself is), which nothing in the
  capture was.

Coordinates: the table has none. It has a departement, a road and a commune,
so each row is placed at its commune centre via BAN. That is the best
resolution available -- the PR (point repere) markers would place a closure to
the metre, but resolving them needs a reference dataset nobody publishes
openly. A pin can therefore sit some kilometres from the actual cut.

`kind` is always "closed": every row in this file is a coupure. Whether the cut
is the carriageway or only a slip road is stated in the Localisation text and
carried verbatim in `headline`.
"""
import hashlib
import re
from datetime import datetime, timedelta
from html.parser import HTMLParser
from zoneinfo import ZoneInfo

from build.http import FetchError, TIMEOUT_SECONDS, make_session

URL = ("https://tipi.bison-fute.gouv.fr/bison-fute-ouvert/publicationsDIR"
       "/Evenementiel-DIR/cnir/coupures.html")

BAN_URL = "https://data.geopf.fr/geocodage/search/"

# The publication writes local French time and never says so. Comparing it to
# the builder's own clock is only correct if the builder happens to sit in
# France: on a US-Eastern runner every closure would survive six hours past its
# end, and a "23:50" with no date would be filed under the wrong day.
PARIS = ZoneInfo("Europe/Paris")

# Metropolitan France, as a coarse rectangle. It is a sanity guard, not a
# border: London and Brussels both fall inside it. What it catches is a
# geocoder that has gone badly wrong -- a DROM commune, a match in Spain --
# and a pin in the wrong country is worse than no pin.
FRANCE_BBOX = (-5.5, 10.0, 41.0, 51.5)

# BAN allows 50 requests a second and the page carries ~50 distinct communes,
# so this never binds in practice. It exists so a page that suddenly grows to
# ten thousand rows cannot turn one build into ten thousand requests.
MAX_GEOCODE = 200

DEP = 3
AXE = 4
LOCALISATION = 6
CONSTAT = 7
FIN = 8
COLUMNS = 10

# "PR24+530...", "PR34+1 000..." -- the kilometre marker the row opens with.
PR_RE = re.compile(r"^PR\s*\d", re.IGNORECASE)

# Fragments that describe the spot rather than name the commune.
NOT_A_PLACE_RE = re.compile(r"^(sur|situ|dans|au niveau|entre|commence|entre)\b",
                            re.IGNORECASE)

# "23/10/25 10:44", "27/07 06:40", "06:53" -- optionally trailed by ? or !.
WHEN_RE = re.compile(
    r"^(?:(\d{1,2})/(\d{1,2})(?:/(\d{2}))?\s+)?(\d{1,2}):(\d{2})\s*[?!]?$")


class _Table(HTMLParser):
    """The first table in the page, as rows of cells.

    Each row is (tr_classes, [cell_text, ...], [event_span_classes, ...]).
    Anything that is not a `td` inside a `tr` is ignored, so a page that is an
    error message rather than a table simply yields nothing.

    The publication writes its header inside `thead` -- but with `td` cells,
    not `th` -- so the header is skipped by position rather than by tag.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows = []
        self._row = None
        self._cell = None
        self._span = None
        self._in_head = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "thead":
            self._in_head = True
        elif tag == "tr":
            self._row = ((attrs.get("class") or "").split(), [], [])
        elif tag == "td" and self._row is not None:
            self._cell = []
        elif tag == "span" and self._row is not None:
            self._span = (attrs.get("class") or "").split()
            if len(self._row[1]) == COLUMNS - 1:
                self._row[2].append(self._span)

    def handle_endtag(self, tag):
        if tag == "thead":
            self._in_head = False
        elif tag == "td" and self._cell is not None:
            self._row[1].append(_clean("".join(self._cell)))
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if not self._in_head:
                self.rows.append(self._row)
            self._row = None
        elif tag == "span":
            self._span = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def _clean(text):
    return re.sub(r"\s+", " ", text.replace("\xa0", " ")).strip()


def fetch(session):
    """The whole page, once per build. It is a static file, never polled."""
    try:
        response = session.get(URL, timeout=TIMEOUT_SECONDS)
        response.raise_for_status()
    except Exception as exc:  # noqa: BLE001 - the caller only needs "no data"
        raise FetchError(f"{URL} failed: {exc}") from exc
    return response.text


def place_of(localisation):
    """The commune named in a Localisation cell, or "".

    The cell opens with a kilometre marker and may trail into a description of
    the slip road; the commune is the segment between the two.
    """
    parts = [p.strip() for p in (localisation or "").split(",")]
    if parts and PR_RE.match(parts[0]):
        parts = parts[1:]
    for part in parts:
        part = re.sub(r"\(.*?\)", "", part).strip(" .")
        if part and not NOT_A_PLACE_RE.match(part):
            return part
    return ""


def parse_when(text, now):
    """A Constat or Fin cell as a datetime, or None when it is not one.

    The publication omits the year on recent rows and the date entirely on
    today's. A year-less date that lands far in the future is last year's --
    without that, December rows read on 3 January never expire.
    """
    match = WHEN_RE.match(_clean(text or ""))
    if not match:
        return None
    day, month, year, hour, minute = match.groups()
    try:
        if day is None:
            return now.replace(hour=int(hour), minute=int(minute),
                               second=0, microsecond=0)
        when = datetime(2000 + int(year) if year else now.year,
                        int(month), int(day), int(hour), int(minute))
    except ValueError:
        return None
    if year is None and when - now > timedelta(days=180):
        when = when.replace(year=when.year - 1)
    return when


def is_finished(tr_classes, event_classes, until, now):
    """Whether the publication says this closure is over.

    Two independent signals, because the page carries both: a strike-through
    on every event, and an end time already past. Neither is inferred from
    silence -- a row with no Fin at all is still open.
    """
    if "fini" in tr_classes:
        return True
    if event_classes and all("fini" in classes for classes in event_classes):
        return True
    return until is not None and until < now


def ban_geocode(place, dep, session=None):
    """The centre of `place` in departement `dep`, or None.

    Two queries at most. The commune index answers 50 of the 53 places in the
    capture; the three it misses are communes that have since merged (Lez into
    Saint-Beat-Lez, Aumont-Aubrac into Peyre en Aubrac), whose names survive
    only as streets and localities, so the fallback drops the type filter. The
    INSEE code is what ties a result to a departement -- a postcode does not,
    since Corsica's 20xxx span 2A and 2B.
    """
    session = session or _session()
    for params in ({"q": place, "type": "municipality"}, {"q": f"{place} {dep}"}):
        try:
            response = session.get(BAN_URL, params={"limit": 5, **params},
                                   timeout=TIMEOUT_SECONDS)
            if not response.ok:
                continue
            features = response.json().get("features") or []
        except Exception:  # noqa: BLE001 - a miss is not worth failing a build
            continue
        for feature in features:
            code = (feature.get("properties") or {}).get("citycode") or ""
            coordinates = (feature.get("geometry") or {}).get("coordinates") or []
            if code.startswith(dep) and len(coordinates) >= 2:
                return coordinates[1], coordinates[0]
    return None


_SHARED_SESSION = None


def _session():
    global _SHARED_SESSION
    if _SHARED_SESSION is None:
        _SHARED_SESSION = make_session()
    return _SHARED_SESSION


def _placed(geocode, place, dep, budget):
    """(lat, lon) for one commune, or (None, None). Never raises."""
    if not place or budget <= 0:
        return None, None
    try:
        found = geocode(place, dep)
    except Exception:  # noqa: BLE001 - an unplaced closure is still a closure
        return None, None
    if not found or len(found) != 2:
        return None, None
    lat, lon = found
    west, east, south, north = FRANCE_BBOX
    if not (west <= lon <= east and south <= lat <= north):
        return None, None
    return lat, lon


def paris_now():
    """Local French time, naive, to compare against the publication's clock."""
    return datetime.now(PARIS).replace(tzinfo=None)


def normalize(payload, geocode=None, cap=MAX_GEOCODE, now=None):
    now = now or paris_now()
    geocode = geocode or ban_geocode

    parser = _Table()
    try:
        parser.feed(payload or "")
        parser.close()
    except Exception:  # noqa: BLE001 - a broken page is no closures, not a crash
        return []

    closures = []
    placed = {}
    for tr_classes, cells, event_classes in parser.rows:
        if len(cells) < COLUMNS:
            continue
        dep, axe = cells[DEP], cells[AXE].rstrip(" *")
        if not dep or not axe:
            continue

        until = parse_when(cells[FIN], now)
        if is_finished(tr_classes, event_classes, until, now):
            continue

        localisation = cells[LOCALISATION]
        place = place_of(localisation)
        if (place, dep) not in placed:
            placed[(place, dep)] = _placed(geocode, place, dep, cap - len(placed))
        lat, lon = placed[(place, dep)]

        since = parse_when(cells[CONSTAT], now)
        closures.append({
            "id": _identify(dep, axe, cells),
            "kind": "closed",
            "road": axe,
            "place": place,
            "dep": dep,
            "headline": f"{axe} — {localisation}" if localisation else axe,
            "since": since.isoformat(timespec="minutes") if since else None,
            "until": until.isoformat(timespec="minutes") if until else None,
            "in_force": since is not None and since <= now,
            "lat": lat,
            "lon": lon,
            "source": "bison_fute",
        })
    return closures


def _identify(dep, axe, cells):
    """A stable id, since the publication carries none of its own.

    Built from the fields that identify the cut rather than its progress, so a
    closure keeps its id across builds while its Fin is revised.
    """
    seed = "|".join([dep, axe, cells[LOCALISATION], cells[CONSTAT]])
    return "bf-" + hashlib.sha1(seed.encode("utf-8")).hexdigest()[:12]
