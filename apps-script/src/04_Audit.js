/**
 * 04_Audit.js
 * Audit logging and idempotency protection.
 */

function writeAudit(actor, action, entityType, entityId, summary, requestId, details) {
  try {
    table(SHEETS.AUDIT).append({
      auditId: newId('aud'), timestamp: nowIso(), actor: actor || '', action: action || '', entityType: entityType || '',
      entityId: entityId || '', summary: summary || '', requestId: requestId || '',
      details: details ? JSON.stringify(details).slice(0, 5000) : ''
    });
  } catch (e) {
    try { console.error('Audit write failed: ' + e); } catch (ignored) { /* ignore */ }
  }
}

function auditList(params, ctx) {
  requirePermission(ctx.user, 'audit.view');
  var rows = table(SHEETS.AUDIT).read().filter(function (r) {
    if (params.actor && normalizeEmail(r.actor) !== normalizeEmail(params.actor)) return false;
    if (params.action && String(r.action).indexOf(params.action) !== 0) return false;
    if ((params.from || params.to) && !inDateRange(r.timestamp, params.from, params.to)) return false;
    return textMatches(r, ['actor', 'action', 'entityType', 'entityId', 'summary'], params.query);
  });
  rows = sortRows(rows, params.sortBy || 'timestamp', params.sortDir || 'desc');
  return paginate(rows, params);
}

/* ---------- Idempotency ----------
 * Mutating actions must send a client-generated requestId (UUID). If the same actor retries the same
 * requestId, the stored response is returned and no second write happens. Checked inside withLock().
 */

function idempotencyKey(ctx) { return normalizeEmail(ctx.user.email) + ':' + ctx.requestId; }

function findIdempotentResponse(ctx, action) {
  var key = idempotencyKey(ctx);
  var cache = CacheService.getScriptCache();
  var cached = cache.get('idem:' + key);
  if (cached) return JSON.parse(cached);
  var row = table(SHEETS.IDEMPOTENCY).findById(key);
  if (row) {
    var parsed = safeJsonParse(row.responseJson, null);
    if (parsed) return parsed;
  }
  return null;
}

function storeIdempotentResponse(ctx, action, response) {
  var key = idempotencyKey(ctx);
  var json = JSON.stringify(response);
  try { CacheService.getScriptCache().put('idem:' + key, json, CONFIG.IDEMPOTENCY_TTL_SECONDS); } catch (e) { /* ignore */ }
  try {
    table(SHEETS.IDEMPOTENCY).append({ key: key, action: action, actor: ctx.user.email, createdAt: nowIso(), responseJson: json.slice(0, 40000) });
  } catch (e) {
    try { console.error('Idempotency write failed: ' + e); } catch (ignored) { /* ignore */ }
  }
}

/** Wraps a mutating handler with lock + idempotency. The handler runs at most once per (actor, requestId). */
function runMutation(action, ctx, fn) {
  if (!isNonEmptyString(ctx.requestId) || ctx.requestId.length < 8 || ctx.requestId.length > 128) {
    fail(ERR.VALIDATION, 'A unique requestId is required for this operation.');
  }
  return withLock(function () {
    var previous = findIdempotentResponse(ctx, action);
    if (previous) return previous;
    var result = fn();
    storeIdempotentResponse(ctx, action, result);
    return result;
  });
}
