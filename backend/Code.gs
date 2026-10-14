/**
 * Personal Wealth OS — Apps Script web app entry points.
 *
 * Deploy: Deploy → New deployment → Web app
 *   Execute as:      Me (the spreadsheet owner)
 *   Who has access:  Anyone
 * "Anyone" only makes the URL reachable; every action except `health` requires a
 * verified Google ID token for an allow-listed email (see Auth.gs). The spreadsheet
 * itself stays private and is never shared.
 *
 * Requests: POST, Content-Type text/plain (avoids a CORS preflight), JSON body:
 *   { action, idToken, requestId, payload }
 */
var PWOS_SERVICE_ = null;
function service_() {
  return PWOS_SERVICE_ || (PWOS_SERVICE_ = createWealthService(WealthCore));
}

function buildDeps_() {
  var svc = service_();
  var ss = getSpreadsheet_();
  var tz = Session.getScriptTimeZone() || 'Asia/Manila';
  return {
    store: SheetStore_(ss, svc.SCHEMA, tz),
    now: function () { return Date.now(); },
    uuid: function () { return Utilities.getUuid(); },
    withLock: function (fn) {
      var lock = LockService.getScriptLock();
      if (!lock.tryLock(25000)) throw new svc.ApiError('BUSY', 'Another update is in progress. Please retry.');
      try { var r = fn(); SpreadsheetApp.flush(); return r; } finally { lock.releaseLock(); }
    },
    authenticate: function (token) { return authenticate_(token, svc); },
    http: { getJson: function (url) {
      var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { Accept: 'application/json' } });
      if (res.getResponseCode() !== 200) throw new svc.ApiError('UPSTREAM', 'Price source returned HTTP ' + res.getResponseCode());
      return JSON.parse(res.getContentText());
    } },
    log: function (e) { console.error(e && e.stack ? e.stack : e); }
  };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var req;
  try {
    var body = e && e.postData && e.postData.contents;
    if (!body || body.length > 2000000) return json_({ ok: false, error: { code: 'VALIDATION', message: 'Empty or oversized request' } });
    req = JSON.parse(body);
  } catch (err) {
    return json_({ ok: false, error: { code: 'VALIDATION', message: 'Request body must be JSON' } });
  }
  try {
    return json_(service_().handle(req, buildDeps_()));
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return json_({ ok: false, error: { code: 'INTERNAL', message: 'Server configuration error. Check the Apps Script execution log.' } });
  }
}

/** GET only serves the public health check. No financial data is ever returned over GET. */
function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === 'health') {
    try { return json_(service_().handle({ action: 'health' }, buildDeps_())); }
    catch (err) { return json_({ ok: false, error: { code: 'MISCONFIGURED', message: 'Backend reachable but not configured' } }); }
  }
  return json_({ ok: true, data: { service: 'Personal Wealth OS API', hint: 'POST JSON {action, idToken, requestId, payload}' } });
}
