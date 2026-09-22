/**
 * Agent Push — core service: locations/packages, credential profiles, target
 * parsing, and job orchestration. Ported from agent_push_webapp's app.py +
 * models.py, adapted to this app's Postgres/Express conventions. See
 * agentPushWindowsPush.js / agentPushLinuxPush.js for the actual per-target
 * push mechanics.
 */
const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const crypto = require('../utils/crypto');
const ApiError = require('../utils/ApiError');
const { pushWindowsAgent } = require('./agentPushWindowsPush');
const { pushLinuxAgent } = require('./agentPushLinuxPush');

const PACKAGES_DIR = path.join(__dirname, '..', '..', 'data', 'agent_push_packages');
const RESPONSE_ISS_PATH = path.join(PACKAGES_DIR, '_shared', 'response.iss');
fs.mkdirSync(PACKAGES_DIR, { recursive: true });

const CONCURRENCY = 5;

// ── Package detection — mirrors app.py's locations() status logic ──────────

function detectWindowsPackage(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir);
  const msi = files.find((f) => f.toLowerCase() === 'uemsagent.msi');
  const mst = files.find((f) => f.toLowerCase() === 'uemsagent.mst');
  if (msi && mst) {
    const certPaths = files
      .filter((f) => f.toLowerCase().endsWith('.crt'))
      .map((f) => path.join(dir, f));
    return { kind: 'msi', msiPath: path.join(dir, msi), mstPath: path.join(dir, mst), certPaths };
  }
  const exe = files.find((f) => f.toLowerCase().endsWith('.exe'));
  if (exe) return { kind: 'exe', exePath: path.join(dir, exe), exeName: exe };
  return null;
}

function detectLinuxPackage(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir);
  const bin = files.find((f) => f.toLowerCase() === 'uems_linuxagent.bin')
    || files.find((f) => f.toLowerCase().endsWith('.bin'));
  const json = files.find((f) => f.toLowerCase() === 'serverinfo.json');
  if (bin && json) return { binPath: path.join(dir, bin), serverinfoPath: path.join(dir, json) };
  return null;
}

function packageDirFor(folderName, osType) {
  return path.join(PACKAGES_DIR, folderName, osType);
}

// ── Locations ────────────────────────────────────────────────────────────

async function listLocations() {
  const { rows } = await db.query(`SELECT * FROM agent_push_locations ORDER BY name`);
  return rows.map((loc) => ({
    ...loc,
    windows_ready: !!detectWindowsPackage(packageDirFor(loc.folder_name, 'windows')),
    windows_package: detectWindowsPackage(packageDirFor(loc.folder_name, 'windows')),
    linux_ready: !!detectLinuxPackage(packageDirFor(loc.folder_name, 'linux')),
    response_iss_configured: fs.existsSync(RESPONSE_ISS_PATH),
  }));
}

async function getLocationById(id) {
  const { rows } = await db.query(`SELECT * FROM agent_push_locations WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function createLocation({ name, folder_name, notes }, userId) {
  if (!name || !folder_name) throw new ApiError(400, 'name and folder_name are required');
  const { rows } = await db.query(
    `INSERT INTO agent_push_locations (name, folder_name, notes, created_by)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [name, folder_name, notes || null, userId],
  );
  const loc = rows[0];
  fs.mkdirSync(packageDirFor(loc.folder_name, 'windows'), { recursive: true });
  fs.mkdirSync(packageDirFor(loc.folder_name, 'linux'), { recursive: true });
  return loc;
}

async function deleteLocation(id) {
  await db.query(`DELETE FROM agent_push_locations WHERE id = $1`, [id]);
  return { deleted: true };
}

/** files: multer memoryStorage array — [{ originalname, buffer }] */
async function uploadLocationPackage(locationId, osType, files) {
  const loc = await getLocationById(locationId);
  if (!loc) throw new ApiError(404, 'Location not found');
  if (!['windows', 'linux'].includes(osType)) throw new ApiError(400, 'os must be windows or linux');
  const dir = packageDirFor(loc.folder_name, osType);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) {
    fs.writeFileSync(path.join(dir, f.originalname), f.buffer);
  }
  return { uploaded: files.map((f) => f.originalname) };
}

async function uploadResponseIss(files) {
  if (!files?.length) throw new ApiError(400, 'A response.iss file is required');
  fs.mkdirSync(path.dirname(RESPONSE_ISS_PATH), { recursive: true });
  fs.writeFileSync(RESPONSE_ISS_PATH, files[0].buffer);
  return { uploaded: true };
}

// ── Credential profiles ─────────────────────────────────────────────────────

async function listCredentialProfiles() {
  const { rows } = await db.query(
    `SELECT id, name, os_type, auth_type, domain, username, created_by, created_at
       FROM agent_push_credential_profiles ORDER BY name`,
  );
  return rows;
}

async function getCredentialProfile(id) {
  const { rows } = await db.query(`SELECT * FROM agent_push_credential_profiles WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function createCredentialProfile({ name, os_type, auth_type, domain, username, password }, userId) {
  if (!name || !os_type || !auth_type || !username || !password) {
    throw new ApiError(400, 'name, os_type, auth_type, username, and password are required');
  }
  const { rows } = await db.query(
    `INSERT INTO agent_push_credential_profiles
       (name, os_type, auth_type, domain, username, password_encrypted, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, name, os_type, auth_type, domain, username, created_by, created_at`,
    [name, os_type, auth_type, domain || null, username, crypto.encrypt(password), userId],
  );
  return rows[0];
}

async function deleteCredentialProfile(id) {
  await db.query(`DELETE FROM agent_push_credential_profiles WHERE id = $1`, [id]);
  return { deleted: true };
}

// ── Target list parsing — port of app.py's parse_target_lines() ────────────

const IP_LINE_RE = /^[A-Za-z0-9.\-_:]+$/;

function parseTargetLines(rawText) {
  const targets = [];
  const errors = [];
  const lines = (rawText || '').split('\n');

  lines.forEach((rawLine, idx) => {
    const lineno = idx + 1;
    const line = rawLine.trim();
    if (!line) return;

    const parts = line.split(',').map((p) => p.trim());
    const ip = parts[0].replace(/,+$/, '');
    if (!ip || !IP_LINE_RE.test(ip)) { errors.push(lineno); return; }

    let overrideDomain = null;
    let overrideUsername = parts[1] || null;
    const overridePassword = parts[2] || null;
    const overrideLocation = parts[3] || null;
    const overrideOsRaw = parts[4] || null;
    const overrideOs = overrideOsRaw ? overrideOsRaw.toLowerCase() : null;
    if (overrideOs && !['windows', 'linux'].includes(overrideOs)) { errors.push(lineno); return; }

    if (overrideUsername && overrideUsername.includes('\\')) {
      const idxBs = overrideUsername.indexOf('\\');
      overrideDomain = overrideUsername.slice(0, idxBs);
      overrideUsername = overrideUsername.slice(idxBs + 1);
    }

    targets.push({ ip, overrideDomain, overrideUsername, overridePassword, overrideLocation, overrideOs });
  });

  return { targets, errors };
}

// ── Job creation ─────────────────────────────────────────────────────────

async function createJob({
  os_type, location_id, credential_profile_id, adhoc_domain, adhoc_username, adhoc_password,
  force_reinstall, raw_text,
}, userId) {
  if (!os_type || !location_id) throw new ApiError(400, 'os_type and location_id are required');

  const { targets, errors } = parseTargetLines(raw_text);
  if (!targets.length) throw new ApiError(400, 'No valid target lines found (paste some, or upload a file).');

  const locations = await listLocations();
  const folderNameToId = new Map(locations.map((l) => [l.folder_name, l.id]));

  const hasJobDefault = !!(credential_profile_id || adhoc_username);
  const missingCreds = [];
  const badLocations = [];
  const crossOsNoOverride = [];

  for (const t of targets) {
    const effectiveOs = t.overrideOs || os_type;
    if (!t.overrideUsername) {
      if (!hasJobDefault) missingCreds.push(t.ip);
      else if (effectiveOs !== os_type) crossOsNoOverride.push(t.ip);
    }
    if (t.overrideLocation && !folderNameToId.has(t.overrideLocation)) {
      badLocations.push(`${t.ip} -> '${t.overrideLocation}'`);
    }
  }

  if (missingCreds.length || badLocations.length || crossOsNoOverride.length) {
    const parts = [];
    if (missingCreds.length) {
      parts.push(`No credentials available for: ${missingCreds.slice(0, 10).join(', ')}`
        + (missingCreds.length > 10 ? ' ...' : '')
        + ' (no per-target override and no job default selected).');
    }
    if (crossOsNoOverride.length) {
      parts.push('These targets are a different OS than the job default and need their own '
        + `credential override: ${crossOsNoOverride.slice(0, 10).join(', ')}`
        + (crossOsNoOverride.length > 10 ? ' ...' : '') + '.');
    }
    if (badLocations.length) {
      parts.push(`Unknown location override(s): ${badLocations.slice(0, 10).join(', ')} `
        + "(must match an existing Location's folder name exactly).");
    }
    throw new ApiError(400, parts.join(' '));
  }

  const jobRes = await db.query(
    `INSERT INTO agent_push_jobs
       (os_type, location_id, credential_profile_id, adhoc_domain, adhoc_username,
        adhoc_password_encrypted, force_reinstall, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8) RETURNING id`,
    [
      os_type, location_id, credential_profile_id || null, adhoc_domain || null, adhoc_username || null,
      adhoc_username ? crypto.encrypt(adhoc_password || '') : null, !!force_reinstall, userId,
    ],
  );
  const jobId = jobRes.rows[0].id;

  for (const t of targets) {
    await db.query(
      `INSERT INTO agent_push_job_targets
         (job_id, ip_or_host, override_domain, override_username, override_password_encrypted,
          override_location_id, override_os_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        jobId, t.ip, t.overrideDomain, t.overrideUsername,
        t.overrideUsername ? crypto.encrypt(t.overridePassword || '') : null,
        t.overrideLocation ? folderNameToId.get(t.overrideLocation) : null,
        t.overrideOs,
      ],
    );
  }

  startJob(jobId).catch((e) => console.error(`[agent-push] job ${jobId} failed:`, e));

  return { id: jobId, targetCount: targets.length, skippedLines: errors };
}

async function listJobs() {
  const { rows } = await db.query(
    `SELECT j.*, l.name AS location_name,
            (SELECT COUNT(*) FROM agent_push_job_targets t WHERE t.job_id = j.id) AS target_count
       FROM agent_push_jobs j
       JOIN agent_push_locations l ON l.id = j.location_id
      ORDER BY j.created_at DESC LIMIT 50`,
  );
  return rows;
}

async function getJob(id) {
  const { rows } = await db.query(
    `SELECT j.*, l.name AS location_name FROM agent_push_jobs j
       JOIN agent_push_locations l ON l.id = j.location_id WHERE j.id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const { rows: targets } = await db.query(
    `SELECT * FROM agent_push_job_targets WHERE job_id = $1 ORDER BY id`, [id],
  );
  return { ...rows[0], targets };
}

async function getJobStatus(id) {
  const { rows: jobRows } = await db.query(`SELECT status FROM agent_push_jobs WHERE id = $1`, [id]);
  if (!jobRows[0]) throw new ApiError(404, 'Job not found');
  const { rows: targets } = await db.query(
    `SELECT id, ip_or_host AS ip, status, log_output AS log FROM agent_push_job_targets
      WHERE job_id = $1 ORDER BY id`,
    [id],
  );
  return { job_status: jobRows[0].status, targets };
}

// ── Orchestration — no separate worker process, same model as Test Deploy:
// fire off async work from the request handler, update Postgres as it
// progresses, and let the frontend poll getJobStatus(). ─────────────────────

async function resolveJobDefaults(job) {
  if (job.credential_profile_id) {
    const cp = await getCredentialProfile(job.credential_profile_id);
    if (!cp) return { domain: null, username: null, password: null };
    return { domain: cp.domain, username: cp.username, password: crypto.decrypt(cp.password_encrypted) };
  }
  return {
    domain: job.adhoc_domain,
    username: job.adhoc_username,
    password: crypto.decryptSafe(job.adhoc_password_encrypted),
  };
}

function resolveTargetCredentials(target, jobDefaults) {
  if (target.override_username) {
    return {
      domain: target.override_domain,
      username: target.override_username,
      password: crypto.decryptSafe(target.override_password_encrypted),
    };
  }
  return jobDefaults;
}

async function finishTarget(targetId, status, logLine) {
  await db.query(
    `UPDATE agent_push_job_targets
        SET status = $1, log_output = TRIM(BOTH FROM (COALESCE(log_output, '') || E'\n' || $2)), finished_at = NOW()
      WHERE id = $3`,
    [status, logLine, targetId],
  );
}

async function pushOneTarget(job, target, jobDefaults) {
  await db.query(
    `UPDATE agent_push_job_targets SET status = 'running', started_at = NOW() WHERE id = $1`,
    [target.id],
  );

  const osType = target.override_os_type || job.os_type;
  const locationId = target.override_location_id || job.location_id;
  const location = await getLocationById(locationId);
  if (!location) {
    await finishTarget(target.id, 'failed', 'Resolved location no longer exists.');
    return;
  }

  const creds = resolveTargetCredentials(target, jobDefaults);
  if (!creds.username) {
    await finishTarget(target.id, 'failed', 'No credentials resolved for this target (no override and no job default).');
    return;
  }

  let accumulatedLog = '';
  const logCallback = (line) => {
    accumulatedLog = `${accumulatedLog}\n${line}`.trim();
    db.query(`UPDATE agent_push_job_targets SET log_output = $1 WHERE id = $2`, [accumulatedLog, target.id])
      .catch(() => {});
  };

  try {
    let result;
    if (osType === 'windows') {
      const pkg = detectWindowsPackage(packageDirFor(location.folder_name, 'windows'));
      if (!pkg) {
        await finishTarget(target.id, 'failed', `No supported Windows package found for location '${location.name}'.`);
        return;
      }
      result = await pushWindowsAgent({
        ip: target.ip_or_host, domain: creds.domain, username: creds.username, password: creds.password,
        pkg, responseIssPath: fs.existsSync(RESPONSE_ISS_PATH) ? RESPONSE_ISS_PATH : null,
        forceReinstall: job.force_reinstall, logCallback,
      });
    } else {
      const pkg = detectLinuxPackage(packageDirFor(location.folder_name, 'linux'));
      if (!pkg) {
        await finishTarget(target.id, 'failed', `No supported Linux package found for location '${location.name}'.`);
        return;
      }
      result = await pushLinuxAgent({
        ip: target.ip_or_host, username: creds.username, password: creds.password,
        pkg, forceReinstall: job.force_reinstall, logCallback,
      });
    }

    const status = result.alreadyInstalled ? 'skipped' : (result.success ? 'success' : 'failed');
    await db.query(
      `UPDATE agent_push_job_targets SET status = $1, log_output = $2, finished_at = NOW() WHERE id = $3`,
      [status, result.log, target.id],
    );
  } catch (e) {
    await finishTarget(target.id, 'failed', `Unhandled error: ${e.message}`);
  }
}

async function maybeCompleteJob(jobId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS remaining FROM agent_push_job_targets
      WHERE job_id = $1 AND status IN ('pending', 'running')`,
    [jobId],
  );
  if (rows[0].remaining === 0) {
    await db.query(`UPDATE agent_push_jobs SET status = 'completed' WHERE id = $1`, [jobId]);
  }
}

async function startJob(jobId) {
  await db.query(`UPDATE agent_push_jobs SET status = 'running' WHERE id = $1`, [jobId]);

  const { rows: jobRows } = await db.query(`SELECT * FROM agent_push_jobs WHERE id = $1`, [jobId]);
  const job = jobRows[0];
  const jobDefaults = await resolveJobDefaults(job);
  const { rows: targets } = await db.query(
    `SELECT * FROM agent_push_job_targets WHERE job_id = $1`, [jobId],
  );

  const queue = [...targets];
  async function worker() {
    while (queue.length) {
      const target = queue.shift();
      await pushOneTarget(job, target, jobDefaults);
    }
  }

  const workerCount = Math.min(CONCURRENCY, targets.length) || 1;
  await Promise.all(Array.from({ length: workerCount }, worker));
  await maybeCompleteJob(jobId);
}

// ── Startup orphan cleanup — a Node restart loses in-memory job state the
// same way the Flask app's background threads did, so any target still
// pending/running belongs to a run that can never finish. ───────────────────

async function cleanupOrphanedJobTargets() {
  const { rows } = await db.query(
    `UPDATE agent_push_job_targets
        SET status = 'failed', finished_at = NOW(),
            log_output = TRIM(BOTH FROM (COALESCE(log_output, '') || E'\n' ||
              '[Marked as failed: interrupted by an application restart before this push could finish — not a real install failure.]'))
      WHERE status IN ('pending', 'running')
      RETURNING job_id`,
  );
  if (!rows.length) return;
  const jobIds = [...new Set(rows.map((r) => r.job_id))];
  await db.query(
    `UPDATE agent_push_jobs SET status = 'completed' WHERE id = ANY($1::int[]) AND status != 'completed'`,
    [jobIds],
  );
  console.log(`[agent-push] startup cleanup: marked ${rows.length} orphaned target(s) `
    + `across ${jobIds.length} job(s) as failed (interrupted by a previous restart).`);
}

module.exports = {
  listLocations, createLocation, deleteLocation, uploadLocationPackage, uploadResponseIss,
  listCredentialProfiles, createCredentialProfile, deleteCredentialProfile,
  createJob, listJobs, getJob, getJobStatus,
  cleanupOrphanedJobTargets,
};
