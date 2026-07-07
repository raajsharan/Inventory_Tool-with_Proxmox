/**
 * version.js — resolves the running build's git commit once at startup so
 * /health (and the app footer) can answer "which code is actually live?".
 * Falls back to the GIT_COMMIT env var, then 'unknown' when git or the
 * .git directory is unavailable (e.g. tarball deployments).
 */
const { execSync } = require('child_process');
const path = require('path');

let cached = null;

function getVersion() {
  if (cached) return cached;
  let commit = process.env.GIT_COMMIT || null;
  if (!commit) {
    try {
      commit = execSync('git rev-parse --short HEAD', {
        cwd: path.join(__dirname, '..', '..'),
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
      }).toString().trim() || null;
    } catch { /* git not available */ }
  }
  cached = {
    commit: commit || 'unknown',
    started_at: new Date().toISOString(),
  };
  return cached;
}

module.exports = { getVersion };
