/**
 * 06_Items.js
 * Literature catalog. Quantities shown here always come from the ledger/balances (07_Inventory.js),
 * never from values supplied by the client.
 */

function publicItem(i, balance) {
  var b = balance || { physicalQty: 0, reservedQty: 0, availableQty: 0 };
  var threshold = i.minStock === '' || i.minStock === undefined || i.minStock === null
    ? toNum(getSetting('defaultLowStockThreshold'), 10) : toNum(i.minStock, 0);
  return {
    itemId: i.itemId, sku: i.sku || '', name: i.name || '', description: i.description || '', category: i.category || '',
    unit: i.unit || 'pcs', minStock: toNum(i.minStock, 0), lowStockThreshold: threshold, active: toBool(i.active),
    physicalQty: b.physicalQty, reservedQty: b.reservedQty, availableQty: b.availableQty,
    isLowStock: toBool(i.active) && b.physicalQty <= threshold,
    createdAt: i.createdAt || '', createdBy: i.createdBy || '', updatedAt: i.updatedAt || '', updatedBy: i.updatedBy || '',
    lastMovementAt: b.lastMovementAt || ''
  };
}

function itemsList(params, ctx) {
  requirePermission(ctx.user, 'items.view');
  var balances = getBalances();
  var rows = table(SHEETS.ITEMS).read()
    .filter(function (i) { return toBool(params.includeInactive) ? true : toBool(i.active); })
    .map(function (i) { return publicItem(i, balances[i.itemId]); })
    .filter(function (i) {
      if (params.category && i.category !== params.category) return false;
      if (toBool(params.lowStockOnly) && !i.isLowStock) return false;
      return textMatches(i, ['sku', 'name', 'description', 'category'], params.query);
    });
  rows = sortRows(rows, params.sortBy || 'name', params.sortDir || 'asc');
  var categories = uniq(table(SHEETS.ITEMS).read().map(function (i) { return i.category; }).filter(Boolean)).sort();
  var page = paginate(rows, params);
  page.categories = categories;
  return page;
}

function itemsGet(params, ctx) {
  requirePermission(ctx.user, 'items.view');
  var item = table(SHEETS.ITEMS).findById(params.itemId);
  if (!item) fail(ERR.NOT_FOUND, 'Literature item not found.', 404);
  var balances = getBalances();
  var out = publicItem(item, balances[item.itemId]);
  out.recentTransactions = itemLedger(item.itemId).slice(0, 10);
  return out;
}

function itemsHistory(params, ctx) {
  requirePermission(ctx.user, 'items.view');
  var item = table(SHEETS.ITEMS).findById(params.itemId);
  if (!item) fail(ERR.NOT_FOUND, 'Literature item not found.', 404);
  var rows = itemLedger(item.itemId).filter(function (t) {
    return (!params.from && !params.to) || inDateRange(t.timestamp, params.from, params.to);
  });
  return paginate(rows, params);
}

function validateItemInput(params, existingId) {
  var sku = requireString(params, 'sku', 'Item code / SKU', 40).toUpperCase();
  var name = requireString(params, 'name', 'Literature name', 160);
  var unit = optionalString(params, 'unit', 20) || 'pcs';
  var minStock = params.minStock === '' || params.minStock === undefined || params.minStock === null ? 0 : requireNonNegativeInt(params.minStock, 'Minimum stock');
  var duplicate = table(SHEETS.ITEMS).read().filter(function (i) { return String(i.sku).toUpperCase() === sku && i.itemId !== existingId; });
  if (duplicate.length) fail(ERR.CONFLICT, 'An item with code ' + sku + ' already exists.', 409);
  return {
    sku: sku, name: name, description: optionalString(params, 'description', 1000), category: optionalString(params, 'category', 60),
    unit: unit, minStock: minStock
  };
}

function itemsCreate(params, ctx) {
  requirePermission(ctx.user, 'items.manage');
  var input = validateItemInput(params, null);
  var now = nowIso();
  var item = {
    itemId: newId('itm'), sku: input.sku, name: input.name, description: input.description, category: input.category, unit: input.unit,
    minStock: input.minStock, active: 'TRUE', createdAt: now, createdBy: ctx.user.email, updatedAt: now, updatedBy: ctx.user.email
  };
  table(SHEETS.ITEMS).append(item);
  table(SHEETS.BALANCES).append({ itemId: item.itemId, physicalQty: 0, lastTxnId: '', updatedAt: now });

  var openingQty = params.openingQty === undefined || params.openingQty === '' || params.openingQty === null ? 0 : requireNonNegativeInt(params.openingQty, 'Opening quantity');
  if (openingQty > 0) {
    postTransactions([{ type: TXN_TYPES.OPENING_BALANCE, itemId: item.itemId, quantity: openingQty, refType: 'ITEM', refId: item.itemId, notes: 'Opening balance on item creation' }], ctx);
  }
  writeAudit(ctx.user.email, 'items.create', 'LiteratureItems', item.itemId, 'Created item ' + item.sku + ' - ' + item.name, ctx.requestId, { openingQty: openingQty });
  return publicItem(item, getBalances()[item.itemId]);
}

function itemsUpdate(params, ctx) {
  requirePermission(ctx.user, 'items.manage');
  var t = table(SHEETS.ITEMS);
  var existing = t.findById(params.itemId);
  if (!existing) fail(ERR.NOT_FOUND, 'Literature item not found.', 404);
  var input = validateItemInput(params, existing.itemId);
  var active = params.active === undefined ? toBool(existing.active) : toBool(params.active);
  var saved = t.update(existing.itemId, {
    sku: input.sku, name: input.name, description: input.description, category: input.category, unit: input.unit,
    minStock: input.minStock, active: active ? 'TRUE' : 'FALSE', updatedAt: nowIso(), updatedBy: ctx.user.email
  });
  writeAudit(ctx.user.email, 'items.update', 'LiteratureItems', saved.itemId, 'Updated item ' + saved.sku, ctx.requestId, null);
  return publicItem(saved, getBalances()[saved.itemId]);
}

/** Manual stock adjustment (count correction). Positive or negative; never below zero. */
function itemsAdjust(params, ctx) {
  requirePermission(ctx.user, 'items.manage');
  var item = table(SHEETS.ITEMS).findById(params.itemId);
  if (!item) fail(ERR.NOT_FOUND, 'Literature item not found.', 404);
  var qty = Number(params.quantity);
  if (!isFinite(qty) || qty === 0 || Math.floor(qty) !== qty) fail(ERR.VALIDATION, 'Adjustment quantity must be a non-zero whole number.');
  var reason = requireString(params, 'reason', 'Reason', 500);
  postTransactions([{ type: TXN_TYPES.ADJUSTMENT, itemId: item.itemId, quantity: qty, refType: 'ADJUSTMENT', refId: ctx.requestId, notes: reason }], ctx);
  writeAudit(ctx.user.email, 'items.adjust', 'LiteratureItems', item.itemId, 'Adjusted ' + item.sku + ' by ' + qty + ': ' + reason, ctx.requestId, { quantity: qty });
  return publicItem(item, getBalances()[item.itemId]);
}
