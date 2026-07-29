"""Météo des forêts — the official French forest-fire danger forecast.

Météo-France publishes one danger level per métropolitain département for today
and tomorrow, updated daily around 14:50 UTC. This is the French front page:
France has no evacuation feed, so the prevention forecast is the headline.

The file behind URL is the archive for the *whole season* — every département,
every day since late May — so normalize() keeps only the most recent date in it.
"""
import csv
import gzip

from build.http import TIMEOUT_SECONDS

# The year is embedded in the filename: this needs bumping each January, or
# replacing with a data.gouv.fr API lookup for the "mdf.<year>" resource of
# dataset "Archives de la Météo des forêts".
URL = "https://meteofrance.s3.sbg.io.cloud.ovh.net/data/BULLETIN/MDF/mdf_2026.csv.gz"

# The four official levels, as Météo-France names them on meteofrance.com/meteo-des-forets.
# Wording is theirs, not ours — the app must not paraphrase a danger level.
LEVEL_LABELS = {
    1: {"colour": "vert", "fr": "Risque faible"},
    2: {"colour": "jaune", "fr": "Risque modéré"},
    3: {"colour": "orange", "fr": "Risque élevé"},
    4: {"colour": "rouge", "fr": "Risque très élevé"},
}


def fetch(session):
    response = session.get(URL, timeout=TIMEOUT_SECONDS)
    response.raise_for_status()
    return gzip.decompress(response.content).decode("utf-8")


def _level(raw):
    """A level we cannot read is unknown. Never fall back to 1 — that would
    invent reassurance on the day the forecast is missing."""
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None
    return value if value in LEVEL_LABELS else None


FIELDS = ("date", "num_dep", "niveau_j1", "niveau_j2", "nom_dep")


def normalize(payload):
    rows = []
    for row in csv.DictReader((payload or "").splitlines(), delimiter=";"):
        # A truncated row is malformed and gets dropped. DictReader leaves an
        # absent column as None, which is what separates it from a column that
        # is present but empty — the latter is a genuine "level unknown".
        if any(row.get(field) is None for field in FIELDS):
            continue
        # Département codes are strings: "01" must not become 1, and Corsica is
        # "2A"/"2B". Never int() them.
        dep = (row.get("num_dep") or "").strip()
        issued_at = (row.get("date") or "").strip()
        if not dep or not issued_at:
            continue
        rows.append({
            "dep": dep,
            "name": (row.get("nom_dep") or "").strip(),
            "level_today": _level(row.get("niveau_j1")),
            "level_tomorrow": _level(row.get("niveau_j2")),
            "issued_at": issued_at,
            "source": "mdf",
        })

    if not rows:
        return []
    latest = max(row["issued_at"] for row in rows)
    return sorted((r for r in rows if r["issued_at"] == latest), key=lambda r: r["dep"])
