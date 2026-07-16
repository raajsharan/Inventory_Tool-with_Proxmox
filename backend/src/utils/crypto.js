const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) throw new Error('ENCRYPTION_KEY is not set');
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

// Decrypts a value that is expected to be ciphertext produced by encrypt(),
// but tolerates legacy plaintext saved before encryption was applied to that
// column: if decryption fails (e.g. GCM auth-tag verification), the original
// value is returned unchanged so existing data keeps working until the next
// save re-encrypts it.
function decryptSafe(payload) {
  if (!payload) return '';
  try {
    const pt = decrypt(payload);
    return pt === null ? '' : pt;
  } catch {
    return payload;
  }
}

module.exports = { encrypt, decrypt, decryptSafe };
