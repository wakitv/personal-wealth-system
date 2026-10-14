/**
 * Configuration — read from Script Properties (Project Settings → Script properties).
 * Nothing secret lives in source code.
 *
 *   SPREADSHEET_ID    ID of the private Google Sheet used as the database (from its URL)
 *   GOOGLE_CLIENT_ID  OAuth 2.0 Web client ID used by the frontend's Google sign-in
 *   ALLOWED_EMAILS    Comma-separated Google account emails allowed to use the app
 *   ALLOWED_ORIGIN    (informational) your GitHub Pages origin, e.g. https://you.github.io
 */
function getConfig_() {
  var p = PropertiesService.getScriptProperties();
  return {
    spreadsheetId: p.getProperty('SPREADSHEET_ID') || '',
    clientId: (p.getProperty('GOOGLE_CLIENT_ID') || '').trim(),
    allowedEmails: (p.getProperty('ALLOWED_EMAILS') || '').split(',').map(function (s) { return s.trim(); }).filter(String),
    allowedOrigin: p.getProperty('ALLOWED_ORIGIN') || ''
  };
}

function getSpreadsheet_() {
  var id = getConfig_().spreadsheetId;
  if (!id) throw new Error('SPREADSHEET_ID script property is not set. Run setupDatabase() or set it in Project Settings.');
  return SpreadsheetApp.openById(id);
}
