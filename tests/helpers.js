'use strict';
const Core = require('../shared/core.js');
global.WealthCore = Core;
const Service = require('../shared/service.js');

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const OWNER = 'owner@example.com';

/** A sandboxed service instance with an in-memory store and a fake Google token verifier. */
function makeApp(opts = {}) {
  let clock = opts.now || Date.parse('2026-10-14T04:00:00Z'); // 12:00 Manila
  const store = Service.MemoryStore();
  let n = 0;
  let lockDepth = 0;
  const tokens = {
    'good-token': { aud: CLIENT_ID, iss: 'https://accounts.google.com', email: OWNER, email_verified: 'true', exp: String(Math.floor(clock / 1000) + 3600) },
    'stranger-token': { aud: CLIENT_ID, iss: 'https://accounts.google.com', email: 'stranger@example.com', email_verified: 'true', exp: String(Math.floor(clock / 1000) + 3600) },
    'wrong-aud-token': { aud: 'someone-elses-app', iss: 'https://accounts.google.com', email: OWNER, email_verified: 'true', exp: String(Math.floor(clock / 1000) + 3600) },
    'expired-token': { aud: CLIENT_ID, iss: 'https://accounts.google.com', email: OWNER, email_verified: 'true', exp: String(Math.floor(clock / 1000) - 10) }
  };
  const deps = {
    store,
    now: () => clock,
    uuid: () => 'u' + String(++n).padStart(12, '0') + 'abcdef0123456789',
    withLock: (fn) => { if (lockDepth) throw new Error('re-entrant lock'); lockDepth++; try { return fn(); } finally { lockDepth--; } },
    authenticate: (token) => Service.checkClaims(tokens[token] || null, { clientId: CLIENT_ID, allowedEmails: [OWNER] }, clock),
    http: opts.http || null,
    log: () => {}
  };
  let r = 0;
  const api = (action, payload = {}, extra = {}) => Service.handle({ action, payload, idToken: 'good-token', requestId: 'req_' + String(++r).padStart(10, '0'), ...extra }, deps);
  const must = (action, payload, extra) => {
    const res = api(action, payload, extra);
    if (!res.ok) throw new Error(action + ' failed: ' + res.error.code + ' ' + res.error.message);
    return res.data;
  };
  const data = () => {
    const d = must('bootstrap');
    return { accounts: d.accounts, assets: d.assets, transactions: d.transactions, prices: d.prices, fx: d.fx, settings: d.settings, snapshots: d.snapshots, goals: d.goals };
  };
  const state = (asOf) => Core.computeState(data(), { asOf: asOf === undefined ? Infinity : asOf });
  return { Core, Service, deps, store, api, must, data, state, setNow: (t) => { clock = t; }, now: () => clock };
}

module.exports = { makeApp, Core, Service, CLIENT_ID, OWNER };
