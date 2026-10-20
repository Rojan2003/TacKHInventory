/**
 * 01_Util.js
 * Shared helpers: errors, ids, time, responses, validation.
 */

/** Application error with a stable, client-safe code. Never carries stack traces to the client. */
function AppError(code, message, status) {
  this.name = 'AppError';
  this.code = code || 'INTERNAL_ERROR';
  this.message = message || 'An unexpected error occurred.';
  this.status = status || 400;
}
AppError.prototype = Object.create(Error.prototype);

var ERR = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  LOCKED: 'LOCKED',
  INTERNAL: 'INTERNAL_ERROR',
  CONFIG: 'CONFIGURATION_ERROR'
};

function fail(code, message, status) { throw new AppError(code, message, status); }

function nowIso() { return new Date().toISOString(); }

function toIsoDate(value) {
  // Accepts Date, ISO string, or yyyy-mm-dd and returns yyyy-mm-dd (or '' when empty).
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return '';
    var y = value.getFullYear(), m = ('0' + (value.getMonth() + 1)).slice(-2), d = ('0' + value.getDate()).slice(-2);
    return y + '-' + m + '-' + d;
  }
  var s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  var dt = new Date(s);
  return isNaN(dt.getTime()) ? '' : toIsoDate(dt);
}

function newId(prefix) {
  var raw = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
  return (prefix ? prefix + '_' : '') + raw;
}

function pad(n, width) {
  var s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

function toBool(v) {
  if (typeof v === 'boolean') return v;
  var s = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === '1';
}

function toNum(v, fallback) {
  if (v === '' || v === null || v === undefined) return fallback === undefined ? 0 : fallback;
  var n = Number(v);
  return isNaN(n) ? (fallback === undefined ? 0 : fallback) : n;
}

function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }

function requireString(obj, key, label, maxLen) {
  var v = obj ? obj[key] : undefined;
  if (!isNonEmptyString(v)) fail(ERR.VALIDATION, (label || key) + ' is required.');
  v = String(v).trim();
  if (maxLen && v.length > maxLen) fail(ERR.VALIDATION, (label || key) + ' must be at most ' + maxLen + ' characters.');
  return v;
}

function optionalString(obj, key, maxLen) {
  var v = obj ? obj[key] : undefined;
  if (v === undefined || v === null) return '';
  v = String(v).trim();
  if (maxLen && v.length > maxLen) fail(ERR.VALIDATION, key + ' must be at most ' + maxLen + ' characters.');
  return v;
}

function requirePositiveInt(value, label) {
  var n = Number(value);
  if (!isFinite(n) || n <= 0 || Math.floor(n) !== n) fail(ERR.VALIDATION, (label || 'Quantity') + ' must be a positive whole number.');
  return n;
}

function requireNonNegativeInt(value, label) {
  var n = Number(value);
  if (!isFinite(n) || n < 0 || Math.floor(n) !== n) fail(ERR.VALIDATION, (label || 'Quantity') + ' must be a whole number of zero or more.');
  return n;
}

function requireDate(value, label) {
  var d = toIsoDate(value);
  if (!d) fail(ERR.VALIDATION, (label || 'Date') + ' must be a valid date (yyyy-mm-dd).');
  return d;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }

function ok(data, message, requestId) {
  return { success: true, data: data === undefined ? null : data, message: message || '', error: null, requestId: requestId || null };
}

function errorResponse(err, requestId) {
  var isApp = err && err.name === 'AppError';
  var code = isApp ? err.code : ERR.INTERNAL;
  var message = isApp ? err.message : 'An unexpected error occurred. Please try again or contact an administrator.';
  if (!isApp) {
    try { console.error('Unhandled error [' + (requestId || '-') + ']: ' + (err && err.stack ? err.stack : err)); } catch (e) { /* ignore */ }
  }
  return { success: false, data: null, message: message, error: { code: code, message: message }, requestId: requestId || null };
}

function uniq(arr) {
  var seen = {}, out = [];
  (arr || []).forEach(function (v) { if (!seen[v]) { seen[v] = true; out.push(v); } });
  return out;
}

function indexBy(rows, key) {
  var map = {};
  (rows || []).forEach(function (r) { map[r[key]] = r; });
  return map;
}

function groupBy(rows, key) {
  var map = {};
  (rows || []).forEach(function (r) { (map[r[key]] = map[r[key]] || []).push(r); });
  return map;
}

function inDateRange(dateValue, from, to) {
  var d = toIsoDate(dateValue);
  if (!d) return false;
  if (from && d < toIsoDate(from)) return false;
  if (to && d > toIsoDate(to)) return false;
  return true;
}

function monthKey(dateValue) {
  var d = toIsoDate(dateValue);
  return d ? d.slice(0, 7) : '';
}

function safeJsonParse(text, fallback) {
  try { return JSON.parse(text); } catch (e) { return fallback; }
}

function paginate(rows, params) {
  var page = Math.max(1, Math.floor(toNum(params && params.page, 1)));
  var pageSize = Math.min(200, Math.max(1, Math.floor(toNum(params && params.pageSize, 25))));
  var total = rows.length;
  var start = (page - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), page: page, pageSize: pageSize, total: total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

function sortRows(rows, sortBy, sortDir) {
  if (!sortBy) return rows;
  var dir = String(sortDir || 'asc').toLowerCase() === 'desc' ? -1 : 1;
  return rows.slice().sort(function (a, b) {
    var av = a[sortBy], bv = b[sortBy];
    var an = Number(av), bn = Number(bv);
    if (av !== '' && bv !== '' && av !== undefined && bv !== undefined && !isNaN(an) && !isNaN(bn)) return (an - bn) * dir;
    av = String(av === undefined || av === null ? '' : av).toLowerCase();
    bv = String(bv === undefined || bv === null ? '' : bv).toLowerCase();
    return av < bv ? -dir : av > bv ? dir : 0;
  });
}

function textMatches(row, keys, query) {
  if (!query) return true;
  var q = String(query).toLowerCase();
  return keys.some(function (k) { return String(row[k] === undefined || row[k] === null ? '' : row[k]).toLowerCase().indexOf(q) !== -1; });
}
