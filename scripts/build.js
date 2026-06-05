#!/usr/bin/env node
// Rebuild all encrypted landing pages with the current optimizations:
//   - webp <image-set> override on the hero background (idempotent)
//   - preload hints for critical CSS + hero image (via the encrypt wrapper)
//   - inlined ~1.8KB AES decryptor (no external crypto-js/aes.min.js request)
//
// Safe to re-run anytime: it decrypts each page, re-applies the transforms,
// and re-encrypts with a fresh key. Run it after changing a background image
// or the wrapper template.
//
// Usage:  node scripts/build.js

const fs = require('fs');
const path = require('path');
const { decrypt, encrypt, webpifyBackground } = require('./crypto-html');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const FILES = ['_pc.html', '_mobile.html', '_ios.html'];

let changed = 0;
for (const file of FILES) {
  const filePath = path.join(PUBLIC_DIR, file);
  console.log(`\n== ${file} ==`);

  const plain = decrypt(fs.readFileSync(filePath, 'utf8'));
  const webp = webpifyBackground(plain);
  if (webp.changed) console.log(`  [webp] background -> ${webp.webpUrl}`);
  else console.log(`  [webp] already applied / no background`);

  fs.writeFileSync(filePath, encrypt(webp.text));
  console.log(`  [write] re-encrypted with preload wrapper`);
  changed++;
}

console.log(`\nDone. ${changed} file(s) rebuilt.`);
