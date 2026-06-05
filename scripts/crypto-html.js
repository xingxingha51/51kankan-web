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
// stylesheets and hero background BEFORE the (render-blocking) crypto script,
// so the browser's preload scanner can fetch them in parallel with the
// decryption instead of only discovering them after document.write().

const crypto = require('crypto');

// --- AES-128-CBC (key == iv, both the 16-char hex string used as utf8 bytes) ---

function decrypt(html) {
  const contentMatch = html.match(/var content="([^"]+)"/);
  const keyMatch = html.match(/CryptoJS\.enc\.Utf8\.parse\("([^"]+)"\)/);
  if (!contentMatch || !keyMatch) throw new Error('encrypted payload not recognised');
  const key = Buffer.from(keyMatch[1], 'utf8');
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, key);
  const buf = Buffer.from(contentMatch[1], 'base64');
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

  return `${preloads ? preloads + '\n' : ''}<script src="/theme/skin1/js/crypto-js.min.js?_v=20251024"></script>
<script>
var content="${enc}";
var key =CryptoJS.enc.Utf8.parse("${keyStr}");
var iv =CryptoJS.enc.Utf8.parse("${keyStr}");
var options = { mode: CryptoJS.mode.CBC,padding:CryptoJS.pad.Pkcs7,iv:iv}
content = CryptoJS.AES.decrypt(content,key,options).toString(CryptoJS.enc.Utf8)
document.write(content)
</script>`;
}

module.exports = { decrypt, encrypt, extractPreloads, webpifyBackground };
