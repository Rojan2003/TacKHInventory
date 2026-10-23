# East Congregation Literature Inventory and Distribution System

A mobile-friendly Vue 3 single-page application backed by Google Apps Script and Google Sheets.
East Congregation receives, stores and tracks literature and distributes it to the SLC, Central, West and
Tagalog congregations. The system records deliveries, congregation requests, approvals, releases, receipts
and a full stock-movement ledger, with Google Sign-In and server-side role enforcement.

> **Keep the spreadsheet Restricted.** The backend runs as the script owner, so end users never need access to
> the Google Sheet. Its sharing setting must stay *Restricted* (owner only). "Anyone with the link" exposes every
> record, the audit log and the authorized-user list to the public and bypasses every permission check in
> this system. Check it after every share dialog and after copying the sheet.

## Repository layout

| Path | What it is |
|------|------------|
| `frontend/` | The new application: Vue 3 + Vite + TypeScript + Vue Router + Pinia + Tailwind CSS v4 + Lucide icons. |
| `apps-script/` | The Google Apps Script backend (modular, V8 runtime). Deployed as a web app owned by the administrator account. |
| `frontend/src/mock/` | A fake Apps Script runtime that executes the real backend sources in Node (tests) and in the browser ("demo mode"). |
| `frontend/tests/` | Vitest backend and unit tests, Playwright end-to-end smoke tests. |
| `.github/workflows/deploy-pages.yml` | Builds, tests, secret-scans and publishes `frontend/dist` to GitHub Pages (only once Pages is switched to "GitHub Actions"). |
| `docs/` | Deployment, security, data model and testing documentation. |

## Quick start (no Google account needed)

```bash
cd frontend
npm install
npm run dev          # uses frontend/.env.local -> VITE_API_MODE=mock
```

Open the printed URL and pick one of the demo accounts. In demo mode the real backend code runs inside
the browser against an in-memory spreadsheet persisted to `localStorage`; nothing touches Google.

## Running against the real backend

1. Follow `docs/DEPLOYMENT.md` to create the OAuth client, deploy the Apps Script and configure Script Properties.
2. Copy `frontend/.env.example` to `frontend/.env.local` and set `VITE_API_MODE=http`, `VITE_API_BASE_URL` and `VITE_GOOGLE_CLIENT_ID`.
   Both values are public identifiers; they are compiled into the browser bundle. No secret is ever placed in the frontend.
3. `npm run dev`, or `npm run build` for the production bundle in `frontend/dist`.

## Commands (run inside `frontend/`)

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck (`vue-tsc`) + production build |
| `npm test` | Vitest: backend rules (via the fake Apps Script runtime) + frontend unit tests |
| `npm run test:e2e` | Playwright smoke tests on desktop, tablet and mobile viewports (mock mode) |
| `npm run secrets:scan` | Scan the repository for credential patterns (also run against `dist` in CI) |

## Architecture in one paragraph

The browser obtains a Google ID token with Google Identity Services, sends it to the Apps Script web app,
which verifies it with Google, checks the `AuthorizedUsers` worksheet and returns an HMAC-signed session
token. Every later call is a `text/plain` POST carrying that token; the backend re-authenticates, enforces
the role matrix, runs stock-mutating actions under a script lock with client request IDs for idempotency,
writes an append-only ledger (`InventoryTransactions`) that is the source of truth for physical stock, and
keeps `InventoryBalances` as a cache that can be rebuilt by the reconcile routine. The two pre-existing
worksheets (`East_Inventory`, `Distribution`) are never written.

See `docs/DATA_MODEL.md`, `docs/SECURITY.md`, `docs/TESTING.md` and `docs/DEPLOYMENT.md`.
