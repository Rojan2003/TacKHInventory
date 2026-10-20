/**
 * 13_Dashboard.js
 * Live summary figures computed from the sheets. Nothing here is hardcoded.
 */

function dashboardSummary(params, ctx) {
  requirePermission(ctx.user, 'dashboard.view');
  var from = params.from ? toIsoDate(params.from) : '', to = params.to ? toIsoDate(params.to) : '';
  var congregationFilter = params.congregationId || '';
  var isCongUser = ctx.user.role === ROLES.CONGREGATION_USER;
  if (isCongUser) congregationFilter = ctx.user.congregationId || '__none__';

  var items = table(SHEETS.ITEMS).read().filter(function (i) { return toBool(i.active); });
  var balances = getBalances();
  var congs = indexBy(table(SHEETS.CONGREGATIONS).read(), 'congregationId');
  var coordinator = getCoordinatorCongregation();

  var stock = { uniqueItems: items.length, physicalQty: 0, reservedQty: 0, availableQty: 0, lowStockCount: 0, lowStockItems: [] };
  var threshold = toNum(getSetting('defaultLowStockThreshold'), 10);
  items.forEach(function (i) {
    var b = balances[i.itemId] || { physicalQty: 0, reservedQty: 0, availableQty: 0 };
    stock.physicalQty += b.physicalQty; stock.reservedQty += b.reservedQty; stock.availableQty += b.availableQty;
    var min = i.minStock === '' || i.minStock === undefined ? threshold : toNum(i.minStock);
    if (b.physicalQty <= min) { stock.lowStockCount += 1; stock.lowStockItems.push({ itemId: i.itemId, sku: i.sku, name: i.name, physicalQty: b.physicalQty, availableQty: b.availableQty, minStock: min }); }
  });
  stock.lowStockItems = sortRows(stock.lowStockItems, 'physicalQty', 'asc').slice(0, 10);

  var deliveries = table(SHEETS.DELIVERIES).read().filter(function (d) { return (!from && !to) || inDateRange(d.deliveryDate, from, to); });
  var deliveryStats = { pending: 0, confirmed: 0, cancelled: 0, confirmedQty: 0 };
  var deliveryQty = {};
  table(SHEETS.DELIVERY_ITEMS).read().forEach(function (di) { deliveryQty[di.deliveryId] = (deliveryQty[di.deliveryId] || 0) + toNum(di.quantity); });
  deliveries.forEach(function (d) {
    if (d.status === STATUS.DELIVERY.PENDING) deliveryStats.pending += 1;
    else if (d.status === STATUS.DELIVERY.CONFIRMED) { deliveryStats.confirmed += 1; deliveryStats.confirmedQty += deliveryQty[d.deliveryId] || 0; }
    else deliveryStats.cancelled += 1;
  });

  var requests = table(SHEETS.REQUESTS).read().filter(function (r) {
    if (congregationFilter && r.congregationId !== congregationFilter) return false;
    return (!from && !to) || inDateRange(r.requestDate, from, to);
  });
  var requestStats = { draft: 0, pending: 0, approved: 0, partiallyFulfilled: 0, fulfilled: 0, rejected: 0, cancelled: 0, awaitingFulfilment: 0 };
  requests.forEach(function (r) {
    switch (r.status) {
      case STATUS.REQUEST.DRAFT: requestStats.draft += 1; break;
      case STATUS.REQUEST.PENDING: requestStats.pending += 1; break;
      case STATUS.REQUEST.APPROVED: requestStats.approved += 1; requestStats.awaitingFulfilment += 1; break;
      case STATUS.REQUEST.PARTIALLY_FULFILLED: requestStats.partiallyFulfilled += 1; requestStats.awaitingFulfilment += 1; break;
      case STATUS.REQUEST.FULFILLED: requestStats.fulfilled += 1; break;
      case STATUS.REQUEST.REJECTED: requestStats.rejected += 1; break;
      case STATUS.REQUEST.CANCELLED: requestStats.cancelled += 1; break;
    }
  });

  var dists = table(SHEETS.DISTRIBUTIONS).read().filter(function (d) {
    if (d.status === STATUS.DISTRIBUTION.FAILED || d.status === STATUS.DISTRIBUTION.PROCESSING) return false;
    if (congregationFilter && d.destinationCongregationId !== congregationFilter) return false;
    return (!from && !to) || inDateRange(d.createdAt, from, to);
  });
  var distMap = indexBy(dists, 'distributionId');
  var distStats = { released: 0, received: 0, totalQty: 0 };
  var byCong = {};
  dists.forEach(function (d) {
    if (d.status === STATUS.DISTRIBUTION.RECEIVED) distStats.received += 1; else distStats.released += 1;
    var c = byCong[d.destinationCongregationId] || (byCong[d.destinationCongregationId] = { congregationId: d.destinationCongregationId, name: (congs[d.destinationCongregationId] || {}).name || '', distributions: 0, releasedQty: 0, receivedQty: 0 });
    c.distributions += 1;
  });
  table(SHEETS.DISTRIBUTION_ITEMS).read().forEach(function (x) {
    var d = distMap[x.distributionId]; if (!d) return;
    var q = toNum(x.quantity);
    distStats.totalQty += q;
    var c = byCong[d.destinationCongregationId];
    if (c) { c.releasedQty += q; if (d.status === STATUS.DISTRIBUTION.RECEIVED) c.receivedQty += q; }
  });
  var distributionByCongregation = Object.keys(byCong).map(function (k) { return byCong[k]; });
  // include congregations with zero activity so the summary is complete
  Object.keys(congs).forEach(function (id) {
    var c = congs[id];
    if (id === coordinator.congregationId || !toBool(c.active)) return;
    if (congregationFilter && id !== congregationFilter) return;
    if (!byCong[id]) distributionByCongregation.push({ congregationId: id, name: c.name, distributions: 0, releasedQty: 0, receivedQty: 0 });
  });
  distributionByCongregation = sortRows(distributionByCongregation, 'name', 'asc');

  var recent = isCongUser ? [] : sortRows(listTransactions({ from: from, to: to, congregationId: congregationFilter }), 'timestamp', 'desc').slice(0, 12);

  return {
    generatedAt: nowIso(), from: from, to: to, congregationId: congregationFilter === '__none__' ? '' : congregationFilter,
    coordinator: { congregationId: coordinator.congregationId, name: coordinator.name, code: coordinator.code },
    stock: isCongUser ? { uniqueItems: stock.uniqueItems, physicalQty: null, reservedQty: null, availableQty: null, lowStockCount: null, lowStockItems: [] } : stock,
    deliveries: isCongUser ? { pending: null, confirmed: null, cancelled: null, confirmedQty: null } : deliveryStats,
    requests: requestStats, distributions: distStats, distributionByCongregation: distributionByCongregation, recentTransactions: recent,
    reserveOnApproval: getSettingBool('reserveOnApproval')
  };
}
