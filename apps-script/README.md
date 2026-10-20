# Apps Script backend

Plain Apps Script (V8), no bundler. Files share one global scope; names are prefixed with numbers only for readability.

| File | Responsibility |
|------|----------------|
| `00_Config.js` | constants, roles, permission matrix, worksheet schema, statuses, default settings |
| `01_Util.js` | AppError, validation helpers, responses, pagination/sort/filter |
| `02_Sheets.js` | spreadsheet access (`table()`), schema creation, settings cache, `withLock`, reference numbers |
| `03_Auth.js` | Google ID token verification, HMAC session tokens, allowlist, permissions |
| `04_Audit.js` | audit log, idempotency store, `runMutation` |
| `05_Congregations.js` … `14_Users.js` | domain modules (catalog, ledger/balances/reconcile, deliveries, requests, distributions, stock overview, reports, dashboard, users/settings) |
| `20_Api.js` | `doPost`/`doGet`, action registry, `handleRequest(body)` |
| `99_Setup.js` | `setup()`, `healthCheck()`, `rotateSessionSecret()`, legacy opening-balance import |

Deployment, Script Properties and permissions: see `../docs/DEPLOYMENT.md`.
Tests: `cd ../frontend && npm test` (the backend is executed in a fake Apps Script runtime).

Required OAuth scopes (manifest): `spreadsheets`, `script.external_request` (Google tokeninfo), `script.scriptapp`.
Ownership: the script and its deployment should be owned by `congregationliterature@gmail.com`, which must have
edit access to the spreadsheet. Nothing here stores or needs a client secret or service-account key.
