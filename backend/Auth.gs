/**
 * Authentication — every protected request carries a Google ID token obtained by the
 * frontend through Google Identity Services. The token is verified server-side:
 *
 *   1. Google's tokeninfo endpoint validates the signature and returns the claims.
 *   2. WealthService.checkClaims() then requires:
 *        aud == GOOGLE_CLIENT_ID, iss == accounts.google.com, exp in the future,
 *        email_verified, and email ∈ ALLOWED_EMAILS.
 *
 * Verified tokens are cached by SHA-256 hash (never the raw token) until shortly
 * before they expire, to avoid a network round-trip on every request.
 */
function authenticate_(idToken, service) {
  var cfg = getConfig_();
  if (!cfg.clientId || !cfg.allowedEmails.length) throw new service.ApiError('MISCONFIGURED', 'Server is missing GOOGLE_CLIENT_ID or ALLOWED_EMAILS script properties');
  if (!idToken || typeof idToken !== 'string' || idToken.length > 4096) {
    throw new service.ApiError('UNAUTHENTICATED', 'Sign in required');
  }
  // Cheap structural pre-filter before spending a network call: a JWT whose (unverified)
  // audience is not our client ID can never pass, so reject it locally. Not a trust decision —
  // the token is still fully verified by Google below.
  var parts = idToken.split('.');
  if (parts.length !== 3) throw new service.ApiError('UNAUTHENTICATED', 'Sign in required');
  try {
    var pre = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[1] + '==='.slice((parts[1].length + 3) % 4))).getDataAsString());
    if (pre.aud !== cfg.clientId) throw new Error('aud');
  } catch (e) { throw new service.ApiError('UNAUTHENTICATED', 'Sign in required'); }
  var cache = CacheService.getScriptCache();
  var key = 'tok_' + sha256Hex_(idToken);
  var cached = cache.get(key);
  if (cached) {
    var c = JSON.parse(cached);
    return service.checkClaims(c, cfg, Date.now()); // re-checks expiry and allowlist every time
  }
  var resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), {
    method: 'get', muteHttpExceptions: true, followRedirects: false
  });
  if (resp.getResponseCode() !== 200) throw new service.ApiError('UNAUTHENTICATED', 'Invalid or expired sign-in');
  var claims = JSON.parse(resp.getContentText());
  var who = service.checkClaims(claims, cfg, Date.now());
  var ttl = Math.min(600, Math.max(0, Math.floor(Number(claims.exp) - Date.now() / 1000) - 60));
  if (ttl > 30) {
    cache.put(key, JSON.stringify({ aud: claims.aud, iss: claims.iss, exp: claims.exp, email: claims.email, email_verified: claims.email_verified }), ttl);
  }
  return who;
}

function sha256Hex_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { var h = (b & 0xff).toString(16); return h.length === 1 ? '0' + h : h; }).join('');
}
