/**
 * Google Identity Services sign-in. The resulting ID token is sent with every API
 * call and verified by the backend (signature, audience, expiry, allowlist). The
 * token lives only in sessionStorage for this tab and expires after ~1 hour.
 * Nothing here grants access by itself — the server decides.
 */
const TOKEN_KEY = 'pwos.idtoken';
let clientId = '';
let pending = null;
let listeners = new Set();

function decode(token) {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(p))));
  } catch { return null; }
}
function stored() {
  try {
    const t = sessionStorage.getItem(TOKEN_KEY);
    const c = t && decode(t);
    if (c && c.exp * 1000 > Date.now() + 60000) return { token: t, claims: c };
  } catch { /* ignore */ }
  return null;
}
function waitForGis(timeout = 10000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function poll() {
      if (window.google?.accounts?.id) return resolve(window.google.accounts.id);
      if (Date.now() - start > timeout) return reject(new Error('Google sign-in could not load. Check your connection or content blockers.'));
      setTimeout(poll, 100);
    })();
  });
}

export const auth = {
  async init(id) {
    clientId = id;
    const gis = await waitForGis();
    gis.initialize({
      client_id: clientId, auto_select: true, itp_support: true, cancel_on_tap_outside: false, use_fedcm_for_prompt: true,
      callback: (resp) => {
        try { sessionStorage.setItem(TOKEN_KEY, resp.credential); } catch { /* ignore */ }
        const c = decode(resp.credential);
        if (pending) { pending.resolve(resp.credential); pending = null; }
        listeners.forEach((fn) => fn(c));
      }
    });
    return gis;
  },
  renderButton(el) {
    window.google.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', width: 280 });
  },
  onSignIn(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  current() { return stored(); },
  user() { return stored()?.claims || null; },
  /** Valid token, prompting silently (One Tap auto-select) when it has expired. */
  getToken() {
    const s = stored();
    if (s) return Promise.resolve(s.token);
    if (!window.google?.accounts?.id) return Promise.reject(Object.assign(new Error('Sign in required'), { code: 'UNAUTHENTICATED' }));
    if (pending) return pending.promise;
    let resolve, reject;
    const promise = new Promise((a, b) => { resolve = a; reject = b; });
    const mine = { promise, resolve, reject };
    pending = mine;
    window.google.accounts.id.prompt((n) => {
      // The notification may arrive synchronously; only settle our own pending request.
      if ((n.isNotDisplayed?.() || n.isSkippedMoment?.() || n.isDismissedMoment?.()) && pending === mine) {
        pending = null;
        mine.reject(Object.assign(new Error('Sign in required'), { code: 'UNAUTHENTICATED' }));
      }
    });
    return promise;
  },
  signOut() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
    try { window.google?.accounts?.id?.disableAutoSelect(); } catch { /* ignore */ }
  }
};
