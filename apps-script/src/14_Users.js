/**
 * 14_Users.js
 * Administrator-only user management and application settings.
 */

function usersList(params, ctx) {
  requirePermission(ctx.user, 'users.manage');
  var congs = indexBy(table(SHEETS.CONGREGATIONS).read(), 'congregationId');
  var rows = table(SHEETS.USERS).read().map(function (u) { return publicUser(u, congs[u.congregationId]); })
    .filter(function (u) {
      if (params.role && u.role !== params.role) return false;
      if (params.active !== undefined && params.active !== '' && u.active !== toBool(params.active)) return false;
      return textMatches(u, ['email', 'name', 'role', 'congregationName'], params.query);
    });
  rows = sortRows(rows, params.sortBy || 'email', params.sortDir || 'asc');
  return paginate(rows, params);
}

function validateRole(role) {
  if (ALL_ROLES.indexOf(role) === -1) fail(ERR.VALIDATION, 'Role must be one of: ' + ALL_ROLES.join(', ') + '.');
  return role;
}

function validateUserCongregation(role, congregationId) {
  if (role === ROLES.CONGREGATION_USER) {
    var c = requireCongregation(congregationId, 'Congregation');
    return c.congregationId;
  }
  if (isNonEmptyString(congregationId)) return requireCongregation(congregationId, 'Congregation').congregationId;
  return '';
}

function countActiveAdmins(exceptUserId) {
  return table(SHEETS.USERS).read().filter(function (u) { return u.role === ROLES.ADMIN && toBool(u.active) && u.userId !== exceptUserId; }).length;
}

function usersCreate(params, ctx) {
  requirePermission(ctx.user, 'users.manage');
  var email = normalizeEmail(requireString(params, 'email', 'Email', 160));
  if (!isValidEmail(email)) fail(ERR.VALIDATION, 'Enter a valid Google account email address.');
  if (findUserByEmail(email)) fail(ERR.CONFLICT, 'This email address is already authorized.', 409);
  var role = validateRole(optionalString(params, 'role') || ROLES.READ_ONLY);
  var congregationId = validateUserCongregation(role, params.congregationId);
  var now = nowIso();
  var u = {
    userId: newId('usr'), email: email, name: optionalString(params, 'name', 120), role: role, congregationId: congregationId,
    active: 'TRUE', createdAt: now, createdBy: ctx.user.email, updatedAt: now, updatedBy: ctx.user.email, lastLoginAt: ''
  };
  table(SHEETS.USERS).append(u);
  invalidateUserCache(email);
  writeAudit(ctx.user.email, 'users.create', 'AuthorizedUsers', u.userId, 'Authorized ' + email + ' as ' + role, ctx.requestId, { role: role, congregationId: congregationId });
  return publicUser(u, congregationId ? table(SHEETS.CONGREGATIONS).findById(congregationId) : null);
}

function usersUpdate(params, ctx) {
  requirePermission(ctx.user, 'users.manage');
  var t = table(SHEETS.USERS);
  var u = t.findById(params.userId);
  if (!u) fail(ERR.NOT_FOUND, 'User not found.', 404);
  var role = params.role === undefined ? u.role : validateRole(params.role);
  var congregationId = params.congregationId === undefined && params.role === undefined ? (u.congregationId || '') : validateUserCongregation(role, params.congregationId === undefined ? u.congregationId : params.congregationId);
  var active = params.active === undefined ? toBool(u.active) : toBool(params.active);
  var isSelf = u.userId === ctx.user.userId;
  if (isSelf && !active) fail(ERR.VALIDATION, 'You cannot deactivate your own account.');
  if (isSelf && role !== ROLES.ADMIN) fail(ERR.VALIDATION, 'You cannot remove your own administrator role.');
  if (u.role === ROLES.ADMIN && toBool(u.active) && (role !== ROLES.ADMIN || !active) && countActiveAdmins(u.userId) === 0) {
    fail(ERR.VALIDATION, 'At least one active administrator must remain.');
  }
  var now = nowIso();
  var saved = t.update(u.userId, { name: params.name === undefined ? u.name : optionalString(params, 'name', 120), role: role, congregationId: congregationId, active: active ? 'TRUE' : 'FALSE', updatedAt: now, updatedBy: ctx.user.email });
  invalidateUserCache(saved.email);
  writeAudit(ctx.user.email, 'users.update', 'AuthorizedUsers', saved.userId, 'Updated ' + saved.email + ' (' + role + ', ' + (active ? 'active' : 'inactive') + ')', ctx.requestId, { role: role, active: active, congregationId: congregationId });
  return publicUser(saved, congregationId ? table(SHEETS.CONGREGATIONS).findById(congregationId) : null);
}

/* ---------- Settings ---------- */

function settingsGet(params, ctx) {
  // Non-sensitive application behaviour flags; any authenticated user may read them.
  var map = getSettings();
  var meta = indexBy(DEFAULT_SETTINGS, 'key');
  return Object.keys(map).map(function (k) { return { key: k, value: map[k], description: meta[k] ? meta[k].description : '' }; });
}

function settingsUpdate(params, ctx) {
  requirePermission(ctx.user, 'settings.manage');
  var key = requireString(params, 'key', 'Setting key', 60);
  var allowed = DEFAULT_SETTINGS.map(function (s) { return s.key; });
  if (allowed.indexOf(key) === -1) fail(ERR.VALIDATION, 'Unknown setting: ' + key);
  var value = String(params.value === undefined || params.value === null ? '' : params.value).trim();
  if (['reserveOnApproval', 'allowAdHocDistribution'].indexOf(key) !== -1 && ['true', 'false'].indexOf(value.toLowerCase()) === -1) fail(ERR.VALIDATION, key + ' must be true or false.');
  if (key === 'defaultLowStockThreshold') value = String(requireNonNegativeInt(value, 'Low stock threshold'));
  if (/Prefix$/.test(key) && !/^[A-Z0-9]{1,8}$/.test(value)) fail(ERR.VALIDATION, 'Prefixes must be 1-8 uppercase letters or digits.');
  var t = table(SHEETS.SETTINGS);
  var existing = t.findById(key);
  var meta = indexBy(DEFAULT_SETTINGS, 'key')[key];
  var now = nowIso();
  if (existing) t.update(key, { value: value, updatedAt: now, updatedBy: ctx.user.email });
  else t.append({ key: key, value: value, description: meta.description, updatedAt: now, updatedBy: ctx.user.email });
  invalidateSettingsCache();
  writeAudit(ctx.user.email, 'settings.update', 'AppSettings', key, 'Set ' + key + ' = ' + value, ctx.requestId, null);
  return settingsGet(params, ctx);
}
