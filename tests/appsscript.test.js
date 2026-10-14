'use strict';
/**
 * Integration test of the real Apps Script files (backend/*.gs) running in a
 * Node VM against an in-memory emulation of SpreadsheetApp and friends.
 * Exercises: setupDatabase, selfTest, doPost auth, formula-injection guard,
 * idempotency, lock usage, snapshots job, and that GET exposes no data.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const CLIENT_ID = '1234-abc.apps.googleusercontent.com';

function fakeGas() {
  const props = { GOOGLE_CLIENT_ID: CLIENT_ID, ALLOWED_EMAILS: 'Owner@Example.com' };
  const cacheMap = new Map();
  const spreadsheets = {};
  const fetchLog = [];
  const lockLog = [];
  const triggers = [];
  let formulaEvaluations = 0;

  function makeSheet(name) {
    let data = []; // 2D array
    let maxRows = 1000;
    const sheet = {
      getName: () => name,
      getLastRow: () => data.length,
      getLastColumn: () => data.reduce((m, r) => Math.max(m, r.length), 0),
      getMaxRows: () => maxRows,
      setFrozenRows: () => sheet,
      protect: () => ({ setDescription() { return this; }, setWarningOnly() { return this; } }),
      getRange: (r, c, nr = 1, nc = 1) => ({
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const row = data[r - 1 + i] || []; const v = row[c - 1 + j]; return v === undefined ? '' : v; })),
        setValues: (vals) => {
          vals.forEach((row, i) => row.forEach((v, j) => {
            const ri = r - 1 + i;
            while (data.length <= ri) data.push([]);
            // Emulate Sheets: a string starting with '=' becomes a formula unless prefixed with an apostrophe
            if (typeof v === 'string' && v.startsWith('=')) { formulaEvaluations++; v = '#FORMULA!'; }
            if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1);
            data[ri][c - 1 + j] = v;
          }));
          return sheet.getRange(r, c, nr, nc);
        },
        setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; }, setNumberFormat() { return this; }
      })
    };
    return sheet;
  }
  function makeSpreadsheet(id) {
    const sheets = { Sheet1: makeSheet('Sheet1') };
    return {
      getId: () => id, getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id,
      getSheetByName: (n) => sheets[n] || null,
      insertSheet: (n) => (sheets[n] = makeSheet(n)),
      getSheets: () => Object.values(sheets),
      deleteSheet: (s) => { delete sheets[s.getName()]; },
      setSpreadsheetTimeZone: () => {},
      _sheets: sheets
    };
  }
  const jwt = (claims) => 'e30.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.sig';
  const tokens = {
    'tok-owner': { aud: CLIENT_ID, iss: 'accounts.google.com', email: 'owner@example.com', email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) + 3600) },
    'tok-other': { aud: CLIENT_ID, iss: 'accounts.google.com', email: 'eve@example.com', email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) + 3600) }
  };
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    SpreadsheetApp: {
      create: () => { const id = 'ss' + Object.keys(spreadsheets).length; return (spreadsheets[id] = makeSpreadsheet(id)); },
      openById: (id) => { if (!spreadsheets[id]) throw new Error('not found'); return spreadsheets[id]; },
      flush: () => {}
    },
    CacheService: { getScriptCache: () => ({ get: (k) => cacheMap.get(k) || null, put: (k, v) => cacheMap.set(k, v) }) },
    UrlFetchApp: {
      fetch: (url) => {
        fetchLog.push(url);
        const m = /tokeninfo\?id_token=([^&]+)/.exec(url);
        const tok = m && decodeURIComponent(m[1]);
        const claims = tok && Object.values(tokens).find((c) => jwt(c) === tok);
        return { getResponseCode: () => (claims ? 200 : 400), getContentText: () => JSON.stringify(claims || { error: 'invalid_token' }) };
      }
    },
    LockService: { getScriptLock: () => ({ tryLock: () => { lockLog.push('lock'); return true; }, releaseLock: () => lockLog.push('unlock') }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      base64DecodeWebSafe: (str) => Array.from(Buffer.from(str.replace(/=+$/, ''), 'base64url')),
      newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes.map((b) => b & 0xff)).toString('utf8') }),
      computeDigest: (_alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      formatDate: (d) => d.toISOString().slice(0, 10)
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ setMimeType() { return this; }, getContent: () => s }) },
    Session: { getScriptTimeZone: () => 'Asia/Manila' },
    DriveApp: { Access: { PRIVATE: 'PRIVATE' }, getFileById: () => ({ getSharingAccess: () => 'PRIVATE' }) },
    ScriptApp: {
      getProjectTriggers: () => triggers,
      deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
      newTrigger: (fn) => { const b = { timeBased: () => b, atHour: () => b, nearMinute: () => b, everyDays: () => b, inTimezone: () => b, create: () => triggers.push({ getHandlerFunction: () => fn }) }; return b; }
    },
    Intl, Date, JSON, Math, Number, String, Object, Array, Error, isFinite, isNaN, encodeURIComponent, decodeURIComponent, RegExp, parseInt, parseFloat
  };
  vm.createContext(ctx);
  // Load .gs files in reverse-alphabetical order to prove load order does not matter.
  const dir = path.join(__dirname, '..', 'backend');
  fs.readdirSync(dir).filter((f) => f.endsWith('.gs')).sort().reverse().forEach((f) => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));
  return { ctx, props, spreadsheets, fetchLog, lockLog, triggers, formulaCount: () => formulaEvaluations, tok: (name) => jwt(tokens[name]) };
}

function post(g, body) {
  const out = g.ctx.doPost({ postData: { contents: JSON.stringify(body) } });
  return JSON.parse(out.getContent());
}
let n = 0;
const rid = () => 'gasreq_' + String(++n).padStart(8, '0');

test('Apps Script backend end-to-end on emulated Sheets', () => {
  const g = fakeGas();
  const url = g.ctx.setupDatabase();
  assert.match(url, /spreadsheets\/d\/ss0/);
  const ss = g.spreadsheets.ss0;
  for (const s of ['Settings', 'Accounts', 'Assets', 'Transactions', 'PriceHistory', 'FXRates', 'DailySnapshots', 'Goals', 'AuditLog', 'Requests']) assert.ok(ss.getSheetByName(s), s);
  assert.equal(ss.getSheetByName('Sheet1'), null);
  // setup is idempotent (re-run = migration, no duplicate settings)
  g.ctx.setupDatabase();
  const settingsRows = ss.getSheetByName('Settings').getLastRow() - 1;
  assert.equal(settingsRows, Object.keys(g.ctx.service_().DEFAULT_SETTINGS).length);
  assert.equal(g.ctx.selfTest(), 'All checks passed.');

  // health over GET: no records
  const h = JSON.parse(g.ctx.doGet({ parameter: { action: 'health' } }).getContent());
  assert.equal(h.ok, true);
  assert.equal(h.data.status, 'ok');

  // unauthenticated / unauthorised
  assert.equal(post(g, { action: 'bootstrap' }).error.code, 'UNAUTHENTICATED');
  assert.equal(post(g, { action: 'bootstrap', idToken: 'garbage' }).error.code, 'UNAUTHENTICATED');
  const before = g.fetchLog.length;
  assert.equal(post(g, { action: 'bootstrap', idToken: 'e30.' + Buffer.from(JSON.stringify({ aud: 'other-app' })).toString('base64url') + '.x' }).error.code, 'UNAUTHENTICATED');
  assert.equal(g.fetchLog.length, before, 'foreign-audience tokens are rejected without a network call');
  assert.equal(post(g, { action: 'bootstrap', idToken: g.tok('tok-other') }).error.code, 'FORBIDDEN');
  assert.equal(JSON.parse(g.ctx.doPost({ postData: { contents: '{not json' } }).getContent()).error.code, 'VALIDATION');

  // owner flow
  const acc = post(g, { action: 'createAccount', idToken: g.tok('tok-owner'), requestId: rid(), payload: { name: '=HYPERLINK("http://evil")', type: 'BANK', currency: 'PHP', opening_balance: 100000, opening_date: '2026-10-01T02:00:00Z', reference: '+639171234567' } });
  assert.equal(acc.ok, true, JSON.stringify(acc));
  assert.equal(g.formulaCount(), 0, 'no user text was ever evaluated as a formula');
  const id = acc.data.account.account_id;
  const dep = { action: 'postTransaction', idToken: g.tok('tok-owner'), requestId: rid(), payload: { type: 'DEPOSIT', account_id: id, gross_amount: 10000, occurred_at: '2026-10-02T02:00:00Z', remarks: '-negative looking remark' } };
  assert.equal(post(g, dep).ok, true);
  const again = post(g, dep);
  assert.equal(again.replayed, true);
  const boot = post(g, { action: 'bootstrap', idToken: g.tok('tok-owner') });
  assert.equal(boot.ok, true);
  assert.equal(boot.data.accounts[0].name, '=HYPERLINK("http://evil")', 'text round-trips exactly');
  assert.equal(boot.data.accounts[0].reference, '+639171234567');
  assert.equal(boot.data.transactions.length, 2);
  assert.equal(boot.data.transactions[1].remarks, '-negative looking remark');
  assert.equal(typeof boot.data.transactions[1].gross_amount, 'number');
  const st = g.ctx.WealthCore.computeState(boot.data, { asOf: Infinity });
  assert.equal(st.accounts[id].cashNative, 110000);
  assert.equal(st.summary.netFlows, 110000);

  // token verification is cached by hash (one tokeninfo call per token)
  const tokenCalls = g.fetchLog.filter((u) => u.includes(encodeURIComponent(g.tok('tok-owner')))).length;
  assert.equal(tokenCalls, 1);
  assert.ok(!JSON.stringify([...g.fetchLog]).includes('undefined'));
  // writes go through the script lock
  assert.ok(g.lockLog.filter((x) => x === 'lock').length >= 2);
  assert.equal(g.lockLog.filter((x) => x === 'lock').length, g.lockLog.filter((x) => x === 'unlock').length);

  // daily trigger job writes snapshots up to today
  g.ctx.installDailySnapshotTrigger();
  g.ctx.installDailySnapshotTrigger();
  assert.equal(g.triggers.length, 1, 'trigger install is idempotent');
  const res = g.ctx.dailySnapshotJob();
  assert.ok(res.count >= 1);
  const boot2 = post(g, { action: 'bootstrap', idToken: g.tok('tok-owner') });
  assert.ok(boot2.data.snapshots.length >= 1);
  assert.equal(boot2.data.snapshots[boot2.data.snapshots.length - 1].net_worth, 110000);
  // the audit log recorded the changes with the actor
  const audit = post(g, { action: 'getAuditLog', idToken: g.tok('tok-owner'), payload: {} });
  assert.ok(audit.data.rows.some((r) => r.actor === 'owner@example.com' && r.action === 'POST'));
});

test('Misconfigured backend fails closed', () => {
  const g = fakeGas();
  g.ctx.setupDatabase();
  g.props.ALLOWED_EMAILS = '';
  const r = post(g, { action: 'bootstrap', idToken: g.tok('tok-owner') });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'MISCONFIGURED');
});
