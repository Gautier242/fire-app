"""The Gironde departement's own crisis feeds: closed roads, evacuated communes,
burned ground.

The departement publishes these behind public ArcGIS FeatureServers, `access:
public`, no token and no licence restriction, refreshed every 60 seconds during an
incident. This is a documented REST API rather than a page to scrape, which is why
it is here at all: the Google boundary layer was rejected because scraping it
breaks its terms and fails silently, and neither objection applies to a public
FeatureServer.

Three things this fixes that nothing else could.

- **Closed roads with a cause, as lines.** Bison Fute publishes points on the
  reseau routier national and returned ZERO closures in Gironde or Landes while 17
  fires burned there. This returns 236 closed roads carrying
  `cause_de_la_fermeture: Incendie` and the fire's name, as LineStrings -- the
  stretch that is shut rather than a dot somewhere on it.

- **Evacuated communes.** Every earlier spec in this repo states that France has no
  evacuation feed because orders go out over FR-Alert. That is true nationally and
  false here: the departement publishes which communes are evacuated, with commune
  polygons and INSEE codes. The claim needed retiring, not repeating.

- **An official burn perimeter.** 405 km2 for the Saumos fire, mapped by the service
  fighting it. build/fire_boundary.py computes a convex hull as a substitute for
  exactly this, and where the real thing exists it wins on every axis -- authored by
  the responders, concave where the fire is concave, and observed rather than
  modelled, so it carries no validated=false caveat.

The risk this module accepts, stated plainly: it is one departement, it exists
because that departement is burning, and it may be withdrawn when the fire ends. So
"we could not ask" and "nothing is shut" must stay distinguishable all the way to
the interface. A failed fetch that renders as an empty road layer tells a reader the
roads are open when we have no idea.
"""
from build.http import get_json
from build.simplify import rdp, simplify_polygons

BASE = "https://services2.arcgis.com/PnKR0J5kVXt842jE/arcgis/rest/services"

# The four road sub-layers of the departement's "Information routiere" group. RD
# fermees are departementales, the rest communal and other roads; both are kept
# because a reader does not care who owns the tarmac.
ROAD_LAYERS = (f"{BASE}/ec_agol_vue/FeatureServer/3",
               f"{BASE}/ec_agol_vue/FeatureServer/2")
DETOUR_LAYER = f"{BASE}/ec_agol_vue/FeatureServer/1"
EVAC_LAYER = f"{BASE}/communes_evacuees/FeatureServer/0"
# Dated in its own name, so a new fire means a new layer rather than an update.
BURN_LAYER = f"{BASE}/emprise_27_07_26/FeatureServer/0"

# Today's counts on a live incident were 24 + 212 roads and 20 communes. The cap is
# generous against that and exists because those are today's numbers, not a limit.
MAX_FEATURES = 600

# ArcGIS's own field names, kept verbatim so a reader of this module can find them
# in the service's metadata.
F_ROAD = "voie_designation"
F_CAUSE = "evenements_de_crise_cause_de_la_fermeture"
F_KIND = "evenements_de_crise_fermeture"
F_LABEL = "evenements_de_crise_libelle"
F_START = "evenements_de_crise_date_heure_de_debut_de_fermeture"
F_REOPEN = "evenements_de_crise_date_heure_de_reouverture"

_QUERY = {"where": "1=1", "outFields": "*", "outSR": "4326", "f": "geojson"}

# Roughly 25 m at this latitude. The raw payload is 1.4 MB -- 20,795 closure
# vertices and 17,786 commune vertices -- which is too much to hand a phone during
# an evacuation. 25 m keeps a road recognisably on its own alignment: the failure to
# avoid is a closure straightened into a line that crosses a different street, so
# the tolerance is well below the gap between neighbouring roads. Ring collapse is
# handled by simplify_polygons, which keeps a ring at full resolution rather than
# lose it -- the Kilgard Road lesson, where four addresses under an evacuation order
# disappeared at a 55 m tolerance.
SIMPLIFY_DEG = 0.00025
PRECISION = 5


def _round(points):
    return [[round(x, PRECISION), round(y, PRECISION)] for x, y in points]


def _simplify_line(geometry):
    """Thin a closed road without shortening it.

    The endpoints are where the closure begins and ends, and rdp preserves them by
    construction. A line reduced below two positions would stop being drawable, so
    it is kept whole instead.
    """
    kind = geometry.get("type")
    if kind == "LineString":
        source = [(p[0], p[1]) for p in geometry["coordinates"]]
        reduced = rdp(source, SIMPLIFY_DEG)
        if len(reduced) < 2:
            reduced = source
        return {"type": kind, "coordinates": _round(reduced)}
    if kind == "MultiLineString":
        parts = []
        for line in geometry["coordinates"]:
            source = [(p[0], p[1]) for p in line]
            reduced = rdp(source, SIMPLIFY_DEG)
            parts.append(_round(reduced if len(reduced) >= 2 else source))
        return {"type": kind, "coordinates": parts}
    return geometry


def _simplify_area(geometry):
    kind = geometry.get("type")
    if kind == "Polygon":
        rings = simplify_polygons([geometry["coordinates"]], SIMPLIFY_DEG, PRECISION)
        return {"type": kind, "coordinates": rings[0]}
    if kind == "MultiPolygon":
        return {"type": kind,
                "coordinates": simplify_polygons(geometry["coordinates"],
                                                 SIMPLIFY_DEG, PRECISION)}
    return geometry


def fetch(session, cap=MAX_FEATURES):
    """Every layer, each failing on its own.

    One dict per concern rather than one merged fetch: an evacuation order must
    survive a road layer being down, so a failure cannot be allowed to propagate
    across concerns.
    """
    params = dict(_QUERY, resultRecordCount=cap)
    out = {}

    roads = []
    road_ok = False
    for url in ROAD_LAYERS:
        try:
            payload = get_json(session, f"{url}/query", params=params)
            roads.extend(payload.get("features") or [])
            road_ok = True
        except Exception:  # noqa: BLE001 - one sub-layer must not lose the other
            continue
    out["roads"] = {"features": roads} if road_ok else None

    for key, url in (("detours", DETOUR_LAYER),
                     ("evacuations", EVAC_LAYER),
                     ("burn", BURN_LAYER)):
        try:
            out[key] = get_json(session, f"{url}/query", params=params)
        except Exception:  # noqa: BLE001 - a missing layer is not a missing map
            out[key] = None
    return out


def _iso(stamp):
    """ArcGIS writes "2026-07-24+02:00": a date, then a UTC offset, no time.

    Returned as the date alone. Inventing a time of day from an offset would be a
    fabricated value, and the only thing this is used for is comparing days.
    """
    if not stamp or not isinstance(stamp, str):
        return None
    return stamp.split("+")[0].split("T")[0] or None


def _has_geometry(geometry):
    return bool(geometry and geometry.get("coordinates"))


def _closure(feature, now_day):
    properties = feature.get("properties") or {}
    geometry = feature.get("geometry")
    if not _has_geometry(geometry):
        # No line means nothing to draw, and a closure drawn at [0, 0] is worse
        # than one missing: it puts a shut road in the Gulf of Guinea.
        return None

    reopened = _iso(properties.get(F_REOPEN))
    if reopened and reopened < now_day:
        return None

    cause = (properties.get(F_CAUSE) or "").strip()
    return {
        "id": f"gironde-{properties.get('OBJECTID')}",
        "road": (properties.get(F_ROAD) or "").strip() or None,
        "cause": cause or None,
        # Marked, not filtered. A shut road matters whatever shut it, but a layer
        # that treated every closure as a fire closure would let roadworks imply a
        # fire -- the mirror of the defect this module exists to fix.
        "fire_related": cause.lower().startswith("incendie"),
        "kind": (properties.get(F_KIND) or "").strip() or None,
        "incident": (properties.get(F_LABEL) or "").strip() or None,
        "since": _iso(properties.get(F_START)),
        "geometry": _simplify_line(geometry),
        "source": "gironde",
    }


def _commune(feature):
    properties = feature.get("properties") or {}
    geometry = feature.get("geometry")
    if not _has_geometry(geometry):
        return None
    insee = str(properties.get("code_insee") or "").strip()
    if not insee:
        return None
    return {
        "name": (properties.get("nom") or "").strip() or None,
        "insee": insee,
        # From the INSEE code, never a postcode: Ajaccio's 20xxx would give "20",
        # which is not a departement.
        "dep": insee[:2],
        "status": (properties.get("statut") or "").strip() or None,
        "geometry": _simplify_area(geometry),
        "source": "gironde",
    }


def normalize(payload, now, cap=MAX_FEATURES):
    """The departement's crisis picture, or an honest statement that we lack one.

    `available` false means the fetch failed. It is not the same as empty lists,
    and the interface must not render it as one: empty means the departement says
    nothing is shut, unavailable means we could not ask.
    """
    now_day = (now or "")[:10]
    out = {
        "source": "Département de la Gironde",
        # Said in the payload so the interface can say it too. A reader in Landes
        # must never read an empty Gironde layer as calm.
        "covers": ["33"],
        "available": payload is not None,
        "layers": {},
        "closures": [],
        "detours": [],
        "evacuations": [],
        "burn_area": None,
        "truncated": False,
    }
    if payload is None:
        return out

    for key in ("roads", "detours", "evacuations", "burn"):
        out["layers"][key] = payload.get(key) is not None

    roads = ((payload.get("roads") or {}).get("features")) or []
    closures = [c for c in (_closure(f, now_day) for f in roads) if c]
    if len(closures) > cap:
        out["truncated"] = True
        # Fire closures first, so a cap can never drop the ones that matter most.
        closures.sort(key=lambda c: not c["fire_related"])
        closures = closures[:cap]
    out["closures"] = closures

    for feature in ((payload.get("detours") or {}).get("features")) or []:
        if _has_geometry(feature.get("geometry")):
            properties = feature.get("properties") or {}
            out["detours"].append({
                "id": f"gironde-dev-{properties.get('OBJECTID')}",
                "road": (properties.get(F_ROAD) or "").strip() or None,
                "incident": (properties.get(F_LABEL) or "").strip() or None,
                "geometry": _simplify_line(feature["geometry"]),
                "source": "gironde",
            })

    communes = ((payload.get("evacuations") or {}).get("features")) or []
    out["evacuations"] = [c for c in (_commune(f) for f in communes) if c][:cap]

    burn = ((payload.get("burn") or {}).get("features")) or []
    if burn and _has_geometry(burn[0].get("geometry")):
        area = (burn[0].get("properties") or {}).get("Shape_Area")
        out["burn_area"] = {
            # Observed, not modelled. The convex hull in build/fire_boundary.py
            # carries validated=false and draws dashed; this was mapped by the
            # service fighting the fire, so it has nothing to validate and draws
            # solid. A reader must be able to tell which one they are looking at.
            "observed": True,
            "area_km2": round(area / 1e6, 1) if isinstance(area, (int, float)) else None,
            "geometry": _simplify_area(burn[0]["geometry"]),
            "source": "gironde",
        }
    return out
