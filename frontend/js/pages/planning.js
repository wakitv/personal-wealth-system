import { html, mount, $, $$, uid } from '../utils/dom.js';
import * as F from '../utils/format.js';
import { store } from '../state.js';
import { chart, chartBox, cssVar, toast, errorMessage, emptyState, confirmDialog } from '../components/ui.js';
import { goalForm } from '../components/forms.js';
import { BUCKET_LABELS } from '../services/analytics.js';
const Core = window.WealthCore;

const calc = { pv: 0, pvTouched: false, pmt: 50000, target: 5000000, years: 10, inflation: false, goal: '' };
const STATUS = { ACHIEVED: ['Achieved', 'ok'], ON_TRACK: ['On track', 'ok'], BEHIND: ['Behind plan', 'warn'], NO_PROJECTION: ['Needs contributions', 'warn'] };

export function render(root) {
  const s = store.live.summary;
  const goals = (store.data.goals || []).filter((g) => g.status !== 'ARCHIVED').sort((a, b) => a.priority - b.priority);
  const archived = (store.data.goals || []).filter((g) => g.status === 'ARCHIVED');
  const today = F.today();
  const scen = store.settingJson('scenario_returns', { conservative: 4, base: 8, optimistic: 12 });
  if (!calc.pvTouched) calc.pv = s.netWorth;
  mount(root, html`
    <div class="page-head"><div><h1>Planning & goals</h1><p class="muted">Projections are hypothetical illustrations based on the assumptions you enter. They are not forecasts, guarantees or personalised investment advice.</p></div>
      <div class="head-actions"><button class="btn primary" data-g="new">${F.icon('plus')} New goal</button></div></div>

    <section><h2 class="section-title">Wealth goals</h2>
    ${!goals.length ? emptyState('No goals yet', 'Create goals, or start with the three milestones you set: ₱5M, ₱15M and ₱100M. Every field can be edited afterwards.', html`<button class="btn primary" data-g="starter">Add ₱5M / ₱15M / ₱100M goals</button> <button class="btn" data-g="new">Custom goal</button>`) : ''}
    <div class="grid g3 goals">${goals.map((g, i) => {
      const ev = Core.evaluateGoal(g, s, today);
      const [label, tone] = STATUS[ev.status] || [ev.status, ''];
      return html`<div class="card goal">
        <div class="goal-top"><div><div class="muted xs">Priority ${i + 1} · ${{ NET_WORTH: 'Net worth', INVESTMENTS: 'Investments', LIQUID: 'Liquid assets', CASH: 'Cash' }[g.basis] || g.basis}</div><h3>${g.name}</h3></div>${F.badge(label, tone)}</div>
        <div class="goal-amt"><span class="amt">${F.php(ev.current, { compact: true })}</span><span class="muted"> of ${F.php(g.target_amount, { compact: true })}</span></div>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${ev.progressPct}" aria-label="${g.name} progress"><span style="width:${Math.max(0.5, ev.progressPct)}%"></span></div>
        <div class="goal-pct"><strong>${F.pct(ev.progressPct, { sign: false, dp: 1 })}</strong><span class="muted"> · ${F.php(ev.remaining, { compact: true })} to go${g.starting_amount ? html` · <span class="${F.tone(ev.sinceStart)}">${F.php(ev.sinceStart, { sign: true, compact: true })}</span> since ${g.start_date ? F.dateStr(g.start_date) : 'start'}` : ''}</span></div>
        <dl class="kv sm">
          <dt>Target date</dt><dd>${g.target_date ? F.dateStr(g.target_date) + (ev.monthsLeft !== null ? ' (' + ev.monthsLeft + ' mo)' : '') : '—'}</dd>
          <dt>Monthly contribution</dt><dd>${F.php(g.monthly_contribution)}</dd>
          <dt>Return assumption</dt><dd>${g.expected_return ? g.expected_return + '% / yr (hypothetical)' : '0% (none assumed)'}</dd>
          <dt>Required monthly</dt><dd>${ev.requiredMonthly === null ? '—' : F.php(ev.requiredMonthly)}</dd>
          <dt>Projected completion</dt><dd>${ev.status === 'ACHIEVED' ? 'Reached' : ev.projectedDate ? F.dateStr(ev.projectedDate) : 'Not within 100 years at this rate'}</dd>
        </dl>
        <div class="goal-actions"><button class="btn xs" data-edit-goal="${g.goal_id}">Edit</button><button class="btn xs ghost" data-up="${g.goal_id}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button class="btn xs ghost" data-down="${g.goal_id}" ${i === goals.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button><button class="btn xs ghost" data-proj="${g.goal_id}">Project</button><button class="btn xs ghost" data-arch="${g.goal_id}">Archive</button></div>
      </div>`;
    })}</div>
    ${archived.length ? html`<details class="archived-goals"><summary class="muted">${archived.length} archived goal(s)</summary><ul class="plain">${archived.map((g) => html`<li>${g.name} · ${F.php(g.target_amount)} <button class="link" data-restore="${g.goal_id}">Restore</button></li>`)}</ul></details>` : ''}
    </section>

    <section class="card"><div class="card-head"><h3>Projection calculator</h3><span class="muted sm">Monthly compounding at the effective annual rate</span></div>
      <div class="calc">
        <form id="calc" class="calc-form">
          <label class="field"><span>Goal</span><select name="goal"><option value="">Custom target</option>${goals.map((g) => html`<option value="${g.goal_id}" ${calc.goal === g.goal_id ? 'selected' : ''}>${g.name}</option>`)}</select></label>
          <label class="field"><span>Starting amount (${store.base})</span><input name="pv" inputmode="decimal" value="${Core.round(calc.pv, 2)}"></label>
          <label class="field"><span>Monthly contribution</span><input name="pmt" inputmode="decimal" value="${calc.pmt}"></label>
          <label class="field"><span>Target (${store.base})</span><input name="target" inputmode="decimal" value="${calc.target}"></label>
          <label class="field"><span>Horizon (years)</span><input name="years" inputmode="numeric" value="${calc.years}"></label>
          <div class="field-row">${['conservative', 'base', 'optimistic'].map((k) => html`<label class="field"><span>${k[0].toUpperCase() + k.slice(1)} %/yr</span><input name="r_${k}" inputmode="decimal" value="${scen[k]}"></label>`)}</div>
          <label class="check"><input type="checkbox" name="inflation" ${calc.inflation ? 'checked' : ''}> <span>Inflation-adjust the target at ${store.setting('inflation_rate', 4)}%/yr</span></label>
          <button type="button" class="btn sm ghost" id="save-scen">Save scenario returns as defaults</button>
        </form>
        <div class="calc-out"><div class="chart-wrap" style="height:280px"><canvas id="ch-proj" role="img" aria-label="Projection chart"></canvas></div><div id="proj-table"></div></div>
      </div>
      <p class="method-note muted">FV = PV·(1+r)<sup>n</sup> + PMT·((1+r)<sup>n</sup>−1)/r, with r = (1+annual)<sup>1/12</sup>−1 and contributions at month end. Required contribution solves the same formula for PMT. Inflation-adjusted target = target·(1+i)<sup>years</sup>. Returns are hypothetical; real returns vary and can be negative.</p>
    </section>

    <section class="grid g2">
      <div class="card"><div class="card-head"><h3>Asset allocation planner</h3></div><div id="alloc"></div></div>
      <div class="card"><div class="card-head"><h3>Emergency fund</h3></div><div id="efund"></div></div>
    </section>`);

  projection(root, scen);
  allocation($('#alloc', root));
  emergency($('#efund', root));

  root.oninput = (e) => { if (e.target.form?.id === 'calc') { if (e.target.name === 'pv') calc.pvTouched = true; projection(root); } };
  root.onchange = (e) => {
    if (e.target.name === 'goal') {
      const g = goals.find((x) => x.goal_id === e.target.value);
      calc.goal = e.target.value;
      if (g) {
        const f = $('#calc');
        f.target.value = g.target_amount; f.pmt.value = g.monthly_contribution || 0;
        if (g.target_date) f.years.value = Math.max(1, Math.ceil(Core.monthsBetweenDates(today, g.target_date) / 12));
      }
      projection(root);
    }
  };
  root.onclick = async (e) => {
    const t = e.target;
    if (t.closest('[data-g="new"]')) return goalForm();
    if (t.closest('[data-g="starter"]')) return starterGoals();
    const id = (a) => t.closest(`[${a}]`)?.getAttribute(a);
    if (id('data-edit-goal')) return goalForm(goals.find((g) => g.goal_id === id('data-edit-goal')));
    if (id('data-proj')) { calc.goal = id('data-proj'); $('#calc [name=goal]').value = calc.goal; $('#calc [name=goal]').dispatchEvent(new Event('change', { bubbles: true })); $('#calc').scrollIntoView({ behavior: 'smooth' }); return; }
    if (id('data-arch')) { if (await confirmDialog({ title: 'Archive goal', message: 'You can restore it later.', confirmLabel: 'Archive' })) await save('updateGoal', { goal_id: id('data-arch'), status: 'ARCHIVED' }, 'Goal archived'); return; }
    if (id('data-restore')) return save('updateGoal', { goal_id: id('data-restore'), status: 'ACTIVE' }, 'Goal restored');
    if (id('data-up') || id('data-down')) return reorder(goals, id('data-up') || id('data-down'), id('data-up') ? -1 : 1);
    if (t.id === 'save-scen') {
      const f = $('#calc');
      return save('saveSettings', { values: { scenario_returns: { conservative: Number(f.r_conservative.value), base: Number(f.r_base.value), optimistic: Number(f.r_optimistic.value) } } }, 'Scenario defaults saved');
    }
  };
}

async function save(action, payload, msg) {
  try { await store.write(action, payload, uid('req')); toast(msg); } catch (e) { toast(errorMessage(e), 'error'); }
}
async function reorder(goals, id, dir) {
  const i = goals.findIndex((g) => g.goal_id === id), j = i + dir;
  if (j < 0 || j >= goals.length) return;
  try {
    const a = goals[i], b = goals[j];
    await store.write('updateGoal', { goal_id: a.goal_id, priority: j + 1 }, uid('req'));
    await store.write('updateGoal', { goal_id: b.goal_id, priority: i + 1 }, uid('req'));
  } catch (e) { toast(errorMessage(e), 'error'); }
}
async function starterGoals() {
  const today = F.today(), y = Number(today.slice(0, 4));
  const nw = store.live.summary.netWorth;
  const defs = [['Short-term: ₱5M', 5000000, 3], ['Medium-term: ₱15M', 15000000, 8], ['Long-term: ₱100M', 100000000, 20]];
  try {
    for (const [i, [name, target, yrs]] of defs.entries()) {
      await (await import('../services/api.js')).api.call('createGoal', { name, target_amount: target, basis: 'NET_WORTH', starting_amount: nw, start_date: today, target_date: (y + yrs) + today.slice(4), monthly_contribution: 0, expected_return: 0, priority: i + 1, notes: 'Starter goal — edit the target date, contribution and return assumption to fit your plan.' }, { requestId: uid('req') });
    }
    await store.load();
    toast('Starter goals added — edit them to set your contributions and dates');
  } catch (e) { toast(errorMessage(e), 'error'); store.load(); }
}

function projection(root, scenDefaults) {
  const f = $('#calc', root); if (!f) return;
  const n = (v, d = 0) => { const x = Number(String(v).replace(/,/g, '')); return isFinite(x) ? x : d; };
  calc.pv = n(f.pv.value); calc.pmt = n(f.pmt.value); calc.target = n(f.target.value); calc.years = Math.min(60, Math.max(1, Math.round(n(f.years.value, 10)))); calc.inflation = f.inflation.checked;
  const months = calc.years * 12;
  const scen = { conservative: n(f.r_conservative.value, scenDefaults?.conservative), base: n(f.r_base.value, scenDefaults?.base), optimistic: n(f.r_optimistic.value, scenDefaults?.optimistic) };
  const infl = Number(store.setting('inflation_rate', 4));
  const target = calc.inflation ? Core.inflationAdjusted(calc.target, infl, calc.years) : calc.target;
  const rows = [
    ['No contributions (base return)', scen.base, 0], ['Conservative', scen.conservative, calc.pmt], ['Base', scen.base, calc.pmt], ['Optimistic', scen.optimistic, calc.pmt]
  ].map(([label, r, pmt]) => {
    const m = Core.monthsToTarget(calc.pv, pmt, r, target);
    return { label, r, pmt, fv: Core.futureValue(calc.pv, pmt, r, months), months: m, date: m === null ? null : Core.addMonths(F.today(), m), required: Core.requiredMonthly(calc.pv, target, r, months), series: Core.projectionSeries(calc.pv, pmt, r, months) };
  });
  const step = Math.max(1, Math.round(months / 60));
  const labels = []; for (let i = 0; i <= months; i += step) labels.push(i % 12 === 0 ? 'Y' + i / 12 : '');
  const colors = [cssVar('--muted'), cssVar('--c5'), cssVar('--c1'), cssVar('--c2')];
  chart($('#ch-proj', root), { type: 'line', data: { labels, datasets: [
    ...rows.map((r, i) => ({ label: r.label, data: r.series.filter((_, k) => k % step === 0), borderColor: colors[i], borderDash: i === 0 ? [4, 4] : [], pointRadius: 0, borderWidth: 2, tension: 0.2 })),
    { label: calc.inflation ? 'Target (inflation-adjusted)' : 'Target', data: labels.map(() => target), borderColor: cssVar('--c3'), borderDash: [2, 3], pointRadius: 0, borderWidth: 1.5 }] },
    options: { animation: false, plugins: { tooltip: { callbacks: { label: (c) => c.dataset.label + ': ' + F.php(c.parsed.y, { compact: true }) } } }, scales: { y: { ticks: { callback: (v) => F.php(v, { compact: true }) } } } } });
  mount($('#proj-table', root), html`<table class="table compact"><thead><tr><th>Scenario</th><th class="r">Return</th><th class="r">Value in ${calc.years} yr</th><th class="r">Reaches ${F.php(target, { compact: true })}</th><th class="r">Needed / month</th></tr></thead><tbody>
    ${rows.map((r) => html`<tr><td>${r.label}</td><td class="r">${r.r}%</td><td class="r">${F.php(r.fv, { compact: true })}</td><td class="r">${r.months === null ? 'Not within 100 yrs' : r.months === 0 ? 'Already' : F.dateStr(r.date) + ' (' + (r.months / 12).toFixed(1) + ' yrs)'}</td><td class="r">${r.pmt === 0 && r.label.startsWith('No') ? '—' : F.php(r.required, { compact: true })}</td></tr>`)}
  </tbody></table>${calc.inflation ? html`<p class="muted xs">Target ${F.php(calc.target)} in today's money ≈ ${F.php(target)} in ${calc.years} years at ${infl}% inflation.</p>` : ''}`);
}

function allocation(host) {
  const st = store.live;
  const targets = store.settingJson('allocation_targets', {});
  const rows = Core.allocationVsTarget(st.allocation, targets);
  const threshold = Number(store.setting('concentration_threshold', 25));
  const conc = Core.concentration(st.byAsset, st.summary.totalAssets, threshold);
  mount(host, html`
    <div class="chart-wrap" style="height:220px"><canvas id="ch-alloc" role="img" aria-label="Current vs target allocation"></canvas></div>
    <form id="alloc-form"><div style="overflow-x:auto"><table class="table compact"><thead><tr><th>Category</th><th class="r">Value</th><th class="r">Current</th><th class="r">Target %</th><th class="r">Drift</th></tr></thead><tbody>
      ${rows.map((r) => html`<tr><td>${BUCKET_LABELS[r.bucket]}</td><td class="r">${F.php(r.value, { compact: true })}</td><td class="r">${F.pct(r.currentPct, { sign: false, dp: 1 })}</td><td class="r"><input class="mini" name="${r.bucket}" inputmode="decimal" value="${r.targetPct}" aria-label="${BUCKET_LABELS[r.bucket]} target %"></td><td class="r ${Math.abs(r.driftPct) > 5 ? (r.driftPct > 0 ? 'warn-t' : 'info-t') : 'muted'}">${F.pct(r.driftPct, { dp: 1 })}</td></tr>`)}
    </tbody><tfoot><tr><td colspan="3" class="muted">Targets must total 100%</td><td class="r"><strong id="alloc-sum"></strong></td><td class="r"><button class="btn xs primary" type="submit">Save</button></td></tr></tfoot></table></div></form>
    ${conc.length ? html`<div class="banner danger sm">${F.icon('alert')}<div><strong>Concentration:</strong> ${conc.map((c) => c.name + ' ' + F.pct(c.pct, { sign: false, dp: 1 })).join(', ')} of total assets exceeds your ${threshold}% threshold.</div></div>` : html`<p class="muted sm">No single asset exceeds ${threshold}% of total assets.</p>`}`);
  const sum = () => { const t = $$('#alloc-form input', host).reduce((a, i) => a + (Number(i.value) || 0), 0); $('#alloc-sum', host).textContent = Core.round(t, 2) + '%'; $('#alloc-sum', host).className = Math.abs(t - 100) < 0.01 ? 'up' : 'down'; };
  sum();
  host.oninput = sum;
  $('#alloc-form', host).onsubmit = (e) => { e.preventDefault(); const v = {}; $$('#alloc-form input', host).forEach((i) => { v[i.name] = Number(i.value) || 0; }); save('saveSettings', { values: { allocation_targets: v } }, 'Allocation targets saved'); };
  chart($('#ch-alloc', host), { type: 'bar', data: { labels: rows.map((r) => BUCKET_LABELS[r.bucket]), datasets: [{ label: 'Current %', data: rows.map((r) => r.currentPct), backgroundColor: cssVar('--c1'), borderRadius: 4 }, { label: 'Target %', data: rows.map((r) => r.targetPct), backgroundColor: cssVar('--c4'), borderRadius: 4 }] }, options: { plugins: { tooltip: { callbacks: { label: (c) => c.dataset.label + ': ' + c.parsed.y + '%' } } }, scales: { y: { ticks: { callback: (v) => v + '%' } } } } });
}

function emergency(host) {
  const exp = Number(store.setting('emergency_monthly_expenses', 0));
  const months = Number(store.setting('emergency_target_months', 6));
  const chosen = store.settingJson('emergency_accounts', []);
  const liquid = store.activeAccounts().filter((a) => ['BANK', 'EWALLET', 'CASH'].includes(a.type));
  const ef = Core.emergencyFund(store.live, store.data.accounts, exp, months, chosen);
  mount(host, html`
    ${exp > 0 ? html`<div class="goal-amt"><span class="amt">${F.php(ef.reserve)}</span><span class="muted"> of ${F.php(ef.target)} target</span></div>
      <div class="progress ${ef.progressPct >= 100 ? 'done' : ''}" role="progressbar" aria-valuenow="${ef.progressPct}" aria-valuemin="0" aria-valuemax="100" aria-label="Emergency fund"><span style="width:${Math.max(0.5, ef.progressPct)}%"></span></div>
      <p class="sm"><strong>${ef.monthsCovered} months</strong> of essential expenses covered${ef.shortfall > 0 ? html` · <span class="down">${F.php(ef.shortfall)} short</span>` : html` · <span class="up">target met</span>`}.</p>` : html`<p class="muted">Enter your monthly essential expenses to track your reserve.</p>`}
    <form id="ef-form" class="stack">
      <div class="field-row"><label class="field"><span>Monthly essential expenses (${store.base})</span><input name="exp" inputmode="decimal" value="${exp || ''}"></label>
      <label class="field"><span>Target (months)</span><input name="months" inputmode="numeric" value="${months}"></label></div>
      <fieldset class="group"><legend>Accounts that count as reserve</legend>${liquid.length ? liquid.map((a) => html`<label class="check"><input type="checkbox" name="acc" value="${a.account_id}" ${!chosen.length || chosen.includes(a.account_id) ? 'checked' : ''}> <span>${a.name} <span class="muted">${F.money(store.live.cashNative[a.account_id] || 0, a.currency)}</span></span></label>`) : html`<p class="muted sm">No bank, e-wallet or cash accounts yet.</p>`}</fieldset>
      <button class="btn sm primary" type="submit">Save</button></form>`);
  $('#ef-form', host).onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    const accs = $$('input[name=acc]:checked', f).map((i) => i.value);
    save('saveSettings', { values: { emergency_monthly_expenses: String(Math.max(0, Number(f.exp.value) || 0)), emergency_target_months: String(Math.max(1, Math.round(Number(f.months.value) || 6))), emergency_accounts: accs.length === liquid.length ? [] : accs } }, 'Emergency fund settings saved');
  };
}
