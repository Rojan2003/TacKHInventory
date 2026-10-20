/**
 * 12_Reports.js
 * Tabular reports. Every report returns { title, columns:[{key,label}], rows:[...], generatedAt, filters }
 * so the frontend can render, print and export CSV uniformly. Rows come from the ledger and the
 * transactional sheets; nothing is hardcoded.
 */

function reportsRun(params, ctx) {
  var scope;
  if (hasPermission(ctx.user, 'reports.view')) scope = { all: true, congregationId: null };
  else scope = requireScope(ctx.user, 'reports.view', 'reports.view.own');
  var type = requireString(params, 'type', 'Report type');
  var from = params.from ? toIsoDate(params.from) : '', to = params.to ? toIsoDate(params.to) : '';
  var congregationId = scope.all ? (params.congregationId || '') : scope.congregationId;
  var filters = { from: from, to: to, congregationId: congregationId };
  var builders = {
    inventory: reportInventory, lowStock: reportLowStock, deliveries: reportDeliveries, distributions: reportDistributions,
    requests: reportRequests, transactions: reportTransactions, congregationSummary: reportCongregationSummary, monthly: reportMonthly,
    legacyEastInventory: reportLegacyEastInventory, legacyDistribution: reportLegacyDistribution
  };
  var ownAllowed = ['distributions', 'requests', 'congregationSummary'];
  if (!scope.all && ownAllowed.indexOf(type) === -1) fail(ERR.FORBIDDEN, 'This report is not available for your role.', 403);
  var builder = builders[type];
  if (!builder) fail(ERR.VALIDATION, 'Unknown report type: ' + type);
  var report = builder(filters, ctx);
  report.type = type;
  report.generatedAt = nowIso();
  report.generatedBy = ctx.user.email;
  report.filters = filters;
  return report;
}

function reportInventory(f) {
  var balances = getBalances();
  var rows = table(SHEETS.ITEMS).read().filter(function (i) { return toBool(i.active); }).map(function (i) {
    var p = publicItem(i, balances[i.itemId]);
    return { sku: p.sku, name: p.name, category: p.category, unit: p.unit, physicalQty: p.physicalQty, reservedQty: p.reservedQty, availableQty: p.availableQty, minStock: p.lowStockThreshold, lowStock: p.isLowStock ? 'Yes' : 'No', lastMovementAt: p.lastMovementAt };
  });
  return { title: 'Current Inventory (East Congregation)', columns: cols(['sku:Item Code', 'name:Literature', 'category:Category', 'unit:Unit', 'physicalQty:Physical', 'reservedQty:Reserved', 'availableQty:Available', 'minStock:Min Stock', 'lowStock:Low Stock', 'lastMovementAt:Last Movement']), rows: sortRows(rows, 'name', 'asc') };
}

function reportLowStock(f) {
  var inv = reportInventory(f);
  inv.title = 'Low-Stock Items';
  inv.rows = inv.rows.filter(function (r) { return r.lowStock === 'Yes'; });
  return inv;
}

function reportDeliveries(f) {
  var congs = indexBy(table(SHEETS.CONGREGATIONS).read(), 'congregationId');
  var items = indexBy(table(SHEETS.ITEMS).read(), 'itemId');
  var deliveries = indexBy(table(SHEETS.DELIVERIES).read().filter(function (d) {
    if ((f.from || f.to) && !inDateRange(d.deliveryDate, f.from, f.to)) return false;
    if (f.congregationId && d.sourceCongregationId !== f.congregationId) return false;
    return true;
  }), 'deliveryId');
  var rows = [];
  table(SHEETS.DELIVERY_ITEMS).read().forEach(function (di) {
    var d = deliveries[di.deliveryId]; if (!d || toNum(di.quantity) <= 0) return;
    var i = items[di.itemId] || {};
    rows.push({ reference: d.reference, deliveryDate: toIsoDate(d.deliveryDate), source: d.sourceType === 'congregation' && congs[d.sourceCongregationId] ? congs[d.sourceCongregationId].name : d.sourceName, sku: i.sku || '', name: i.name || '', quantity: toNum(di.quantity), status: d.status, receivedBy: d.receivedBy, confirmedAt: d.confirmedAt || '' });
  });
  return { title: 'Incoming Deliveries', columns: cols(['reference:Reference', 'deliveryDate:Date', 'source:Source', 'sku:Item Code', 'name:Literature', 'quantity:Qty', 'status:Status', 'receivedBy:Received By', 'confirmedAt:Confirmed At']), rows: sortRows(rows, 'deliveryDate', 'desc') };
}

function reportDistributions(f) {
  var congs = indexBy(table(SHEETS.CONGREGATIONS).read(), 'congregationId');
  var items = indexBy(table(SHEETS.ITEMS).read(), 'itemId');
  var requests = indexBy(table(SHEETS.REQUESTS).read(), 'requestId');
  var dists = indexBy(table(SHEETS.DISTRIBUTIONS).read().filter(function (d) {
    if (d.status === STATUS.DISTRIBUTION.FAILED) return false;
    if ((f.from || f.to) && !inDateRange(d.createdAt, f.from, f.to)) return false;
    if (f.congregationId && d.destinationCongregationId !== f.congregationId) return false;
    return true;
  }), 'distributionId');
  var rows = [];
  table(SHEETS.DISTRIBUTION_ITEMS).read().forEach(function (x) {
    var d = dists[x.distributionId]; if (!d) return;
    var i = items[x.itemId] || {}; var r = requests[d.requestId];
    rows.push({ reference: d.reference, date: toIsoDate(d.createdAt), destination: (congs[d.destinationCongregationId] || {}).name || '', requestNumber: r ? r.requestNumber : '', sku: i.sku || '', name: i.name || '', quantity: toNum(x.quantity), status: d.status, releasedBy: d.releasedBy, receivedAt: d.receivedAt || '' });
  });
  return { title: 'Distribution History', columns: cols(['reference:Reference', 'date:Date', 'destination:Congregation', 'requestNumber:Request', 'sku:Item Code', 'name:Literature', 'quantity:Qty', 'status:Status', 'releasedBy:Released By', 'receivedAt:Received At']), rows: sortRows(rows, 'date', 'desc') };
}

function reportRequests(f) {
  var congs = indexBy(table(SHEETS.CONGREGATIONS).read(), 'congregationId');
  var items = indexBy(table(SHEETS.ITEMS).read(), 'itemId');
  var reqs = indexBy(table(SHEETS.REQUESTS).read().filter(function (r) {
    if ((f.from || f.to) && !inDateRange(r.requestDate, f.from, f.to)) return false;
    if (f.congregationId && r.congregationId !== f.congregationId) return false;
    return true;
  }), 'requestId');
  var rows = [];
  table(SHEETS.REQUEST_ITEMS).read().forEach(function (ri) {
    var r = reqs[ri.requestId]; if (!r || toNum(ri.requestedQty) <= 0) return;
    var i = items[ri.itemId] || {};
    rows.push({ requestNumber: r.requestNumber, requestDate: toIsoDate(r.requestDate), congregation: (congs[r.congregationId] || {}).name || '', sku: i.sku || '', name: i.name || '', requestedQty: toNum(ri.requestedQty), approvedQty: toNum(ri.approvedQty), fulfilledQty: toNum(ri.fulfilledQty), remainingQty: Math.max(0, toNum(ri.approvedQty) - toNum(ri.fulfilledQty)), status: r.status, requestedBy: r.requestedBy, approvedBy: r.approvedBy });
  });
  return { title: 'Requests and Fulfilment', columns: cols(['requestNumber:Request', 'requestDate:Date', 'congregation:Congregation', 'sku:Item Code', 'name:Literature', 'requestedQty:Requested', 'approvedQty:Approved', 'fulfilledQty:Fulfilled', 'remainingQty:Remaining', 'status:Status', 'requestedBy:Requested By', 'approvedBy:Decided By']), rows: sortRows(rows, 'requestDate', 'desc') };
}

function reportTransactions(f) {
  var rows = listTransactions({ from: f.from, to: f.to, congregationId: f.congregationId }).map(function (t) {
    return { timestamp: t.timestamp, type: t.type, sku: t.sku, name: t.itemName, quantity: t.quantity, counterparty: t.counterpartyName, refType: t.refType, refId: t.refId, actor: t.actor, notes: t.notes };
  });
  return { title: 'Stock Movements (Ledger)', columns: cols(['timestamp:Timestamp', 'type:Type', 'sku:Item Code', 'name:Literature', 'quantity:Qty (+/-)', 'counterparty:Counterparty', 'refType:Ref Type', 'refId:Ref ID', 'actor:Actor', 'notes:Notes']), rows: sortRows(rows, 'timestamp', 'desc') };
}

/** One row per congregation: what East released to them and what they confirmed, plus open requests. No double counting with East stock. */
function reportCongregationSummary(f) {
  var congs = table(SHEETS.CONGREGATIONS).read().filter(function (c) { return toBool(c.active) && (!f.congregationId || c.congregationId === f.congregationId); });
  var coordinator = getCoordinatorCongregation();
  var dists = table(SHEETS.DISTRIBUTIONS).read().filter(function (d) { return d.status !== STATUS.DISTRIBUTION.FAILED && d.status !== STATUS.DISTRIBUTION.PROCESSING && ((!f.from && !f.to) || inDateRange(d.createdAt, f.from, f.to)); });
  var distMap = indexBy(dists, 'distributionId');
  var released = {}, received = {}, inTransit = {}, count = {};
  table(SHEETS.DISTRIBUTION_ITEMS).read().forEach(function (x) {
    var d = distMap[x.distributionId]; if (!d) return;
    var c = d.destinationCongregationId, q = toNum(x.quantity);
    released[c] = (released[c] || 0) + q;
    if (d.status === STATUS.DISTRIBUTION.RECEIVED) received[c] = (received[c] || 0) + q; else inTransit[c] = (inTransit[c] || 0) + q;
  });
  dists.forEach(function (d) { count[d.destinationCongregationId] = (count[d.destinationCongregationId] || 0) + 1; });
  var reqs = table(SHEETS.REQUESTS).read().filter(function (r) { return (!f.from && !f.to) || inDateRange(r.requestDate, f.from, f.to); });
  var open = {}, pending = {}, reqCount = {};
  var openIds = {};
  reqs.forEach(function (r) {
    reqCount[r.congregationId] = (reqCount[r.congregationId] || 0) + 1;
    if (r.status === STATUS.REQUEST.PENDING) pending[r.congregationId] = (pending[r.congregationId] || 0) + 1;
    if ([STATUS.REQUEST.APPROVED, STATUS.REQUEST.PARTIALLY_FULFILLED].indexOf(r.status) !== -1) openIds[r.requestId] = r.congregationId;
  });
  table(SHEETS.REQUEST_ITEMS).read().forEach(function (ri) { var c = openIds[ri.requestId]; if (c) open[c] = (open[c] || 0) + Math.max(0, toNum(ri.approvedQty) - toNum(ri.fulfilledQty)); });
  var balances = getBalances();
  var eastPhysical = 0, eastReserved = 0;
  Object.keys(balances).forEach(function (k) { eastPhysical += balances[k].physicalQty; eastReserved += balances[k].reservedQty; });
  var rows = congs.map(function (c) {
    var isCoord = c.congregationId === coordinator.congregationId;
    return { congregation: c.name, role: isCoord ? 'Coordinator (holds stock)' : 'Member', physicalQty: isCoord ? eastPhysical : '', reservedQty: isCoord ? eastReserved : '', releasedQty: isCoord ? '' : (released[c.congregationId] || 0), receivedQty: isCoord ? '' : (received[c.congregationId] || 0), inTransitQty: isCoord ? '' : (inTransit[c.congregationId] || 0), outstandingQty: isCoord ? '' : (open[c.congregationId] || 0), pendingRequests: isCoord ? '' : (pending[c.congregationId] || 0), requests: isCoord ? '' : (reqCount[c.congregationId] || 0), distributions: isCoord ? '' : (count[c.congregationId] || 0) };
  });
  return { title: 'Congregation Stock Summary', columns: cols(['congregation:Congregation', 'role:Role', 'physicalQty:Physical (East)', 'reservedQty:Reserved (East)', 'releasedQty:Released to', 'receivedQty:Confirmed Received', 'inTransitQty:In Transit', 'outstandingQty:Outstanding Approved', 'pendingRequests:Pending Requests', 'requests:Requests', 'distributions:Distributions']), rows: rows };
}

function reportMonthly(f) {
  var txns = listTransactions({ from: f.from, to: f.to, congregationId: f.congregationId });
  var byMonth = {};
  txns.forEach(function (t) {
    var m = monthKey(t.timestamp); if (!m) return;
    var row = byMonth[m] || (byMonth[m] = { month: m, deliveredQty: 0, openingQty: 0, distributedQty: 0, adjustedQty: 0, netChange: 0, transactions: 0 });
    row.transactions += 1; row.netChange += t.quantity;
    if (t.type === TXN_TYPES.DELIVERY_IN) row.deliveredQty += t.quantity;
    else if (t.type === TXN_TYPES.OPENING_BALANCE) row.openingQty += t.quantity;
    else if (t.type === TXN_TYPES.DISTRIBUTION_OUT) row.distributedQty += Math.abs(t.quantity);
    else row.adjustedQty += t.quantity;
  });
  var rows = Object.keys(byMonth).sort().reverse().map(function (m) { return byMonth[m]; });
  return { title: 'Monthly Summary', columns: cols(['month:Month', 'deliveredQty:Delivered In', 'openingQty:Opening Balances', 'distributedQty:Distributed Out', 'adjustedQty:Adjustments', 'netChange:Net Change', 'transactions:Transactions']), rows: rows };
}

/** Legacy worksheets, read only, preserved for the original monthly report. */
function reportLegacyEastInventory(f) {
  var data = readLegacySheet(CONFIG.LEGACY_SHEETS.EAST_INVENTORY);
  var rows = data.rows.filter(function (r) { return (!f.from && !f.to) || inDateRange(r.Date, f.from, f.to); });
  return { title: 'Legacy East_Inventory worksheet', columns: data.headers.map(function (h) { return { key: h, label: h }; }), rows: rows };
}

function reportLegacyDistribution(f) {
  var data = readLegacySheet(CONFIG.LEGACY_SHEETS.DISTRIBUTION);
  var congName = f.congregationId ? (table(SHEETS.CONGREGATIONS).findById(f.congregationId) || {}).code : '';
  var rows = data.rows.filter(function (r) {
    if ((f.from || f.to) && !inDateRange(r.Date, f.from, f.to)) return false;
    if (congName && String(r.Congregation || '').toUpperCase() !== String(congName).toUpperCase()) return false;
    return true;
  });
  return { title: 'Legacy Distribution worksheet', columns: data.headers.map(function (h) { return { key: h, label: h }; }), rows: rows };
}

function cols(specs) {
  return specs.map(function (s) { var p = s.split(':'); return { key: p[0], label: p[1] || p[0] }; });
}
