/**
 * 07_Inventory.js
 * The inventory ledger (InventoryTransactions) is the source of truth for physical stock held by the
 * coordinating congregation. InventoryBalances is a materialized cache of SUM(quantity) per item and is
 * rebuilt by reconcile(). Reserved stock is derived from open approved requests, never stored.
 *
 *   physicalQty  = SUM(ledger.quantity) for the item
 *   reservedQty  = SUM(approvedQty - fulfilledQty) over requests in Approved / Partially Fulfilled   (if reserveOnApproval)
 *   availableQty = physicalQty - reservedQty
 */

/** Map itemId -> reserved quantity. */
function computeReservations() {
  var reserved = {};
  if (!getSettingBool('reserveOnApproval')) return reserved;
  var openStatuses = [STATUS.REQUEST.APPROVED, STATUS.REQUEST.PARTIALLY_FULFILLED];
  var openRequests = {};
  table(SHEETS.REQUESTS).read().forEach(function (r) { if (openStatuses.indexOf(r.status) !== -1) openRequests[r.requestId] = true; });
  table(SHEETS.REQUEST_ITEMS).read().forEach(function (ri) {
    if (!openRequests[ri.requestId]) return;
    var remaining = Math.max(0, toNum(ri.approvedQty) - toNum(ri.fulfilledQty));
    reserved[ri.itemId] = (reserved[ri.itemId] || 0) + remaining;
  });
  return reserved;
}

/** Map itemId -> { physicalQty, reservedQty, availableQty, lastMovementAt }. */
function getBalances() {
  var reserved = computeReservations();
  var out = {};
  table(SHEETS.BALANCES).read().forEach(function (b) {
    var physical = toNum(b.physicalQty);
    var res = reserved[b.itemId] || 0;
    out[b.itemId] = { physicalQty: physical, reservedQty: res, availableQty: physical - res, lastMovementAt: b.updatedAt || '' };
  });
  Object.keys(reserved).forEach(function (itemId) {
    if (!out[itemId]) out[itemId] = { physicalQty: 0, reservedQty: reserved[itemId], availableQty: -reserved[itemId], lastMovementAt: '' };
  });
  return out;
}

function sumLedgerByItem() {
  var sums = {};
  table(SHEETS.TRANSACTIONS).read().forEach(function (t) { sums[t.itemId] = (sums[t.itemId] || 0) + toNum(t.quantity); });
  return sums;
}

/**
 * Appends ledger rows and updates balances. MUST be called inside withLock().
 * Validates that no item balance goes negative before writing anything.
 * txns: [{ type, itemId, quantity, refType, refId, counterpartyCongregationId?, notes?, timestamp? }]
 */
function postTransactions(txns, ctx) {
  if (!txns || !txns.length) return [];
  var coordinator = getCoordinatorCongregation();
  var balancesTable = table(SHEETS.BALANCES);
  var current = {};
  balancesTable.read().forEach(function (b) { current[b.itemId] = toNum(b.physicalQty); });
  var items = indexBy(table(SHEETS.ITEMS).read(), 'itemId');

  // Validate first (all or nothing from the validation point of view).
  var projected = {};
  txns.forEach(function (t) {
    if (!items[t.itemId]) fail(ERR.NOT_FOUND, 'Literature item not found: ' + t.itemId, 404);
    var q = Number(t.quantity);
    if (!isFinite(q) || Math.floor(q) !== q || q === 0) fail(ERR.VALIDATION, 'Transaction quantity must be a non-zero whole number.');
    var before = projected[t.itemId] === undefined ? (current[t.itemId] || 0) : projected[t.itemId];
    var after = before + q;
    if (after < 0) fail(ERR.INSUFFICIENT_STOCK, 'Insufficient stock for ' + items[t.itemId].name + ' (' + items[t.itemId].sku + '): available ' + before + ', requested ' + Math.abs(q) + '.', 409);
    projected[t.itemId] = after;
  });

  var now = nowIso();
  var rows = txns.map(function (t) {
    return {
      txnId: newId('txn'), timestamp: t.timestamp || now, type: t.type, itemId: t.itemId, quantity: Number(t.quantity),
      holderCongregationId: coordinator.congregationId, refType: t.refType || '', refId: t.refId || '',
      counterpartyCongregationId: t.counterpartyCongregationId || '', actor: ctx.user ? ctx.user.email : 'system',
      notes: t.notes || '', requestKey: ctx.requestId || ''
    };
  });
  // 1) ledger (source of truth) 2) balances cache. If 2 fails, reconcile() repairs it from 1.
  table(SHEETS.TRANSACTIONS).append(rows);
  Object.keys(projected).forEach(function (itemId) {
    var lastTxn = rows.filter(function (r) { return r.itemId === itemId; }).pop();
    if (current[itemId] === undefined) balancesTable.append({ itemId: itemId, physicalQty: projected[itemId], lastTxnId: lastTxn.txnId, updatedAt: now });
    else balancesTable.update(itemId, { physicalQty: projected[itemId], lastTxnId: lastTxn.txnId, updatedAt: now });
  });
  return rows;
}

/** Ledger rows for one item, newest first, with running balance. */
function itemLedger(itemId) {
  var congs = indexBy(table(SHEETS.CONGREGATIONS).read(), 'congregationId');
  var rows = table(SHEETS.TRANSACTIONS).read().filter(function (t) { return t.itemId === itemId; });
  rows = sortRows(rows, 'timestamp', 'asc');
  var running = 0;
  var out = rows.map(function (t) {
    running += toNum(t.quantity);
    var cp = congs[t.counterpartyCongregationId];
    return {
      txnId: t.txnId, timestamp: t.timestamp, type: t.type, quantity: toNum(t.quantity), balanceAfter: running,
      refType: t.refType, refId: t.refId, counterpartyCongregationId: t.counterpartyCongregationId || '',
      counterpartyName: cp ? cp.name : '', actor: t.actor, notes: t.notes || ''
    };
  });
  return out.reverse();
}

/** Ledger rows across all items with item details, filtered by date and type. */
function listTransactions(params) {
  var items = indexBy(table(SHEETS.ITEMS).read(), 'itemId');
  var congs = indexBy(table(SHEETS.CONGREGATIONS).read(), 'congregationId');
  var rows = table(SHEETS.TRANSACTIONS).read().filter(function (t) {
    if (params.type && t.type !== params.type) return false;
    if (params.itemId && t.itemId !== params.itemId) return false;
    if (params.congregationId && t.counterpartyCongregationId !== params.congregationId) return false;
    if ((params.from || params.to) && !inDateRange(t.timestamp, params.from, params.to)) return false;
    return true;
  }).map(function (t) {
    var i = items[t.itemId] || {};
    var cp = congs[t.counterpartyCongregationId];
    return {
      txnId: t.txnId, timestamp: t.timestamp, type: t.type, itemId: t.itemId, sku: i.sku || '', itemName: i.name || '',
      quantity: toNum(t.quantity), refType: t.refType, refId: t.refId, counterpartyCongregationId: t.counterpartyCongregationId || '',
      counterpartyName: cp ? cp.name : '', actor: t.actor, notes: t.notes || ''
    };
  });
  return rows.filter(function (r) { return textMatches(r, ['sku', 'itemName', 'refId', 'actor', 'notes', 'counterpartyName'], params.query); });
}

function transactionsList(params, ctx) {
  requirePermission(ctx.user, 'items.view');
  var rows = sortRows(listTransactions(params), params.sortBy || 'timestamp', params.sortDir || 'desc');
  return paginate(rows, params);
}

/**
 * Reconciliation. Rebuilds InventoryBalances from the ledger, recomputes request fulfilledQty from
 * distribution items, and finalizes/flags distributions left in Processing by an interrupted run.
 * Safe to run at any time; it only corrects derived data and never deletes ledger rows.
 */
function adminReconcile(params, ctx) {
  requirePermission(ctx.user, 'admin.reconcile');
  var apply = toBool(params.apply);
  var report = { balanceFixes: [], fulfilledFixes: [], processingDistributions: [], applied: apply };

  // 0) Distributions stuck in Processing: finalize if the ledger was written, otherwise mark Failed.
  //    Done first so that fulfilment (step 2) is computed against the corrected statuses.
  var distributions = indexBy(table(SHEETS.DISTRIBUTIONS).read(), 'distributionId');
  var ledgerByRef = groupBy(table(SHEETS.TRANSACTIONS).read().filter(function (t) { return t.refType === 'DISTRIBUTION'; }), 'refId');
  var effectiveStatus = {};
  var touchedRequests = {};
  Object.keys(distributions).forEach(function (id) {
    var d = distributions[id];
    effectiveStatus[id] = d.status;
    if (d.status !== STATUS.DISTRIBUTION.PROCESSING) return;
    var hasLedger = !!ledgerByRef[id];
    var next = hasLedger ? STATUS.DISTRIBUTION.RELEASED : STATUS.DISTRIBUTION.FAILED;
    effectiveStatus[id] = next;
    report.processingDistributions.push({ distributionId: id, reference: d.reference, ledgerWritten: hasLedger, action: hasLedger ? 'finalize' : 'mark failed' });
    if (apply) {
      table(SHEETS.DISTRIBUTIONS).update(id, { status: next, updatedAt: nowIso() });
      if (d.requestId) touchedRequests[d.requestId] = true;
    }
  });

  // 1) Balances vs ledger
  var sums = sumLedgerByItem();
  var balancesTable = table(SHEETS.BALANCES);
  var balanceRows = indexBy(balancesTable.read(), 'itemId');
  var itemIds = uniq(Object.keys(sums).concat(Object.keys(balanceRows)));
  itemIds.forEach(function (itemId) {
    var ledger = sums[itemId] || 0;
    var cached = balanceRows[itemId] ? toNum(balanceRows[itemId].physicalQty) : null;
    if (cached !== ledger) {
      report.balanceFixes.push({ itemId: itemId, cached: cached, ledger: ledger });
      if (apply) {
        if (balanceRows[itemId]) balancesTable.update(itemId, { physicalQty: ledger, updatedAt: nowIso() });
        else balancesTable.append({ itemId: itemId, physicalQty: ledger, lastTxnId: '', updatedAt: nowIso() });
      }
    }
  });

  // 2) Request item fulfilledQty vs distribution items (only distributions that reached Released/Received)
  var fulfilled = {};
  table(SHEETS.DISTRIBUTION_ITEMS).read().forEach(function (di) {
    var d = distributions[di.distributionId];
    if (!d || !di.requestItemId) return;
    if ([STATUS.DISTRIBUTION.RELEASED, STATUS.DISTRIBUTION.RECEIVED].indexOf(effectiveStatus[di.distributionId]) === -1) return;
    fulfilled[di.requestItemId] = (fulfilled[di.requestItemId] || 0) + toNum(di.quantity);
  });
  var requestItems = table(SHEETS.REQUEST_ITEMS);
  requestItems.read().forEach(function (ri) {
    var expected = fulfilled[ri.requestItemId] || 0;
    if (toNum(ri.fulfilledQty) !== expected) {
      report.fulfilledFixes.push({ requestItemId: ri.requestItemId, requestId: ri.requestId, cached: toNum(ri.fulfilledQty), computed: expected });
      if (apply) { requestItems.update(ri.requestItemId, { fulfilledQty: expected }); touchedRequests[ri.requestId] = true; }
    }
  });
  if (apply) Object.keys(touchedRequests).forEach(function (requestId) { refreshRequestStatus(requestId, ctx); });

  if (apply) {
    writeAudit(ctx.user.email, 'admin.reconcile', 'System', '', 'Reconciliation applied: ' + report.balanceFixes.length + ' balance fixes, ' +
      report.fulfilledFixes.length + ' fulfilment fixes, ' + report.processingDistributions.length + ' distributions', ctx.requestId, report);
  }
  return report;
}
