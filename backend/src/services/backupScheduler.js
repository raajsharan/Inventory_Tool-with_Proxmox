let cron;
try { cron = require('node-cron'); } catch { cron = null; }
const backupSvc = require('./backupService');

const tasks = { pg: null, csv: null };

function toCronExpr(s) {
  if (!s) return null;
  const [hh = '9', mm = '0'] = String(s.time_24h || '09:00').split(':');
  const minute = String(parseInt(mm, 10) || 0);
  const hour = String(parseInt(hh, 10) || 0);
  switch (s.frequency) {
    case 'weekly':  return `${minute} ${hour} * * ${(s.day_of_week ?? 1)}`;
    case 'monthly': return `${minute} ${hour} ${(s.day_of_month ?? 1)} * *`;
    case 'daily':
    default:        return `${minute} ${hour} * * *`;
  }
}

async function startKind(kind) {
  if (!cron) return;
  if (tasks[kind]) { try { tasks[kind].stop(); } catch {} tasks[kind] = null; }
  const s = await backupSvc.getSettings(kind);
  if (!s || !s.enabled) return;
  const expr = toCronExpr(s);
  if (!expr || !cron.validate(expr)) return;
  tasks[kind] = cron.schedule(expr, async () => {
    try {
      if (kind === 'pg') await backupSvc.runPgBackup({ trigger: 'scheduled' });
      else               await backupSvc.runCsvExport({ trigger: 'scheduled' });
      // eslint-disable-next-line no-console
      console.log(`[backup-scheduler] ${kind} run completed`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[backup-scheduler] ${kind} run failed:`, e.message);
    }
  });
  // eslint-disable-next-line no-console
  console.log(`[backup-scheduler] ${kind} scheduled: ${expr}`);
}

async function start() {
  if (!cron) {
    // eslint-disable-next-line no-console
    console.warn('[backup-scheduler] node-cron not installed — scheduled backups disabled');
    return;
  }
  await Promise.all([startKind('pg'), startKind('csv')]);
}

async function reload(kind) {
  if (kind) return startKind(kind);
  return start();
}

module.exports = { start, reload };
