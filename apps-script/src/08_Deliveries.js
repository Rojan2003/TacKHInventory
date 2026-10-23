/**
 * 08_Deliveries.js
 * Incoming literature. Only CONFIRMED deliveries post to the ledger, and confirmation is idempotent:
 * if ledger rows with refType DELIVERY / refId already exist, no second posting happens.
 */

function deliveryItemsFor(deliveryId, items) {
  return table(SHEETS.DELIVERY_ITEMS).read().filter(function (di) { return di.deliveryId === deliveryId; }).map(function (di) {
    var i = items[di.itemId] || {};
    return { deliveryItemId: di.deliveryItemId, itemId: di.itemId, sku: i.sku || '', itemName: i.name || '', unit: i.unit || 'pcs', quantity: toNum(di.quantity) };
  });
}

function publicDelivery(d, congs, items, withItems) {
  var src = congs[d.sourceCongregationId];
  var out = {
    deliveryId: d.deliveryId, reference: d.reference, deliveryDate: toIsoDate(d.deliveryDate), sourceType: d.sourceType,
    sourceCongregationId: d.sourceCongregationId || '', sourceName: d.sourceType === 'congregation' && src ? src.name : (d.sourceName || ''),
    receivedBy: d.receivedBy || '', status: d.status, notes: d.notes || '', packingListNumber: d.packingListNumber || '', createdAt: d.createdAt, createdBy: d.createdBy,
    confirmedAt: d.confirmedAt || '', confirmedBy: d.confirmedBy || '', updatedAt: d.updatedAt || ''
  };
  var lines = deliveryItemsFor(d.deliveryId, items);
  out.itemCount = lines.length;
  out.totalQty = lines.reduce(function (s, l) { return s + l.quantity; }, 0);
  if (withItems) out.items = lines;
  return out;
}

function deliveriesList(params, ctx) {
  requirePermission(ctx.user, 'deliveries.view');
  var congs = indexBy(table(SHEETS.CONGREGATIONS).read(), 'congregationId');
  var items = indexBy(table(SHEETS.ITEMS).read(), 'itemId');
  var rows = table(SHEETS.DELIVERIES).read().filter(function (d) {
    if (params.status && d.status !== params.status) return false;
    if (params.sourceCongregationId && d.sourceCongregationId !== params.sourceCongregationId) return false;
    if ((params.from || params.to) && !inDateRange(d.deliveryDate, params.from, params.to)) return false;
    return true;
  }).map(function (d) { return publicDelivery(d, congs, items, false); })
    .filter(function (d) { return textMatches(d, ['reference', 'sourceName', 'receivedBy', 'notes', 'status', 'packingListNumber'], params.query); });
  rows = sortRows(rows, params.sortBy || 'deliveryDate', params.sortDir || 'desc');
  return paginate(rows, params);
}

function deliveriesGet(params, ctx) {
  requirePermission(ctx.user, 'deliveries.view');
  var d = table(SHEETS.DELIVERIES).findById(params.deliveryId);
  if (!d) fail(ERR.NOT_FOUND, 'Delivery not found.', 404);
  var congs = indexBy(table(SHEETS.CONGREGATIONS).read(), 'congregationId');
  var items = indexBy(table(SHEETS.ITEMS).read(), 'itemId');
  var out = publicDelivery(d, congs, items, true);
  out.ledgerPosted = table(SHEETS.TRANSACTIONS).read().some(function (t) { return t.refType === 'DELIVERY' && t.refId === d.deliveryId; });
  return out;
}

function validateDeliveryLines(lines) {
  if (!Array.isArray(lines) || !lines.length) fail(ERR.VALIDATION, 'At least one literature item is required.');
  if (lines.length > 200) fail(ERR.VALIDATION, 'A delivery may contain at most 200 lines.');
  var items = indexBy(table(SHEETS.ITEMS).read(), 'itemId');
  var seen = {};
  return lines.map(function (l) {
    var itemId = requireString(l, 'itemId', 'Literature item');
    if (!items[itemId]) fail(ERR.NOT_FOUND, 'Literature item not found: ' + itemId, 404);
    if (!toBool(items[itemId].active)) fail(ERR.VALIDATION, items[itemId].name + ' is inactive.');
    if (seen[itemId]) fail(ERR.VALIDATION, 'Item ' + items[itemId].sku + ' appears more than once.');
    seen[itemId] = true;
    return { itemId: itemId, quantity: requirePositiveInt(l.quantity, 'Quantity for ' + items[itemId].sku) };
  });
}

/** Optional packing list number; must be unique across all deliveries (any status). */
function validatePackingListNumber(value, exceptDeliveryId) {
  var n = optionalString({ v: value }, 'v', 40);
  if (!n) return '';
  var clash = table(SHEETS.DELIVERIES).read().filter(function (d) { return String(d.packingListNumber || '').trim() === n && d.deliveryId !== exceptDeliveryId; });
  if (clash.length) fail(ERR.CONFLICT, 'Packing list ' + n + ' was already entered as delivery ' + clash[0].reference + '.', 409);
  return n;
}

function validateDeliveryHeader(params) {
  var sourceType = optionalString(params, 'sourceType') || 'supplier';
  if (['supplier', 'congregation'].indexOf(sourceType) === -1) fail(ERR.VALIDATION, 'Source type must be supplier or congregation.');
  var header = {
    deliveryDate: requireDate(params.deliveryDate, 'Delivery date'),
    sourceType: sourceType,
    sourceCongregationId: '',
    sourceName: '',
    receivedBy: requireString(params, 'receivedBy', 'Receiving person', 120),
    notes: optionalString(params, 'notes', 1000)
  };
  if (sourceType === 'congregation') {
    var c = requireCongregation(params.sourceCongregationId, 'Source congregation');
    header.sourceCongregationId = c.congregationId;
    header.sourceName = c.name;
  } else {
    header.sourceName = requireString(params, 'sourceName', 'Supplier name', 160);
  }
  return header;
}

/** Posts a Pending delivery to the ledger (idempotent) and marks it Confirmed. Call inside the lock. */
function confirmDeliveryRecord(d, ctx) {
  var now = nowIso();
  var alreadyPosted = table(SHEETS.TRANSACTIONS).read().some(function (t) { return t.refType === 'DELIVERY' && t.refId === d.deliveryId; });
  if (!alreadyPosted) {
    var lines = table(SHEETS.DELIVERY_ITEMS).read().filter(function (di) { return di.deliveryId === d.deliveryId; });
    postTransactions(lines.map(function (l) {
      return { type: TXN_TYPES.DELIVERY_IN, itemId: l.itemId, quantity: toNum(l.quantity), refType: 'DELIVERY', refId: d.deliveryId,
        counterpartyCongregationId: d.sourceCongregationId || '', notes: 'Delivery ' + d.reference + ' from ' + d.sourceName };
    }), ctx);
  }
  return table(SHEETS.DELIVERIES).update(d.deliveryId, { status: STATUS.DELIVERY.CONFIRMED, confirmedAt: now, confirmedBy: ctx.user.email, updatedAt: now, updatedBy: ctx.user.email });
}

function deliveriesCreate(params, ctx) {
  requirePermission(ctx.user, 'deliveries.manage');
  var header = validateDeliveryHeader(params);
  var lines = validateDeliveryLines(params.items);
  var packingListNumber = validatePackingListNumber(params.packingListNumber, null);
  var now = nowIso();
  var d = {
    packingListNumber: packingListNumber,
    deliveryId: newId('dlv'), reference: nextReference(SHEETS.DELIVERIES, 'reference', getSetting('deliveryReferencePrefix') || 'DLV'),
    deliveryDate: header.deliveryDate, sourceType: header.sourceType, sourceCongregationId: header.sourceCongregationId, sourceName: header.sourceName,
    receivedBy: header.receivedBy, status: STATUS.DELIVERY.PENDING, notes: header.notes, createdAt: now, createdBy: ctx.user.email,
    confirmedAt: '', confirmedBy: '', updatedAt: now, updatedBy: ctx.user.email
  };
  table(SHEETS.DELIVERIES).append(d);
  table(SHEETS.DELIVERY_ITEMS).append(lines.map(function (l) { return { deliveryItemId: newId('dli'), deliveryId: d.deliveryId, itemId: l.itemId, quantity: l.quantity }; }));
  writeAudit(ctx.user.email, 'deliveries.create', 'Deliveries', d.deliveryId, 'Recorded delivery ' + d.reference + ' from ' + d.sourceName, ctx.requestId, { lines: lines.length });
  if (toBool(params.confirmNow)) {
    d = confirmDeliveryRecord(d, ctx);
    writeAudit(ctx.user.email, 'deliveries.confirm', 'Deliveries', d.deliveryId, 'Confirmed delivery ' + d.reference, ctx.requestId, null);
  }
  return deliveriesGet({ deliveryId: d.deliveryId }, ctx);
}

function deliveriesUpdate(params, ctx) {
  requirePermission(ctx.user, 'deliveries.manage');
  var t = table(SHEETS.DELIVERIES);
  var d = t.findById(params.deliveryId);
  if (!d) fail(ERR.NOT_FOUND, 'Delivery not found.', 404);
  if (d.status !== STATUS.DELIVERY.PENDING) fail(ERR.INVALID_TRANSITION, 'Only pending deliveries can be edited.', 409);
  var header = validateDeliveryHeader(params);
  var lines = validateDeliveryLines(params.items);
  var now = nowIso();
  t.update(d.deliveryId, {
    deliveryDate: header.deliveryDate, sourceType: header.sourceType, sourceCongregationId: header.sourceCongregationId, sourceName: header.sourceName,
    receivedBy: header.receivedBy, notes: header.notes, updatedAt: now, updatedBy: ctx.user.email,
    packingListNumber: params.packingListNumber === undefined ? (d.packingListNumber || '') : validatePackingListNumber(params.packingListNumber, d.deliveryId)
  });
  // Replace lines: existing lines are updated in place / new lines appended / removed lines zeroed (history preserved).
  var existing = table(SHEETS.DELIVERY_ITEMS).read().filter(function (di) { return di.deliveryId === d.deliveryId; });
  var byItem = indexBy(existing, 'itemId');
  var keep = {};
  var toAppend = [];
  lines.forEach(function (l) {
    keep[l.itemId] = true;
    if (byItem[l.itemId]) table(SHEETS.DELIVERY_ITEMS).update(byItem[l.itemId].deliveryItemId, { quantity: l.quantity });
    else toAppend.push({ deliveryItemId: newId('dli'), deliveryId: d.deliveryId, itemId: l.itemId, quantity: l.quantity });
  });
  existing.forEach(function (di) { if (!keep[di.itemId]) table(SHEETS.DELIVERY_ITEMS).update(di.deliveryItemId, { quantity: 0 }); });
  if (toAppend.length) table(SHEETS.DELIVERY_ITEMS).append(toAppend);
  writeAudit(ctx.user.email, 'deliveries.update', 'Deliveries', d.deliveryId, 'Edited pending delivery ' + d.reference, ctx.requestId, null);
  return deliveriesGet({ deliveryId: d.deliveryId }, ctx);
}

function deliveriesConfirm(params, ctx) {
  requirePermission(ctx.user, 'deliveries.manage');
  var d = table(SHEETS.DELIVERIES).findById(params.deliveryId);
  if (!d) fail(ERR.NOT_FOUND, 'Delivery not found.', 404);
  if (d.status === STATUS.DELIVERY.CONFIRMED) return deliveriesGet({ deliveryId: d.deliveryId }, ctx); // idempotent
  if (d.status !== STATUS.DELIVERY.PENDING) fail(ERR.INVALID_TRANSITION, 'Only pending deliveries can be confirmed.', 409);
  var lines = table(SHEETS.DELIVERY_ITEMS).read().filter(function (di) { return di.deliveryId === d.deliveryId && toNum(di.quantity) > 0; });
  if (!lines.length) fail(ERR.VALIDATION, 'This delivery has no items to confirm.');
  d = confirmDeliveryRecord(d, ctx);
  writeAudit(ctx.user.email, 'deliveries.confirm', 'Deliveries', d.deliveryId, 'Confirmed delivery ' + d.reference, ctx.requestId, null);
  return deliveriesGet({ deliveryId: d.deliveryId }, ctx);
}

function deliveriesCancel(params, ctx) {
  requirePermission(ctx.user, 'deliveries.manage');
  var t = table(SHEETS.DELIVERIES);
  var d = t.findById(params.deliveryId);
  if (!d) fail(ERR.NOT_FOUND, 'Delivery not found.', 404);
  if (d.status === STATUS.DELIVERY.CANCELLED) return deliveriesGet({ deliveryId: d.deliveryId }, ctx);
  if (d.status !== STATUS.DELIVERY.PENDING) fail(ERR.INVALID_TRANSITION, 'Only pending deliveries can be cancelled. Confirmed deliveries must be corrected with a stock adjustment.', 409);
  var reason = optionalString(params, 'reason', 500);
  var now = nowIso();
  t.update(d.deliveryId, { status: STATUS.DELIVERY.CANCELLED, notes: (d.notes ? d.notes + '\n' : '') + (reason ? 'Cancelled: ' + reason : 'Cancelled'), updatedAt: now, updatedBy: ctx.user.email });
  writeAudit(ctx.user.email, 'deliveries.cancel', 'Deliveries', d.deliveryId, 'Cancelled delivery ' + d.reference, ctx.requestId, { reason: reason });
  return deliveriesGet({ deliveryId: d.deliveryId }, ctx);
}
