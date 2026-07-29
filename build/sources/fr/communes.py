"""The French commune list, the fallback for when address search is unavailable.

France's equivalent of `public/static/places.json`. BAN (see `public/js/geocode.js`)
is the primary way a French user finds themselves — it resolves full street
addresses live. This file is what the picker falls back on when that request
fails or the user is offline, so it must stand alone: every commune, findable by
name, with a centre good enough to place a map on.

Run manually like `tools/build_places.py`; commune boundaries and populations
change on a legal timetable, not a daily one.

Rows are positional rather than objects because the key names cost 1 MB across
35,000 communes — 2.64 MB of objects against 1.64 MB of rows. `fields` ships in
the file so nothing has to guess the column order.
"""
import json
from pathlib import Path

from build.http import get_json

URL = "https://geo.api.gouv.fr/communes"
OUT = Path("public/static/fr/communes.json")

# Everything the French sources need to join on. The INSEE code is the join key
# for Georisques (per-commune risk) and Atmo (per-commune air quality);
# `departement` is the join key for Meteo des forets, which is per-departement.
FIELDS = ["code", "nom", "departement", "lat", "lon", "population"]

# 11 m. A commune centre is a label position, not a survey mark, and the extra
# digit costs 70 KB across the file.
PRECISION = 4


def fetch(session):
    return get_json(session, URL, params={
        "fields": "nom,code,codeDepartement,centre,population",
        "format": "json",
    })


def normalize(payload):
    communes = []
    for record in payload:
        code = record.get("code")
        name = record.get("nom")
        departement = record.get("codeDepartement")
        coords = (record.get("centre") or {}).get("coordinates") or []
        if not code or not name or not departement or len(coords) != 2:
            continue
        try:
            lon, lat = float(coords[0]), float(coords[1])
        except (TypeError, ValueError):
            continue
        # Six communes upstream report no population. Ranking them last keeps
        # them searchable; dropping them would make them unfindable, which is
        # the one failure a fallback list cannot have.
        population = record.get("population") or 0
        communes.append([code, name, departement,
                         round(lat, PRECISION), round(lon, PRECISION),
                         int(population)])

    # Population descending, so typing "mar" offers Marseille before
    # Marseille-en-Beauvaisis. Name breaks ties so the build is reproducible.
    communes.sort(key=lambda c: (-c[FIELDS.index("population")], c[FIELDS.index("nom")]))
    return {"fields": FIELDS, "communes": communes}


def main():
    from build.http import make_session

    data = normalize(fetch(make_session()))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False))
    print(f"wrote {OUT} with {len(data['communes'])} communes, "
          f"{OUT.stat().st_size / 1048576:.2f} MB")


if __name__ == "__main__":
    main()
