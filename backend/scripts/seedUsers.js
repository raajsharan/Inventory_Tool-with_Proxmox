#!/usr/bin/env node
/**
 * Seeds the three default-role accounts (admin / asset_manager / viewer)
 * with real bcrypt hashes, each given a freshly generated random password —
 * printed once below so you can hand them off, then change them. Re-running
 * rotates all three passwords in place (idempotent on email).
 *
 * Usage:  node scripts/seedUsers.js
 * Reads DB credentials from backend/.env
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('../src/config/db');
const { isValidPassword } = require('../src/utils/passwordPolicy');

function randomPassword() {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  let password;
  // crypto.randomBytes-backed charset pick, retried until it happens to
  // satisfy the complexity policy (upper+lower+digit) — effectively always
  // the first try with a 16-char mixed-class charset, but checked rather
  // than assumed.
  do {
    password = Array.from(crypto.randomBytes(16))
      .map(b => charset[b % charset.length])
      .join('');
  } while (!isValidPassword(password));
  return password;
}

const users = [
  { email: 'admin@example.com',   fullName: 'System Admin',  role: 'admin' },
  { email: 'manager@example.com', fullName: 'Asset Manager', role: 'asset_manager' },
  { email: 'viewer@example.com',  fullName: 'Viewer User',   role: 'viewer' },
];

(async () => {
  try {
    for (const u of users) {
      const password = randomPassword();
      const hash = await bcrypt.hash(password, 12);
      await db.query(
        `INSERT INTO users (email, full_name, password_hash, role)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (email) DO UPDATE
           SET full_name = EXCLUDED.full_name,
               password_hash = EXCLUDED.password_hash,
               role = EXCLUDED.role`,
        [u.email, u.fullName, hash, u.role]
      );
      console.log(`✓ seeded ${u.email} (${u.role}) — password: ${password}`);
    }
    console.log('\nDone. These passwords are shown once and not stored anywhere — save them now, and change them after first login.');
    process.exit(0);
  } catch (e) {
    console.error('Seed failed:', e);
    process.exit(1);
  }
})();
