import { CONFIG } from '../config.js';
import { uid } from '../utils/dom.js';
import { auth } from './auth.js';

const SANDBOX_KEY = 'pwos.sandbox.db.v1';
const CONN_KEY = 'pwos.connection.v1';

export class ApiError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}

/** Connection settings: build-time config, optionally overridden in this browser. */
export function getConnection() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(CONN_KEY) || '{}'); } catch { saved = {}; }
  return {
    mode: saved.mode || (CONFIG.API_URL ? 'remote' : null),
    apiUrl: saved.apiUrl || CONFIG.API_URL,
    clientId: saved.clientId || CONFIG.GOOGLE_CLIENT_ID
  };
}
export function saveConnection(c) {
  try { localStorage.setItem(CONN_KEY, JSON.stringify(c)); } catch { /* storage unavailable */ }
}
export function clearConnection() { try { localStorage.removeItem(CONN_KEY); } catch { /* ignore */ } }

// ------------------------------------------------------------------ transports
class RemoteTransport {
  constructor(url) { this.url = url; this.kind = 'remote'; }
  async send(body, { anonymous = false } = {}) {
    const req = { ...body };
    if (!anonymous) req.idToken = await auth.getToken();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.REQUEST_TIMEOUT_MS);
    let res;
    try {
      // text/plain keeps this a "simple" CORS request (Apps Script cannot answer preflights).
      res = await fetch(this.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(req), redirect: 'follow', signal: ctrl.signal, credentials: 'omit', cache: 'no-store' });
    } catch (e) {
      throw new ApiError('NETWORK', e.name === 'AbortError' ? 'The server took too long to respond.' : 'Could not reach the backend. Check your connection and API URL.');
    } finally { clearTimeout(timer); }
    if (!res.ok) throw new ApiError('NETWORK', 'Backend returned HTTP ' + res.status);
    let json;
    try { json = await res.json(); } catch { throw new ApiError('NETWORK', 'Backend response was not JSON. Is the deployment URL correct (…/exec)?'); }
    return json;
  }
}

/** Runs the real service code against a browser-local store. No network. */
class SandboxTransport {
  constructor() {
    this.kind = 'sandbox';
    let init = null;
    try { init = JSON.parse(localStorage.getItem(SANDBOX_KEY) || 'null'); } catch { init = null; }
    this.store = window.WealthService.MemoryStore(init || undefined);
    this.persist = () => { try { localStorage.setItem(SANDBOX_KEY, JSON.stringify(this.store.dump())); } catch { /* quota or disabled */ } };
    this.deps = {
      store: this.store, now: () => Date.now(), uuid: () => crypto.randomUUID(),
      withLock: (fn) => fn(), authenticate: () => ({ email: 'sandbox@this-browser' }), http: null,
      log: (e) => console.error(e)
    };
    if (!init) this.seedSettings();
  }
  seedSettings() {
    const now = new Date().toISOString();
    this.store.append('Settings', Object.entries(window.WealthService.DEFAULT_SETTINGS).map(([key, value]) => ({ key, value, updated_at: now })));
    this.persist();
  }
  async send(body) {
    const res = window.WealthService.handle(body, this.deps);
    this.persist();
    await new Promise((r) => setTimeout(r, 60)); // keep loading states honest
    return JSON.parse(JSON.stringify(res));
  }
  static wipe() { try { localStorage.removeItem(SANDBOX_KEY); } catch { /* ignore */ } }
}

// ------------------------------------------------------------------ client
class Api {
  constructor() { this.transport = null; this.listeners = new Set(); }
  init(conn) {
    this.transport = conn.mode === 'sandbox' ? new SandboxTransport() : new RemoteTransport(conn.apiUrl);
  }
  get mode() { return this.transport?.kind; }
  onAuthError(fn) { this.listeners.add(fn); }
  /**
   * @param requestId pass a stable id for writes (created when a form opens) so a
   *        double-submit or retry is recognised by the server and recorded once.
   */
  async call(action, payload = {}, { requestId, anonymous } = {}) {
    if (!this.transport) throw new ApiError('MISCONFIGURED', 'Backend not configured');
    const body = { action, payload, requestId: requestId || uid('req') };
    const res = await this.transport.send(body, { anonymous });
    if (!res || typeof res !== 'object') throw new ApiError('NETWORK', 'Empty response');
    if (!res.ok) {
      const e = res.error || {};
      if (e.code === 'UNAUTHENTICATED') this.listeners.forEach((fn) => fn(e));
      throw new ApiError(e.code || 'ERROR', e.message || 'Request failed', e.details);
    }
    return res.data;
  }
  health() { return this.call('health', {}, { anonymous: true }); }
}

export const api = new Api();
export const wipeSandbox = () => SandboxTransport.wipe();
