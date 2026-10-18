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
    http: { getJson: function (url) { return fetchJson_(url, svc); } },
    log: function (e) { console.error(e && e.stack ? e.stack : e); }
  };
}

/**
 * Server-side fetch for market data. If the optional COINGECKO_API_KEY script property holds a
 * free CoinGecko "Demo" key, it is sent as a header (it never reaches the browser).
 */
function fetchJson_(url, svc) {
  var headers = { Accept: 'application/json' };
  var key = PropertiesService.getScriptProperties().getProperty('COINGECKO_API_KEY');
  var isCoinGecko = url.indexOf('https://api.coingecko.com/') === 0;
  if (isCoinGecko && key) headers['x-cg-demo-api-key'] = key.trim();
  var res;
  try { res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: headers }); }
  catch (e) { throw new svc.ApiError('UPSTREAM', 'Could not reach the price source: ' + e.message); }
  var code = res.getResponseCode();
  if (code === 200) return JSON.parse(res.getContentText());
  if (isCoinGecko && code === 429) {
    throw new svc.ApiError('UPSTREAM', key
      ? 'CoinGecko rate limit reached. Wait a minute and try again.'
      : 'CoinGecko is limiting requests from Google servers (HTTP 429). Get a free Demo API key at coingecko.com/en/api and add it as script property COINGECKO_API_KEY.');
  }
  if (isCoinGecko && (code === 401 || code === 403)) {
    throw new svc.ApiError('UPSTREAM', key
      ? 'CoinGecko rejected the API key in COINGECKO_API_KEY (HTTP ' + code + '). Check it is a Demo key copied in full.'
      : 'CoinGecko refused the request (HTTP ' + code + '). Add a free Demo API key as script property COINGECKO_API_KEY.');
  }
  throw new svc.ApiError('UPSTREAM', 'Price source returned HTTP ' + code);
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
    return json_({ ok: false, error: setupProblem_(err) });
  }
}

/**
 * Explain setup problems precisely. These messages describe configuration only — never data —
 * so they are safe to show before sign-in.
 */
function setupProblem_(err) {
  var msg = String(err && err.message || err);
  if (/SPREADSHEET_ID/.test(msg)) {
    return { code: 'MISCONFIGURED', message: 'The database is not set up yet: SPREADSHEET_ID is empty. In the Apps Script editor run setupDatabase, then try again.' };
  }
  if (/openById|not found|Requested entity|permission/i.test(msg)) {
    return { code: 'MISCONFIGURED', message: 'The backend cannot open its spreadsheet. Check the SPREADSHEET_ID script property (run setupDatabase if unsure).' };
  }
  if (/Worksheet|header row|missing column/i.test(msg)) {
    return { code: 'MISCONFIGURED', message: msg };
  }
  return { code: 'INTERNAL', message: 'Server configuration error. Check the Apps Script execution log (Executions, left sidebar).' };
}

/** GET only serves the public health check. No financial data is ever returned over GET. */
function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === 'health') {
    try { return json_(service_().handle({ action: 'health' }, buildDeps_())); }
    catch (err) { return json_({ ok: false, error: setupProblem_(err) }); }
  }
  return json_({ ok: true, data: { service: 'Personal Wealth OS API', hint: 'POST JSON {action, idToken, requestId, payload}' } });
}
