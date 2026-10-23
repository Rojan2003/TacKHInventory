/**
 * 02_Sheets.js
 * Spreadsheet access layer. All reads/writes to managed worksheets go through here.
 *
 * Design notes
 * - Every managed worksheet has a header row defined in SCHEMA (00_Config.js).
 * - Rows are addressed by their stable ID column (ID_COLUMNS), never by row number from the client.
 * - All columns are formatted as plain text ('@') when a sheet is created so ISO timestamps are not
 *   silently converted into Sheets date serials. Numbers are coerced on read with toNum().
 * - Legacy worksheets (East_Inventory, Distribution) are never written by this backend.
 */

var __ssCache = null;
var __tableCache = {};

/* ---------- Cross-request row cache (CacheService) ----------
 * Raw worksheet rows are cached for CACHE_ROWS_TTL_SECONDS under a key that embeds a global data version.
 * Every write bumps the version (withLock does it in a finally block, so a mutation that fails partway still
 * invalidates), which makes every previously cached row unreachable at once. Reads inside withLock always go
 * to the sheet and never populate the cache. AuthorizedUsers (per-account), AuditLogs and IdempotencyKeys are
 * never cached. Script Property CACHE_ENABLED=false switches the cache off; admin.clearCache bumps the version.
 * Manual edits made directly in the spreadsheet therefore show up within CACHE_ROWS_TTL_SECONDS at the latest.
 */
var __inLock = false;
var __dataVersion = null;
var __cacheEnabled = null;
var CACHE_ROWS_TTL_SECONDS = 120;
var CACHE_VERSION_TTL_SECONDS = 21600; // CacheService maximum
var CACHE_MAX_BYTES = 90000;           // CacheService allows 100 KB per value; larger sheets are read directly
var CACHEABLE_SHEETS = ['LiteratureItems', 'Congregations', 'InventoryBalances', 'InventoryTransactions', 'Deliveries', 'DeliveryItems', 'Requests', 'RequestItems', 'Distributions', 'DistributionItems', 'AppSettings'];

function cacheEnabled() {
  if (__cacheEnabled === null) {
    var v = getProps().getProperty('CACHE_ENABLED');
    __cacheEnabled = (v === null || v === undefined || String(v).trim() === '') ? true : toBool(v);
  }
  return __cacheEnabled;
}

function newDataVersion() { return String(Date.now()) + '-' + Utilities.getUuid().slice(0, 8); }

/** Current data version; a missing or evicted key yields a brand-new version, never an old one. */
function getDataVersion() {
  if (__dataVersion) return __dataVersion;
  var v = null;
  try { v = CacheService.getScriptCache().get('dataVersion'); } catch (e) { v = null; }
  if (!v) v = bumpDataVersion();
  __dataVersion = v;
  return v;
}

function bumpDataVersion() {
  var v = newDataVersion();
  try { CacheService.getScriptCache().put('dataVersion', v, CACHE_VERSION_TTL_SECONDS); } catch (e) { /* cache unavailable: reads fall through to the sheet */ }
  __dataVersion = v;
  return v;
}

function rowCacheKey(name) {
  if (__inLock || CACHEABLE_SHEETS.indexOf(name) === -1 || !cacheEnabled()) return null;
  return 'rows:' + getDataVersion() + ':' + name;
}

function readRowsFromCache(key) {
  var raw = null;
  try { raw = CacheService.getScriptCache().get(key); } catch (e) { return null; }
  if (!raw) return null;
  var parsed = safeJsonParse(raw, null);
  if (!parsed || !Array.isArray(parsed.rows)) return null;
  return parsed.rows.map(function (entry) {
    var obj = entry[1];
    Object.defineProperty(obj, '_row', { value: entry[0], enumerable: false });
    return obj;
  });
}

function storeRowsInCache(key, rows) {
  var json;
  try { json = JSON.stringify({ rows: rows.map(function (r) { return [r._row, r]; }) }); } catch (e) { return; }
  if (json.length > CACHE_MAX_BYTES) return;
  try { CacheService.getScriptCache().put(key, json, CACHE_ROWS_TTL_SECONDS); } catch (e) { /* ignore */ }
}

function getProps() { return PropertiesService.getScriptProperties(); }

function getSpreadsheetId() {
  var id = getProps().getProperty('SPREADSHEET_ID');
  return id || CONFIG.DEFAULT_SPREADSHEET_ID;
}

function getSpreadsheet() {
  if (__ssCache) return __ssCache;
  var id = getSpreadsheetId();
  if (!id) fail(ERR.CONFIG, 'Spreadsheet ID is not configured.', 500);
  try {
    __ssCache = SpreadsheetApp.openById(id);
  } catch (e) {
    fail(ERR.CONFIG, 'The inventory spreadsheet could not be opened. Check the SPREADSHEET_ID property and sharing.', 500);
  }
  return __ssCache;
}

/** Clears per-execution caches. Called at the start of each request and after bulk writes. */
function resetSheetCaches() { __tableCache = {}; }

/** Drops the spreadsheet handle too. Called once at the start of every request. */
function resetAllCaches() { __tableCache = {}; __ssCache = null; __dataVersion = null; __cacheEnabled = null; }

function getOrCreateSheet(name) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (sheet) return sheet;
  if (!SCHEMA[name]) fail(ERR.CONFIG, 'Unknown worksheet: ' + name, 500);
  sheet = ss.insertSheet(name);
  var headers = SCHEMA[name];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 2), headers.length).setNumberFormat('@');
  sheet.setFrozenRows(1);
  return sheet;
}

/** Ensures every managed worksheet exists with the expected header row. Appends missing columns. */
function ensureSchema() {
  var report = [];
  Object.keys(SCHEMA).forEach(function (name) {
    var sheet = getOrCreateSheet(name);
    var expected = SCHEMA[name];
    var lastCol = sheet.getLastColumn();
    var existing = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
    var missing = expected.filter(function (h) { return existing.indexOf(h) === -1; });
    if (missing.length) {
      sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
      sheet.getRange(1, existing.length + 1, Math.max(sheet.getMaxRows(), 2), missing.length).setNumberFormat('@');
    }
    report.push({ sheet: name, addedColumns: missing });
  });
  resetSheetCaches();
  return report;
}

/**
 * Table wrapper around a worksheet.
 * read() returns plain objects keyed by header; each object also carries a non-enumerable _row.
 */
function table(name) {
  if (__tableCache[name]) return __tableCache[name];
  var sheet = getOrCreateSheet(name);
  var lastCol = sheet.getLastColumn();
  var headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : SCHEMA[name].slice();
  var idCol = ID_COLUMNS[name];
  var t = {
    name: name,
    sheet: sheet,
    headers: headers,
    idColumn: idCol,
    _rows: null,

    read: function () {
      if (this._rows) return this._rows;
      var cacheKey = rowCacheKey(name);
      if (cacheKey) {
        var hit = readRowsFromCache(cacheKey);
        if (hit) { this._rows = hit; return hit; }
      }
      var lastRow = sheet.getLastRow();
      var out = [];
      if (lastRow >= 2) {
        var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
        for (var i = 0; i < values.length; i++) {
          var row = values[i];
          var obj = {};
          var empty = true;
          for (var c = 0; c < headers.length; c++) {
            var v = row[c];
            if (v instanceof Date) v = v.toISOString();
            obj[headers[c]] = v;
            if (v !== '' && v !== null && v !== undefined) empty = false;
          }
          if (empty) continue;
          Object.defineProperty(obj, '_row', { value: i + 2, enumerable: false });
          out.push(obj);
        }
      }
      this._rows = out;
      if (cacheKey) storeRowsInCache(cacheKey, out);
      return out;
    },

    findById: function (id) {
      if (id === undefined || id === null || id === '') return null;
      var rows = this.read();
      for (var i = 0; i < rows.length; i++) if (String(rows[i][idCol]) === String(id)) return rows[i];
      return null;
    },

    where: function (pred) { return this.read().filter(pred); },

    toRow: function (obj) {
      return headers.map(function (h) {
        var v = obj[h];
        if (v === undefined || v === null) return '';
        if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
        if (typeof v === 'object') return JSON.stringify(v);
        return v;
      });
    },

    append: function (objs) {
      var list = Array.isArray(objs) ? objs : [objs];
      if (!list.length) return [];
      var self = this;
      var values = list.map(function (o) { return self.toRow(o); });
      var startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, values.length, headers.length).setValues(values);
      if (!__inLock) bumpDataVersion();
      this._rows = null; // force re-read so _row indexes stay correct
      return list;
    },

    update: function (id, patch) {
      var existing = this.findById(id);
      if (!existing) fail(ERR.NOT_FOUND, name + ' record not found: ' + id, 404);
      var merged = {};
      headers.forEach(function (h) { merged[h] = existing[h]; });
      Object.keys(patch || {}).forEach(function (k) { if (headers.indexOf(k) !== -1) merged[k] = patch[k]; });
      sheet.getRange(existing._row, 1, 1, headers.length).setValues([this.toRow(merged)]);
      if (!__inLock) bumpDataVersion();
      Object.defineProperty(merged, '_row', { value: existing._row, enumerable: false });
      // keep in-memory copy in sync
      var rows = this._rows;
      if (rows) for (var i = 0; i < rows.length; i++) if (rows[i]._row === existing._row) { rows[i] = merged; break; }
      return merged;
    },

    /** Batch update many rows by id in one pass (one setValues per contiguous row). */
    updateMany: function (patches) {
      var self = this;
      Object.keys(patches).forEach(function (id) { self.update(id, patches[id]); });
    },

    count: function () { return this.read().length; }
  };
  __tableCache[name] = t;
  return t;
}

/** Reads a legacy worksheet (read only) into objects keyed by its own header row. */
function readLegacySheet(name) {
  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) return { headers: [], rows: [] };
  var lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { headers: [], rows: [] };
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(String);
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var obj = {}, empty = true;
    for (var c = 0; c < headers.length; c++) {
      var v = values[i][c];
      if (v instanceof Date) v = toIsoDate(v);
      obj[headers[c]] = v;
      if (v !== '' && v !== null) empty = false;
    }
    if (!empty) rows.push(obj);
  }
  return { headers: headers, rows: rows };
}

/* ---------- Settings ---------- */

function getSettings() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('settings');
  if (cached) return JSON.parse(cached);
  var map = {};
  DEFAULT_SETTINGS.forEach(function (s) { map[s.key] = s.value; });
  table(SHEETS.SETTINGS).read().forEach(function (r) { map[r.key] = String(r.value); });
  cache.put('settings', JSON.stringify(map), 300);
  return map;
}

function getSetting(key) { return getSettings()[key]; }
function getSettingBool(key) { return toBool(getSetting(key)); }
function invalidateSettingsCache() { CacheService.getScriptCache().remove('settings'); }

/* ---------- Locking ---------- */

/** Runs fn while holding the script lock. Every stock-mutating operation must use this. */
function withLock(fn) {
  var lock = LockService.getScriptLock();
  var acquired = false;
  try {
    acquired = lock.tryLock(CONFIG.LOCK_TIMEOUT_MS);
  } catch (e) { acquired = false; }
  if (!acquired) fail(ERR.LOCKED, 'The system is busy processing another change. Please try again in a moment.', 423);
  try {
    __inLock = true;
    resetSheetCaches(); // always read fresh data inside the lock (rowCacheKey() returns null while __inLock)
    return fn();
  } finally {
    __inLock = false;
    bumpDataVersion(); // in finally: a mutation that failed partway must still invalidate cached rows
    try { lock.releaseLock(); } catch (e) { /* ignore */ }
  }
}

/* ---------- Reference numbers ---------- */

/** Generates a human-readable, unique reference such as REQ-2026-0001 (call inside withLock). */
function nextReference(sheetName, columnName, prefix) {
  var year = new Date().getFullYear();
  var head = prefix + '-' + year + '-';
  var max = 0;
  table(sheetName).read().forEach(function (r) {
    var ref = String(r[columnName] || '');
    if (ref.indexOf(head) === 0) {
      var n = parseInt(ref.slice(head.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  });
  return head + pad(max + 1, 4);
}
