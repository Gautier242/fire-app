"""Legal forest-fire risk classification per commune, from the French state's
GASPAR register (Géorisques).

This is a LEGAL CLASSIFICATION, not a live signal. `fire_risk` True means the
commune is officially listed as exposed to forest fire, which is the fact that
triggers débroussaillement obligations. It is equally true in February.

`fire_risk` False means ONLY "not classified". It never means "safe". An
unclassified commune can still burn, and the frontend must never render False
as reassurance. Where we could not read a commune at all we emit no record,
so that "no data" stays distinguishable from "not classified".

The API is per-commune but accepts a comma-separated list. Measured 2026-07-29:
20 codes per call is the hard ceiling — 21 returns HTTP 500. Results paginate at
10 by default, so `page_size` is pinned to the batch size.
"""
import unicodedata

from build.http import get_json

URL = "https://www.georisques.gouv.fr/api/v1/gaspar/risques"

# The API rejects a 21st code with HTTP 500.
BATCH_SIZE = 20

# There are ~35,000 communes. A national sweep is a deliberate, separately
# scheduled job, never something a caller falls into by passing a long list.
MAX_COMMUNES = 2000

FIRE_RISK_LABEL = "Feu de forêt"


def _key(label):
    """Compare risk labels independently of unicode normalization form.

    The live API returns NFC today. A naive == against a hardcoded NFC string
    would report "not classified" for every commune in France the day it
    switched to NFD — a silent all-clear, which is the one failure this
    project refuses to ship.
    """
    return unicodedata.normalize("NFC", label).casefold()


FIRE_RISK_KEY = _key(FIRE_RISK_LABEL)


def fetch(session, insee_codes, cap=MAX_COMMUNES):
    """Fetch risk records for an explicit, bounded list of INSEE codes.

    Raises ValueError rather than truncating: a silently shortened sweep would
    look like a set of unclassified communes.
    """
    codes = list(insee_codes)
    if len(codes) > cap:
        raise ValueError(
            f"refusing to fetch {len(codes)} communes, cap is {cap}")

    records = []
    for start in range(0, len(codes), BATCH_SIZE):
        batch = codes[start:start + BATCH_SIZE]
        payload = get_json(session, URL, params={
            "code_insee": ",".join(batch),
            "page_size": BATCH_SIZE,
        })
        records.extend(payload.get("data") or [])
    return {"data": records}


def normalize(payload):
    records = []
    for entry in (payload.get("data") or []):
        if not isinstance(entry, dict):
            continue
        insee = entry.get("code_insee")
        detail = entry.get("risques_detail")
        if not insee or not isinstance(detail, list) or not detail:
            continue

        risks = [
            unicodedata.normalize("NFC", d["libelle_risque_long"])
            for d in detail
            if isinstance(d, dict) and isinstance(d.get("libelle_risque_long"), str)
        ]
        if not risks:
            continue

        records.append({
            "insee": insee,
            "fire_risk": any(_key(r) == FIRE_RISK_KEY for r in risks),
            "risks": risks,
            "source": "georisques",
        })
    return sorted(records, key=lambda r: r["insee"])
