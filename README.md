# STRATA Markets — v1 implementation scaffold

An installable, responsive PWA and Python end-of-day research pipeline for Indian equities. The hosted dashboard is read-only for visitors on Cloudflare Pages; market snapshots refresh automatically on weekdays after the close via GitHub Actions, subject to workflow availability and provider data quality.

## Important boundaries

- **No AI and no live broker orders.** The Rule Bot Portfolio is a deterministic model ledger with simulated fills for evaluating the rules; it is not a real brokerage account and it is not a separate manual paper-trading workspace.
- **Demo data is illustrative, not live.** The initial dashboard is populated with synthetic examples until `data/universe.csv` is supplied and the pipeline is run successfully. Do not use demo signals to make investment decisions.
- **Market data:** `yfinance` is used as a replaceable prototype provider. It is an unofficial Yahoo Finance interface; coverage, continuity, permitted use and rate limits are not guaranteed. Validate its terms and output before unattended use.
- **Universe:** to avoid scraping an exchange website, supply a current, permitted Nifty 500 constituent CSV yourself. The importer accepts columns `Symbol` and optionally `Industry` or `Industry`/`Sector`. Symbols are converted to Yahoo `.NS` tickers.
- **Public deployment warning:** the GitHub Actions pipeline publishes generated JSON to this repository and Cloudflare Pages. Anyone with repository access can see those files. Use only non-sensitive model-portfolio settings in a public repository. For private data, run locally and do not publish snapshots.

## Quick start — dashboard

The PWA uses plain HTML/CSS/JS and no paid assets or frontend build step.

```bash
python -m http.server 8000
```

Open `http://localhost:8000/app/`. For PWA install/offline features, serve over HTTPS or localhost. The initial data is labelled `DEMO / SYNTHETIC`.

## Deploy to Cloudflare Pages (free-tier target)

The frontend is deployed to Cloudflare Pages; GitHub Actions remains the scheduled Python compute runner. This separates static hosting from data processing while avoiding an always-on server. Free-tier limits and service terms apply.

### One-time setup

1. Push this project to your GitHub repository's `main` branch.
2. In Cloudflare, create a **Pages** project named exactly `strata-markets`. Choose **Direct Upload** if prompted; deployment is driven by GitHub Actions rather than a connected Git integration.
3. Create a Cloudflare API token with permission to deploy Pages projects, and note your Cloudflare Account ID. Keep both private.
4. In GitHub → Settings → Secrets and variables → Actions, add repository secrets named `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
5. Add a current, permitted stock-universe CSV as `data/universe_source.csv`, run `python engine/import_universe.py data/universe_source.csv`, and commit the resulting `data/universe.csv`.
6. In GitHub → Actions, run **Deploy STRATA to Cloudflare Pages** once, or push a code change under `app/`. Confirm that the Cloudflare Pages URL opens the dashboard.
7. The scheduled pipeline runs on weekdays at approximately 18:15 IST. It validates the generated snapshot, commits successful outputs, and deploys the updated `app/` directory to Cloudflare Pages.

### Important

- The Pages project name must be `strata-markets` unless you also change it in both workflow files.
- Do not put Cloudflare tokens in frontend files or commit them to Git. Store them only as GitHub Actions secrets.
- The dashboard and generated snapshot are public. Do not publish private portfolio information or secrets.
- GitHub schedule timing is best-effort and can be delayed. If the pipeline fails, the previous successful deployment should remain available.
- Cloudflare Pages is used for static hosting; no user login or backend is needed for the current public, read-only dashboard.

## Set up the data pipeline

Python 3.11+ recommended.

```bash
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux:
source .venv/bin/activate
pip install -r requirements.txt
```

Place a permitted current Nifty 500 constituent CSV at `data/universe_source.csv`. The script normalises it into `data/universe.csv`:

```bash
python engine/import_universe.py data/universe_source.csv
python engine/run_pipeline.py --universe data/universe.csv --starting-capital 1000000
```

First run may take a while because historical prices and fundamentals are retrieved per provider limits. The pipeline writes `data/latest_snapshot.json`, `data/bot_state.json`, `data/run_report.json`, compressed audit snapshots under `data/history/`, and CSV exports. History is compressed and capped at the latest 252 trading sessions in the working tree. It intentionally fails closed when the universe is empty or coverage is inadequate.

## Daily automation and operational safeguards

- The hosted workflow runs automatically on weekdays at 12:45 UTC (18:15 IST). GitHub scheduling is best-effort and may be delayed; it is not a guaranteed exact-time service. GitHub may disable scheduled workflows in public repositories after 60 days without repository activity, so periodically verify the Actions status.
- There is no manual Update data control in the dashboard. The top-bar reload control only fetches the latest already-published snapshot; it does not run the pipeline. The dashboard flags snapshots older than five calendar days for investigation.
- The workflow validates the universe, checks the generated snapshot, writes a run summary, and uploads diagnostic logs for 14 days. It commits data only after the pipeline and output checks succeed, then deploys the changed snapshot to Cloudflare Pages in the same workflow run.
- If the pipeline fails, the last published snapshot remains available. Check the GitHub Actions run summary and diagnostic artifact for the failure reason.
- Before unattended use, populate `data/universe.csv` with a current, permitted universe. The repository currently ships with an empty `data/universe.csv`; automation will intentionally fail until this is configured.

## Signal and bot conventions

- Signals are deterministic and ruleset-versioned.
- `BUY` requires data quality checks, an entry score and risk gates.
- `SELL` is an exit signal only for a stock held by the model portfolio; otherwise the scanner shows `HOLD` with an optional sell/watch condition.
- `HOLD` means no action, not a recommendation that the stock is safe.
- `DATA BLOCKED` means required fields are missing or invalid; it is not an investment signal.
- A signal created after close is not filled at that same close. Pending actions are filled at the next available session open from a validated OHLCV record.
- The initial strategy thresholds are engineering defaults, not validated investment advice. Backtest with point-in-time data and realistic costs before relying on results.

## Tests

```bash
pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
```

## Structure

- `app/` — responsive PWA terminal.
- `engine/` — universe import, data provider, indicators, deterministic signals, model portfolio and pipeline.
- `data/` — demo snapshot, generated outputs and compressed rolling history.
- `.github/workflows/` — scheduled refresh and Cloudflare deployment.
- `tests/` — unit tests for indicator/signal/portfolio invariants.

## Trading rules review

See [`RULES_REVIEW.md`](RULES_REVIEW.md) for the mapping of candidate rules into STRATA, assumptions that remain unvalidated, and deferred work. Rule outputs are heuristic research signals, not probabilities or guarantees. The live yfinance pipeline has not been validated end-to-end in this environment.
