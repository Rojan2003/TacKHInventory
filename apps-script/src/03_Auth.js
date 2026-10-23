/**
 * 03_Auth.js
 * Authentication and authorization.
 *
 * Flow
 * 1. Browser obtains a Google ID token via Google Identity Services (no client secret involved).
 * 2. auth.login sends the ID token. We verify it with Google's tokeninfo endpoint over HTTPS
 *    (signature, issuer, audience, expiry, email_verified are all checked by Google and re-checked here).
 * 3. The verified email is looked up in AuthorizedUsers. Unknown or inactive accounts are rejected.
 * 4. A session token (HMAC-SHA256 signed, secret in Script Properties) is returned to the browser.
 * 5. Every later call carries the session token in the request body. We verify the signature + expiry
 *    and re-load the user so deactivation / role changes take effect immediately.
 *
 * The browser NEVER supplies its own email or role; both come from verified Google identity and the sheet.
 */

var TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo?id_token=';

function getSessionSecret() {
  var secret = getProps().getProperty('SESSION_SECRET');
  if (!secret || secret.length < 32) fail(ERR.CONFIG, 'Session secret is not configured. Run setup() in the Apps Script editor.', 500);
  return secret;
}

function getGoogleClientId() {
  var id = getProps().getProperty('GOOGLE_CLIENT_ID');
  if (!id) fail(ERR.CONFIG, 'GOOGLE_CLIENT_ID is not configured in Script Properties.', 500);
  return id;
}

function base64UrlEncode(bytesOrString) {
  var b64 = typeof bytesOrString === 'string'
    ? Utilities.base64EncodeWebSafe(bytesOrString, Utilities.Charset.UTF_8)
    : Utilities.base64EncodeWebSafe(bytesOrString);
  return b64.replace(/=+$/, '');
}

function base64UrlDecodeToString(s) {
  var bytes = Utilities.base64DecodeWebSafe(s, Utilities.Charset.UTF_8);
  return Utilities.newBlob(bytes).getDataAsString('UTF-8');
}

function hmacSign(payloadB64, secret) {
  var sig = Utilities.computeHmacSha256Signature(payloadB64, secret, Utilities.Charset.UTF_8);
  return base64UrlEncode(sig);
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function issueSessionToken(user) {
  var now = Math.floor(Date.now() / 1000);
  var payload = { sub: user.email, uid: user.userId, iat: now, exp: now + CONFIG.SESSION_TTL_SECONDS, n: Utilities.getUuid().slice(0, 8) };
  var payloadB64 = base64UrlEncode(JSON.stringify(payload));
  return payloadB64 + '.' + hmacSign(payloadB64, getSessionSecret());
}

function parseSessionToken(token) {
  if (!isNonEmptyString(token)) fail(ERR.UNAUTHENTICATED, 'Please sign in.', 401);
  var parts = token.split('.');
  if (parts.length !== 2) fail(ERR.UNAUTHENTICATED, 'Invalid session. Please sign in again.', 401);
  var expected = hmacSign(parts[0], getSessionSecret());
  if (!constantTimeEqual(expected, parts[1])) fail(ERR.UNAUTHENTICATED, 'Invalid session. Please sign in again.', 401);
  var payload = safeJsonParse(base64UrlDecodeToString(parts[0]), null);
  if (!payload || !payload.sub || !payload.exp) fail(ERR.UNAUTHENTICATED, 'Invalid session. Please sign in again.', 401);
  if (payload.exp < Math.floor(Date.now() / 1000)) fail(ERR.UNAUTHENTICATED, 'Your session has expired. Please sign in again.', 401);
  return payload;
}

/** Verifies a Google ID token with Google. Returns { email, name, picture, sub }. */
function verifyGoogleIdToken(idToken) {
  if (!isNonEmptyString(idToken) || idToken.length > 4096) fail(ERR.UNAUTHENTICATED, 'Google sign-in token is missing.', 401);
  var resp;
  try {
    resp = UrlFetchApp.fetch(TOKENINFO_URL + encodeURIComponent(idToken), { muteHttpExceptions: true, followRedirects: false });
  } catch (e) {
    var reason = String(e && e.message ? e.message : e);
    try { console.error('tokeninfo request failed: ' + reason); } catch (ignored) { /* ignore */ }
    // "You do not have permission to call UrlFetchApp.fetch" = the script was never authorized for script.external_request.
    if (/permission/i.test(reason)) fail(ERR.CONFIG, 'The backend is not authorized to contact Google. An administrator must run authSelfTest() in the Apps Script editor and grant access.', 500);
    fail(ERR.INTERNAL, 'Google identity verification is temporarily unavailable.', 503);
  }
  if (resp.getResponseCode() !== 200) fail(ERR.UNAUTHENTICATED, 'Google sign-in could not be verified. Please try again.', 401);
  var info = safeJsonParse(resp.getContentText(), null);
  if (!info || !info.email) fail(ERR.UNAUTHENTICATED, 'Google sign-in could not be verified.', 401);

  var clientId = getGoogleClientId();
  if (String(info.aud) !== clientId) fail(ERR.UNAUTHENTICATED, 'Sign-in token was not issued for this application.', 401);
  if (['accounts.google.com', 'https://accounts.google.com'].indexOf(String(info.iss)) === -1) fail(ERR.UNAUTHENTICATED, 'Sign-in token has an invalid issuer.', 401);
  if (toNum(info.exp) < Math.floor(Date.now() / 1000)) fail(ERR.UNAUTHENTICATED, 'Sign-in token has expired. Please try again.', 401);
  if (!toBool(info.email_verified)) fail(ERR.UNAUTHENTICATED, 'Your Google email address is not verified.', 401);

  return { email: normalizeEmail(info.email), name: info.name || '', picture: info.picture || '', sub: info.sub || '' };
}

/* ---------- Authorized users ---------- */

function publicUser(u, congregation) {
  return {
    userId: u.userId,
    email: u.email,
    name: u.name || '',
    role: u.role,
    congregationId: u.congregationId || '',
    congregationName: congregation ? congregation.name : '',
    congregationCode: congregation ? congregation.code : '',
    active: toBool(u.active),
    lastLoginAt: u.lastLoginAt || '',
    permissions: permissionsForRole(u.role)
  };
}

function permissionsForRole(role) {
  return Object.keys(PERMISSIONS).filter(function (p) { return PERMISSIONS[p].indexOf(role) !== -1; });
}

function findUserByEmail(email) {
  email = normalizeEmail(email);
  var cache = CacheService.getScriptCache();
  var key = 'user:' + email;
  var cached = cache.get(key);
  if (cached) return JSON.parse(cached);
  var user = null;
  table(SHEETS.USERS).read().forEach(function (u) { if (normalizeEmail(u.email) === email) user = u; });
  if (user) cache.put(key, JSON.stringify(user), CONFIG.USER_CACHE_TTL_SECONDS);
  return user;
}

function invalidateUserCache(email) {
  CacheService.getScriptCache().remove('user:' + normalizeEmail(email));
}

/** Seeds the initial administrator when no users exist. Safe to call repeatedly. */
function seedInitialAdmin(actor) {
  var users = table(SHEETS.USERS);
  if (users.count() > 0) return null;
  var now = nowIso();
  var admin = {
    userId: newId('usr'), email: normalizeEmail(CONFIG.INITIAL_ADMIN_EMAIL), name: 'Initial Administrator',
    role: ROLES.ADMIN, congregationId: '', active: 'TRUE', createdAt: now, createdBy: actor || 'setup', updatedAt: now, updatedBy: actor || 'setup', lastLoginAt: ''
  };
  users.append(admin);
  invalidateUserCache(admin.email);
  return admin;
}

/** Resolves the acting user from a session token. Throws if unauthenticated or deactivated. */
function authenticate(token) {
  var payload = parseSessionToken(token);
  var user = findUserByEmail(payload.sub);
  if (!user) fail(ERR.UNAUTHORIZED, 'Your account is no longer authorized.', 403);
  if (!toBool(user.active)) fail(ERR.UNAUTHORIZED, 'Your account has been deactivated. Contact an administrator.', 403);
  if (ALL_ROLES.indexOf(user.role) === -1) fail(ERR.UNAUTHORIZED, 'Your account has an invalid role. Contact an administrator.', 403);
  return user;
}

function hasPermission(user, permission) {
  var roles = PERMISSIONS[permission];
  return !!roles && roles.indexOf(user.role) !== -1;
}

function requirePermission(user, permission) {
  if (!hasPermission(user, permission)) fail(ERR.FORBIDDEN, 'You do not have permission to perform this action.', 403);
}

/** Either "all" permission, or "own" permission scoped to the user's congregation. Returns the scope. */
function requireScope(user, allPermission, ownPermission) {
  if (hasPermission(user, allPermission)) return { all: true, congregationId: null };
  if (hasPermission(user, ownPermission)) {
    if (!user.congregationId) fail(ERR.FORBIDDEN, 'Your account is not linked to a congregation. Contact an administrator.', 403);
    return { all: false, congregationId: user.congregationId };
  }
  fail(ERR.FORBIDDEN, 'You do not have permission to view this information.', 403);
}

function assertScopeCongregation(scope, congregationId) {
  if (!scope.all && String(scope.congregationId) !== String(congregationId)) {
    fail(ERR.FORBIDDEN, 'You may only access records for your own congregation.', 403);
  }
}

/* ---------- Auth actions ---------- */

function authLogin(params, ctx) {
  var identity = verifyGoogleIdToken(params && params.idToken);
  var user = findUserByEmail(identity.email);
  if (!user && table(SHEETS.USERS).count() === 0 && identity.email === normalizeEmail(CONFIG.INITIAL_ADMIN_EMAIL)) {
    user = seedInitialAdmin(identity.email);
  }
  if (!user) fail(ERR.UNAUTHORIZED, 'This Google account is not authorized to use the system. Contact the administrator.', 403);
  if (!toBool(user.active)) fail(ERR.UNAUTHORIZED, 'Your account has been deactivated. Contact an administrator.', 403);

  var now = nowIso();
  var patch = { lastLoginAt: now, updatedAt: user.updatedAt || now };
  if (!user.name && identity.name) patch.name = identity.name;
  user = table(SHEETS.USERS).update(user.userId, patch);
  invalidateUserCache(user.email);
  writeAudit(user.email, 'auth.login', 'AuthorizedUsers', user.userId, 'Signed in', ctx.requestId, null);

  var congregation = user.congregationId ? table(SHEETS.CONGREGATIONS).findById(user.congregationId) : null;
  return { token: issueSessionToken(user), user: publicUser(user, congregation), expiresInSeconds: CONFIG.SESSION_TTL_SECONDS };
}

function authMe(params, ctx) {
  var user = ctx.user;
  var congregation = user.congregationId ? table(SHEETS.CONGREGATIONS).findById(user.congregationId) : null;
  return publicUser(user, congregation);
}

function authLogout(params, ctx) {
  writeAudit(ctx.user.email, 'auth.logout', 'AuthorizedUsers', ctx.user.userId, 'Signed out', ctx.requestId, null);
  return { loggedOut: true };
}
