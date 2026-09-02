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

module.exports = { listManualSections, updateManualSection };
