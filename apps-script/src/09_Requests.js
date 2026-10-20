/**
 * 09_Requests.js
 * Congregation literature requests.
 *
 * Status transitions
 *   Draft    -> Pending (submit) | Cancelled
 *   Pending  -> Approved (approve) | Rejected | Cancelled
 *   Approved -> Partially Fulfilled | Fulfilled (via distributions) | Cancelled (releases remaining reservation)
 *   Partially Fulfilled -> Fulfilled (via distributions) | Cancelled
 *   Fulfilled / Rejected / Cancelled are terminal.
 */

var REQUEST_TRANSITIONS = {
  'Draft': ['Pending', 'Cancelled'],
  'Pending': ['Approved', 'Rejected', 'Cancelled'],
  'Approved': ['Partially Fulfilled', 'Fulfilled', 'Cancelled'],
  'Partially Fulfilled': ['Fulfilled', 'Cancelled'],
  'Fulfilled': [], 'Rejected': [], 'Cancelled': []
};

function assertTransition(current, next) {
  var allowed = REQUEST_TRANSITIONS[current] || [];
  if (allowed.indexOf(next) === -1) fail(ERR.INVALID_TRANSITION, 'A request in status "' + current + '" cannot move to "' + next + '".', 409);
}

function requestLines(requestId, items) {
  return table(SHEETS.REQUEST_ITEMS).read().filter(function (ri) { return ri.requestId === requestId; }).map(function (ri) {
    var i = items[ri.itemId] || {};
    var approved = toNum(ri.approvedQty), fulfilled = toNum(ri.fulfilledQty);
    return {
      requestItemId: ri.requestItemId, itemId: ri.itemId, sku: i.sku || '', itemName: i.name || '', unit: i.unit || 'pcs',
      requestedQty: toNum(ri.requestedQty), approvedQty: approved, fulfilledQty: fulfilled, remainingQty: Math.max(0, approved - fulfilled)
    };
  });
}

function publicRequest(r, congs, items, withItems) {
  var c = congs[r.congregationId];
  var lines = requestLines(r.requestId, items);
  var out = {
    requestId: r.requestId, requestNumber: r.requestNumber, congregationId: r.congregationId, congregationName: c ? c.name : '',
    congregationCode: c ? c.code : '', requestDate: toIsoDate(r.requestDate), requestedBy: r.requestedBy || '', approvedBy: r.approvedBy || '',
    status: r.status, notes: r.notes || '', decisionNotes: r.decisionNotes || '', createdAt: r.createdAt, createdBy: r.createdBy,
    submittedAt: r.submittedAt || '', decidedAt: r.decidedAt || '', updatedAt: r.updatedAt || '', updatedBy: r.updatedBy || '',
    itemCount: lines.length,
    requestedTotal: lines.reduce(function (s, l) { return s + l.requestedQty; }, 0),
    approvedTotal: lines.reduce(function (s, l) { return s + l.approvedQty; }, 0),
    fulfilledTotal: lines.reduce(function (s, l) { return s + l.fulfilledQty; }, 0)
  };
  out.remainingTotal = Math.max(0, out.approvedTotal - out.fulfilledTotal);
  if (withItems) out.items = lines;
  return out;
}

function requestsList(params, ctx) {
  var scope = requireScope(ctx.user, 'requests.view.all', 'requests.view.own');
  var congs = indexBy(table(SHEETS.CONGREGATIONS).read(), 'congregationId');
  var items = indexBy(table(SHEETS.ITEMS).read(), 'itemId');
  var rows = table(SHEETS.REQUESTS).read().filter(function (r) {
    if (!scope.all && r.congregationId !== scope.congregationId) return false;
    if (params.congregationId && r.congregationId !== params.congregationId) return false;
    if (params.status && r.status !== params.status) return false;
    if (Array.isArray(params.statuses) && params.statuses.length && params.statuses.indexOf(r.status) === -1) return false;
    if ((params.from || params.to) && !inDateRange(r.requestDate, params.from, params.to)) return false;
    return true;
  }).map(function (r) { return publicRequest(r, congs, items, false); })
    .filter(function (r) { return textMatches(r, ['requestNumber', 'congregationName', 'requestedBy', 'approvedBy', 'notes', 'status'], params.query); });
  rows = sortRows(rows, params.sortBy || 'requestDate', params.sortDir || 'desc');
  return paginate(rows, params);
}

function loadRequestForUser(requestId, ctx) {
  var scope = requireScope(ctx.user, 'requests.view.all', 'requests.view.own');
  var r = table(SHEETS.REQUESTS).findById(requestId);
  if (!r) fail(ERR.NOT_FOUND, 'Request not found.', 404);
  assertScopeCongregation(scope, r.congregationId);
  return r;
}

function requestsGet(params, ctx) {
  var r = loadRequestForUser(params.requestId, ctx);
  var congs = indexBy(table(SHEETS.CONGREGATIONS).read(), 'congregationId');
  var items = indexBy(table(SHEETS.ITEMS).read(), 'itemId');
  var out = publicRequest(r, congs, items, true);
  if (hasPermission(ctx.user, 'requests.decide')) {
    var balances = getBalances();
    out.items.forEach(function (l) {
      var b = balances[l.itemId] || { physicalQty: 0, reservedQty: 0, availableQty: 0 };
      l.physicalQty = b.physicalQty; l.reservedQty = b.reservedQty; l.availableQty = b.availableQty;
    });
  }
  out.distributions = table(SHEETS.DISTRIBUTIONS).read().filter(function (d) { return d.requestId === r.requestId; }).map(function (d) {
    return { distributionId: d.distributionId, reference: d.reference, status: d.status, createdAt: d.createdAt, releasedBy: d.releasedBy || '' };
  });
  return out;
}

function validateRequestLines(lines) {
  if (!Array.isArray(lines) || !lines.length) fail(ERR.VALIDATION, 'At least one literature item is required.');
  if (lines.length > 200) fail(ERR.VALIDATION, 'A request may contain at most 200 lines.');
  var items = indexBy(table(SHEETS.ITEMS).read(), 'itemId');
  var seen = {};
  return lines.map(function (l) {
    var itemId = requireString(l, 'itemId', 'Literature item');
    if (!items[itemId]) fail(ERR.NOT_FOUND, 'Literature item not found: ' + itemId, 404);
    if (!toBool(items[itemId].active)) fail(ERR.VALIDATION, items[itemId].name + ' is inactive.');
    if (seen[itemId]) fail(ERR.VALIDATION, 'Item ' + items[itemId].sku + ' appears more than once.');
    seen[itemId] = true;
    return { itemId: itemId, requestedQty: requirePositiveInt(l.requestedQty !== undefined ? l.requestedQty : l.quantity, 'Quantity for ' + items[itemId].sku) };
  });
}

function resolveRequestCongregation(params, ctx) {
  if (ctx.user.role === ROLES.CONGREGATION_USER) {
    if (!ctx.user.congregationId) fail(ERR.FORBIDDEN, 'Your account is not linked to a congregation. Contact an administrator.', 403);
    return requireCongregation(ctx.user.congregationId, 'Your congregation');
  }
  return requireCongregation(params.congregationId, 'Requesting congregation');
}

function requestsCreate(params, ctx) {
  requirePermission(ctx.user, 'requests.create');
  var cong = resolveRequestCongregation(params, ctx);
  var coordinator = getCoordinatorCongregation();
  if (cong.congregationId === coordinator.congregationId) fail(ERR.VALIDATION, 'The coordinating congregation does not request literature from itself.');
  var lines = validateRequestLines(params.items);
  var now = nowIso();
  var submit = toBool(params.submit);
  var r = {
    requestId: newId('req'), requestNumber: nextReference(SHEETS.REQUESTS, 'requestNumber', getSetting('requestNumberPrefix') || 'REQ'),
    congregationId: cong.congregationId, requestDate: params.requestDate ? requireDate(params.requestDate, 'Request date') : toIsoDate(new Date()),
    requestedBy: optionalString(params, 'requestedBy', 120) || ctx.user.name || ctx.user.email, approvedBy: '',
    status: submit ? STATUS.REQUEST.PENDING : STATUS.REQUEST.DRAFT, notes: optionalString(params, 'notes', 1000), decisionNotes: '',
    createdAt: now, createdBy: ctx.user.email, submittedAt: submit ? now : '', decidedAt: '', updatedAt: now, updatedBy: ctx.user.email
  };
  table(SHEETS.REQUESTS).append(r);
  table(SHEETS.REQUEST_ITEMS).append(lines.map(function (l) {
    return { requestItemId: newId('rqi'), requestId: r.requestId, itemId: l.itemId, requestedQty: l.requestedQty, approvedQty: 0, fulfilledQty: 0 };
  }));
  writeAudit(ctx.user.email, 'requests.create', 'Requests', r.requestId, (submit ? 'Submitted' : 'Drafted') + ' request ' + r.requestNumber + ' for ' + cong.name, ctx.requestId, { lines: lines.length });
  return requestsGet({ requestId: r.requestId }, ctx);
}

function assertCanEditRequest(r, ctx) {
  if (hasPermission(ctx.user, 'requests.decide')) return;
  if (ctx.user.role === ROLES.CONGREGATION_USER && r.congregationId === ctx.user.congregationId) return;
  fail(ERR.FORBIDDEN, 'You may only edit requests for your own congregation.', 403);
}

function requestsUpdate(params, ctx) {
  requirePermission(ctx.user, 'requests.create');
  var t = table(SHEETS.REQUESTS);
  var r = t.findById(params.requestId);
  if (!r) fail(ERR.NOT_FOUND, 'Request not found.', 404);
  assertCanEditRequest(r, ctx);
  if ([STATUS.REQUEST.DRAFT, STATUS.REQUEST.PENDING].indexOf(r.status) === -1) fail(ERR.INVALID_TRANSITION, 'Only draft or pending requests can be edited.', 409);
  var lines = validateRequestLines(params.items);
  var now = nowIso();
  t.update(r.requestId, {
    requestDate: params.requestDate ? requireDate(params.requestDate, 'Request date') : r.requestDate,
    requestedBy: optionalString(params, 'requestedBy', 120) || r.requestedBy, notes: optionalString(params, 'notes', 1000), updatedAt: now, updatedBy: ctx.user.email
  });
  var ri = table(SHEETS.REQUEST_ITEMS);
  var existing = ri.read().filter(function (x) { return x.requestId === r.requestId; });
  var byItem = indexBy(existing, 'itemId');
  var keep = {}, toAppend = [];
  lines.forEach(function (l) {
    keep[l.itemId] = true;
    if (byItem[l.itemId]) ri.update(byItem[l.itemId].requestItemId, { requestedQty: l.requestedQty });
    else toAppend.push({ requestItemId: newId('rqi'), requestId: r.requestId, itemId: l.itemId, requestedQty: l.requestedQty, approvedQty: 0, fulfilledQty: 0 });
  });
  existing.forEach(function (x) { if (!keep[x.itemId]) ri.update(x.requestItemId, { requestedQty: 0 }); });
  if (toAppend.length) ri.append(toAppend);
  writeAudit(ctx.user.email, 'requests.update', 'Requests', r.requestId, 'Edited request ' + r.requestNumber, ctx.requestId, null);
  return requestsGet({ requestId: r.requestId }, ctx);
}

function requestsSubmit(params, ctx) {
  requirePermission(ctx.user, 'requests.create');
  var t = table(SHEETS.REQUESTS);
  var r = t.findById(params.requestId);
  if (!r) fail(ERR.NOT_FOUND, 'Request not found.', 404);
  assertCanEditRequest(r, ctx);
  if (r.status === STATUS.REQUEST.PENDING) return requestsGet({ requestId: r.requestId }, ctx);
  assertTransition(r.status, STATUS.REQUEST.PENDING);
  var hasLines = table(SHEETS.REQUEST_ITEMS).read().some(function (x) { return x.requestId === r.requestId && toNum(x.requestedQty) > 0; });
  if (!hasLines) fail(ERR.VALIDATION, 'Add at least one item before submitting.');
  var now = nowIso();
  t.update(r.requestId, { status: STATUS.REQUEST.PENDING, submittedAt: now, updatedAt: now, updatedBy: ctx.user.email });
  writeAudit(ctx.user.email, 'requests.submit', 'Requests', r.requestId, 'Submitted request ' + r.requestNumber, ctx.requestId, null);
  return requestsGet({ requestId: r.requestId }, ctx);
}

/**
 * Approve with per-line approved quantities (defaults to requested). When reserveOnApproval is on,
 * the approved quantity may not exceed currently available stock, so a reservation is always fulfillable.
 */
function requestsApprove(params, ctx) {
  requirePermission(ctx.user, 'requests.decide');
  var t = table(SHEETS.REQUESTS);
  var r = t.findById(params.requestId);
  if (!r) fail(ERR.NOT_FOUND, 'Request not found.', 404);
  assertTransition(r.status, STATUS.REQUEST.APPROVED);
  var ri = table(SHEETS.REQUEST_ITEMS);
  var lines = ri.read().filter(function (x) { return x.requestId === r.requestId && toNum(x.requestedQty) > 0; });
  if (!lines.length) fail(ERR.VALIDATION, 'This request has no items.');
  var overrides = {};
  (Array.isArray(params.items) ? params.items : []).forEach(function (o) { if (o && o.requestItemId !== undefined) overrides[o.requestItemId] = o.approvedQty; });
  var items = indexBy(table(SHEETS.ITEMS).read(), 'itemId');
  var balances = getBalances();
  var reserve = getSettingBool('reserveOnApproval');
  var total = 0;
  var decided = lines.map(function (l) {
    var requested = toNum(l.requestedQty);
    var approved = overrides[l.requestItemId] === undefined ? requested : requireNonNegativeInt(overrides[l.requestItemId], 'Approved quantity for ' + (items[l.itemId] || {}).sku);
    if (approved > requested) fail(ERR.VALIDATION, 'Approved quantity cannot exceed the requested quantity for ' + (items[l.itemId] || {}).sku + '.');
    if (reserve && approved > 0) {
      var b = balances[l.itemId] || { availableQty: 0 };
      if (approved > b.availableQty) fail(ERR.INSUFFICIENT_STOCK, 'Only ' + b.availableQty + ' available for ' + (items[l.itemId] || {}).name + '; reduce the approved quantity.', 409);
    }
    total += approved;
    return { requestItemId: l.requestItemId, approvedQty: approved };
  });
  if (total <= 0) fail(ERR.VALIDATION, 'Approve at least one unit, or reject the request instead.');
  decided.forEach(function (d) { ri.update(d.requestItemId, { approvedQty: d.approvedQty, fulfilledQty: 0 }); });
  var now = nowIso();
  t.update(r.requestId, { status: STATUS.REQUEST.APPROVED, approvedBy: ctx.user.name || ctx.user.email, decidedAt: now, decisionNotes: optionalString(params, 'decisionNotes', 1000), updatedAt: now, updatedBy: ctx.user.email });
  writeAudit(ctx.user.email, 'requests.approve', 'Requests', r.requestId, 'Approved request ' + r.requestNumber + ' (' + total + ' units)', ctx.requestId, { lines: decided });
  return requestsGet({ requestId: r.requestId }, ctx);
}

function requestsReject(params, ctx) {
  requirePermission(ctx.user, 'requests.decide');
  var t = table(SHEETS.REQUESTS);
  var r = t.findById(params.requestId);
  if (!r) fail(ERR.NOT_FOUND, 'Request not found.', 404);
  if (r.status === STATUS.REQUEST.REJECTED) return requestsGet({ requestId: r.requestId }, ctx);
  assertTransition(r.status, STATUS.REQUEST.REJECTED);
  var now = nowIso();
  t.update(r.requestId, { status: STATUS.REQUEST.REJECTED, approvedBy: ctx.user.name || ctx.user.email, decidedAt: now, decisionNotes: requireString(params, 'decisionNotes', 'Reason', 1000), updatedAt: now, updatedBy: ctx.user.email });
  writeAudit(ctx.user.email, 'requests.reject', 'Requests', r.requestId, 'Rejected request ' + r.requestNumber, ctx.requestId, null);
  return requestsGet({ requestId: r.requestId }, ctx);
}

function requestsCancel(params, ctx) {
  var t = table(SHEETS.REQUESTS);
  var r = t.findById(params.requestId);
  if (!r) fail(ERR.NOT_FOUND, 'Request not found.', 404);
  if (hasPermission(ctx.user, 'requests.decide')) {
    // ok: any cancellable status
  } else if (ctx.user.role === ROLES.CONGREGATION_USER && r.congregationId === ctx.user.congregationId) {
    if ([STATUS.REQUEST.DRAFT, STATUS.REQUEST.PENDING].indexOf(r.status) === -1) fail(ERR.FORBIDDEN, 'Approved requests can only be cancelled by the inventory team.', 403);
  } else {
    fail(ERR.FORBIDDEN, 'You do not have permission to cancel this request.', 403);
  }
  if (r.status === STATUS.REQUEST.CANCELLED) return requestsGet({ requestId: r.requestId }, ctx);
  assertTransition(r.status, STATUS.REQUEST.CANCELLED);
  var now = nowIso();
  var reason = optionalString(params, 'reason', 500);
  // Reservation release is automatic: reservations are computed only from Approved / Partially Fulfilled requests.
  t.update(r.requestId, { status: STATUS.REQUEST.CANCELLED, decisionNotes: reason ? 'Cancelled: ' + reason : (r.decisionNotes || 'Cancelled'), updatedAt: now, updatedBy: ctx.user.email });
  writeAudit(ctx.user.email, 'requests.cancel', 'Requests', r.requestId, 'Cancelled request ' + r.requestNumber, ctx.requestId, { reason: reason, previousStatus: r.status });
  return requestsGet({ requestId: r.requestId }, ctx);
}

/** Recomputes status from fulfilled vs approved quantities after a distribution (inside the lock). */
function refreshRequestStatus(requestId, ctx) {
  var t = table(SHEETS.REQUESTS);
  var r = t.findById(requestId);
  if (!r) return null;
  if ([STATUS.REQUEST.APPROVED, STATUS.REQUEST.PARTIALLY_FULFILLED, STATUS.REQUEST.FULFILLED].indexOf(r.status) === -1) return r;
  var lines = table(SHEETS.REQUEST_ITEMS).read().filter(function (x) { return x.requestId === requestId; });
  var approved = 0, fulfilled = 0;
  lines.forEach(function (l) { approved += toNum(l.approvedQty); fulfilled += Math.min(toNum(l.approvedQty), toNum(l.fulfilledQty)); });
  var next = fulfilled <= 0 ? STATUS.REQUEST.APPROVED : (fulfilled >= approved ? STATUS.REQUEST.FULFILLED : STATUS.REQUEST.PARTIALLY_FULFILLED);
  if (next !== r.status) r = t.update(requestId, { status: next, updatedAt: nowIso(), updatedBy: ctx.user ? ctx.user.email : 'system' });
  return r;
}
