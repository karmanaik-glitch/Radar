# STRATA Markets v0.3 — Daily Automation & Reliability

## User-facing changes
- Removed the manual **Update data** button and the hosted workflow-dispatch interaction.
- Kept the lightweight reload control; it reloads the latest published snapshot only.
- Added snapshot age awareness: the dashboard warns when a non-demo snapshot is older than five calendar days.
- The header now shows a more informative last-run timestamp.

## Automation and operations
- Daily end-of-day workflow runs weekdays at approximately 18:15 IST.
- The workflow validates the universe before downloading data and validates the generated snapshot before publication.
- The workflow produces a GitHub Actions summary and retains diagnostic artifacts for 14 days.
- The successful snapshot is deployed by the same workflow, avoiding reliance on a push made with `GITHUB_TOKEN` to trigger another workflow.
- Daily workflow has no manual dispatch trigger; the scheduled workflow is the standard refresh path.
- The static preview launchers no longer start a local update API.

## Data and repository hygiene
- Added pipeline run IDs for traceability.
- Daily audit snapshots are gzip-compressed and capped at the latest 252 sessions in the working tree.
- Kept the last published snapshot in place if the scheduled pipeline or output validation fails.

## Validation
- 12 Python unit tests pass.
- Python compilation passes.
- `node --check app/app.js` passes.
- Workflow shell blocks pass `bash -n` syntax checks.
- No live provider run or GitHub Pages deployment was performed in this environment.

## Required before live automation
- Add a current, permitted symbol universe to `data/universe.csv`; it is intentionally empty in this package.
- Confirm GitHub Pages uses GitHub Actions as its source and that repository Actions are enabled.
- Confirm that the selected data provider's availability and terms are suitable for the intended use.
