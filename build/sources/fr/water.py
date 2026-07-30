"""Points d'eau incendie — where crews and Canadairs refill.

This is the one layer aimed at firefighters rather than residents, and it is the
most fragmented data in the app. DECI is a mayoral competence under a règlement
départemental, so each SDIS owns its own register by law: there is no national
authority and therefore no national dataset to wait for. A survey of data.gouv on
2026-07-29 found 21 candidate datasets, of which eleven are stdlib-parseable and
reachable — 74,632 points on 2026-07-30, four complete départements, seven local
patches. That is roughly 9% of France's estimated ~800,000 PEI.

Every point and every coverage row declares `tier: "register"`. A register is
complete for the area it covers, so absence inside one carries information; a
crowd source cannot make that claim, and the two must never be added together.

A firefighter who sees no water point must not conclude there is none, so
normalize() returns a coverage statement alongside the points and the frontend is
expected to render it. A source that yields nothing is never claimed as covered.

Two traps this module exists to survive:

  * **Lambert-93.** SDIS 64 and Grand Annecy publish `x`/`y` in EPSG:2154 beside
    WGS84 `lon`/`lat`, and the Hérault GeoPackage is *entirely* in EPSG:2154. A
    six-digit easting read as a longitude lands in the Gulf of Guinea — the
    French twin of the EPSG:3978 trap the Canadian hotspots hit. Fields are read
    by name, never positionally; the GeoPackage is reprojected from the srs_id
    its own metadata declares; and every point is checked against the France box
    afterwards.
  * **Capacity that is not capacity.** Most sources publish flow rate (m³/h) and
    pipe diameter, not stored volume. Only Tarn and the Hérault DFCI set carry a
    real m³ figure, and only on ~2% of points overall. Flow is never converted:
    an unknown capacity is None, and a published 0 is also None, because sending
    a crew to a tank the map called empty is the failure that matters here.
"""
import csv
import io
import json
import math
import sqlite3
import struct
import tempfile
import warnings

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

    # A GeoPackage is a SQLite database, so this needs no dependency beyond
    # stdlib. It is published in Lambert-93 — see _gpkg_rows.
    {"key": "herault_sdis", "dep": "34", "area": "Hérault — registre SDIS 34",
     "scope": "departement", "format": "gpkg", "id": "id_sdis", "kind": "type_pei",
     "insee": "insee",
     "url": "https://static.data.gouv.fr/resources/points-deau-incendie-du-departement-"
            "de-lherault-sdis-34/20240223-133940/peis-herault-l93.gpkg"},

    # Forest-fire defence water, managed by the département rather than the SDIS.
    # A separate register, not a subset: only 3 of its 328 points sit within
    # 100 m of an SDIS one, so the two are kept side by side.
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
    # 20,694 points, the whole département. The SDIS publishes it on data.gouv
    # but hosts it on geo.sdis76.fr, which resolves to 194.53.7.100 and drops
    # every connection on 80 and 443 — measured 2026-07-29 and again 2026-07-30,
    # while data.gouv's own crawler reached it in April. Rather than lose a
    # complete register to one firewall, it is read from data.gouv's parse of
    # that same CSV resource, which serves all 20,694 rows in one request.
    {"key": "sdis76", "dep": "76", "area": "Seine-Maritime", "scope": "departement",
     "format": "csv", "x": "x_l93", "y": "y_l93", "id": "id_interne_pei",
     "kind": "type_rn", "insee": "code_insee",
     "url": "https://tabular-api.data.gouv.fr/api/resources"
            "/b685a7ca-8e96-40df-9a69-c1d6c8e37916/data/csv/"},

    {"key": "sixt", "dep": "35", "area": "Sixt-sur-Aff", "scope": "local",
     "format": "csv", "lat": "LONG_PEI", "lon": "LAT_PEI", "delimiter": ";",
     "id": "ID_PEI", "kind": "TYPE_PEI", "insee": "COLL_INSEE",
     "url": "https://static.data.gouv.fr/resources/point-deau-incendie-2018"
            "/20191127-131445/sixtsuraff-pei-2019.csv"},
)

# Two more registers were looked at on 2026-07-30 and are not here:
#
#   * DECI - Calvados - SDIS14 (https://data.calvados.fr/sdis/deci_pei.geojson)
#     still resolves in DNS and drops the connection, as on 2026-07-29. Nothing
#     mirrors it, so its field names cannot be read and guessing them would
#     invent coordinates. Add it once the host answers, or once data.gouv parses
#     a tabular copy the way it did for Seine-Maritime.
#   * PEI des Alpes-de-Haute-Provence, SDIS 04. data.gouv lists it, but its only
#     resource is an OGC *web map* service — a Lizmap instance at
#     https://www.opensis.fr/04/ whose WMS answers and whose WFS returns 403
#     "Accès interdit au service". A WMS serves rendered pixels: no identifiers,
#     no types, no coordinates. There is nothing to parse, and the portal's own
#     landing page answers HTTP 200 for every query string, so a naive fetch of
#     it would look like a success and normalize to an empty département.

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
            if source["format"] == "gpkg":
                # A SQLite file; decoding it as text would destroy it.
                if response.content:
                    payload[source["key"]] = response.content
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


# --- EPSG:2154, Lambert-93 -------------------------------------------------
# A Lambert conformal conic (2SP) on GRS80. The inverse is Snyder's, and it is
# plain arithmetic: no projection library is needed to undo it. Verified against
# Agde, Hérault — 723894.42, 6262032.84 gives 3.29510, 43.45699.
_A = 6378137.0                                  # GRS80 semi-major axis, metres
_E = math.sqrt(2 / 298.257222101 - (1 / 298.257222101) ** 2)
_LAT_0, _LON_0 = math.radians(46.5), math.radians(3.0)
_LAT_1, _LAT_2 = math.radians(44.0), math.radians(49.0)
_FALSE_EASTING, _FALSE_NORTHING = 700000.0, 6600000.0


def _conic_m(lat):
    return math.cos(lat) / math.sqrt(1 - _E * _E * math.sin(lat) ** 2)


def _conic_t(lat):
    ratio = _E * math.sin(lat)
    return math.tan(math.pi / 4 - lat / 2) / ((1 - ratio) / (1 + ratio)) ** (_E / 2)


_N = ((math.log(_conic_m(_LAT_1)) - math.log(_conic_m(_LAT_2)))
      / (math.log(_conic_t(_LAT_1)) - math.log(_conic_t(_LAT_2))))
_F = _conic_m(_LAT_1) / (_N * _conic_t(_LAT_1) ** _N)
_RHO_0 = _A * _F * _conic_t(_LAT_0) ** _N

EPSG_WGS84 = 4326
EPSG_LAMBERT93 = 2154


def lambert93_to_wgs84(x, y):
    """Metres east/north in EPSG:2154 to (lon, lat) degrees."""
    dx, dy = x - _FALSE_EASTING, _RHO_0 - (y - _FALSE_NORTHING)
    rho = math.copysign(math.hypot(dx, dy), _N)
    t = (rho / (_A * _F)) ** (1 / _N)
    lon = math.atan2(dx, dy) / _N + _LON_0
    lat = math.pi / 2 - 2 * math.atan(t)
    for _ in range(12):  # converges to well under a millimetre in five
        ratio = _E * math.sin(lat)
        lat = math.pi / 2 - 2 * math.atan(t * ((1 - ratio) / (1 + ratio)) ** (_E / 2))
    return math.degrees(lon), math.degrees(lat)


def _wkb_point(blob):
    """(x, y) out of a GeoPackage geometry blob: a GP header, then standard WKB."""
    if not isinstance(blob, (bytes, bytearray)) or len(blob) < 8 or blob[:2] != b"GP":
        return None
    flags = blob[3]
    if (flags >> 4) & 1:                        # the "empty geometry" bit
        return None
    offset = 8 + (0, 4, 6, 6, 8)[(flags >> 1) & 7] * 8      # skip the envelope
    if len(blob) < offset + 21:
        return None
    order = "<" if blob[offset] else ">"
    if struct.unpack_from(order + "I", blob, offset + 1)[0] & 0xFFFF != 1:
        return None                             # not a Point; nothing else here
    return struct.unpack_from(order + "dd", blob, offset + 5)


def _gpkg_rows(body):
    """Read every feature layer of a GeoPackage into (record, (lon, lat)) pairs.

    The projection comes from gpkg_contents rather than being assumed: the
    Hérault file is Lambert-93 today and a republication in another CRS must not
    silently become six-digit longitudes. Anything we cannot undo exactly is
    skipped with a message, because a guessed projection is a wrong location.
    """
    if not isinstance(body, (bytes, bytearray)) or not body.startswith(b"SQLite format 3\x00"):
        return []
    rows = []
    with tempfile.NamedTemporaryFile(suffix=".gpkg") as handle:
        handle.write(body)
        handle.flush()
        db = sqlite3.connect(handle.name)
        try:
            db.row_factory = sqlite3.Row
            layers = db.execute(
                "SELECT c.table_name AS name, c.srs_id AS srs, g.column_name AS geom "
                "FROM gpkg_contents c JOIN gpkg_geometry_columns g "
                "ON g.table_name = c.table_name WHERE c.data_type = 'features'"
            ).fetchall()
            for layer in layers:
                if layer["srs"] not in (EPSG_WGS84, EPSG_LAMBERT93):
                    warnings.warn(
                        f"{layer['name']}: srs_id {layer['srs']} is neither WGS84 "
                        f"({EPSG_WGS84}) nor Lambert-93 ({EPSG_LAMBERT93}); layer "
                        "skipped rather than guessing its projection")
                    continue
                quoted = layer["name"].replace('"', '""')
                for record in db.execute(f'SELECT * FROM "{quoted}"'):
                    point = _wkb_point(record[layer["geom"]])
                    if point is not None and layer["srs"] == EPSG_LAMBERT93:
                        point = lambert93_to_wgs84(*point)
                    rows.append((
                        {key: record[key] for key in record.keys() if key != layer["geom"]},
                        point,
                    ))
        except sqlite3.DatabaseError:
            return rows
        finally:
            db.close()
    return rows


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


def _geojson_rows(body):
    features = (body or {}).get("features") if isinstance(body, dict) else None
    for feature in features if isinstance(features, list) else ():
        if not isinstance(feature, dict):
            continue
        properties = feature.get("properties")
        yield (properties if isinstance(properties, dict) else {},
               _coordinates(feature.get("geometry")))


def _csv_rows(source, body):
    reader = csv.DictReader(io.StringIO(body if isinstance(body, str) else ""),
                            delimiter=source.get("delimiter", ","))
    for row in reader:
        if source.get("x"):
            # Seine-Maritime publishes no lon/lat at all, only Lambert-93 metres.
            # Reading them as degrees is the Gulf of Guinea; dropping them is a
            # département of no water. They are reprojected, and the France box
            # in normalize() is still the backstop.
            easting, northing = _number(row.get(source["x"])), _number(row.get(source["y"]))
            pair = ((None, None) if easting is None or northing is None
                    else lambert93_to_wgs84(easting, northing))
        elif source.get("latlon"):
            # La Rochelle packs "lat, lon" into one quoted column.
            parts = _text(row.get(source["latlon"])).split(",")
            pair = ((_number(parts[1]), _number(parts[0])) if len(parts) == 2
                    else (None, None))
        else:
            pair = (_number(row.get(source["lon"])), _number(row.get(source["lat"])))
        yield row, None if pair[0] is None or pair[1] is None else pair


def _rows(source, body):
    """(properties, coordinates-or-None) pairs, whatever the format.

    A dispatcher rather than a generator: _gpkg_rows returns a list, and a bare
    `return` inside a generator would quietly yield nothing at all.
    """
    if source["format"] == "gpkg":
        return _gpkg_rows(body)
    if source["format"] == "geojson":
        return _geojson_rows(body)
    return _csv_rows(source, body)


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
                # A register is complete for its area, so absence inside it means
                # something. That is exactly what a crowd source cannot claim, and
                # the tier is how the two stay separable all the way to the map
                # rather than being summed into one reassuring number.
                "tier": "register",
            })
            # Saint-Avé publishes no identifier at all, and Grand Annecy writes
            # "NULL". Position within its own source is stable across builds.
            points[-1]["id"] = points[-1]["id"] or f"{source['key']}-{index}"
            found += 1
        if found:
            coverage.append({"dep": source["dep"], "area": source["area"],
                             "scope": source["scope"], "count": found,
                             "tier": "register"})
    return {"points": points, "coverage": coverage}
