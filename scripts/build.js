#!/usr/bin/env node
/**
 * Keeps ONE copy of the financial logic. shared/*.js is the source; this script
 * copies it into the Apps Script project and the frontend. `--check` fails if any
 * copy has drifted (run by `npm test`).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const targets = [
  ['shared/core.js', 'backend/Core.gs'],
  ['shared/service.js', 'backend/Service.gs'],
  ['shared/core.js', 'frontend/js/shared/core.js'],
  ['shared/service.js', 'frontend/js/shared/service.js']
];
const banner = (src) => `// GENERATED from ${src} by scripts/build.js — edit the source, then run \`npm run build\`.\n`;
const check = process.argv.includes('--check');
let drift = 0;
for (const [src, dst] of targets) {
  const want = banner(src) + fs.readFileSync(path.join(root, src), 'utf8');
  const dstPath = path.join(root, dst);
  if (check) {
    const have = fs.existsSync(dstPath) ? fs.readFileSync(dstPath, 'utf8') : '';
    if (have !== want) { console.error(`✗ ${dst} is out of date with ${src} (run npm run build)`); drift++; }
  } else {
    fs.mkdirSync(path.dirname(dstPath), { recursive: true });
    fs.writeFileSync(dstPath, want);
    console.log(`✓ ${src} → ${dst}`);
  }
}
if (check) {
  if (drift) process.exit(1);
  console.log('✓ shared logic is in sync across backend and frontend');
}
