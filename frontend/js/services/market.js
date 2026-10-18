/**
 * Market prices fetched by YOUR browser, then saved to your sheet by the backend.
 *
 * Why the browser: Binance refuses requests from Google's servers (HTTP 451 "restricted
 * location"), and CoinGecko throttles them. Requests from your own device are allowed.
 *
 *  - Binance: public market-data endpoint (no key), one call for all symbols.
 *  - CoinGecko: one call for all IDs, plus USDT/USDC → base-currency rates.
 *  - A Binance price is quoted in the pair's quote currency (BTCUSDT → USDT). If the asset is
 *    priced in that currency it is stored as-is; if it is priced in the base currency (PHP) it is
 *    converted with the USDT→PHP rate fetched now, or your latest recorded rate.
 */
import { api } from './api.js';
import { store } from '../state.js';

const BINANCE_URLS = [
  'https://data-api.binance.vision/api/v3/ticker/price', // Binance's public market-data-only host
  'https://api.binance.com/api/v3/ticker/price'
];
const QUOTES = ['FDUSD', 'USDT', 'USDC', 'TUSD', 'BTC', 'ETH', 'BNB', 'EUR', 'TRY', 'BRL', 'JPY'];
const STABLE_IDS = { USDT: 'tether', USDC: 'usd-coin', FDUSD: 'first-digital-usd' };
const TIMEOUT = 15000;

async function getJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { signal: ctrl.signal, credentials: 'omit', cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(t); }
}

async function binanceTable() {
  let lastErr;
  for (const u of BINANCE_URLS) {
    try {
      const rows = await getJson(u);
      if (!Array.isArray(rows)) throw new Error('unexpected response');
      const m = {};
      rows.forEach((r) => { const p = Number(r.price); if (r.symbol && p > 0) m[r.symbol] = p; });
      return m;
    } catch (e) { lastErr = e; }
  }
  throw new Error('Binance could not be reached from this device (' + (lastErr?.message || 'network error') + ')');
}

export function quoteOf(symbol) {
  return QUOTES.find((q) => symbol.endsWith(q) && symbol.length > q.length) || null;
}

/** Assets that use an automatic source. */
export function marketAssets() {
  return store.activeAssets().filter((a) => (a.price_source === 'BINANCE' || a.price_source === 'COINGECKO') && a.price_source_id);
}

/**
 * Fetch and record prices. Returns { updated, fx, skipped: [..], errors: [..] }.
 * Throws only if nothing at all could be updated.
 */
export async function refreshMarketPrices() {
  const assets = marketAssets();
  const base = store.base, baseLc = base.toLowerCase();
  const nowIso = new Date().toISOString();
  const binance = assets.filter((a) => a.price_source === 'BINANCE');
  const gecko = assets.filter((a) => a.price_source === 'COINGECKO');
  const skipped = [], errors = [];

  // CoinGecko: asset IDs + stablecoin FX in one call (also used to convert Binance USDT prices)
  const fxNeeded = new Set(['USDT']);
  binance.forEach((a) => { const q = quoteOf(a.price_source_id); if (q && STABLE_IDS[q]) fxNeeded.add(q); });
  let fxIdsSetting = {};
  try { fxIdsSetting = JSON.parse(store.setting('coingecko_fx_ids', '{}')); } catch { fxIdsSetting = {}; }
  const fxIds = { ...STABLE_IDS, ...fxIdsSetting };
  const geckoIds = new Set(gecko.map((a) => a.price_source_id));
  [...fxNeeded].forEach((c) => { if (fxIds[c]) geckoIds.add(fxIds[c]); });
  const vs = [...new Set([baseLc, 'usd', ...gecko.map((a) => a.currency.toLowerCase())])].join(',');
  let cg = {};
  try {
    cg = await getJson('https://api.coingecko.com/api/v3/simple/price?ids=' + encodeURIComponent([...geckoIds].join(',')) + '&vs_currencies=' + encodeURIComponent(vs));
  } catch (e) { if (gecko.length || binance.length) errors.push('CoinGecko: ' + e.message); }

  const fxRows = [];
  const fxRate = {};
  [...fxNeeded].forEach((c) => {
    const q = cg[fxIds[c]];
    if (q && q[baseLc] > 0 && c !== base) { fxRate[c] = q[baseLc]; fxRows.push({ currency: c, rate: q[baseLc], as_of: nowIso, source: 'COINGECKO:' + fxIds[c] }); }
  });
  const rateFor = (cur) => (cur === base ? 1 : fxRate[cur] || store.latestFx(cur)?.rate || null);

  const prices = [];
  gecko.forEach((a) => {
    const label = a.ticker || a.name, q = cg[a.price_source_id], v = q && q[a.currency.toLowerCase()];
    if (!q) { skipped.push(`${label}: CoinGecko has no coin with ID "${a.price_source_id}"`); return; }
    if (!(v > 0)) { skipped.push(`${label}: CoinGecko has no ${a.currency} price`); return; }
    prices.push({ asset_id: a.asset_id, price: v, currency: a.currency, as_of: nowIso, source: 'COINGECKO', notes: 'coingecko:' + a.price_source_id });
  });

  if (binance.length) {
    let table = null;
    try { table = await binanceTable(); } catch (e) { errors.push(e.message); }
    if (table) binance.forEach((a) => {
      const label = a.ticker || a.name, sym = a.price_source_id, p = table[sym];
      if (!(p > 0)) { skipped.push(`${label}: Binance has no pair "${sym}" (check the symbol, e.g. BTCUSDT)`); return; }
      const quote = quoteOf(sym);
      if (a.currency === quote) { prices.push({ asset_id: a.asset_id, price: p, currency: a.currency, as_of: nowIso, source: 'BINANCE', notes: `binance:${sym}` }); return; }
      if (!quote) { skipped.push(`${label}: cannot tell the quote currency of "${sym}"`); return; }
      const from = rateFor(quote), to = rateFor(a.currency);
      if (!from || !to) { skipped.push(`${label}: needs a ${quote} → ${base} rate (record one in Settings → FX rates)`); return; }
      const converted = p * from / to;
      prices.push({ asset_id: a.asset_id, price: Number(converted.toPrecision(12)), currency: a.currency, as_of: nowIso, source: 'BINANCE', notes: `binance:${sym} ${p} ${quote} × ${from}${to !== 1 ? ' ÷ ' + to : ''}` });
    });
  }

  if (!prices.length && !fxRows.length) {
    const why = [...errors, ...skipped];
    throw new Error(assets.length ? 'No prices updated. ' + why.join(' · ') : 'No assets use Binance or CoinGecko prices yet. Edit a coin and choose a price source.');
  }
  await api.call('recordPrices', { prices, fx: fxRows });
  await store.load();
  return { updated: prices.length, fx: fxRows.length, skipped, errors };
}

/** Newest automatic price timestamp (ms), or 0. */
export function lastMarketUpdate() {
  let t = 0;
  (store.data.prices || []).forEach((p) => { if ((p.source === 'BINANCE' || p.source === 'COINGECKO') && Date.parse(p.as_of) > t) t = Date.parse(p.as_of); });
  return t;
}
