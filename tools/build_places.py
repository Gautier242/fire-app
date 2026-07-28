"""Build the community list used when a user declines browser geolocation.

Source is the Canadian Geographical Names database, filtered to populated
places. Run manually; the upstream file is regenerated weekly but names change
slowly.
"""
import csv
import io
import json
import zipfile
from pathlib import Path

from build.http import make_session

URL = ("https://ftp.maps.canada.ca/pub/nrcan_rncan/vector/geobase_cgn_toponyme/"
       "prov_csv_eng/cgn_canada_csv_eng.zip")
OUT = Path("public/static/places.json")

# Categories worth searching. Reserves are filed under Administrative Area
# rather than Populated Place, and they are exactly the remote communities
# most often placed under evacuation order, so both categories are read.
CATEGORIES = {"Populated Place", "Administrative Area"}

# Generic Term values that name somewhere a person lives and would type into
# the search box. Excludes railway points, post offices, industrial parks,
# transit stations and anything marked former, abandoned or seasonal.
WANTED = {
    "City", "Town", "Village", "Hamlet", "Municipality", "Community",
    "Locality", "Named Locality", "Settlement",
    "Dispersed Rural Community", "Compact Rural Community", "Rural Community",
    "Urban Community", "Suburban Community", "Recreational Community",
    "Neighbourhood", "Residential Area", "Borough",
    "Organized Hamlet", "Northern Hamlet", "Northern Community",
    "Northern Settlement", "Northern Village", "Northern Village Municipality",
    "Local Urban District", "Parish Municipality", "District Municipality",
    "Township Municipality", "United Townships Municipality",
    "Village Municipality", "Separated Town", "Summer Village",
    "Resort Village", "Police Village", "Rural Village", "Forest Village",
    "Resort Municipality", "Mountain Resort Municipality", "Townsite",
    "Charter Community", "Community Government", "Regional Government",
    "Metropolitan Community Territory",
    "First Nation Village", "Cree Village", "Cree Village Municipality",
    "Naskapi Village", "Naskapi Village Municipality",
    "Metis Settlement", "Amerindian Settlement",
    "Indian Reserve", "First Nation Administrative Location",
}

# The CSV spells provinces out; the app keys coverage off two-letter codes and
# a name that does not map is dropped rather than guessed at.
PROVINCES = {
    "Alberta": "AB",
    "British Columbia": "BC",
    "Manitoba": "MB",
    "New Brunswick": "NB",
    "Newfoundland and Labrador": "NL",
    "Northwest Territories": "NT",
    "Nova Scotia": "NS",
    "Nunavut": "NU",
    "Ontario": "ON",
    "Prince Edward Island": "PE",
    "Quebec": "QC",
    "Saskatchewan": "SK",
    "Yukon": "YT",
}


# "Relevance at Scale" is the smallest-scale map the gazetteer draws the name
# on, as a denominator: Toronto and Yellowknife are 30000000 (legible on a map
# of the whole country), Kamloops and Vancouver 17500000, Kamsack 7500000,
# Kamarsuk 1200000. So a LARGER denominator means a MORE prominent place, and
# the 216853 rows sitting at the 50000 floor are the long tail of named
# specks. A row without a usable value sorts last rather than being dropped —
# a place missing from the picker cannot be searched for at all.
def scale_of(row):
    try:
        return int(row["Relevance at Scale"])
    except (KeyError, TypeError, ValueError):
        return 0


def main():
    response = make_session().get(URL, timeout=180)
    response.raise_for_status()

    archive = zipfile.ZipFile(io.BytesIO(response.content))
    name = next(n for n in archive.namelist() if n.lower().endswith(".csv"))
    rows = csv.DictReader(io.TextIOWrapper(archive.open(name), encoding="utf-8-sig"))

    places = []
    seen = set()
    for row in rows:
        if row.get("Generic Category") not in CATEGORIES:
            continue
        if row.get("Generic Term") not in WANTED:
            continue
        province = PROVINCES.get(row.get("Province - Territory", ""))
        if not province:
            continue
        try:
            lat, lon = float(row["Latitude"]), float(row["Longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        place = {
            "n": row["Geographical Name"],
            "p": province,
            "lat": round(lat, 4),
            "lon": round(lon, 4),
            "scale": scale_of(row),
        }
        # The same place recurs once per language it is named in.
        key = (place["n"], place["p"], place["lat"], place["lon"])
        if key in seen:
            continue
        seen.add(key)
        places.append(place)

    # Collapse the scale denominators to a dense 0-based rank so the key costs
    # one or two digits per place rather than eight.
    ranks = {s: i for i, s in enumerate(sorted({p["scale"] for p in places}, reverse=True))}
    for place in places:
        place["r"] = ranks[place.pop("scale")]

    # Rank first, so the file reads most-prominent-first and a truncated read
    # still holds the places anyone is most likely to be searching for.
    places.sort(key=lambda p: (p["r"], p["n"], p["p"]))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(places, separators=(",", ":"), ensure_ascii=False))
    print(f"wrote {OUT} with {len(places)} places")


if __name__ == "__main__":
    main()
