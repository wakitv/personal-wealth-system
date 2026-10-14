/**
 * One-time setup and maintenance helpers. Run these from the Apps Script editor
 * (select the function in the toolbar → Run). They run as you, the owner.
 */

/**
 * Creates (or migrates) every worksheet with headers, frozen header row,
 * plain-text formatting for text columns, and default settings.
 * If SPREADSHEET_ID is not set, a new private spreadsheet is created and its ID saved.
 */
function setupDatabase() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  var ss;
  if (!id) {
    ss = SpreadsheetApp.create('Personal Wealth OS — Database');
    props.setProperty('SPREADSHEET_ID', ss.getId());
    console.log('Created spreadsheet ' + ss.getUrl());
  } else {
    ss = SpreadsheetApp.openById(id);
  }
  ss.setSpreadsheetTimeZone('Asia/Manila');
  var svc = service_();
  svc.SHEETS.forEach(function (name) {
    var cols = svc.SCHEMA[name].cols;
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var lastCol = Math.max(1, sh.getLastColumn());
    var existing = sh.getLastRow() >= 1 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String).filter(String) : [];
    var headers = existing.slice();
    cols.forEach(function (c) { if (headers.indexOf(c[0]) < 0) headers.push(c[0]); });
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#0f172a').setFontColor('#e2e8f0');
    sh.setFrozenRows(1);
    var maxRows = Math.max(sh.getMaxRows(), 2);
    var types = {}; cols.forEach(function (c) { types[c[0]] = c[1]; });
    headers.forEach(function (h, i) {
      var range = sh.getRange(2, i + 1, maxRows - 1, 1);
      if (types[h] === 'n') range.setNumberFormat('0.########');
      else if (types[h] === 's' || types[h] === 'j') range.setNumberFormat('@');
    });
    var protection = sh.protect().setDescription('Managed by Personal Wealth OS — edit through the app');
    protection.setWarningOnly(true); // warns before accidental manual edits; the app is the source of truth
  });
  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
  // Default settings (only keys that are not set yet)
  var store = SheetStore_(ss, svc.SCHEMA, 'Asia/Manila');
  var have = {}; store.read('Settings').forEach(function (r) { have[r.key] = 1; });
  var now = new Date().toISOString();
  var rows = Object.keys(svc.DEFAULT_SETTINGS).filter(function (k) { return !have[k]; }).map(function (k) { return { key: k, value: svc.DEFAULT_SETTINGS[k], updated_at: now }; });
  store.append('Settings', rows);
  console.log('Database ready: ' + ss.getUrl());
  return ss.getUrl();
}

/** Verifies configuration and a formula-injection-safe write/read round trip. Leaves no data behind except an audit row. */
function selfTest() {
  var cfg = getConfig_();
  var problems = [];
  if (!cfg.spreadsheetId) problems.push('SPREADSHEET_ID not set');
  if (!/\.apps\.googleusercontent\.com$/.test(cfg.clientId)) problems.push('GOOGLE_CLIENT_ID missing or malformed');
  if (!cfg.allowedEmails.length) problems.push('ALLOWED_EMAILS not set');
  var ss = getSpreadsheet_();
  var svc = service_();
  svc.SHEETS.forEach(function (s) { if (!ss.getSheetByName(s)) problems.push('Missing worksheet ' + s); });
  var file = DriveApp.getFileById(ss.getId());
  var access = file.getSharingAccess();
  if (access !== DriveApp.Access.PRIVATE) problems.push('Spreadsheet sharing is ' + access + ' — set it to Restricted (private).');
  var store = SheetStore_(ss, svc.SCHEMA, 'Asia/Manila');
  var probe = '=1+1 selftest ' + Utilities.getUuid().slice(0, 8);
  store.append('AuditLog', [{ audit_id: 'SELFTEST-' + Date.now(), at: new Date().toISOString(), actor: 'selfTest', action: 'SELFTEST', entity: 'Store', entity_id: 'probe', request_id: '', before_json: probe, after_json: '' }]);
  var fresh = SheetStore_(ss, svc.SCHEMA, 'Asia/Manila');
  var back = fresh.read('AuditLog').filter(function (r) { return r.before_json === probe; });
  if (back.length !== 1) problems.push('Text round trip failed (formula guard)');
  var result = problems.length ? 'PROBLEMS:\n- ' + problems.join('\n- ') : 'All checks passed.';
  console.log(result);
  return result;
}
