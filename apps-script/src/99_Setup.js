/**
 * 99_Setup.js
 * One-time and maintenance functions run manually from the Apps Script editor by the script owner.
 * None of these are reachable from the web app except admin.importLegacyOpeningBalances (admin role, dry-run by default).
 */

/**
 * Run once after deploying the script and granting permissions:
 *  - creates missing worksheets/columns (never touches East_Inventory or Distribution)
 *  - generates SESSION_SECRET if absent
 *  - seeds congregations, default settings and the initial administrator
 * Then set GOOGLE_CLIENT_ID (and optionally SPREADSHEET_ID) in Project Settings > Script Properties.
 */
function setup() {
  var props = getProps();
  var created = ensureSchema();
  if (!props.getProperty('SESSION_SECRET')) {
    props.setProperty('SESSION_SECRET', generateSecret());
    console.log('Generated SESSION_SECRET.');
  }
  resetSheetCaches();
  var congTable = table(SHEETS.CONGREGATIONS);
  if (congTable.count() === 0) {
    var now = nowIso();
    congTable.append(DEFAULT_CONGREGATIONS.map(function (c) {
      return { congregationId: newId('cong'), code: c.code, name: c.name, type: c.type, active: 'TRUE', notes: '', createdAt: now, updatedAt: now };
    }));
    console.log('Seeded ' + DEFAULT_CONGREGATIONS.length + ' congregations.');
  }
  var settings = table(SHEETS.SETTINGS);
  var existingKeys = settings.read().map(function (s) { return s.key; });
  var missing = DEFAULT_SETTINGS.filter(function (s) { return existingKeys.indexOf(s.key) === -1; });
  if (missing.length) {
    settings.append(missing.map(function (s) { return { key: s.key, value: s.value, description: s.description, updatedAt: nowIso(), updatedBy: 'setup' }; }));
    invalidateSettingsCache();
  }
  bumpDataVersion(); // schema or seed changes must not be served from cached rows
  var admin = seedInitialAdmin('setup');
  if (admin) console.log('Seeded initial administrator: ' + admin.email);
  var summary = {
    spreadsheetId: getSpreadsheetId(),
    schema: created,
    googleClientIdConfigured: !!props.getProperty('GOOGLE_CLIENT_ID'),
    sessionSecretConfigured: !!props.getProperty('SESSION_SECRET')
  };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

/** Invalidates all existing sessions by rotating the HMAC secret. */
function rotateSessionSecret() {
  getProps().setProperty('SESSION_SECRET', generateSecret());
  console.log('SESSION_SECRET rotated; all users must sign in again.');
}

function generateSecret() {
  // 64 random bytes -> base64 (88 chars). Utilities.getUuid is not cryptographically ideal on its own,
  // so we hash several together with a timestamp to widen the entropy pool.
  var seed = [Utilities.getUuid(), Utilities.getUuid(), Utilities.getUuid(), Utilities.getUuid(), String(Date.now()), String(Math.random())].join('|');
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_512, seed, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}

/** Quick diagnostic you can run from the editor. */
function healthCheck() {
  var props = getProps();
  var ss = getSpreadsheet();
  var result = {
    spreadsheet: ss.getName(),
    sheets: ss.getSheets().map(function (s) { return s.getName() + ' (' + Math.max(0, s.getLastRow() - 1) + ' rows)'; }),
    googleClientIdConfigured: !!props.getProperty('GOOGLE_CLIENT_ID'),
    sessionSecretConfigured: !!props.getProperty('SESSION_SECRET'),
    cacheEnabled: cacheEnabled(),
    dataVersion: getDataVersion(),
    coordinator: (function () { try { return getCoordinatorCongregation().name; } catch (e) { return 'NOT CONFIGURED'; } })(),
    users: table(SHEETS.USERS).count()
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Proposed migration: load the latest month of the legacy East_Inventory sheet as OPENING_BALANCE
 * transactions for matching item codes. Dry run unless params.apply === true. Appends only; never edits
 * legacy rows. Items are matched by SKU == "Literature Code"; unmatched codes are reported, not created,
 * unless params.createMissingItems === true.
 */
function adminImportLegacyOpeningBalances(params, ctx) {
  requirePermission(ctx.user, 'admin.reconcile');
  var apply = toBool(params.apply);
  var legacy = readLegacySheet(CONFIG.LEGACY_SHEETS.EAST_INVENTORY);
  if (!legacy.rows.length) fail(ERR.NOT_FOUND, 'The legacy East_Inventory worksheet is empty or missing.', 404);
  var month = params.month ? String(params.month).slice(0, 7) : legacy.rows.map(function (r) { return monthKey(r.Date); }).filter(Boolean).sort().pop();
  var rows = legacy.rows.filter(function (r) { return monthKey(r.Date) === month; });
  if (!rows.length) fail(ERR.NOT_FOUND, 'No legacy rows found for month ' + month + '.', 404);
  if (table(SHEETS.TRANSACTIONS).read().some(function (t) { return t.refType === 'LEGACY_IMPORT'; })) {
    fail(ERR.CONFLICT, 'Legacy opening balances have already been imported. Use stock adjustments for corrections.', 409);
  }
  var items = table(SHEETS.ITEMS).read();
  var bySku = {};
  items.forEach(function (i) { bySku[String(i.sku).toUpperCase()] = i; });
  var plan = [], unmatched = [];
  rows.forEach(function (r) {
    var sku = String(r['Literature Code'] || '').trim().toUpperCase();
    var qty = toNum(r.Total);
    if (!sku || qty <= 0) return;
    var item = bySku[sku];
    if (!item) { unmatched.push({ sku: sku, name: r['Literature Name'], quantity: qty }); return; }
    plan.push({ itemId: item.itemId, sku: sku, name: item.name, quantity: qty });
  });
  var report = { month: month, apply: apply, planned: plan, unmatched: unmatched, created: [] };
  if (!apply) return report;
  if (unmatched.length && toBool(params.createMissingItems)) {
    var now = nowIso();
    unmatched.forEach(function (u) {
      var item = { itemId: newId('itm'), sku: u.sku, name: u.name || u.sku, description: 'Imported from legacy East_Inventory', category: '', unit: 'pcs', minStock: 0, active: 'TRUE', createdAt: now, createdBy: ctx.user.email, updatedAt: now, updatedBy: ctx.user.email };
      table(SHEETS.ITEMS).append(item);
      table(SHEETS.BALANCES).append({ itemId: item.itemId, physicalQty: 0, lastTxnId: '', updatedAt: now });
      plan.push({ itemId: item.itemId, sku: u.sku, name: item.name, quantity: u.quantity });
      report.created.push(u.sku);
    });
    report.unmatched = [];
  }
  if (!plan.length) fail(ERR.VALIDATION, 'Nothing to import: no legacy codes match catalog items.');
  postTransactions(plan.map(function (p) {
    return { type: TXN_TYPES.OPENING_BALANCE, itemId: p.itemId, quantity: p.quantity, refType: 'LEGACY_IMPORT', refId: month, notes: 'Opening balance imported from East_Inventory ' + month };
  }), ctx);
  writeAudit(ctx.user.email, 'admin.importLegacyOpeningBalances', 'InventoryTransactions', month, 'Imported ' + plan.length + ' opening balances from legacy sheet (' + month + ')', ctx.requestId, report);
  return report;
}

/**
 * Run from the Apps Script editor after pasting new code or changing the manifest. It confirms that the
 * script is allowed to call Google's token-info endpoint (scope script.external_request). The first run
 * shows the authorization prompt; afterwards it logs the HTTP status Google returned for a dummy token.
 * A status of 400 is the expected result and means the sign-in verification path works.
 */
function authSelfTest() {
  var props = getProps();
  var result = {
    googleClientIdConfigured: !!props.getProperty('GOOGLE_CLIENT_ID'),
    sessionSecretConfigured: !!props.getProperty('SESSION_SECRET'),
    tokeninfoReachable: false,
    tokeninfoStatus: null,
    error: null
  };
  try {
    var resp = UrlFetchApp.fetch(TOKENINFO_URL + 'self-test', { muteHttpExceptions: true, followRedirects: false });
    result.tokeninfoStatus = resp.getResponseCode();
    result.tokeninfoReachable = true;
  } catch (e) {
    result.error = String(e && e.message ? e.message : e);
  }
  console.log(JSON.stringify(result, null, 2));
  return result;
}
