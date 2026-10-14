#!/usr/bin/env node
/**
 * Test double for the Apps Script web app: runs the real WealthService over HTTP with an
 * in-memory store and a fake token verifier (claims are read from an unsigned test JWT,
 * then checked with the real checkClaims). Used only by tests/e2e/remote.py.
 */
'use strict';
const http = require('http');
const Core = require('../../shared/core.js');
global.WealthCore = Core;
const Service = require('../../shared/service.js');
const CLIENT_ID = 'e2e-client.apps.googleusercontent.com';
const store = Service.MemoryStore();
const now = new Date().toISOString();
store.append('Settings', Object.entries(Service.DEFAULT_SETTINGS).map(([key, value]) => ({ key, value, updated_at: now })));
const deps = {
  store, now: () => Date.now(), uuid: () => require('crypto').randomUUID(), withLock: (fn) => fn(), http: null, log: console.error,
  authenticate: (tok) => {
    let claims = null;
    try { claims = JSON.parse(Buffer.from(String(tok).split('.')[1], 'base64url').toString()); } catch { claims = null; }
    return Service.checkClaims(claims, { clientId: CLIENT_ID, allowedEmails: ['owner@example.com'] }, Date.now());
  }
};
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let out;
    if (req.method !== 'POST') out = { ok: true, data: { service: 'mock' } };
    else if (!/^text\/plain/.test(req.headers['content-type'] || '')) out = { ok: false, error: { code: 'VALIDATION', message: 'expected text/plain (simple CORS request)' } };
    else { try { out = Service.handle(JSON.parse(body), deps); } catch { out = { ok: false, error: { code: 'VALIDATION', message: 'bad json' } }; } }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(out));
  });
}).listen(Number(process.env.PORT || 5174), () => console.log('mock backend on', process.env.PORT || 5174));
