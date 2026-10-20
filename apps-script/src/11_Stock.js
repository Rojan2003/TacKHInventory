/**
 * 11_Stock.js
 * Congregation stock overview.
 *
 * For the coordinator (East): physical / reserved / available per item plus movements in the period.
 * For member congregations: quantities CONFIRMED RECEIVED from East (cumulative), quantities released but
 * not yet confirmed (in transit), outstanding approved-but-unfulfilled requests, and history.
 * A member congregation's "received" total is NOT physical stock held by East and is never added to it.
 */

function stockOverview(params, ctx) {
  var scope = requireScope(ctx.user, 'stock.view.all', 'stock.view.own');
  var congregationId = params.congregationId || (scope.all ? getCoordinatorCongregation().congregationId : scope.congregationId);
  assertScopeCongregation(scope, congregationId);
  var cong = table(SHEETS.CONGREGATIONS).findById(congregationId);
  if (!cong) fail(ERR.NOT_FOUND, 'Congregation not found.', 404);
  var coordinator = getCoordinatorCongregation();
  var isCoordinator = cong.congregationId === coordinator.congregationId;
  var from = params.from ? toIsoDate(params.from) : '', to = params.to ? toIsoDate(params.to) : '';
  var items = table(SHEETS.ITEMS).read();
  var itemMap = indexBy(items, 'itemId');
  var congs = indexBy(table(SHEETS.CONGREGATIONS).read(), 'congregationId');

  var out = { congregation: publicCongregation(cong), isCoordinator: isCoordinator, from: from, to: to, items: [], requests: [], distributions: [], totals: {} };

  if (isCoordinator) {
    var balances = getBalances();
    var txns = table(SHEETS.TRANSACTIONS).read().filter(function (t) { return (!from && !to) || inDateRange(t.timestamp, from, to); });
    var inBy = {}, outBy = {}, adjBy = {};
    txns.forEach(function (t) {
      var q = toNum(t.quantity);
      if (t.type === TXN_TYPES.DISTRIBUTION_OUT) outBy[t.itemId] = (outBy[t.itemId] || 0) + Math.abs(q);
      else if (t.type === TXN_TYPES.DELIVERY_IN || t.type === TXN_TYPES.OPENING_BALANCE) inBy[t.itemId] = (inBy[t.itemId] || 0) + q;
      else adjBy[t.itemId] = (adjBy[t.itemId] || 0) + q;
    });
    out.items = items.filter(function (i) { return toBool(i.active); }).map(function (i) {
      var b = balances[i.itemId] || { physicalQty: 0, reservedQty: 0, availableQty: 0 };
      return { itemId: i.itemId, sku: i.sku, name: i.name, unit: i.unit || 'pcs', physicalQty: b.physicalQty, reservedQty: b.reservedQty, availableQty: b.availableQty,
        receivedQty: inBy[i.itemId] || 0, releasedQty: outBy[i.itemId] || 0, adjustedQty: adjBy[i.itemId] || 0 };
    });
    out.totals = {
      physicalQty: out.items.reduce(function (s, i) { return s + i.physicalQty; }, 0),
      reservedQty: out.items.reduce(function (s, i) { return s + i.reservedQty; }, 0),
      availableQty: out.items.reduce(function (s, i) { return s + i.availableQty; }, 0),
      receivedQty: out.items.reduce(function (s, i) { return s + i.receivedQty; }, 0),
      releasedQty: out.items.reduce(function (s, i) { return s + i.releasedQty; }, 0)
    };
  } else {
    var dists = table(SHEETS.DISTRIBUTIONS).read().filter(function (d) { return d.destinationCongregationId === cong.congregationId && d.status !== STATUS.DISTRIBUTION.FAILED && d.status !== STATUS.DISTRIBUTION.PROCESSING; });
    var distMap = indexBy(dists, 'distributionId');
    var receivedBy = {}, inTransitBy = {}, periodReceivedBy = {};
    table(SHEETS.DISTRIBUTION_ITEMS).read().forEach(function (di) {
      var d = distMap[di.distributionId];
      if (!d) return;
      var q = toNum(di.quantity);
      if (d.status === STATUS.DISTRIBUTION.RECEIVED) {
        receivedBy[di.itemId] = (receivedBy[di.itemId] || 0) + q;
        if ((!from && !to) || inDateRange(d.receivedAt || d.createdAt, from, to)) periodReceivedBy[di.itemId] = (periodReceivedBy[di.itemId] || 0) + q;
      } else if (d.status === STATUS.DISTRIBUTION.RELEASED) {
        inTransitBy[di.itemId] = (inTransitBy[di.itemId] || 0) + q;
      }
    });
    var reqs = table(SHEETS.REQUESTS).read().filter(function (r) { return r.congregationId === cong.congregationId; });
    var openReq = {};
    reqs.forEach(function (r) { if ([STATUS.REQUEST.APPROVED, STATUS.REQUEST.PARTIALLY_FULFILLED].indexOf(r.status) !== -1) openReq[r.requestId] = true; });
    var outstandingBy = {};
    table(SHEETS.REQUEST_ITEMS).read().forEach(function (ri) {
      if (!openReq[ri.requestId]) return;
      outstandingBy[ri.itemId] = (outstandingBy[ri.itemId] || 0) + Math.max(0, toNum(ri.approvedQty) - toNum(ri.fulfilledQty));
    });
    var itemIds = uniq(Object.keys(receivedBy).concat(Object.keys(inTransitBy), Object.keys(outstandingBy)));
    out.items = itemIds.map(function (id) {
      var i = itemMap[id] || {};
      return { itemId: id, sku: i.sku || '', name: i.name || '', unit: i.unit || 'pcs', receivedQty: receivedBy[id] || 0, periodReceivedQty: periodReceivedBy[id] || 0,
        inTransitQty: inTransitBy[id] || 0, outstandingQty: outstandingBy[id] || 0 };
    });
    out.items = sortRows(out.items, 'name', 'asc');
    out.totals = {
      receivedQty: out.items.reduce(function (s, i) { return s + i.receivedQty; }, 0),
      periodReceivedQty: out.items.reduce(function (s, i) { return s + i.periodReceivedQty; }, 0),
      inTransitQty: out.items.reduce(function (s, i) { return s + i.inTransitQty; }, 0),
      outstandingQty: out.items.reduce(function (s, i) { return s + i.outstandingQty; }, 0)
    };
    out.requests = sortRows(reqs.filter(function (r) { return (!from && !to) || inDateRange(r.requestDate, from, to); })
      .map(function (r) { return publicRequest(r, congs, itemMap, false); }), 'requestDate', 'desc');
    out.distributions = sortRows(dists.filter(function (d) { return (!from && !to) || inDateRange(d.createdAt, from, to); })
      .map(function (d) { return publicDistribution(d, congs, itemMap, indexBy(reqs, 'requestId'), false); }), 'createdAt', 'desc');
  }
  return out;
}
