# STRATA Markets v0.4 — Cloudflare Pages migration

- Migrated static dashboard deployment from GitHub Pages to Cloudflare Pages.
- Kept GitHub Actions as the scheduled Python data-processing runner.
- Daily workflow deploys the new snapshot to Cloudflare Pages after a validated data commit.
- Added a separate deployment workflow for frontend/code changes.
- Removed GitHub Pages deployment workflow and Pages-specific permissions.
- Added Cloudflare `_headers` rules for security headers, snapshot no-store caching, and service-worker revalidation.
- No manual data-update button, no user login, and no paid always-on server.

This is a migration-ready package, not a completed live migration. The owner must create the Cloudflare Pages project and add the two GitHub Actions secrets described in README.md. A live data-provider run and real deployment have not been performed here.
