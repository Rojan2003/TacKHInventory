# Testing

## Automated

All automated tests run against the **fake Apps Script runtime** (`frontend/src/mock/gasRuntime.ts`), which
executes the real backend source files from `apps-script/src` with in-memory stand-ins for `SpreadsheetApp`,
`LockService`, `PropertiesService`, `CacheService`, `Utilities`, `UrlFetchApp` and `ContentService`. No test ever
touches Google or the production spreadsheet.

```bash
cd frontend
npm test              # Vitest: tests/backend/*.test.ts + tests/unit/*.test.ts
npm run test:e2e      # Playwright: tests/e2e/smoke.spec.ts on desktop (1366), tablet (820) and mobile (Pixel 7)
npm run build         # vue-tsc typecheck + Vite production build
npm run secrets:scan  # credential pattern scan
```

### Acceptance criteria coverage

| # | Criterion | Automated test | Status |
|---|-----------|----------------|--------|
| 1 | Authorized Google accounts can sign in | backend/auth: seeds admin, login via verified identity | pass |
| 2 | Unauthorized accounts cannot access data | backend/auth: unknown email, deactivated user, missing token | pass |
| 3 | Server-side role checks cannot be bypassed | backend/auth: body-supplied role ignored; 16-case matrix | pass |
| 4 | Confirmed deliveries increase stock exactly once | backend/inventory: confirm twice with new request IDs | pass |
| 5 | Pending deliveries do not increase stock | backend/inventory + e2e | pass |
| 6 | Distributions decrease stock exactly once | backend/inventory | pass |
| 7 | Distributions exceeding available stock are rejected | backend/inventory (ad-hoc and cross-request) | pass |
| 8 | Duplicate submissions cannot double count | backend/inventory: same requestId replay for delivery and distribution | pass |
| 9 | Partial fulfilment updates quantities/status | backend/inventory: Partially Fulfilled → Fulfilled | pass |
| 10 | Cancellation follows reservation rules | backend/inventory: reservation released, terminal state | pass |
| 11 | Concurrent operations do not create negative stock | serialised by the script lock; LOCKED response tested; validation happens inside the lock | pass (modelled; see manual) |
| 12 | Congregation users cannot run admin operations | authorization matrix | pass |
| 13 | Reports reconcile with the ledger | backend/inventory: inventory total = ledger sum; East + released = total received | pass |
| 14 | Spreadsheet failures handled gracefully | backend/inventory: CONFIGURATION_ERROR without stack trace | pass |
| 15 | Mobile navigation and forms work | e2e mobile project: drawer navigation, forms, no horizontal overflow | pass |
| 16 | Frontend build succeeds | `npm run build`, CI workflow | pass |
| 17 | No private credentials in the build | `scan-secrets.mjs dist` | pass (0 findings) |
| 18 | Existing records/formulas intact | backend never writes legacy sheets; test asserts byte-identical legacy data after import | pass |

Latest local results are recorded in the final project report; CI re-runs `npm test` and the build on every push.

## Manual tests after deployment (production verification)

Perform these against a **test copy** of the spreadsheet first.

1. **Sign-in**: authorized admin signs in; unauthorized Google account sees the rejection; sign-in is audited.
2. **Deactivation**: deactivate a test user in User Management; their next action returns "account deactivated".
3. **Delivery**: record pending → confirm → item history shows one `DELIVERY_IN`; press Confirm twice quickly → still one.
4. **Concurrency**: two people release against the same approved request at the same moment → one succeeds, the
   other gets "insufficient"/"remaining" or LOCKED; physical stock never negative; Executions log shows serialisation.
5. **Interrupted write drill** (test copy only): set a distribution's status cell to `Processing` by hand, run
   Reconcile dry run → it is listed → apply → Released, request status correct.
6. **Reports**: Inventory total equals the sum of the Stock Movements report; Congregation summary East physical +
   all Released equals Deliveries + Opening balances.
7. **Mobile**: on a phone, open the drawer, record a delivery, approve a request, print a receipt (share → print).
8. **Quota**: Apps Script free quotas (UrlFetch 20k/day, execution time 6 min) are far above expected usage; check
   Executions for any failures after the first week.
