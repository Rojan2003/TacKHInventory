# Deployment guide

Everything below is manual and must be done by a human with the right accounts. Nothing in this repository
deploys itself, and no step here was executed by the automated build. Use a **copy** of the spreadsheet for a
test environment first (step 7) and only then point production at the real spreadsheet.

## 1. Google Cloud project and OAuth client (public client ID only)

1. Sign in to https://console.cloud.google.com as `congregationliterature@gmail.com` and create a project
   (e.g. "East Literature Inventory").
2. APIs & Services → OAuth consent screen: External, app name "East Congregation Literature Inventory",
   support email the admin account, scopes: none beyond the defaults (`openid`, `email`, `profile`).
   Publish the app (or add every user as a test user while in Testing mode).
3. APIs & Services → Credentials → Create credentials → **OAuth client ID** → type **Web application**.
   - Authorized JavaScript origins:
     - `https://rojan2003.github.io` (default Pages host)
     - `https://<your-custom-domain>` once configured
     - `http://localhost:5173` for local development
   - Authorized redirect URIs: none are needed for the Google Sign-In button in popup mode.
4. Copy the **Client ID** (`…apps.googleusercontent.com`). It is a public identifier.
   **Do not download or use the client secret anywhere in this project.** The frontend flow never needs it.

## 2. Spreadsheet sharing (fix the current exposure)

The production spreadsheet is currently readable by anyone with the link. The backend runs as the script
owner, so end users never need direct access.

1. Open the spreadsheet → Share → General access → **Restricted**.
2. Share with editor access only to the administrator account (and any staff who maintain it by hand).
3. Make a dated copy as a backup before anything else (File → Make a copy). Version history remains available.

## 3. Apps Script backend

1. Signed in as `congregationliterature@gmail.com`, open https://script.google.com → New project, name it
   "East Literature Inventory API". (A standalone script is recommended so the spreadsheet can be changed via
   the `SPREADSHEET_ID` property; a container-bound script also works.)
2. Add the files from `apps-script/src/` (same names, `.gs` or `.js`) and replace the manifest with
   `apps-script/appsscript.json` (View → Show manifest file). With clasp:
   ```bash
   npm i -g @google/clasp
   clasp login                       # creates ~/.clasprc.json – never commit it
   cd apps-script && cp .clasp.json.example .clasp.json   # fill in scriptId; .clasp.json is git-ignored
   clasp push
   ```
3. Project Settings → Script Properties:
   | Property | Value |
   |----------|-------|
   | `GOOGLE_CLIENT_ID` | the client ID from step 1 |
   | `SPREADSHEET_ID` | (optional) overrides the default production ID; use a copy for testing |
   | `ENVIRONMENT` | `test` or `production` (informational) |
4. In the editor select `setup` and Run. Grant the requested permissions (Sheets, external requests).
   `setup()` creates the new worksheets and columns, generates `SESSION_SECRET`, seeds the five
   congregations, default settings and the initial administrator. Run `healthCheck` to verify.
5. Deploy → New deployment → type **Web app**:
   - Description: v1
   - Execute as: **Me** (the admin account; the script needs the owner's spreadsheet access)
   - Who has access: **Anyone** (required for cross-origin calls from GitHub Pages; every action except
     `health` and `auth.login` still requires a valid session token, and `auth.login` requires a Google-verified
     identity that is on the allowlist)
   Copy the Web app URL ending in `/exec`. It is public; put it in `VITE_API_BASE_URL`.
6. Smoke test:
   ```bash
   curl -s "https://script.google.com/macros/s/<deployment-id>/exec"          # {"success":true,"data":{"service":...}}
   curl -s -X POST -H "Content-Type: text/plain" -d '{"action":"items.list"}' "https://script.google.com/macros/s/<deployment-id>/exec"
   # -> {"success":false,"error":{"code":"UNAUTHENTICATED",...}}
   ```
7. Every code change needs **Deploy → Manage deployments → Edit → New version** (or `clasp deploy -i <id>`)
   so the `/exec` URL stays stable.

## 4. GitHub repository and Pages

1. Settings → Secrets and variables → Actions → **Variables** (not secrets; they are public):
   | Variable | Value |
   |----------|-------|
   | `VITE_API_BASE_URL` | the `/exec` URL |
   | `VITE_GOOGLE_CLIENT_ID` | the client ID |
   | `VITE_BASE_PATH` | `/` for a custom domain, `/TacKHInventory/` for `rojan2003.github.io/TacKHInventory/` |
   | `PAGES_CNAME` | the custom domain, if any (writes `dist/CNAME`) |
2. Commit and push the new files (see "What to commit" below). The workflow runs tests, typecheck, build and a
   secret scan, then uploads the Pages artifact.
3. Settings → Pages → Build and deployment → Source: **GitHub Actions**. The legacy root `index.html` was
   removed on 2026-10-20, so the Pages URL returns 404 from the push that deletes it until this switch is made
   and the workflow has run once.
4. Custom domain: Settings → Pages → Custom domain → enter it; at your DNS provider add a `CNAME` record
   pointing to `rojan2003.github.io` (or `A`/`AAAA` records to GitHub's Pages IPs for an apex domain).
   Tick **Enforce HTTPS** once the certificate is issued. Add the domain to the OAuth client's JavaScript origins.
5. Recommended: Settings → Branches → protect `main` (require the workflow to pass).

## 5. Authorizing users

The initial administrator is `congregationliterature@gmail.com` (seeded by `setup()`). Sign in with that account,
open **User Management** and authorize other Google accounts with a role and, for congregation users, a
congregation. Role changes and deactivation take effect on the user's next request.

## 6. Testing the deployed authentication flow

1. Open the site in a private window; the Google button should render (if it does not, check the client ID
   and that the page origin is listed in the OAuth client).
2. Sign in with an account that is **not** authorized → "This account is not authorized".
3. Sign in with the administrator → dashboard loads; AuditLogs gains an `auth.login` row.
4. In the Apps Script editor, Executions shows the calls; errors there never reach the browser as stack traces.

## 7. Test environment

- Make a copy of the spreadsheet, create a second Apps Script deployment (or project) with
  `SPREADSHEET_ID` set to the copy, and point a local `frontend/.env.local` at that deployment.
- Never run destructive tests against the production spreadsheet. The automated test suites in this repo
  only ever use the in-memory fake runtime.

## 8. Backup and restore

- Backup: File → Make a copy (dated), or Drive version history. Consider a monthly copy as routine.
- Restore a single record: use version history to view the old value and fix it with a stock adjustment or a
  reconcile run; do not edit ledger rows by hand.
- Restore everything: replace `SPREADSHEET_ID` with the ID of the backup copy and redeploy (or copy sheets back).
- After any manual repair run **User Management → Maintenance → Reconcile** (dry run, then apply).

## 9. Cut-over and retirement of the legacy app

1. Optionally import the latest month of `East_Inventory` as opening balances (User Management →
   Maintenance → "Import legacy opening balances", dry run first). This needs an explicit decision because it
   changes production stock figures.
2. When the new site is live, archive the old Apps Script deployment (`AKfycbz…`; it serves spreadsheet data to
   anyone) via Deploy → Manage deployments → Archive. The legacy `index.html` has already been deleted from the
   working tree; its shared password remains in Git history and must be considered compromised regardless.

## What to commit

Everything new under `frontend/` (except `node_modules`, `dist`, `.env.local`, `test-results`), `apps-script/`
(except `.clasp.json`), `.github/`, `.gitignore`, `README.md`, `docs/`. The root `.gitignore` already
excludes the sensitive paths; run `npm run secrets:scan` before committing.
