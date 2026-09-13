#!/usr/bin/env node
/* ==========================================================================
   VELIX — manual/initial publish.

   Runs the exact same regenerate-and-push pipeline api/admin/data.js
   triggers automatically after every Project/News change (see
   lib/publish.js) — this script exists for:
     - The one-time initial migration: bringing public-data/*.json,
       sitemap.xml, and every already-uploaded image/video under uploads/
       into git for the very first time, so the first static deploy has
       everything that's currently published (not just what changes from
       here on).
     - Re-running a publish by hand if an earlier auto-publish's git push
       failed (no network, stale credentials, ...) — see the message it
       prints when that happens.

   Usage: npm run publish-site
   ========================================================================== */
require('../lib/env').loadEnv(); // so GIT_AUTO_PUSH etc. in .env.local are respected here too
const { publish } = require('../lib/publish');

// force: true — always run the gh-pages build+push step even if SQLite
// hasn't changed since the last publish. That's the whole point of running
// this by hand: seeding gh-pages for the first time, or re-syncing it after
// an earlier auto-publish's push failed.
const result = publish(process.argv[2] || 'Manual publish (npm run publish-site)', { force: true });

console.log('');
if (result.snapshot.error) {
  console.error('✗ Could not read from the database:', result.snapshot.error);
  process.exitCode = 1;
} else if (!result.snapshot.changed) {
  console.log('✓ Nothing to publish — public-data/*.json and sitemap.xml already match the database.');
} else {
  console.log(`✓ Regenerated: ${result.snapshot.files.join(', ')}`);
}

if (result.git.ok && !result.git.skipped) {
  console.log('✓ Committed and pushed gh-pages.');
} else if (result.git.skipped) {
  console.log(`  (git: ${result.git.reason})`);
} else if (!result.git.ok) {
  console.error('✗ git publish failed:', result.git.error);
  process.exitCode = 1;
}
console.log('');
