#!/usr/bin/env node
// scripts/hash-admin-password.js
// ----------------------------------------------------------------------------
// One-time (or whenever-you-want-to-rotate-it) CLI helper: turns a plaintext
// admin password into a bcrypt hash to paste into the ADMIN_PASSWORD_HASH
// environment variable. The plaintext password itself is NEVER written to
// any file, never logged anywhere but your own terminal history, and never
// leaves this machine.
//
// Usage:
//   node scripts/hash-admin-password.js "your-new-password"
//
// Then set the printed value as ADMIN_PASSWORD_HASH in Vercel (or your
// local .env for `vercel dev`), and set ADMIN_EMAIL to the matching email.
// ----------------------------------------------------------------------------

const bcrypt = require('bcryptjs');

const password = process.argv[2];

if (!password) {
  console.error('Usage: node scripts/hash-admin-password.js "your-new-password"');
  process.exit(1);
}

if (password.length < 10) {
  console.error('Refusing to hash a password shorter than 10 characters — choose a longer one.');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);
console.log('\nADMIN_PASSWORD_HASH value (paste this into your environment variables):\n');
console.log(hash);
console.log('\nDo not paste the plaintext password anywhere. Only this hash goes into ADMIN_PASSWORD_HASH.\n');
