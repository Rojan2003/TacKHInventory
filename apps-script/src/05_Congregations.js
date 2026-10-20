/**
 * 05_Congregations.js
 * Congregation master data. The coordinator (East) is the only congregation that holds physical stock
 * in this system; member congregations receive distributions.
 */

function listCongregations(includeInactive) {
  return table(SHEETS.CONGREGATIONS).read()
    .filter(function (c) { return includeInactive || toBool(c.active); })
    .map(publicCongregation);
}

function publicCongregation(c) {
  return {
    congregationId: c.congregationId, code: c.code, name: c.name, type: c.type || 'member',
    active: toBool(c.active), notes: c.notes || '', createdAt: c.createdAt || '', updatedAt: c.updatedAt || ''
  };
}

function getCoordinatorCongregation() {
  var rows = table(SHEETS.CONGREGATIONS).read();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].type === 'coordinator' || String(rows[i].code).toUpperCase() === CONFIG.COORDINATOR_CONGREGATION_CODE) return rows[i];
  }
  fail(ERR.CONFIG, 'The coordinating congregation is not configured. Run setup().', 500);
}

function requireCongregation(congregationId, label) {
  if (!isNonEmptyString(congregationId)) fail(ERR.VALIDATION, (label || 'Congregation') + ' is required.');
  var c = table(SHEETS.CONGREGATIONS).findById(congregationId);
  if (!c) fail(ERR.NOT_FOUND, (label || 'Congregation') + ' not found.', 404);
  if (!toBool(c.active)) fail(ERR.VALIDATION, (label || 'Congregation') + ' is inactive.');
  return c;
}

function congregationsList(params, ctx) {
  requirePermission(ctx.user, 'congregations.view');
  var includeInactive = toBool(params.includeInactive) && hasPermission(ctx.user, 'congregations.manage');
  return listCongregations(includeInactive);
}

function congregationsSave(params, ctx) {
  requirePermission(ctx.user, 'congregations.manage');
  var t = table(SHEETS.CONGREGATIONS);
  var now = nowIso();
  var code = requireString(params, 'code', 'Code', 20).toUpperCase();
  var name = requireString(params, 'name', 'Name', 120);
  var type = optionalString(params, 'type') || 'member';
  if (['coordinator', 'member', 'supplier'].indexOf(type) === -1) fail(ERR.VALIDATION, 'Type must be coordinator, member or supplier.');
  var notes = optionalString(params, 'notes', 500);

  var duplicate = t.read().filter(function (c) { return String(c.code).toUpperCase() === code && c.congregationId !== params.congregationId; });
  if (duplicate.length) fail(ERR.CONFLICT, 'A congregation with code ' + code + ' already exists.', 409);

  var saved;
  if (params.congregationId) {
    var existing = t.findById(params.congregationId);
    if (!existing) fail(ERR.NOT_FOUND, 'Congregation not found.', 404);
    if (existing.type === 'coordinator' && type !== 'coordinator') fail(ERR.VALIDATION, 'The coordinating congregation cannot change type.');
    var active = params.active === undefined ? toBool(existing.active) : toBool(params.active);
    if (existing.type === 'coordinator' && !active) fail(ERR.VALIDATION, 'The coordinating congregation cannot be deactivated.');
    saved = t.update(params.congregationId, { code: code, name: name, type: type, notes: notes, active: active ? 'TRUE' : 'FALSE', updatedAt: now });
    writeAudit(ctx.user.email, 'congregations.update', 'Congregations', saved.congregationId, 'Updated congregation ' + code, ctx.requestId, null);
  } else {
    if (type === 'coordinator' && t.read().some(function (c) { return c.type === 'coordinator'; })) fail(ERR.VALIDATION, 'Only one coordinating congregation is allowed.');
    saved = { congregationId: newId('cong'), code: code, name: name, type: type, active: 'TRUE', notes: notes, createdAt: now, updatedAt: now };
    t.append(saved);
    writeAudit(ctx.user.email, 'congregations.create', 'Congregations', saved.congregationId, 'Created congregation ' + code, ctx.requestId, null);
  }
  return publicCongregation(saved);
}
