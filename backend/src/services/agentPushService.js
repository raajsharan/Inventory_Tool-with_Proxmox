/**
 * Agent Push — core service: locations/packages, eligible-asset listing, and
 * job orchestration. Ported from agent_push_webapp's app.py + models.py, but
 * targets are picked from existing Assets/Ext. Assets records instead of a
 * pasted IP list — same model Test Deploy uses (see resolveTarget() below,
 * which mirrors testDeployService.js's resolveTarget()). See
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

// Scoped to just these two sources, per how this page is meant to be used —
// Test Deploy's own listAssets() also covers Beijing Assets/Physical Servers,
// but Agent Push deliberately doesn't.
const SOURCE_TABLE = { 'MSL Assets': 'assets', 'Ext. Assets': 'ext_assets' };
const isWindows = (t) => /windows/i.test(t || '');

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

// Matches an asset record's own `location` field (e.g. "Burlington") to an
// Agent Push Location by name — same idea as Test Deploy matching a VM's
// location string to test_deploy_location_config.location.
async function getLocationByName(name) {
  if (!name) return null;
  const { rows } = await db.query(
    `SELECT * FROM agent_push_locations WHERE LOWER(name) = LOWER($1)`, [name.trim()],
  );
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

// ── Eligible assets — same shape/filter as testDeployService.listAssets(),
// scoped to MSL Assets + Ext. Assets only. ──────────────────────────────────

async function listEligibleAssets() {
  const unions = Object.entries(SOURCE_TABLE).map(([source, table]) => `
    SELECT vm_name, os_hostname, ip_address::text AS ip_address,
           COALESCE(os_type, '') AS os_type,
           COALESCE(NULLIF(TRIM(location), ''), 'Unknown') AS location,
           COALESCE(manage_engine_installed, false) AS me_installed,
           '${source}' AS source
      FROM ${table}
     WHERE deleted_at IS NULL AND decommissioned_at IS NULL AND ip_address IS NOT NULL
  `);
  const { rows } = await db.query(`
    SELECT * FROM (${unions.join(' UNION ALL ')}) all_vms
    WHERE os_type NOT ILIKE '%esxi%' AND os_type NOT ILIKE '%vmware%'
      AND os_type NOT ILIKE '%appliance%' AND os_type NOT ILIKE '%proxmox%'
    ORDER BY location, vm_name
  `);

  const locations = await listLocations();
  const locByName = new Map(locations.map((l) => [l.name.toLowerCase(), l]));

  return rows.map((r) => {
    const loc = locByName.get((r.location || '').toLowerCase());
    const win = isWindows(r.os_type);
    const packageReady = !!loc && (win ? loc.windows_ready : loc.linux_ready);
    return { ...r, package_ready: packageReady };
  });
}

// Resolves one {source, ip_address} ref against the live asset record —
// direct port of testDeployService.js's resolveTarget(), scoped to this
// page's two sources.
async function resolveAssetTarget({ source, ip_address }) {
  const table = SOURCE_TABLE[source];
  if (!table) return null;
  const { rows } = await db.query(
    `SELECT vm_name, asset_username, asset_password_encrypted, os_type, location
       FROM ${table} WHERE ip_address::text = $1 AND deleted_at IS NULL AND decommissioned_at IS NULL LIMIT 1`,
    [ip_address],
  );
  if (!rows.length) return null;
  const row = rows[0];
  let password = null;
  if (row.asset_password_encrypted) {
    try { password = crypto.decrypt(row.asset_password_encrypted); } catch { /* treated as no password below */ }
  }
  return {
    vm_name: row.vm_name, os_type: row.os_type || '', location: (row.location || '').trim(),
    username: row.asset_username || null, password,
  };
}

// ── Job creation ─────────────────────────────────────────────────────────

/** refs: [{ source, ip_address }] — picked from the Agent Push VM picker table. */
async function createJob({ targets: refs, force_reinstall }, userId) {
  if (!Array.isArray(refs) || !refs.length) throw new ApiError(400, 'At least one target is required');
  for (const r of refs) {
    if (!SOURCE_TABLE[r.source] || !r.ip_address) throw new ApiError(400, 'Each target needs a valid source and ip_address');
  }

  const jobRes = await db.query(
    `INSERT INTO agent_push_jobs (force_reinstall, status, created_by) VALUES ($1,'pending',$2) RETURNING id`,
    [!!force_reinstall, userId],
  );
  const jobId = jobRes.rows[0].id;

  for (const ref of refs) {
    // Best-effort snapshot for display — a failed/missing resolution here
    // still gets inserted (with nulls) so pushOneTarget can report the
    // precise reason once the job actually runs, rather than silently
    // dropping the target from the job at creation time.
    const resolved = await resolveAssetTarget(ref).catch(() => null);
    await db.query(
      `INSERT INTO agent_push_job_targets (job_id, source, ip_address, vm_name, os_type, location)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [jobId, ref.source, ref.ip_address, resolved?.vm_name || null, resolved?.os_type || null, resolved?.location || null],
    );
  }

  startJob(jobId).catch((e) => console.error(`[agent-push] job ${jobId} failed:`, e));

  return { id: jobId, targetCount: refs.length };
}

async function listJobs() {
  const { rows } = await db.query(
    `SELECT j.*,
            (SELECT COUNT(*) FROM agent_push_job_targets t WHERE t.job_id = j.id) AS target_count
       FROM agent_push_jobs j
      ORDER BY j.created_at DESC LIMIT 50`,
  );
  return rows;
}

async function getJob(id) {
  const { rows } = await db.query(`SELECT * FROM agent_push_jobs WHERE id = $1`, [id]);
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
    `SELECT id, ip_address AS ip, status, log_output AS log FROM agent_push_job_targets
      WHERE job_id = $1 ORDER BY id`,
    [id],
  );
  return { job_status: jobRows[0].status, targets };
}

// ── Orchestration — no separate worker process, same model as Test Deploy:
// fire off async work from the request handler, update Postgres as it
// progresses, and let the frontend poll getJobStatus(). ─────────────────────

async function finishTarget(targetId, status, logLine) {
  await db.query(
    `UPDATE agent_push_job_targets
        SET status = $1, log_output = TRIM(BOTH FROM (COALESCE(log_output, '') || E'\n' || $2)), finished_at = NOW()
      WHERE id = $3`,
    [status, logLine, targetId],
  );
}

async function pushOneTarget(job, target) {
  await db.query(
    `UPDATE agent_push_job_targets SET status = 'running', started_at = NOW() WHERE id = $1`,
    [target.id],
  );

  // Resolved fresh here (not from the job-creation snapshot) so credentials
  // are never persisted anywhere in Agent Push's own tables, and any recent
  // edit to the asset record (password rotation, location move) is honored.
  const resolved = await resolveAssetTarget({ source: target.source, ip_address: target.ip_address });
  if (!resolved || !resolved.username || !resolved.password) {
    await finishTarget(target.id, 'failed', 'No stored username/password on the asset record — set credentials on '
      + `the ${target.source} record for ${target.ip_address} first.`);
    return;
  }

  const location = await getLocationByName(resolved.location);
  if (!location) {
    await finishTarget(target.id, 'failed', `No Agent Push Location configured matching '${resolved.location}' — `
      + 'add one under Agent Push → Locations.');
    return;
  }

  const win = isWindows(resolved.os_type);

  let accumulatedLog = '';
  const logCallback = (line) => {
    accumulatedLog = `${accumulatedLog}\n${line}`.trim();
    db.query(`UPDATE agent_push_job_targets SET log_output = $1 WHERE id = $2`, [accumulatedLog, target.id])
      .catch(() => {});
  };

  try {
    let result;
    if (win) {
      const pkg = detectWindowsPackage(packageDirFor(location.folder_name, 'windows'));
      if (!pkg) {
        await finishTarget(target.id, 'failed', `No supported Windows package found for location '${location.name}'.`);
        return;
      }
      result = await pushWindowsAgent({
        ip: target.ip_address, username: resolved.username, password: resolved.password,
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
        ip: target.ip_address, username: resolved.username, password: resolved.password,
        pkg, forceReinstall: job.force_reinstall, logCallback,
      });
    }

    const status = result.alreadyInstalled ? 'skipped' : (result.success ? 'success' : 'failed');
    await db.query(
      `UPDATE agent_push_job_targets
          SET status = $1, log_output = $2, finished_at = NOW(), vm_name = $3, os_type = $4, location = $5
        WHERE id = $6`,
      [status, result.log, resolved.vm_name, resolved.os_type, resolved.location, target.id],
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
  const { rows: targets } = await db.query(
    `SELECT * FROM agent_push_job_targets WHERE job_id = $1`, [jobId],
  );

  const queue = [...targets];
  async function worker() {
    while (queue.length) {
      const target = queue.shift();
      await pushOneTarget(job, target);
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
  listEligibleAssets,
  createJob, listJobs, getJob, getJobStatus,
  cleanupOrphanedJobTargets,
};
