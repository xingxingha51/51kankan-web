// Compact synchronous AES-128-CBC decryptor for the landing pages.
// Replaces the 60KB crypto-js.min.js with ~2KB inlined into the page wrapper.
//
// Matches the existing scheme exactly:
//   - AES-128-CBC, PKCS7 padding
//   - key == iv == the UTF-8 bytes of the 16-char hex key string
//   - content is base64 of the ciphertext
//   - returns the UTF-8 decoded plaintext HTML
//
// S-box is generated at runtime (standard Rijndael algorithm) to keep the
// payload tiny and avoid hand-typed table errors. Verified byte-exact against
// Node's crypto.createDecipheriv across all pages (see verify step in build).
//
// Exposed as window.__kkdec(base64, keyString) -> plaintext string.
(function (g) {
  function dec(b64, keyStr) {
    // base64 -> ciphertext bytes
    var bin = atob(b64), n = bin.length, ct = new Uint8Array(n), i;
    for (i = 0; i < n; i++) ct[i] = bin.charCodeAt(i);

    // key / iv = utf-8 bytes of the 16-char ascii hex string
    var key = new Uint8Array(16), iv = new Uint8Array(16);
    for (i = 0; i < 16; i++) { key[i] = keyStr.charCodeAt(i); iv[i] = keyStr.charCodeAt(i); }

    // --- build S-box and inverse S-box (standard Rijndael generation) ---
    var S = new Uint8Array(256), IS = new Uint8Array(256), p = 1, q = 1, x;
    do {
      p = (p ^ (p << 1) ^ ((p & 0x80) ? 0x11b : 0)) & 0xff;       // p *= 3
      q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff;            // q /= 3
      if (q & 0x80) q ^= 0x09;
      x = (q ^ ((q << 1 | q >> 7) & 0xff) ^ ((q << 2 | q >> 6) & 0xff)
             ^ ((q << 3 | q >> 5) & 0xff) ^ ((q << 4 | q >> 4) & 0xff) ^ 0x63) & 0xff;
      S[p] = x;
    } while (p !== 1);
    S[0] = 0x63;
    for (i = 0; i < 256; i++) IS[S[i]] = i;

    // --- key expansion (AES-128: 176 bytes / 11 round keys) ---
    var RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];
    var w = new Uint8Array(176), b = 16, rc = 0, t = new Uint8Array(4), tmp;
    for (i = 0; i < 16; i++) w[i] = key[i];
    while (b < 176) {
      for (i = 0; i < 4; i++) t[i] = w[b - 4 + i];
      if (b % 16 === 0) {
        tmp = t[0]; t[0] = t[1]; t[1] = t[2]; t[2] = t[3]; t[3] = tmp;  // RotWord
        for (i = 0; i < 4; i++) t[i] = S[t[i]];                         // SubWord
        t[0] ^= RCON[rc++];
      }
      for (i = 0; i < 4; i++) { w[b] = w[b - 16] ^ t[i]; b++; }
    }

    // GF(2^8) multiply
    function mul(a, bb) { var r = 0; while (bb) { if (bb & 1) r ^= a; var hi = a & 0x80; a = (a << 1) & 0xff; if (hi) a ^= 0x1b; bb >>= 1; } return r; }

    // decrypt one 16-byte block (state is column-major: s[r + 4c])
    function inv(s) {
      var r, c, k, a0, a1, a2, a3;
      function ark(rd) { for (k = 0; k < 16; k++) s[k] ^= w[rd * 16 + k]; }
      function isub() { for (k = 0; k < 16; k++) s[k] = IS[s[k]]; }
      function ishift() {
        var z;
        z = s[13]; s[13] = s[9]; s[9] = s[5]; s[5] = s[1]; s[1] = z;             // row1 >> 1
        z = s[2]; s[2] = s[10]; s[10] = z; z = s[6]; s[6] = s[14]; s[14] = z;    // row2 >> 2
        z = s[3]; s[3] = s[7]; s[7] = s[11]; s[11] = s[15]; s[15] = z;           // row3 >> 3
      }
      function imix() {
        for (c = 0; c < 4; c++) {
          k = 4 * c; a0 = s[k]; a1 = s[k + 1]; a2 = s[k + 2]; a3 = s[k + 3];
          s[k]     = mul(a0, 14) ^ mul(a1, 11) ^ mul(a2, 13) ^ mul(a3, 9);
          s[k + 1] = mul(a0, 9) ^ mul(a1, 14) ^ mul(a2, 11) ^ mul(a3, 13);
          s[k + 2] = mul(a0, 13) ^ mul(a1, 9) ^ mul(a2, 14) ^ mul(a3, 11);
          s[k + 3] = mul(a0, 11) ^ mul(a1, 13) ^ mul(a2, 9) ^ mul(a3, 14);
        }
      }
      ark(10);
      for (r = 9; r >= 1; r--) { ishift(); isub(); ark(r); imix(); }
      ishift(); isub(); ark(0);
    }

    // --- CBC over all blocks ---
    var out = new Uint8Array(n), prev = iv, blk = new Uint8Array(16), j;
    for (i = 0; i < n; i += 16) {
      for (j = 0; j < 16; j++) blk[j] = ct[i + j];
      inv(blk);
      for (j = 0; j < 16; j++) out[i + j] = blk[j] ^ prev[j];
      prev = ct.subarray(i, i + 16);
    }

    // --- strip PKCS7 padding ---
    var pad = out[n - 1], len = n - pad;

    // --- UTF-8 decode ---
    var bytes = out.subarray(0, len);
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes);
    var s2 = '';
    for (i = 0; i < len; i++) s2 += String.fromCharCode(bytes[i]);
    return decodeURIComponent(escape(s2)); // utf-8 decode fallback for old engines
  }

  g.__kkdec = dec;
})(typeof window !== 'undefined' ? window : this);
