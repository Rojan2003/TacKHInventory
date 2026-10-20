/**
 * 10_Distributions.js
 * Releasing stock to a congregation.
 *
 * Write order inside the lock (so an interruption is detectable and repairable by adminReconcile):
 *   1. Distribution header (status Processing) + DistributionItems
 *   2. Ledger rows (DISTRIBUTION_OUT, refId = distributionId) + balances
 *   3. RequestItems.fulfilledQty + request status
 *   4. Distribution status -> Released
 * Google Sheets has no transactions. Steps are ordered so that the ledger is never written twice for the
 * same distribution and so partial writes can be finalized or flagged by the reconcile routine.
 */

function distributionLines(distributionId, items) {
  return table(SHEETS.DISTRIBUTION_ITEMS).read().filter(function (x) { return x.distributionId === distributionId; }).map(function (x) {
    var i = items[x.itemId] || {};
    return { distributionItemId: x.distributionItemId, itemId: x.itemId, sku: i.sku || '', itemName: i.name || '', unit: i.unit || 'pcs', quantity: toNum(x.quantity), requestItemId: x.requestItemId || '' };
  });
}

function publicDistribution(d, congs, items, requests, withItems) {
  var c = congs[d.destinationCongregationId];
  var r = requests ? requests[d.requestId] : null;
  var lines = distributionLines(d.distributionId, items);
  var out = {
    distributionId: d.distributionId, reference: d.reference, requestId: d.requestId || '', requestNumber: r ? r.requestNumber : '',
    destinationCongregationId: d.destinationCongregationId, destinationName: c ? c.name : '', destinationCode: c ? c.code : '',
    releasedBy: d.releasedBy || '', receivedBy: d.receivedBy || '', status: d.status, notes: d.notes || '',
    createdAt: d.createdAt, createdBy: d.createdBy, receivedAt: d.receivedAt || '', receivedConfirmedBy: d.receivedConfirmedBy || '', updatedAt: d.updatedAt || '',
    itemCount: lines.length, totalQty: lines.reduce(function (s, l) { return s + l.quantity; }, 0)
  };
  if (withItems) out.items = lines;
  return out;
}

function distributionsList(params, ctx) {
  var scope = requireScope(ctx.user, 'distributions.view.all', 'distributions.view.own');
  var congs = indexBy(table(SHEETS.CONGREGATIONS).read(), 'congregationId');
  var items = indexBy(table(SHEETS.ITEMS).read(), 'itemId');
  var requests = indexBy(table(SHEETS.REQUESTS).read(), 'requestId');
  var rows = table(SHEETS.DISTRIBUTIONS).read().filter(function (d) {
    if (!scope.all && d.destinationCongregationId !== scope.congregationId) return false;
    if (params.congregationId && d.destinationCongregationId !== params.congregationId) return false;
    if (params.status && d.status !== params.status) return false;
    if (params.requestId && d.requestId !== params.requestId) return false;
    if ((params.from || params.to) && !inDateRange(d.createdAt, params.from, params.to)) return false;
    return true;
  }).map(function (d) { return publicDistribution(d, congs, items, requests, false); })
    .filter(function (d) { return textMatches(d, ['reference', 'requestNumber', 'destinationName', 'releasedBy', 'receivedBy', 'notes', 'status'], params.query); });
  rows = sortRows(rows, params.sortBy || 'createdAt', params.sortDir || 'desc');
  return paginate(rows, params);
}

function distributionsGet(params, ctx) {
  var scope = requireScope(ctx.user, 'distributions.view.all', 'distributions.view.own');
  var d = table(SHEETS.DISTRIBUTIONS).findById(params.distributionId);
  if (!d) fail(ERR.NOT_FOUND, 'Distribution not found.', 404);
  assertScopeCongregation(scope, d.destinationCongregationId);
  var congs = indexBy(table(SHEETS.CONGREGATIONS).read(), 'congregationId');
  var items = indexBy(table(SHEETS.ITEMS).read(), 'itemId');
  var requests = indexBy(table(SHEETS.REQUESTS).read(), 'requestId');
  var out = publicDistribution(d, congs, items, requests, true);
  var coordinator = getCoordinatorCongregation();
  out.receipt = {
    appName: CONFIG.APP_NAME, issuedBy: coordinator.name, issuedByCode: coordinator.code,
    reference: out.reference, requestNumber: out.requestNumber, destination: out.destinationName, releasedBy: out.releasedBy,
    receivedBy: out.receivedBy, releasedAt: out.createdAt, status: out.status, notes: out.notes, items: out.items, totalQty: out.totalQty
  };
  return out;
}

function distributionsCreate(params, ctx) {
  requirePermission(ctx.user, 'distributions.create');
  var lines = params.items;
  if (!Array.isArray(lines) || !lines.length) fail(ERR.VALIDATION, 'At least one literature item is required.');
  if (lines.length > 200) fail(ERR.VALIDATION, 'A distribution may contain at most 200 lines.');
  var items = indexBy(table(SHEETS.ITEMS).read(), 'itemId');
  var coordinator = getCoordinatorCongregation();
  var releasedBy = optionalString(params, 'releasedBy', 120) || ctx.user.name || ctx.user.email;
  var receivedBy = optionalString(params, 'receivedBy', 120);
  var notes = optionalString(params, 'notes', 1000);

  var request = null, destination = null, requestLinesByItem = {};
  if (isNonEmptyString(params.requestId)) {
    request = table(SHEETS.REQUESTS).findById(params.requestId);
    if (!request) fail(ERR.NOT_FOUND, 'Request not found.', 404);
    if ([STATUS.REQUEST.APPROVED, STATUS.REQUEST.PARTIALLY_FULFILLED].indexOf(request.status) === -1) {
      fail(ERR.INVALID_TRANSITION, 'Only approved or partially fulfilled requests can be distributed. This request is "' + request.status + '".', 409);
    }
    destination = requireCongregation(request.congregationId, 'Destination congregation');
    table(SHEETS.REQUEST_ITEMS).read().forEach(function (ri) { if (ri.requestId === request.requestId) requestLinesByItem[ri.itemId] = ri; });
  } else {
    if (!getSettingBool('allowAdHocDistribution')) fail(ERR.VALIDATION, 'Distributions must be made against an approved request.');
    destination = requireCongregation(params.destinationCongregationId, 'Destination congregation');
  }
  if (destination.congregationId === coordinator.congregationId) fail(ERR.VALIDATION, 'Stock cannot be distributed to the coordinating congregation itself.');

  var balances = getBalances();
  var seen = {};
  var validated = lines.map(function (l) {
    var itemId = requireString(l, 'itemId', 'Literature item');
    var item = items[itemId];
    if (!item) fail(ERR.NOT_FOUND, 'Literature item not found: ' + itemId, 404);
    if (seen[itemId]) fail(ERR.VALIDATION, 'Item ' + item.sku + ' appears more than once.');
    seen[itemId] = true;
    var qty = requirePositiveInt(l.quantity, 'Quantity for ' + item.sku);
    var b = balances[itemId] || { physicalQty: 0, reservedQty: 0, availableQty: 0 };
    var requestItemId = '';
    if (request) {
      var ri = requestLinesByItem[itemId];
      if (!ri) fail(ERR.VALIDATION, item.sku + ' is not part of request ' + request.requestNumber + '.');
      var remaining = Math.max(0, toNum(ri.approvedQty) - toNum(ri.fulfilledQty));
      if (qty > remaining) fail(ERR.VALIDATION, 'Only ' + remaining + ' remaining to fulfil for ' + item.sku + ' on ' + request.requestNumber + '.');
      requestItemId = ri.requestItemId;
      // This request's own reservation is usable, other reservations are not.
      var usable = b.physicalQty - (b.reservedQty - Math.min(b.reservedQty, remaining));
      if (qty > usable) fail(ERR.INSUFFICIENT_STOCK, 'Insufficient stock for ' + item.name + ': ' + usable + ' usable, ' + qty + ' requested.', 409);
    } else if (qty > b.availableQty) {
      fail(ERR.INSUFFICIENT_STOCK, 'Insufficient available stock for ' + item.name + ': ' + b.availableQty + ' available, ' + qty + ' requested.', 409);
    }
    if (qty > b.physicalQty) fail(ERR.INSUFFICIENT_STOCK, 'Insufficient physical stock for ' + item.name + '.', 409);
    return { itemId: itemId, quantity: qty, requestItemId: requestItemId };
  });

  var now = nowIso();
  var d = {
    distributionId: newId('dst'), reference: nextReference(SHEETS.DISTRIBUTIONS, 'reference', getSetting('distributionReferencePrefix') || 'DST'),
    requestId: request ? request.requestId : '', destinationCongregationId: destination.congregationId, releasedBy: releasedBy, receivedBy: receivedBy,
    status: STATUS.DISTRIBUTION.PROCESSING, notes: notes, createdAt: now, createdBy: ctx.user.email, receivedAt: '', receivedConfirmedBy: '', updatedAt: now
  };
  // 1) header + lines
  table(SHEETS.DISTRIBUTIONS).append(d);
  table(SHEETS.DISTRIBUTION_ITEMS).append(validated.map(function (v) {
    return { distributionItemId: newId('dsi'), distributionId: d.distributionId, itemId: v.itemId, quantity: v.quantity, requestItemId: v.requestItemId };
  }));
  // 2) ledger
  postTransactions(validated.map(function (v) {
    return { type: TXN_TYPES.DISTRIBUTION_OUT, itemId: v.itemId, quantity: -v.quantity, refType: 'DISTRIBUTION', refId: d.distributionId,
      counterpartyCongregationId: destination.congregationId, notes: 'Distribution ' + d.reference + ' to ' + destination.name };
  }), ctx);
  // 3) request fulfilment
  if (request) {
    var ri = table(SHEETS.REQUEST_ITEMS);
    validated.forEach(function (v) {
      var line = ri.findById(v.requestItemId);
      ri.update(v.requestItemId, { fulfilledQty: toNum(line.fulfilledQty) + v.quantity });
    });
    refreshRequestStatus(request.requestId, ctx);
  }
  // 4) finalize
  table(SHEETS.DISTRIBUTIONS).update(d.distributionId, { status: STATUS.DISTRIBUTION.RELEASED, updatedAt: nowIso() });
  writeAudit(ctx.user.email, 'distributions.create', 'Distributions', d.distributionId,
    'Released ' + d.reference + ' to ' + destination.name + (request ? ' for ' + request.requestNumber : ''), ctx.requestId, { lines: validated });
  return distributionsGet({ distributionId: d.distributionId }, ctx);
}

function distributionsConfirmReceipt(params, ctx) {
  requirePermission(ctx.user, 'distributions.confirm');
  var t = table(SHEETS.DISTRIBUTIONS);
  var d = t.findById(params.distributionId);
  if (!d) fail(ERR.NOT_FOUND, 'Distribution not found.', 404);
  if (ctx.user.role === ROLES.CONGREGATION_USER && d.destinationCongregationId !== ctx.user.congregationId) {
    fail(ERR.FORBIDDEN, 'You may only confirm receipt for your own congregation.', 403);
  }
  if (d.status === STATUS.DISTRIBUTION.RECEIVED) return distributionsGet({ distributionId: d.distributionId }, ctx);
  if (d.status !== STATUS.DISTRIBUTION.RELEASED) fail(ERR.INVALID_TRANSITION, 'Only released distributions can be confirmed as received.', 409);
  var now = nowIso();
  t.update(d.distributionId, {
    status: STATUS.DISTRIBUTION.RECEIVED, receivedAt: now, receivedConfirmedBy: ctx.user.email,
    receivedBy: optionalString(params, 'receivedBy', 120) || d.receivedBy || ctx.user.name || ctx.user.email, updatedAt: now
  });
  writeAudit(ctx.user.email, 'distributions.confirmReceipt', 'Distributions', d.distributionId, 'Confirmed receipt of ' + d.reference, ctx.requestId, null);
  return distributionsGet({ distributionId: d.distributionId }, ctx);
}
