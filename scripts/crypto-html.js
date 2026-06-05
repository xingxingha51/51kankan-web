// Shared logic for the AES-encrypted landing pages.
//
// The three pages in public/_*.html are stored as an AES-128-CBC encrypted
// payload that the browser decrypts at runtime. This module is the single
// source of truth for:
//   - decrypt(html)            -> plaintext HTML
//   - encrypt(plaintext)       -> encrypted wrapper (fresh random key each call)
//   - webpifyBackground(html)  -> add a webp <image-set> override to the bg CSS
//   - extractPreloads(html)    -> critical CSS + hero image to <link rel=preload>
//
// The encrypt() wrapper emits <link rel="preload"> hints for the critical
// stylesheets and hero background first, so the browser's preload scanner can
// fetch them in parallel with decryption instead of only discovering them
// after document.write().
//
// Decryption uses a ~1.8KB inlined AES-128-CBC decryptor (scripts/decryptor.min.js,
// readable source in decryptor.src.js) instead of a 60KB external crypto-js —
// no extra render-blocking request. decrypt() below also still reads the old
// crypto-js wrapper format so existing pages can be re-encrypted.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// the minified browser decryptor, inlined into every page wrapper
const DECRYPTOR = fs.readFileSync(path.join(__dirname, 'decryptor.min.js'), 'utf8').trim();

// --- AES-128-CBC (key == iv, both the 16-char hex string used as utf8 bytes) ---

function decrypt(html) {
  // new wrapper: __kkdec("<base64>","<key>")
  let m = html.match(/__kkdec\("([^"]+)","([^"]+)"\)/);
  // legacy crypto-js wrapper: var content="..." + CryptoJS.enc.Utf8.parse("<key>")
  if (!m) {
    const c = html.match(/var content="([^"]+)"/);
    const k = html.match(/CryptoJS\.enc\.Utf8\.parse\("([^"]+)"\)/);
    if (c && k) m = [null, c[1], k[1]];
  }
  if (!m) throw new Error('encrypted payload not recognised');
  const key = Buffer.from(m[2], 'utf8');
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, key);
  const buf = Buffer.from(m[1], 'base64');
  return Buffer.concat([decipher.update(buf), decipher.final()]).toString('utf8');
}

// --- critical-resource discovery for preload hints ---

function extractPreloads(plaintext) {
  const out = [];

  // render-blocking stylesheets
  const cssRe = /<link\s+rel=["']stylesheet["']\s+href=["']([^"']+)["']/gi;
  let m;
  while ((m = cssRe.exec(plaintext))) out.push({ as: 'style', href: m[1] });

  // hero background image — prefer the webp variant if present
  const webpBg = plaintext.match(/image-set\(\s*url\(\s*["']?([^"')]+\.webp[^"')]*)/i);
  if (webpBg) {
    out.push({ as: 'image', href: webpBg[1] });
  } else {
    const jpgBg = plaintext.match(/background(?:-image)?\s*:[^;{}]*url\(\s*["']?([^"')]+\.(?:jpe?g|png|webp)[^"')]*)/i);
    if (jpgBg) out.push({ as: 'image', href: jpgBg[1] });
  }

  return out;
}

// --- add a webp override to the background declaration (idempotent) ---

function webpifyBackground(plaintext) {
  // already done?
  if (/image-set\([^)]*\.webp/i.test(plaintext)) return { text: plaintext, changed: false };

  const re = /^([ \t]*)((?:background-image|background)\s*:[^;]*url\(\s*["']?([^"')]+?)\.jpe?g([^"')]*)["']?\s*\)[^;]*;)/m;
  const m = plaintext.match(re);
  if (!m) return { text: plaintext, changed: false };

  const [full, indent, decl, base, query] = m;
  const webpUrl = `${base}.webp${query}`;
  const override = `${indent}background-image: image-set(url("${webpUrl}") type("image/webp"));`;
  const replaced = `${indent}${decl}\n${override}`;
  return { text: plaintext.replace(full, replaced), changed: true, webpUrl };
}

// --- encrypt with the preload-aware wrapper ---

function encrypt(plaintext) {
  const preloads = extractPreloads(plaintext)
    .map((p) => `<link rel="preload" as="${p.as}" href="${p.href}">`)
    .join('\n');

  const keyStr = crypto.randomBytes(8).toString('hex'); // 16 hex chars = 16 bytes utf8
  const key = Buffer.from(keyStr, 'utf8');
  const cipher = crypto.createCipheriv('aes-128-cbc', key, key);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('base64');

  return `${preloads ? preloads + '\n' : ''}<script>
${DECRYPTOR}
document.write(__kkdec("${enc}","${keyStr}"))
</script>`;
}

module.exports = { decrypt, encrypt, extractPreloads, webpifyBackground };
