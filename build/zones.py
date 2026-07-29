"""Which places get pre-built hyper-local detail.

Two ways in. The site owner pins a region in zones.json because they care about
it whether or not it is burning today, and anywhere reaching a high Meteo des
forets level is picked up automatically so a fire somewhere nobody thought about
still gets detail.

Everywhere else still works: the browser fetches its own area live. A zone is an
optimisation, never a precondition for coverage.
"""
import json

DEFAULTS = {"auto_danger_min": 3, "radius_km": 50, "max_zones": 6, "always": []}


def load_config(path):
    """Read the config, falling back to defaults it cannot be read.

    A missing or broken config must not stop detail being built where it is
    burning, so the danger threshold survives on its own.
    """
    config = dict(DEFAULTS)
    try:
        loaded = json.loads(path.read_text())
    except (OSError, ValueError):
        return config
    if isinstance(loaded, dict):
        for key in DEFAULTS:
            if key in loaded:
                config[key] = loaded[key]
    return config


def active_zones(config, danger_rows):
    """Today's pre-build list: pinned zones first, then high-danger departements."""
    radius = int(config.get("radius_km") or DEFAULTS["radius_km"])
    zones, seen = [], set()

    for entry in config.get("always") or []:
        if entry.get("lat") is None or entry.get("lon") is None:
            continue
        zone_id = str(entry.get("id") or "").strip()
        if not zone_id or zone_id in seen:
            continue
        seen.add(zone_id)
        zones.append({"id": zone_id, "label": entry.get("label") or zone_id,
                      "lat": float(entry["lat"]), "lon": float(entry["lon"]),
                      "radius_km": int(entry.get("radius_km") or radius),
                      "reason": "config"})

    threshold = int(config.get("auto_danger_min") or DEFAULTS["auto_danger_min"])

    # Worst first. The cap truncates, so ordering decides which departements get
    # detail: taking the bulletin's own order would hand a slot to a level-3
    # departement while a level-4 one beside it got none.
    def severity(row):
        levels = [v for v in (row.get("level_today"), row.get("level_tomorrow"))
                  if isinstance(v, int)]
        return max(levels) if levels else 0

    for row in sorted(danger_rows or [], key=severity, reverse=True):
        # Tomorrow counts as well as today: detail has to exist before the fire,
        # not after it.
        levels = [row.get("level_today"), row.get("level_tomorrow")]
        if not any(isinstance(v, int) and v >= threshold for v in levels):
            continue
        if row.get("lat") is None or row.get("lon") is None:
            continue  # a departement we cannot place cannot be a zone
        zone_id = f"dep-{row['dep']}"
        if zone_id in seen:
            continue
        seen.add(zone_id)
        zones.append({"id": zone_id, "label": row.get("name") or zone_id,
                      "lat": float(row["lat"]), "lon": float(row["lon"]),
                      "radius_km": radius, "reason": "danger"})

    # Every zone is a full set of fetches on a 30-minute cron. Cap it.
    return zones[:int(config.get("max_zones") or DEFAULTS["max_zones"])]
