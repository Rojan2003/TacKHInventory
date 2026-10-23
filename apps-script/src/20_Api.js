/**
 * 20_Api.js
 * Web app entry points and the action router.
 *
 * Transport: the SPA sends a POST with a text/plain body (so the browser does not issue a CORS
 * preflight, which Apps Script cannot answer). Body:
 *   { "action": "items.list", "token": "<session token>", "requestId": "<uuid>", "params": { ... } }
 * Response (always HTTP 200 from Apps Script; success is in the body):
 *   { "success": true|false, "data": ..., "message": "", "error": { "code", "message" } | null, "requestId": "<uuid>" }
 */

var ACTIONS = {
  'health':                       { handler: healthAction, isPublic: true },
  'auth.login':                   { handler: authLogin, isPublic: true, mutation: false },
  'auth.me':                      { handler: authMe },
  'auth.logout':                  { handler: authLogout },

  'dashboard.summary':            { handler: dashboardSummary },

  'congregations.list':           { handler: congregationsList },
  'congregations.save':           { handler: congregationsSave, mutation: true },

  'items.list':                   { handler: itemsList },
  'items.get':                    { handler: itemsGet },
  'items.history':                { handler: itemsHistory },
  'items.create':                 { handler: itemsCreate, mutation: true },
  'items.update':                 { handler: itemsUpdate, mutation: true },
  'items.adjust':                 { handler: itemsAdjust, mutation: true },
  'transactions.list':            { handler: transactionsList },

  'deliveries.list':              { handler: deliveriesList },
  'deliveries.get':               { handler: deliveriesGet },
  'deliveries.create':            { handler: deliveriesCreate, mutation: true },
  'deliveries.update':            { handler: deliveriesUpdate, mutation: true },
  'deliveries.confirm':           { handler: deliveriesConfirm, mutation: true },
  'deliveries.cancel':            { handler: deliveriesCancel, mutation: true },

  'requests.list':                { handler: requestsList },
  'requests.get':                 { handler: requestsGet },
  'requests.create':              { handler: requestsCreate, mutation: true },
  'requests.update':              { handler: requestsUpdate, mutation: true },
  'requests.submit':              { handler: requestsSubmit, mutation: true },
  'requests.approve':             { handler: requestsApprove, mutation: true },
  'requests.reject':              { handler: requestsReject, mutation: true },
  'requests.cancel':              { handler: requestsCancel, mutation: true },

  'distributions.list':           { handler: distributionsList },
  'distributions.get':            { handler: distributionsGet },
  'distributions.create':         { handler: distributionsCreate, mutation: true },
  'distributions.confirmReceipt': { handler: distributionsConfirmReceipt, mutation: true },

  'stock.overview':               { handler: stockOverview },
  'reports.run':                  { handler: reportsRun },

  'users.list':                   { handler: usersList },
  'users.create':                 { handler: usersCreate, mutation: true },
  'users.update':                 { handler: usersUpdate, mutation: true },
  'audit.list':                   { handler: auditList },
  'settings.get':                 { handler: settingsGet },
  'settings.update':              { handler: settingsUpdate, mutation: true },
  'admin.reconcile':              { handler: adminReconcile, mutation: true },
  'admin.importLegacyOpeningBalances': { handler: adminImportLegacyOpeningBalances, mutation: true }
};

function healthAction() {
  // BUILD_ID is injected by build.mjs into Code.gs; sources pushed with clasp (or run in tests) report "dev".
  return { service: CONFIG.APP_NAME, version: CONFIG.APP_VERSION, build: typeof BUILD_ID === 'string' ? BUILD_ID : 'dev', time: nowIso() };
}

/** Core dispatcher. Pure function of the request body; used by doPost and by the test harness. */
function handleRequest(body) {
  resetAllCaches();
  var requestId = body && typeof body.requestId === 'string' ? body.requestId.slice(0, 128) : null;
  try {
    if (!body || typeof body !== 'object') fail(ERR.VALIDATION, 'Request body must be a JSON object.');
    var action = body.action;
    var def = typeof action === 'string' ? ACTIONS[action] : null;
    if (!def) fail(ERR.NOT_FOUND, 'Unknown action.', 404);
    var params = body.params && typeof body.params === 'object' ? body.params : {};
    var ctx = { requestId: requestId, action: action, user: null };
    if (!def.isPublic) ctx.user = authenticate(body.token);
    var data = def.mutation ? runMutation(action, ctx, function () { return def.handler(params, ctx); }) : def.handler(params, ctx);
    return ok(data, '', requestId);
  } catch (err) {
    return errorResponse(err, requestId);
  }
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var body = null;
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '';
    if (raw.length > 1000000) return jsonOutput(errorResponse(new AppError(ERR.VALIDATION, 'Request too large.'), null));
    body = raw ? JSON.parse(raw) : null;
  } catch (err) {
    return jsonOutput(errorResponse(new AppError(ERR.VALIDATION, 'Request body must be valid JSON.'), null));
  }
  return jsonOutput(handleRequest(body));
}

function doGet(e) {
  // Health check only. No data is ever served over GET.
  return jsonOutput(ok(healthAction(), 'OK', null));
}
