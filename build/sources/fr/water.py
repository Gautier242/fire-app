"""Points d'eau incendie — where crews and Canadairs refill.

This is the one layer aimed at firefighters rather than residents, and it is the
most fragmented data in the app. DECI is a mayoral competence under a règlement
départemental, so each SDIS owns its own register by law: there is no national
authority and therefore no national dataset to wait for. A survey of data.gouv on
2026-07-29 found 21 candidate datasets, of which nine are stdlib-parseable and
reachable — 34,643 points, two complete départements, seven local patches. That
is roughly 4% of France's estimated ~800,000 PEI.

A firefighter who sees no water point must not conclude there is none, so
normalize() returns a coverage statement alongside the points and the frontend is
expected to render it. A source that yields nothing is never claimed as covered.

Two traps this module exists to survive:

  * **Lambert-93.** SDIS 64 and Grand Annecy publish `x`/`y` in EPSG:2154 beside
    WGS84 `lon`/`lat`. A six-digit easting read as a longitude lands in the Gulf
    of Guinea — the French twin of the EPSG:3978 trap the Canadian hotspots hit.
    Fields are read by name, never positionally, and every point is checked
    against the France box afterwards.
  * **Capacity that is not capacity.** Most sources publish flow rate (m³/h) and
    pipe diameter, not stored volume. Only Tarn and the Hérault DFCI set carry a
    real m³ figure, and only on ~4% of points overall. Flow is never converted:
    an unknown capacity is None, and a published 0 is also None, because sending
    a crew to a tank the map called empty is the failure that matters here.
"""
import csv
import io
import json

from build.http import TIMEOUT_SECONDS

# Metropolitan France, matching build/sources/fr/atmo.py.
LON_MIN, LON_MAX = -5.5, 10.0
LAT_MIN, LAT_MAX = 41.0, 51.5

# Tarn is 9 MB and SDIS 64 is 8.6 MB, so the cap is generous; it exists to stop a
# publisher who swaps a point layer for a national raster from eating the build.
MAX_BYTES = 25_000_000
MAX_POINTS = 50_000

# scope is the honest part: "departement" means the SDIS register for the whole
# département, "local" means one agglomération, one commune, or — for Hérault —
# only the forest-fire subset. The frontend renders this, not a hardcoded list.
SOURCES = (
    {"key": "sdis64", "dep": "64", "area": "Pyrénées-Atlantiques", "scope": "departement",
     "format": "geojson", "id": "id_sdis", "kind": "type_pei", "insee": "insee",
     "url": "https://www.pigma.org/fr/dataset/datasets/7554/resource/15478/download/"},

    {"key": "sdis81", "dep": "81", "area": "Tarn", "scope": "departement",
     "format": "geojson", "id": "numero_long", "kind": "type_hydrant",
     "insee": "commune_insee", "capacity": "volume_pa",
     "url": "https://carto-sdis81.tigeo.fr/index.php/lizmap/service?repository=public"
            "&project=PEI_Hydraclic&SERVICE=WFS&typeName=pei_hydraclic_v2"
            "&VERSION=1.3.0&REQUEST=GetFeature&OutputFormat=geojson"},

    {"key": "rennes", "dep": "35", "area": "Rennes Métropole", "scope": "local",
     "format": "geojson", "id": "id_pei_sdis", "kind": "type", "insee": "code_insee",
     "url": "https://data.rennesmetropole.fr/api/explore/v2.1/catalog/datasets"
            "/deci-pei/exports/geojson"},

    {"key": "annecy", "dep": "74", "area": "Grand Annecy", "scope": "local",
     "format": "csv", "lat": "lat", "lon": "lon", "id": "id_sdis",
     "kind": "type_pei", "insee": "insee",
     "url": "https://static.data.gouv.fr/resources/points-deau-incendie-de-"
            "lagglomeration-du-grand-annecy/20250128-081713/points-eau-incendie-2024.csv"},

    {"key": "angers", "dep": "49", "area": "Angers Loire Métropole", "scope": "local",
     "format": "geojson", "id": "num_pompier", "kind": "type", "insee": "codeinsee",
     "url": "https://data.angers.fr/api/explore/v2.1/catalog/datasets"
            "/borne-incendie-angers-loire-metropole/exports/geojson"},

    {"key": "larochelle", "dep": "17", "area": "Agglomération de La Rochelle",
     "scope": "local", "format": "csv", "latlon": "COORDINATES", "id": "PI_NUM",
     "kind": "PI_TYPE",
     "url": "https://opendata.agglo-larochelle.fr/sites/default/files/dataset/res"
            "/eau_deau_potable_poteau_dincendie/reseau_deau_potable_poteau_dincendie.csv"},

    {"key": "herault_dfci", "dep": "34", "area": "Hérault — points d'eau DFCI (forêt)",
     "scope": "local", "format": "geojson", "id": "n_eau_1", "kind": "nature",
     "capacity": "capacite",
     "url": "https://www.herault-data.fr/api/explore/v2.1/catalog/datasets/points-deau-"
            "defense-des-forets-contre-les-incendies-dfci-herault/exports/geojson"},

    {"key": "saintave", "dep": "56", "area": "Saint-Avé", "scope": "local",
     "format": "geojson",
     "url": "https://www.opendata56.fr/api/explore/v2.1/catalog/datasets"
            "/56206_poteaux_incendie_kml/exports/geojson"},

    # LAT_PEI holds the longitude and LONG_PEI the latitude. The columns are
    # mapped as published rather than trusted by name.
    {"key": "sixt", "dep": "35", "area": "Sixt-sur-Aff", "scope": "local",
     "format": "csv", "lat": "LONG_PEI", "lon": "LAT_PEI", "delimiter": ";",
     "id": "ID_PEI", "kind": "TYPE_PEI", "insee": "COLL_INSEE",
     "url": "https://static.data.gouv.fr/resources/point-deau-incendie-2018"
            "/20191127-131445/sixtsuraff-pei-2019.csv"},
)

# Two complete départements are one reachable host away: DECI - Calvados - SDIS14
# (https://data.calvados.fr/sdis/deci_pei.geojson) and Points d'Eau Incendie de la
# Seine-Maritime (https://geo.sdis76.fr/documents/opendata/deci_sdis76__8850c577-
# 4a99-45f4-b91b-e3eab62892f1.csv). Both resolve in DNS and refuse connections;
# neither is wired in, because their field names cannot be read from a dead host
# and guessing them would invent coordinates. Add them once one answers.
#
# Hérault SDIS 34 is the full register for a Mediterranean fire département and
# would be the single most valuable addition, but it ships gpkg only. That needs
# a dependency, which is the owner's call, not this module's.

# Publishers write "NULL" as a string surprisingly often.
BLANK = {"", "null", "none", "nan", "-"}

# The real vocabulary, counted across all nine sources. Longest match wins, so
# "point d'aspiration" beats nothing and "réservoir" beats "re".
WORDS = (
    ("poteau", "borne"), ("bouche", "borne"), ("borne", "borne"), ("hydrant", "borne"),
    ("citerne", "citerne"), ("réserve", "citerne"), ("reserve", "citerne"),
    ("réservoir", "citerne"), ("reservoir", "citerne"), ("bâche", "citerne"),
    ("bache", "citerne"), ("prisersv", "citerne"),
    ("aspiration", "naturel"), ("puisard", "naturel"), ("priseriv", "naturel"),
    ("plan d", "naturel"), ("cours d", "naturel"), ("naturel", "naturel"),
    ("rivière", "naturel"), ("riviere", "naturel"),
)
# Codes appear alone ("PI") or as a prefix ("BI 150", "PIN 100"), so they are
# matched against the first token only — never as a substring, which would turn
# "pistes" into a borne.
CODES = {"pi": "borne", "bi": "borne", "pin": "borne", "pibi": "borne",
         "ci": "citerne", "re": "citerne", "bs": "citerne", "res": "citerne",
         "pa": "naturel", "pena": "naturel"}


def fetch(session, max_bytes=MAX_BYTES, timeout=TIMEOUT_SECONDS):
    """Return {source key: parsed body} for the sources that answered.

    Every source is independent: two of the eleven known publishers were
    unreachable on the day this was written, and one dead host must never take
    the layer down. A source that fails is simply absent from the payload, which
    is what keeps it out of the coverage statement.
    """
    payload = {}
    for source in SOURCES:
        try:
            response = session.get(source["url"], timeout=timeout)
            response.raise_for_status()
            if len(response.content) > max_bytes:
                continue
            body = response.content.decode("utf-8-sig", errors="replace").strip()
            if not body:
                continue
            payload[source["key"]] = (
                json.loads(body) if source["format"] == "geojson" else body
            )
        except Exception:  # noqa: BLE001 - one bad source must not sink the layer
            continue
    return payload


def _text(value):
    if value is None:
        return ""
    value = str(value).strip()
    return "" if value.lower() in BLANK else value


def _number(value):
    """Accept 5.97412 and the French 5,97412. Anything else is unknown."""
    text = _text(value)
    if not text:
        return None
    try:
        return float(text.replace(",", "."))
    except ValueError:
        return None


def _kind(raw):
    """Map a publisher's wording onto borne/citerne/naturel, or None.

    None means "not recorded", and it stays None. Guessing `borne` for an
    unreadable type would tell a crew there is pressurised mains water where the
    register only says "Autre"."""
    text = _text(raw).lower()
    if not text:
        return None
    for word, kind in WORDS:
        if word in text:
            return kind
    return CODES.get(text.split()[0].strip("\"'.-"))


def _capacity(raw):
    """Stored volume in m³, or None. A published 0 is 'not recorded', not an
    empty tank, and must never render as one."""
    value = _number(raw)
    return value if value and value > 0 else None


def _dep(raw, fallback):
    """INSEE commune codes are five characters and the département is the first
    two — "2A004" for Corsica, "01001" for the Ain. Anything else falls back to
    the source's own département rather than inventing one; Tarn publishes the
    code as an integer, which drops the leading zero for départements 01-09."""
    code = _text(raw)
    return code[:2] if len(code) == 5 else fallback


def _coordinates(geometry):
    if not isinstance(geometry, dict):
        return None
    coordinates = geometry.get("coordinates")
    if geometry.get("type") == "MultiPoint":
        coordinates = coordinates[0] if coordinates else None
    if not isinstance(coordinates, (list, tuple)) or len(coordinates) < 2:
        return None
    lon, lat = _number(coordinates[0]), _number(coordinates[1])
    return None if lon is None or lat is None else (lon, lat)


def _rows(source, body):
    """Yield (properties, coordinates-or-None) pairs, whatever the format."""
    if source["format"] == "geojson":
        features = (body or {}).get("features") if isinstance(body, dict) else None
        for feature in features if isinstance(features, list) else ():
            if not isinstance(feature, dict):
                continue
            properties = feature.get("properties")
            yield (properties if isinstance(properties, dict) else {},
                   _coordinates(feature.get("geometry")))
        return

    reader = csv.DictReader(io.StringIO(body or ""),
                            delimiter=source.get("delimiter", ","))
    for row in reader:
        if source.get("latlon"):
            # La Rochelle packs "lat, lon" into one quoted column.
            parts = _text(row.get(source["latlon"])).split(",")
            pair = ((_number(parts[1]), _number(parts[0])) if len(parts) == 2
                    else (None, None))
        else:
            pair = (_number(row.get(source["lon"])), _number(row.get(source["lat"])))
        yield row, None if pair[0] is None or pair[1] is None else pair


def normalize(payload, cap=MAX_POINTS):
    points, coverage = [], []
    for source in SOURCES:
        if source["key"] not in (payload or {}):
            continue
        found = 0
        for index, (record, pair) in enumerate(_rows(source, payload[source["key"]])):
            if found >= cap:
                break
            if pair is None:
                continue
            lon, lat = pair
            # The France box is the backstop for every CRS mistake at once: a
            # Lambert-93 easting, a swapped pair no mapping caught, a stray 0/0.
            if not (LON_MIN <= lon <= LON_MAX and LAT_MIN <= lat <= LAT_MAX):
                continue
            points.append({
                "id": _text(record.get(source["id"])) if source.get("id") else "",
                "lat": round(lat, 5),
                "lon": round(lon, 5),
                "kind": _kind(record.get(source["kind"])) if source.get("kind") else None,
                "capacity_m3": _capacity(record.get(source["capacity"]))
                               if source.get("capacity") else None,
                "dep": _dep(record.get(source["insee"]) if source.get("insee") else None,
                            source["dep"]),
                "source": "pei",
            })
            # Saint-Avé publishes no identifier at all, and Grand Annecy writes
            # "NULL". Position within its own source is stable across builds.
            points[-1]["id"] = points[-1]["id"] or f"{source['key']}-{index}"
            found += 1
        if found:
            coverage.append({"dep": source["dep"], "area": source["area"],
                             "scope": source["scope"], "count": found})
    return {"points": points, "coverage": coverage}
