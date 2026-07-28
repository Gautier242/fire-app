"""Declares what we ingest and, crucially, what we do not cover.

The frontend reads `coverage` from summary.json to decide whether it is allowed
to say "no evacuation near you". Adding a province means adding a source module
and flipping a flag here — no UI change.
"""

SOURCES = [
    {"id": "aqhi", "label": "Environment and Climate Change Canada — Air Quality Health Index"},
    {"id": "bc_evac", "label": "BC Evacuation Orders and Alerts"},
    {"id": "bc_fires", "label": "BC Wildfire Service — Active Fires"},
    {"id": "cwfis_perimeters", "label": "CWFIS — Estimated Fire Perimeters"},
]

PROVINCES = [
    {"province": "AB", "named_fires": False, "evacuations": False,
     "official_url": "https://www.alberta.ca/wildfire-status"},
    {"province": "BC", "named_fires": True, "evacuations": True,
     "official_url": "https://wildfiresituation.nrs.gov.bc.ca/"},
    {"province": "MB", "named_fires": False, "evacuations": False,
     "official_url": "https://www.gov.mb.ca/wildfire/"},
    {"province": "NB", "named_fires": False, "evacuations": False,
     "official_url": "https://www.gnb.ca/en/emergency/fire-watch.html"},
    {"province": "NL", "named_fires": False, "evacuations": False,
     "official_url": "https://www.gov.nl.ca/ffa/public-education/forestry/forest-fires/"},
    {"province": "NS", "named_fires": False, "evacuations": False,
     "official_url": "https://novascotia.ca/burnsafe/"},
    {"province": "NT", "named_fires": False, "evacuations": False,
     "official_url": "https://www.nwtfire.com/"},
    {"province": "NU", "named_fires": False, "evacuations": False,
     "official_url": "https://www.gov.nu.ca/en/public-safety-and-emergencies/nunavut-emergency-management"},
    {"province": "ON", "named_fires": False, "evacuations": False,
     "official_url": "https://www.ontario.ca/page/forest-fires"},
    {"province": "PE", "named_fires": False, "evacuations": False,
     "official_url": "https://www.princeedwardisland.ca/en/topic/emergency-measures"},
    {"province": "QC", "named_fires": False, "evacuations": False,
     "official_url": "https://sopfeu.qc.ca/"},
    {"province": "SK", "named_fires": False, "evacuations": False,
     "official_url": "https://www.saskpublicsafety.ca/emergencies-and-response/active-wildfires"},
    {"province": "YT", "named_fires": False, "evacuations": False,
     "official_url": "https://yukon.ca/en/wildfire-information"},
]


def coverage_payload():
    return [dict(p) for p in PROVINCES]
