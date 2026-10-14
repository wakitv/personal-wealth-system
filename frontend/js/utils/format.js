import { html, raw } from './dom.js';
const Core = window.WealthCore;

let BASE = 'PHP';
let TZ = 'Asia/Manila';
const fmtCache = new Map();
function nf(key, opts) {
  if (!fmtCache.has(key)) fmtCache.set(key, new Intl.NumberFormat('en-PH', opts));
  return fmtCache.get(key);
}
export function configure({ base, tz }) { if (base) BASE = base; if (tz) TZ = tz; fmtCache.clear(); }
export const base = () => BASE;
export const tz = () => TZ;

const SYMBOLS = { PHP: '₱', USD: '$', EUR: '€', GBP: '£', JPY: '¥', SGD: 'S$' };
/** Money in any currency. Crypto-like codes get their own decimals. */
export function money(v, cur = BASE, { sign = false, compact = false } = {}) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  const d = Core.decimals(cur);
  const abs = Math.abs(v);
  let body;
  if (compact && abs >= 1e5) body = nf('c' + d, { notation: 'compact', maximumFractionDigits: 2 }).format(abs);
  else body = nf('m' + d, { minimumFractionDigits: Math.min(d, 2), maximumFractionDigits: d }).format(abs);
  const sym = SYMBOLS[cur];
  const s = sym ? sym + body : body + ' ' + cur;
  const pre = v < 0 ? '−' : sign && v > 0 ? '+' : '';
  return pre + s;
}
export const php = (v, o) => money(v, BASE, o);
export function qty(v) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  return nf('q', { maximumFractionDigits: 8 }).format(v);
}
export function pct(v, { sign = true, dp = 2 } = {}) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  const pre = v < 0 ? '−' : sign && v > 0 ? '+' : '';
  return pre + Math.abs(v).toFixed(dp) + '%';
}
export const tone = (v) => (v > 0.0049 ? 'up' : v < -0.0049 ? 'down' : 'flat');
/** Coloured signed amount. */
export const pl = (v, cur) => html`<span class="amt ${tone(v)}">${money(v, cur, { sign: true })}</span>`;
export const amt = (v, cur, o) => html`<span class="amt">${money(v, cur, o)}</span>`;
export const date = (v) => Core.formatDate(v, TZ);
export const dateTime = (v) => Core.formatDateTime(v, TZ);
export const dateStr = (s) => Core.formatDateStr(s);
export const today = () => Core.localDate(Date.now(), TZ);
export function ago(ms) {
  if (!ms) return '—';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}
/** ISO instant → value for <input type=datetime-local> in the app time zone. */
export function toLocalInput(iso) {
  const ms = iso ? Date.parse(iso) : Date.now();
  const d = Core.localDate(ms, TZ);
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  return d + 'T' + t;
}
/** <input type=datetime-local> value (app time zone) → ISO instant. */
export function fromLocalInput(v) {
  if (!v) return '';
  const [d, t] = v.split('T');
  return new Date(Core.localToUtcMs(d, (t || '00:00') + ':00', TZ)).toISOString();
}
export const typeLabel = (t) => Core.TX_LABELS[t] || t;
export const accountTypeLabel = (t) => Core.ACCOUNT_TYPE_LABELS[t] || t;
export const badge = (text, kind = '') => html`<span class="badge ${kind}">${text}</span>`;
export const icon = (name) => raw(`<svg class="i" aria-hidden="true"><use href="#i-${name}"/></svg>`);
