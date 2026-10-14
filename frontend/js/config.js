/**
 * Public configuration. These two values are NOT secrets — they are visible to
 * anyone who loads the page, and that is fine:
 *   - API_URL: your Apps Script web-app URL (…/exec). Every protected call still
 *     requires a verified Google sign-in for an allow-listed email.
 *   - GOOGLE_CLIENT_ID: your OAuth Web client ID. Client IDs are public by design.
 *
 * You can leave them empty and enter them on the in-app "Connect backend" screen
 * instead (stored in this browser's localStorage).
 *
 * NEVER put passwords, API keys, service-account JSON or spreadsheet IDs here.
 */
export const CONFIG = {
  APP_NAME: 'Personal Wealth OS',
  API_URL: '',
  GOOGLE_CLIENT_ID: '',
  REQUEST_TIMEOUT_MS: 45000
};
