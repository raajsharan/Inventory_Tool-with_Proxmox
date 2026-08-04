/**
 * recurringActivityService.js
 * ----------------------------
 * Admin-editable rotation config (mirrors Recurring_Activity_Ready_Reckoner.md)
 * plus the same rotation math: monthly rotation advances on the 5th of each
 * month (not the 1st), weekly rotation advances every Monday, and rotating
 * activities cycle through their configured owner order. Shared activities
 * (owner = "All 3" or any custom label) never rotate. Manual overrides take
 * priority over the automatic pick for one specific period + activity.
 */

const db = require('../config/db');

const DEFAULT_CONFIG = {
  team: ['Ashok', 'Haran', 'Sharan'],
  monthlyReference: { year: 2026, month: 7 },       // Jul-2026 = period 0
  weeklyReferenceMonday: '2026-07-27',              // Monday = period 0
  monthlyRotating: [
    { key: 'huan_vms_patching',     label: "Huan' VMs Patching",    order: ['Ashok', 'Haran', 'Sharan'] },
    { key: 'me_vms_patching',       label: 'ME VMs Patching',       order: ['Sharan', 'Ashok', 'Haran'] },
    { key: 'bj_inventory_followup', label: 'BJ Inventory Followup', order: ['Ashok', 'Haran', 'Sharan'] },
    { key: 'me_hotfix',             label: 'ME Hotfix',             order: ['Sharan', 'Ashok', 'Haran'] },
  ],
  monthlyShared: [
    { key: 'dc_patching',            label: 'DC Patching',             owner: 'All 3' },
    { key: 'ext_inventory_followup', label: 'Ext. Inventory follow up', owner: 'All 3' },
    { key: 'proxmox_migration',      label: 'Proxmox Migration',       owner: 'All 3' },
  ],
  weeklyRotating: [
    { key: 'weekly_report', label: 'Weekly Report', order: ['Ashok', 'Haran', 'Sharan'] },
  ],
};

// ---------------------------------------------------------------------------
// Config persistence
// ---------------------------------------------------------------------------

async function getConfig() {
  const { rows } = await db.query('SELECT config, updated_at FROM recurring_activity_config WHERE id = 1');
  const stored = rows[0]?.config;
  return {
    config: (stored && Object.keys(stored).length) ? stored : DEFAULT_CONFIG,
    updated_at: rows[0]?.updated_at || null,
  };
}

async function saveConfig(config, userId) {
  const { rows } = await db.query(
    `INSERT INTO recurring_activity_config (id, config, updated_by, updated_at)
     VALUES (1, $1, $2, NOW())
     ON CONFLICT (id) DO UPDATE
       SET config = EXCLUDED.config, updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING config, updated_at`,
    [JSON.stringify(config), userId]
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

async function listOverrides(frequency) {
  const { rows } = await db.query(
    `SELECT o.*, u.full_name AS created_by_name
       FROM recurring_activity_overrides o
       LEFT JOIN users u ON u.id = o.created_by
      WHERE ($1::text IS NULL OR frequency = $1)
      ORDER BY period_key DESC`,
    [frequency || null]
  );
  return rows;
}

async function addOverride({ frequency, periodKey, activityKey, assignedTo, reason }, userId) {
  const { rows } = await db.query(
    `INSERT INTO recurring_activity_overrides (frequency, period_key, activity_key, assigned_to, reason, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (frequency, period_key, activity_key) DO UPDATE
       SET assigned_to = EXCLUDED.assigned_to, reason = EXCLUDED.reason, created_by = EXCLUDED.created_by, created_at = NOW()
     RETURNING *`,
    [frequency, periodKey, activityKey, assignedTo, reason || null, userId]
  );
  return rows[0];
}

async function removeOverride(id) {
  const { rowCount } = await db.query('DELETE FROM recurring_activity_overrides WHERE id = $1', [id]);
  return rowCount > 0;
}

function overrideMap(overrides) {
  const m = new Map();
  for (const o of overrides) m.set(`${o.frequency}:${o.period_key}:${o.activity_key}`, o.assigned_to);
  return m;
}

// ---------------------------------------------------------------------------
// Rotation math — pure functions over a config + override map
// ---------------------------------------------------------------------------

function monthIndex(year, month) { return year * 12 + (month - 1); }

// Rotation advances on the 5th, not the 1st — before that, the previous
// calendar month's assignment is still "current".
function effectiveMonth(date) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  if (date.getDate() < 5) {
    return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
  }
  return { year: y, month: m };
}

function addMonths({ year, month }, n) {
  const idx = monthIndex(year, month) + n;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

function monthKey({ year, month }) { return `${year}-${String(month).padStart(2, '0')}`; }

function monthLabel({ year, month }) {
  return new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
}

function monthlyAssignee(activity, period, config) {
  const refIdx = monthIndex(config.monthlyReference.year, config.monthlyReference.month);
  const idx = monthIndex(period.year, period.month);
  if (idx < refIdx) return null; // before the tracker started
  const offset = ((idx - refIdx) % activity.order.length + activity.order.length) % activity.order.length;
  return activity.order[offset];
}

function mondayOf(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun..6=Sat
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

function addWeeks(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n * 7);
  return d;
}

function weekKey(monday) { return monday.toISOString().slice(0, 10); }

function weekLabel(monday) {
  return `Week of ${monday.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}`;
}

function weeklyAssignee(activity, monday, config) {
  const ref = mondayOf(new Date(`${config.weeklyReferenceMonday}T00:00:00`));
  const diffWeeks = Math.round((monday - ref) / (7 * 24 * 3600 * 1000));
  if (diffWeeks < 0) return null;
  const offset = ((diffWeeks % activity.order.length) + activity.order.length) % activity.order.length;
  return activity.order[offset];
}

function applyOverride(frequency, periodKey, activity, autoPick, overrides) {
  const key = `${frequency}:${periodKey}:${activity.key}`;
  return overrides.has(key) ? overrides.get(key) : autoPick;
}

function getMonthlySchedule(config, overrides, now = new Date()) {
  const eff = effectiveMonth(now);
  const periods = {
    last: addMonths(eff, -1), current: eff, next: addMonths(eff, 1), afterNext: addMonths(eff, 2),
  };
  const pick = (activity, period) => {
    const auto = monthlyAssignee(activity, period, config);
    return auto === null ? null : applyOverride('monthly', monthKey(period), activity, auto, overrides);
  };
  const rotating = (config.monthlyRotating || []).map(a => ({
    key: a.key, label: a.label, type: 'rotating',
    last: pick(a, periods.last), current: pick(a, periods.current),
    next: pick(a, periods.next), afterNext: pick(a, periods.afterNext),
  }));
  const shared = (config.monthlyShared || []).map(a => ({
    key: a.key, label: a.label, type: 'shared',
    last: a.owner, current: a.owner, next: a.owner, afterNext: a.owner,
  }));
  return {
    period: {
      last: monthLabel(periods.last), current: monthLabel(periods.current),
      next: monthLabel(periods.next), afterNext: monthLabel(periods.afterNext),
    },
    activities: [...rotating, ...shared],
  };
}

function getWeeklySchedule(config, overrides, now = new Date()) {
  const curMonday = mondayOf(now);
  const periods = {
    last: addWeeks(curMonday, -1), current: curMonday, next: addWeeks(curMonday, 1), afterNext: addWeeks(curMonday, 2),
  };
  const pick = (activity, monday) => {
    const auto = weeklyAssignee(activity, monday, config);
    return auto === null ? null : applyOverride('weekly', weekKey(monday), activity, auto, overrides);
  };
  const activities = (config.weeklyRotating || []).map(a => ({
    key: a.key, label: a.label, type: 'rotating',
    last: pick(a, periods.last), current: pick(a, periods.current),
    next: pick(a, periods.next), afterNext: pick(a, periods.afterNext),
  }));
  return {
    period: {
      last: weekLabel(periods.last), current: weekLabel(periods.current),
      next: weekLabel(periods.next), afterNext: weekLabel(periods.afterNext),
    },
    activities,
  };
}

// Simulates N periods from the reference point and counts how many times
// each team member is picked — the "48 assignments, perfectly even" table.
function computeWorkloadBalance(config, { months = 36, weeks = 156 } = {}) {
  const monthlyTotals = Object.fromEntries((config.team || []).map(p => [p, 0]));
  for (const a of config.monthlyRotating || []) {
    for (let i = 0; i < months; i++) {
      const person = a.order[i % a.order.length];
      if (person in monthlyTotals) monthlyTotals[person]++;
    }
  }
  const weeklyTotals = Object.fromEntries((config.team || []).map(p => [p, 0]));
  for (const a of config.weeklyRotating || []) {
    for (let i = 0; i < weeks; i++) {
      const person = a.order[i % a.order.length];
      if (person in weeklyTotals) weeklyTotals[person]++;
    }
  }
  return { monthly: monthlyTotals, weekly: weeklyTotals, months, weeks };
}

// ---------------------------------------------------------------------------
// Public read APIs
// ---------------------------------------------------------------------------

async function getReckoner(now = new Date()) {
  const { config } = await getConfig();
  const [monthlyOverrides, weeklyOverrides] = await Promise.all([
    listOverrides('monthly'), listOverrides('weekly'),
  ]);
  const overrides = overrideMap([...monthlyOverrides, ...weeklyOverrides]);
  return {
    today: now.toISOString().slice(0, 10),
    config,
    monthly: getMonthlySchedule(config, overrides, now),
    weekly: getWeeklySchedule(config, overrides, now),
    workloadBalance: computeWorkloadBalance(config),
    overrides: { monthly: monthlyOverrides, weekly: weeklyOverrides },
  };
}

// First-name based match against the logged-in user's name/email — the
// tracker only ever names first names, and there's no separate mapping
// table between team members and their system accounts.
function matchesTeamMember(user, memberName) {
  if (!user || !memberName) return false;
  const needle = memberName.toLowerCase();
  const name  = (user.name  || '').toLowerCase();
  const email = (user.email || '').toLowerCase();
  return name.split(/\s+/).includes(needle) || email.startsWith(needle) || email.includes(`.${needle}`) || email.includes(`${needle}.`);
}

// Only named team members get anything back — everyone else isn't part of
// this rotation, so there's nothing personal to show them.
async function getMyTasks(user, now = new Date()) {
  const { config } = await getConfig();
  const team = config.team || [];
  const isTeamMember = team.some(m => matchesTeamMember(user, m));

  const [monthlyOverrides, weeklyOverrides] = await Promise.all([
    listOverrides('monthly'), listOverrides('weekly'),
  ]);
  const overrides = overrideMap([...monthlyOverrides, ...weeklyOverrides]);

  const monthlySchedule = getMonthlySchedule(config, overrides, now);
  const weeklySchedule  = getWeeklySchedule(config, overrides, now);

  const mine = (activities) => isTeamMember
    ? activities.filter(a => a.type === 'shared' || matchesTeamMember(user, a.current))
    : [];

  return {
    isTeamMember,
    generatedAt: now.toISOString(),
    monthly: { period: monthlySchedule.period, activities: mine(monthlySchedule.activities) },
    weekly:  { period: weeklySchedule.period,  activities: mine(weeklySchedule.activities) },
  };
}

module.exports = {
  DEFAULT_CONFIG,
  getConfig, saveConfig,
  listOverrides, addOverride, removeOverride,
  getMonthlySchedule, getWeeklySchedule, computeWorkloadBalance,
  getReckoner, getMyTasks,
};
