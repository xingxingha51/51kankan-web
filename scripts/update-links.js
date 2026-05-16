#!/usr/bin/env node
// Update download / PWA links in the AES-encrypted HTML pages.
//
// Usage:
//   node scripts/update-links.js [--apk <url> | --apk-name <filename>] [--pwa <url>] [--push]
//
//   --apk <url>            Android APK download URL (full URL)
//   --apk-name <filename>  Shortcut: prepend https://dl.downlaod.win/ to the filename
//   --pwa <url>            iOS PWA / install URL (the link inside `if(isIos)`)
//   --push                 git add + commit + push after writing changes
//
// At least one of --apk / --apk-name / --pwa is required.
// Both _ios.html and _mobile.html are updated to stay in sync.
//
// Examples:
//   node scripts/update-links.js --apk-name kankan_V2.4.0_xxx.apk
//   node scripts/update-links.js --pwa https://m.51kankan.org/
//   node scripts/update-links.js --apk-name kankan_V2.4.0.apk --push

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TARGET_FILES = ['_ios.html', '_mobile.html'];
const APK_URL_PREFIX = 'https://dl.downlaod.win/';

const APK_RE = /(\bvar\s+link\s*=\s*')[^']*(')/;
const PWA_RE = /(if\s*\(\s*isIos\s*\)\s*\{\s+link\s*=\s*')[^']*(')/;

function parseArgs(argv) {
  const out = { apk: null, apkName: null, pwa: null, push: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apk') out.apk = argv[++i];
    else if (a === '--apk-name') out.apkName = argv[++i];
    else if (a === '--pwa') out.pwa = argv[++i];
    else if (a === '--push') out.push = true;
    else if (a === '-h' || a === '--help') out.help = true;
    else { console.error(`Unknown argument: ${a}`); process.exit(2); }
  }
  if (out.apk && out.apkName) {
    console.error('Error: pass either --apk or --apk-name, not both');
    process.exit(2);
  }
  if (out.apkName) out.apk = APK_URL_PREFIX + out.apkName;
  return out;
}

function usage() {
  console.log(`Usage: node scripts/update-links.js [--apk <url> | --apk-name <filename>] [--pwa <url>] [--push]

  --apk <url>            Full APK download URL
  --apk-name <filename>  Shortcut: ${APK_URL_PREFIX}<filename>
  --pwa <url>            iOS PWA / install URL
  --push                 git add + commit + push after writing changes

Examples:
  node scripts/update-links.js --apk-name kankan_V2.4.0.apk
  node scripts/update-links.js --pwa https://m.51kankan.org/
  node scripts/update-links.js --apk-name kankan_V2.4.0.apk --push`);
}

function decrypt(html) {
  const contentMatch = html.match(/var content="([^"]+)"/);
  const keyMatch = html.match(/CryptoJS\.enc\.Utf8\.parse\("([^"]+)"\)/);
  if (!contentMatch || !keyMatch) throw new Error('encrypted payload not recognised');
  const key = Buffer.from(keyMatch[1], 'utf8');
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, key);
  const buf = Buffer.from(contentMatch[1], 'base64');
  return Buffer.concat([decipher.update(buf), decipher.final()]).toString('utf8');
}

function encrypt(plaintext) {
  const keyStr = crypto.randomBytes(8).toString('hex'); // 16 hex chars = 16 bytes utf8
  const key = Buffer.from(keyStr, 'utf8');
  const cipher = crypto.createCipheriv('aes-128-cbc', key, key);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('base64');
  return `<script  src="/theme/skin1/js/crypto-js.min.js?_v=20251024"></script>
<script src="/theme/skin1/js/aes.min.js?_v=20251024"></script>
<script>
var content="${enc}";
var key =CryptoJS.enc.Utf8.parse("${keyStr}");
var iv =CryptoJS.enc.Utf8.parse("${keyStr}");
var options = { mode: CryptoJS.mode.CBC,padding:CryptoJS.pad.Pkcs7,iv:iv}
content = CryptoJS.AES.decrypt(content,key,options).toString(CryptoJS.enc.Utf8)
document.write(content)
</script>`;
}

function replaceBetween(text, regex, newValue, label, file) {
  const m = text.match(regex);
  if (!m) {
    console.warn(`  [skip] ${label}: pattern not found in ${file}`);
    return { text, changed: false };
  }
  const start = m.index + m[1].length;
  const end = m.index + m[0].length - m[2].length;
  const old = text.slice(start, end);
  if (old === newValue) {
    console.log(`  [same] ${label}: already ${newValue}`);
    return { text, changed: false };
  }
  console.log(`  [ok]   ${label}:`);
  console.log(`           ${old}`);
  console.log(`        -> ${newValue}`);
  return { text: text.slice(0, start) + newValue + text.slice(end), changed: true };
}

function buildCommitMessage(args) {
  const parts = [];
  if (args.apk) {
    const name = args.apkName || args.apk.split('/').pop();
    parts.push(`更新下载链接为 ${name}`);
  }
  if (args.pwa) parts.push(`更新 PWA 链接为 ${args.pwa}`);
  return parts.join('，');
}

function gitPush(args, changedFiles) {
  if (changedFiles.length === 0) {
    console.log('\nNothing changed, skipping commit/push.');
    return;
  }
  const message = buildCommitMessage(args);
  console.log(`\n[git] add ${changedFiles.join(' ')}`);
  execFileSync('git', ['add', '--', ...changedFiles], { stdio: 'inherit' });
  console.log(`[git] commit -m "${message}"`);
  execFileSync('git', ['commit', '-m', message], { stdio: 'inherit' });
  console.log(`[git] push`);
  execFileSync('git', ['push'], { stdio: 'inherit' });
  console.log('Pushed.');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.apk && !args.pwa)) { usage(); process.exit(args.help ? 0 : 1); }

  const changedFiles = [];
  for (const file of TARGET_FILES) {
    const filePath = path.join(PUBLIC_DIR, file);
    console.log(`\n== ${file} ==`);
    const original = fs.readFileSync(filePath, 'utf8');
    let plain = decrypt(original);
    let changed = false;

    if (args.apk) {
      const r = replaceBetween(plain, APK_RE, args.apk, 'APK link', file);
      plain = r.text; changed = changed || r.changed;
    }
    if (args.pwa) {
      const r = replaceBetween(plain, PWA_RE, args.pwa, 'PWA link', file);
      plain = r.text; changed = changed || r.changed;
    }

    if (changed) {
      fs.writeFileSync(filePath, encrypt(plain));
      console.log(`  [write] re-encrypted with fresh key`);
      changedFiles.push(path.relative(process.cwd(), filePath));
    } else {
      console.log(`  [noop] no changes`);
    }
  }

  console.log(`\nDone. ${changedFiles.length} file(s) updated.`);

  if (args.push) gitPush(args, changedFiles);
}

main();
