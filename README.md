# Fire Near Me

[![build](https://github.com/Gautier242/fire-app/actions/workflows/build.yml/badge.svg)](https://github.com/Gautier242/fire-app/actions/workflows/build.yml)

Is there a fire near me? A plain-language wildfire, evacuation, and air quality
page for Canada, in English and French.

Static site. No server, no database. Live at
<https://gautier242.github.io/fire-app/>.

## Data sources

| Source | What it provides |
| --- | --- |
| [CWFIS](https://cwfis.cfs.nrcan.gc.ca/geoserver/ows) (Canadian Wildland Fire Information System) | National estimated fire perimeters |
| [BC Wildfire Service](https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/) | Named active fires in British Columbia |
| [Province of BC](https://services6.arcgis.com/ubm4tcTYICKBpist/arcgis/rest/services/) | Evacuation orders and alerts |
| [ECCC](https://api.weather.gc.ca/collections/aqhi-observations-realtime/items) (Environment and Climate Change Canada) | Air Quality Health Index observations |

## Run locally

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m build.main --out public/data   # build the data files
python3 -m http.server -d public 8000              # serve the site
```

```bash
.venv/bin/pytest -q          # build pipeline
node --test tests-js/*.js    # frontend logic
```

## How the build works

`.github/workflows/build.yml` runs every 30 minutes. It fetches all four
sources, merges them into a single `public/data/summary.json`, and publishes
`public/` to GitHub Pages.

`public/data/` is gitignored on purpose — generated data is never committed.
Each run first downloads the currently published `summary.json` so that a
source which fails keeps its last good data, flagged stale with its real age;
the frontend uses that flag to decide what it is allowed to claim. If a source
fails *and* has no previous data to fall back on, the workflow refuses to
deploy rather than publish a map that looks all-clear, and the last good
deployment keeps serving.

## Design

See `docs/specs/2026-07-28-fire-near-me-design.md` for the design and
`docs/plans/2026-07-28-fire-near-me.md` for the implementation plan.
