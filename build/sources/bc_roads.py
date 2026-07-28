"""Road closures and travel restrictions from DriveBC's Open511 feed.

The second question after "am I ordered out" is "which way can I actually
drive", so this layer only carries events that stop or restrict travel. Routine
roadworks are filtered out: during an evacuation a map covered in paving crews
is worse than no road layer at all.

On reading closure state: Open511 puts a `state` field on each entry in
`roads[]`, and it is present in this feed, but it cannot be the filter on its
own. In a 257-event sample of ACTIVE events, 117 road entries had no `state` at
all -- including nine of the ten wildfire closures, every one of which said
"Road closed." in its description. Meanwhile ten of the thirteen `CLOSED`
states belonged to construction: overnight paving, culvert work, a street
festival. Filtering on `state == "CLOSED"` would therefore have produced a map
that was mostly roadworks and that omitted almost every fire closure. So state
is read first where it exists, and the description is read where it does not.
"""
import re

from build.http import get_json

URL = "https://api.open511.gov.bc.ca/events"
MAX_EVENTS = 500

# BC's bounding box. The feed is provincial, so anything outside it is bad data
# rather than a neighbouring closure, and a road we cannot place is a road we
# cannot route around.
BC_BBOX = (-141.0, -114.0, 48.0, 60.0)

# The feed's placeholder for a road it does not carry a route number for.
GENERIC_ROUTE = "other roads"

# Wording that means the road itself is shut. Deliberately anchored to a road
# noun or a sentence start so that "Right lane closed" and "Washrooms closed"
# do not match.
CLOSED_RE = re.compile(
    r"(?:^|\.\s+)clos(?:ed|ure)\b"
    r"|\b(?:road|bridge|highway|hwy|route|ferry route|ferry|pass|section)\b"
    r"(?:\s+\w+){0,2}\s+clos(?:ed|ure)"
    r"|\bclosed\s+(?:to\s+all\s+traffic|from|in\s+both\s+directions)",
    re.IGNORECASE,
)

# Wording that means travel is slowed but still possible. A description has to
# match one of these *and* none of the above to be downgraded to "restricted".
RESTRICTED_RE = re.compile(
    r"\b(?:lane|lanes|shoulder|ramp)\b[^.]{0,20}\b(?:closed|blocked)\b"
    r"|\bexpect\s+(?:\w+\s+)?delays?\b"
    r"|\bsingle\s+lane\b|\balternating\b|\breduced\s+to\s+one\s+lane\b"
    r"|\bopen\s+to\s+traffic\b|\bwatch\s+for\b",
    re.IGNORECASE,
)

# Tokens that mark the first sentence of a description as naming a road rather
# than an incident ("Jesmond Rd, in both directions" vs "Wildfire").
ROUTE_TOKEN_RE = re.compile(
    r"\b(?:rd|road|hwy|highway|street|st|ave|avenue|drive|dr|way|bridge|ferry"
    r"|route|connector|parkway|lane|trail|crescent|boulevard|blvd)\b",
    re.IGNORECASE,
)

# Sentences that describe the job or the hazard rather than the place. These
# veto ROUTE_TOKEN_RE, which would otherwise read "Bridge maintenance" as a
# road name on the strength of the word "bridge".
WORK_LABEL_RE = re.compile(
    r"\b(?:maintenance|construction|work|works|operations|paving|painting"
    r"|investigation|brushing|resurfacing|event|incident|wildfire|fire|washout"
    r"|landslide|flooding|closure|closed|delay|delays)\b",
    re.IGNORECASE,
)

DIRECTION_RE = re.compile(
    r",\s*(?:in\s+both\s+directions|northbound|southbound|eastbound|westbound)\s*$",
    re.IGNORECASE,
)


def fetch(session):
    return get_json(session, URL, params={
        "format": "json",
        "status": "ACTIVE",
        "limit": MAX_EVENTS,
    })


def road_state(roads):
    """The state of the first road entry, or None when the feed omits it."""
    for road in roads or []:
        state = road.get("state")
        if state:
            return state.strip().upper()
    return None


def classify(state, description):
    """Return 'closed' or 'restricted' for one event.

    Anything we cannot read as merely restricting travel is treated as closed.
    Telling someone a road is shut when it is only slow costs them a detour;
    the reverse can route them into a fire.
    """
    text = description or ""
    if state == "CLOSED":
        return "closed"
    if CLOSED_RE.search(text):
        return "closed"
    if RESTRICTED_RE.search(text):
        return "restricted"
    return "closed"


def is_travel_stopping(event, state):
    """Whether an event belongs on an evacuation map at all.

    Severity is the feed's own judgement of whether an event matters, and it is
    the line that keeps 200-odd paving and utility notices off the map. It is
    widened in one direction -- an explicitly closed road counts regardless of
    severity -- and narrowed for construction, which has to be both major and
    actually shut before it earns a pin.
    """
    major = event.get("severity") == "MAJOR"
    if event.get("event_type") == "CONSTRUCTION":
        return major and state == "CLOSED"
    return major or state == "CLOSED"


def road_name(roads, description):
    """A road name a driver would recognise.

    ponytail: heuristic. The feed labels most closures "Other Roads" and hides
    the real name in the first sentence of the description, so that sentence is
    used when it contains a road-ish token. `from` is the extent of the closure
    rather than the road itself, so it is only a last resort.
    """
    first = (roads or [{}])[0]
    named = (first.get("name") or "").strip()
    if named and named.lower() != GENERIC_ROUTE:
        return named

    sentence = DIRECTION_RE.sub("", (description or "").split(".")[0].strip())
    if (sentence and ROUTE_TOKEN_RE.search(sentence)
            and not WORK_LABEL_RE.search(sentence)):
        return sentence

    return (first.get("from") or "").strip() or "Road closure"


def _in_bc(geometry):
    """Whether every vertex of a Point or LineString sits inside BC."""
    kind = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if kind == "Point":
        points = [coords]
    elif kind == "LineString":
        points = coords
    else:
        return False

    west, east, south, north = BC_BBOX
    for point in points:
        if len(point) < 2:
            return False
        lon, lat = point[0], point[1]
        if not (west <= lon <= east and south <= lat <= north):
            return False
    return bool(points)


def normalize(payload):
    closures = []
    for event in payload.get("events", []):
        geometry = event.get("geography")
        if not geometry or not _in_bc(geometry):
            continue

        roads = event.get("roads") or []
        state = road_state(roads)
        if not is_travel_stopping(event, state):
            continue

        description = event.get("description") or ""
        closures.append({
            "id": event.get("id"),
            "kind": classify(state, description),
            "name": road_name(roads, description),
            # The feed's own `headline` is the event type word ("INCIDENT")
            # for every record, so it carries nothing a driver can use. The
            # description is the sentence DriveBC actually writes.
            "headline": description or event.get("headline") or "",
            "severity": event.get("severity"),
            "geometry": geometry,
            "url": event.get("url"),
            "source": "bc_roads",
        })
    return closures
