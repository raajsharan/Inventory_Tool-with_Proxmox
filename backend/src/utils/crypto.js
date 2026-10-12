const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

// The exact placeholder shipped in .env.example — it's valid-looking 64-hex
// input (passes every format check below), which is exactly why it has been
// copy-pasted into a real .env unchanged before. Refuse to encrypt/decrypt
// anything with it rather than silently running every stored credential
// through a key anyone who has ever seen this repo also has.
const EXAMPLE_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function getKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) throw new Error('ENCRYPTION_KEY is not set');
  if (hex === EXAMPLE_KEY) {
    throw new Error('ENCRYPTION_KEY is still the .env.example placeholder value — generate a real one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes hex (64 chars)');
  return key;
}

function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // store as base64: iv || tag || ciphertext
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

function decrypt(payload) {
  if (!payload) return null;
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

// A real ciphertext from encrypt() is base64 of at least IV_LEN+TAG_LEN+1
// raw bytes. Legacy plaintext (a password saved before encryption was
// applied to that column) essentially never happens to also satisfy this —
// used below to tell "this was never encrypted" apart from "this was
// encrypted and the ciphertext is now corrupt/tampered", which look
// identical to a bare try/catch around decrypt().
function looksLikeCiphertext(payload) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) return false;
  return Buffer.from(payload, 'base64').length > IV_LEN + TAG_LEN;
}

// Decrypts a value that is expected to be ciphertext produced by encrypt(),
// but tolerates legacy plaintext saved before encryption was applied to that
// column: if decryption fails on a payload that doesn't even look like our
// ciphertext format, the original value is returned unchanged so existing
// data keeps working until the next save re-encrypts it. If the payload DOES
// look like ciphertext but still fails (auth-tag mismatch — corruption or
// tampering), that's logged rather than silently swallowed, since returning
// the raw encrypted blob as if it were a usable value would be worse than
// surfacing the problem.
function decryptSafe(payload) {
  if (!payload) return '';
  try {
    const pt = decrypt(payload);
    return pt === null ? '' : pt;
  } catch (e) {
    if (looksLikeCiphertext(payload)) {
      // eslint-disable-next-line no-console
      console.error('[crypto] decryptSafe: payload looks like ciphertext but failed to decrypt (corrupted or tampered):', e.message);
    }
    return payload;
  }
}

module.exports = { encrypt, decrypt, decryptSafe };
