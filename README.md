# Fire Near Me

Is there a fire near me? A plain-language wildfire, evacuation, and air quality
page for Canada, in English and French.

Static site. No server, no database. A GitHub Actions cron rebuilds the data
every 10 minutes and deploys to Cloudflare Pages.

## Develop

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m build.main --out public/data   # build the data files
python3 -m http.server -d public 8000              # serve the site
```

## Test

```bash
.venv/bin/pytest -q      # build pipeline
node --test tests-js/*.js    # frontend logic
```

## Design

See `docs/specs/2026-07-28-fire-near-me-design.md` for the design and
`docs/plans/2026-07-28-fire-near-me.md` for the implementation plan.
