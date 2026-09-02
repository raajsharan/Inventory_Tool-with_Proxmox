/**
 * weeklyReportManualService.js
 * ------------------------------
 * Plain CRUD over weekly_report_manual_sections — the narrative/manual
 * content (BAU activities, SOP count, licenses, migration challenges, etc.)
 * that has no other source in this app. Seeded with one row per known
 * section by ensureSchema.js.
 */
const db = require('../config/db');

async function listManualSections() {
  const { rows } = await db.query(
    `SELECT section_key, title, sort_order, content, updated_at
       FROM weekly_report_manual_sections
      ORDER BY sort_order`,
  );
  return rows;
}

async function updateManualSection(sectionKey, content, userId) {
  const { rows } = await db.query(
    `UPDATE weekly_report_manual_sections
        SET content = $2, updated_by = $3, updated_at = NOW()
      WHERE section_key = $1
      RETURNING section_key, title, sort_order, content, updated_at`,
    [sectionKey, content ?? null, userId || null],
  );
  return rows[0] || null;
}

function slugify(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50) || 'section';
}

// Custom rows a user adds always land after every existing row (auto
// sections included — their sort_order tops out at 110 in
// weeklyReportAutoService.js) so a fresh row never silently jumps ahead of
// content someone is already relying on the position of.
async function createManualSection(title, content, userId) {
  const baseKey = slugify(title);
  let sectionKey = baseKey;
  for (let i = 2; ; i++) {
    const { rows } = await db.query(
      `SELECT 1 FROM weekly_report_manual_sections WHERE section_key = $1`,
      [sectionKey],
    );
    if (!rows.length) break;
    sectionKey = `${baseKey}_${i}`;
  }
  const { rows } = await db.query(
    `INSERT INTO weekly_report_manual_sections (section_key, title, sort_order, content, updated_by)
     VALUES ($1, $2, COALESCE((SELECT MAX(sort_order) FROM weekly_report_manual_sections), 150) + 10, $3, $4)
     RETURNING section_key, title, sort_order, content, updated_at`,
    [sectionKey, title, content ?? null, userId || null],
  );
  return rows[0];
}

async function deleteManualSection(sectionKey) {
  const { rows } = await db.query(
    `DELETE FROM weekly_report_manual_sections WHERE section_key = $1 RETURNING section_key`,
    [sectionKey],
  );
  return !!rows[0];
}

module.exports = { listManualSections, updateManualSection, createManualSection, deleteManualSection };
