import { html, raw, mount, $, $$, debounce, esc } from '../utils/dom.js';
import { icon } from '../utils/format.js';

// ------------------------------------------------------------------ toasts
export function toast(message, kind = 'ok', ms = 4200) {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  mount(el, html`${icon(kind === 'error' ? 'alert' : 'check')}<span>${message}</span>`);
  host.appendChild(el);
  while (host.children.length > 3) host.firstElementChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}
export function errorMessage(e) {
  if (!e) return 'Something went wrong';
  const m = e.message || String(e);
  return e.code && !['VALIDATION', 'INSUFFICIENT_FUNDS', 'INSUFFICIENT_QUANTITY', 'CONFLICT', 'NOT_FOUND'].includes(e.code) ? m + ' (' + e.code + ')' : m;
}

// ------------------------------------------------------------------ modal
let openModal = null;
/**
 * Accessible modal dialog.
 * opts: { title, body (Raw), wide, submitLabel, onSubmit(form) → Promise, onOpen(el), danger }
 */
export function modal(opts) {
  closeModal();
  const prev = document.activeElement;
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = String(html`
    <div class="modal ${opts.wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <form class="modal-form" novalidate>
        <header class="modal-head"><h2 id="modal-title">${opts.title}</h2>
          <button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button></header>
        <div class="modal-body">${opts.body}</div>
        <div class="form-error" role="alert" hidden></div>
        ${opts.onSubmit ? html`<footer class="modal-foot">
          <button type="button" class="btn ghost" data-close>Cancel</button>
          <button type="submit" class="btn ${opts.danger ? 'danger' : 'primary'}">${opts.submitLabel || 'Save'}</button></footer>` : ''}
      </form>
    </div>`);
  document.body.appendChild(wrap);
  document.body.classList.add('no-scroll');
  const form = $('form', wrap), errBox = $('.form-error', wrap);
  const close = () => { if (!wrap.isConnected) return; wrap.remove(); document.body.classList.remove('no-scroll'); openModal = null; prev?.focus?.(); opts.onClose?.(); };
  openModal = { close, el: wrap };
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  $$('[data-close]', wrap).forEach((b) => b.addEventListener('click', close));
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') { // focus trap
      const f = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', wrap).filter((x) => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!opts.onSubmit || busy) return; // ignore double submits while one is in flight
    const invalid = $$('[required]', form).find((i) => !String(i.value).trim() && i.offsetParent !== null);
    if (invalid) { errBox.hidden = false; errBox.textContent = (invalid.dataset.label || invalid.name) + ' is required'; invalid.focus(); return; }
    busy = true; errBox.hidden = true;
    const btn = $('[type=submit]', form); btn.disabled = true; btn.classList.add('loading');
    try { const keep = await opts.onSubmit(form, { close }); if (keep !== false) close(); }
    catch (err) { errBox.hidden = false; errBox.textContent = errorMessage(err); }
    finally { busy = false; btn.disabled = false; btn.classList.remove('loading'); }
  });
  opts.onOpen?.(wrap);
  setTimeout(() => ($('input:not([type=hidden]), select, textarea', $('.modal-body', wrap)) || $('[data-close]', wrap))?.focus(), 30);
  return openModal;
}
export function closeModal() { openModal?.close(); }

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = true, withReason = false }) {
  return new Promise((resolve) => {
    let result = false;
    modal({
      title, danger, submitLabel: confirmLabel,
      body: html`<p class="muted">${message}</p>${withReason ? html`<label class="field"><span>Reason (kept in the audit log)</span><input name="reason" required data-label="Reason" maxlength="400"></label>` : ''}`,
      onSubmit: async (form) => { result = withReason ? form.reason.value.trim() : true; },
      onClose: () => resolve(result)
    });
  });
}

// ------------------------------------------------------------------ states
export const loadingBlock = (rows = 3) => html`<div class="skeleton-wrap" aria-busy="true" aria-label="Loading">${Array.from({ length: rows }, () => raw('<div class="skeleton"></div>'))}</div>`;
export const emptyState = (title, text, action) => html`<div class="empty">${icon('spark')}<h3>${title}</h3><p>${text}</p>${action || ''}</div>`;
export const errorState = (e, retry = true) => html`<div class="empty error">${icon('alert')}<h3>Could not load data</h3><p>${errorMessage(e)}</p>${retry ? html`<button class="btn" data-action="reload">Retry</button>` : ''}</div>`;

// ------------------------------------------------------------------ cards
export function statCard({ label, value, sub, tone = '', hint = '', id = '' }) {
  return html`<div class="card stat ${tone}" ${id ? raw(`id="${esc(id)}"`) : ''}>
    <div class="stat-label">${label}${hint ? html`<span class="hint" title="${hint}" tabindex="0" aria-label="${hint}">?</span>` : ''}</div>
    <div class="stat-value amt">${value}</div>${sub ? html`<div class="stat-sub">${sub}</div>` : ''}</div>`;
}

// ------------------------------------------------------------------ data table
/**
 * Sortable, searchable, paginated table.
 * columns: [{ key, label, render(row) → Raw|string, sort(row) → value, align, className }]
 */
export function dataTable(host, { columns, rows, pageSize = 25, search = true, searchText, empty = 'Nothing here yet.', initialSort, toolbar = '', rowAttrs }) {
  const st = { q: '', sortKey: initialSort?.key || null, dir: initialSort?.dir || 'desc', page: 0 };
  const text = searchText || ((r) => columns.map((c) => (c.sort ? c.sort(r) : r[c.key]) ?? '').join(' ').toLowerCase());
  function view() {
    let list = rows;
    if (st.q) { const q = st.q.toLowerCase(); list = list.filter((r) => text(r).toLowerCase().includes(q)); }
    if (st.sortKey) {
      const col = columns.find((c) => c.key === st.sortKey);
      const val = col.sort || ((r) => r[col.key]);
      list = [...list].sort((a, b) => { const x = val(a), y = val(b); const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true }); return st.dir === 'asc' ? c : -c; });
    }
    const pages = Math.max(1, Math.ceil(list.length / pageSize));
    st.page = Math.min(st.page, pages - 1);
    const slice = list.slice(st.page * pageSize, st.page * pageSize + pageSize);
    mount($('.dt-body', host), slice.length ? html`<table class="table"><thead><tr>${columns.map((c) => html`<th class="${c.align || ''}" scope="col">${c.noSort ? c.label : html`<button type="button" class="th-btn" data-sort="${c.key}" aria-label="Sort by ${c.label}">${c.label}${st.sortKey === c.key ? (st.dir === 'asc' ? ' ▲' : ' ▼') : ''}</button>`}</th>`)}</tr></thead>
      <tbody>${slice.map((r) => html`<tr ${rowAttrs ? raw(rowAttrs(r)) : ''}>${columns.map((c) => html`<td class="${c.align || ''} ${c.className || ''}" data-label="${c.label}"><div class="cell">${c.render ? c.render(r) : r[c.key] ?? ''}</div></td>`)}</tr>`)}</tbody></table>`
      : html`<div class="dt-empty">${st.q ? 'No matches for “' + st.q + '”.' : empty}</div>`);
    mount($('.dt-foot', host), list.length > pageSize ? html`<span class="muted">${st.page * pageSize + 1}–${Math.min(list.length, (st.page + 1) * pageSize)} of ${list.length}</span>
      <div class="pager"><button class="btn sm ghost" data-page="-1" ${st.page === 0 ? 'disabled' : ''}>Prev</button><button class="btn sm ghost" data-page="1" ${st.page >= pages - 1 ? 'disabled' : ''}>Next</button></div>` : list.length ? html`<span class="muted">${list.length} row${list.length === 1 ? '' : 's'}</span>` : '');
  }
  mount(host, html`<div class="dt">${search || toolbar ? html`<div class="dt-tools">${search ? html`<label class="search">${icon('search')}<input type="search" placeholder="Search…" aria-label="Search table"></label>` : ''}${toolbar}</div>` : ''}<div class="dt-body"></div><div class="dt-foot"></div></div>`);
  $('input[type=search]', host)?.addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); st.page = 0; view(); }, 150));
  host.addEventListener('click', (e) => {
    const s = e.target.closest('[data-sort]');
    if (s) { const k = s.dataset.sort; st.dir = st.sortKey === k && st.dir === 'desc' ? 'asc' : 'desc'; st.sortKey = k; view(); }
    const p = e.target.closest('[data-page]');
    if (p) { st.page += Number(p.dataset.page); view(); }
  });
  view();
  return { refresh: (newRows) => { rows = newRows; view(); } };
}

// ------------------------------------------------------------------ charts
const charts = new WeakMap();
export function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
export const PALETTE = () => ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7', '--c8'].map(cssVar);
export function chart(canvas, config) {
  if (!canvas) return null;
  if (!window.Chart) {
    canvas.replaceWith(Object.assign(document.createElement('div'), { className: 'chart-fallback', textContent: 'Charts are unavailable (chart library did not load).' }));
    return null;
  }
  charts.get(canvas)?.destroy();
  const grid = cssVar('--grid'), text = cssVar('--muted');
  window.Chart.defaults.font.family = cssVar('--font-sans') || 'system-ui';
  window.Chart.defaults.color = text;
  const base = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true } }, tooltip: { backgroundColor: cssVar('--panel-2'), borderColor: cssVar('--border'), borderWidth: 1, titleColor: cssVar('--text'), bodyColor: cssVar('--text'), padding: 10 } },
    scales: config.type === 'doughnut' ? undefined : { x: { grid: { color: grid, drawTicks: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } }, y: { grid: { color: grid, drawTicks: false }, ticks: { maxTicksLimit: 6 } } }
  };
  const merged = { ...config, options: deepMerge(base, config.options || {}) };
  const c = new window.Chart(canvas, merged);
  charts.set(canvas, c);
  return c;
}
function deepMerge(a, b) {
  const o = { ...a };
  Object.keys(b).forEach((k) => { o[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' ? deepMerge(a[k], b[k]) : b[k]; });
  return o;
}
export const chartBox = (id, title, extra = '', h = 260) => html`<div class="card chart-card"><div class="card-head"><h3>${title}</h3>${extra}</div><div class="chart-wrap" style="height:${h}px"><canvas id="${id}" role="img" aria-label="${title}"></canvas></div></div>`;

export function segmented(name, options, value) {
  return html`<div class="seg" role="tablist" aria-label="${name}">${options.map(([v, l]) => html`<button type="button" role="tab" class="${v === value ? 'on' : ''}" aria-selected="${v === value}" data-seg="${name}" data-value="${v}">${l}</button>`)}</div>`;
}
