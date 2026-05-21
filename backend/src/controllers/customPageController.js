const ExcelJS = require('exceljs');
const db = require('../config/db');
const ApiError = require('../utils/ApiError');
const audit = require('../services/auditService');

function slugify(s) {
  return String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

async function list(_req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT cp.*, COALESCE(json_agg(cpf.* ORDER BY cpf.sort_order) FILTER (WHERE cpf.id IS NOT NULL), '[]') AS fields
         FROM custom_pages cp
         LEFT JOIN custom_page_fields cpf ON cpf.page_id = cp.id
        WHERE cp.is_active = TRUE
        GROUP BY cp.id
        ORDER BY cp.created_at ASC`
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
}

async function get(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT cp.*, COALESCE(json_agg(cpf.* ORDER BY cpf.sort_order) FILTER (WHERE cpf.id IS NOT NULL), '[]') AS fields
         FROM custom_pages cp
         LEFT JOIN custom_page_fields cpf ON cpf.page_id = cp.id
        WHERE cp.id::text = $1 OR cp.slug = $1
        GROUP BY cp.id`,
      [req.params.id]
    );
    if (!rows.length) throw new ApiError(404, 'Page not found');
    res.json(rows[0]);
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  const client = await db.getClient();
  try {
    const { name, description, icon, fields } = req.body;
    if (!name) throw new ApiError(400, 'name is required');
    if (!Array.isArray(fields) || !fields.length) throw new ApiError(400, 'At least one field is required');

    await client.query('BEGIN');
    const slug = slugify(name);
    const page = await client.query(
      `INSERT INTO custom_pages (name, slug, description, icon, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, slug, description || null, icon || null, req.user.id]
    );

    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (!f.label || !f.field_type) throw new ApiError(400, `Field #${i+1} requires label and field_type`);
      const key = slugify(f.field_key || f.label).replace(/-/g, '_');
      const section = (f.section && String(f.section).trim()) || 'General';
      await client.query(
        `INSERT INTO custom_page_fields (page_id, field_key, label, field_type, options, is_required, sort_order, section)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [page.rows[0].id, key, f.label, f.field_type, f.options ? JSON.stringify(f.options) : null, !!f.is_required, i, section]
      );
    }
    await client.query('COMMIT');
    await audit.log({ user: req.user, action: 'CREATE', entityType: 'custom_page', entityId: page.rows[0].id, details: { name }, ipAddress: req.ip });
    res.status(201).json(page.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return next(new ApiError(409, 'Page name already exists'));
    next(e);
  } finally { client.release(); }
}

async function update(req, res, next) {
  try {
    const { name, description, icon, is_active } = req.body;
    const { rows } = await db.query(
      `UPDATE custom_pages
          SET name        = COALESCE($1, name),
              slug        = COALESCE($2, slug),
              description = COALESCE($3, description),
              icon        = COALESCE($4, icon),
              is_active   = COALESCE($5, is_active)
        WHERE id = $6
        RETURNING *`,
      [
        name ?? null,
        name ? slugify(name) : null,
        description ?? null,
        icon ?? null,
        typeof is_active === 'boolean' ? is_active : null,
        req.params.id,
      ]
    );
    if (!rows.length) throw new ApiError(404, 'Page not found');
    await audit.log({ user: req.user, action: 'UPDATE', entityType: 'custom_page', entityId: rows[0].id, details: { name: rows[0].name }, ipAddress: req.ip });
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return next(new ApiError(409, 'Page name already exists'));
    next(e);
  }
}

async function remove(req, res, next) {
  try {
    const { rowCount } = await db.query(`DELETE FROM custom_pages WHERE id = $1`, [req.params.id]);
    if (!rowCount) throw new ApiError(404, 'Not found');
    await audit.log({ user: req.user, action: 'DELETE', entityType: 'custom_page', entityId: req.params.id, ipAddress: req.ip });
    res.status(204).end();
  } catch (e) { next(e); }
}

async function listRecords(req, res, next) {
  try {
    const page = Number(req.query.page) || 1;
    const pageSize = Math.min(Number(req.query.pageSize) || 50, 500);
    const offset = (page - 1) * pageSize;
    const [items, count] = await Promise.all([
      db.query(
        `SELECT id, data, created_at, updated_at FROM custom_page_records
          WHERE page_id = $1 AND deleted_at IS NULL
          ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [req.params.id, pageSize, offset]
      ),
      db.query(
        `SELECT COUNT(*)::int AS c FROM custom_page_records
          WHERE page_id = $1 AND deleted_at IS NULL`,
        [req.params.id]
      ),
    ]);
    res.json({ items: items.rows, total: count.rows[0].c, page, pageSize });
  } catch (e) { next(e); }
}

async function createRecord(req, res, next) {
  try {
    const { rows } = await db.query(
      `INSERT INTO custom_page_records (page_id, data, created_by, updated_by)
       VALUES ($1,$2,$3,$3) RETURNING *`,
      [req.params.id, JSON.stringify(req.body.data || {}), req.user.id]
    );
    await audit.log({ user: req.user, action: 'CREATE', entityType: 'custom_page_record', entityId: rows[0].id, ipAddress: req.ip });
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
}

async function updateRecord(req, res, next) {
  try {
    const { rows } = await db.query(
      `UPDATE custom_page_records SET data = $1, updated_by = $2
        WHERE id = $3 AND page_id = $4 RETURNING *`,
      [JSON.stringify(req.body.data || {}), req.user.id, req.params.recordId, req.params.id]
    );
    if (!rows.length) throw new ApiError(404, 'Record not found');
    await audit.log({ user: req.user, action: 'UPDATE', entityType: 'custom_page_record', entityId: rows[0].id, ipAddress: req.ip });
    res.json(rows[0]);
  } catch (e) { next(e); }
}

async function deleteRecord(req, res, next) {
  try {
    const { verifyCurrentPassword } = require('../utils/verifyPassword');
    await verifyCurrentPassword(req.user.id, req.body?.password);
    const { rowCount } = await db.query(
      `UPDATE custom_page_records
          SET deleted_at = NOW(), deleted_by = $3
        WHERE id = $1 AND page_id = $2 AND deleted_at IS NULL`,
      [req.params.recordId, req.params.id, req.user.id]
    );
    if (!rowCount) throw new ApiError(404, 'Record not found');
    await audit.log({ user: req.user, action: 'DELETE', entityType: 'custom_page_record', entityId: req.params.recordId, ipAddress: req.ip });
    res.status(204).end();
  } catch (e) { next(e); }
}

function parseBool(v) {
  if (v === true || v === false) return v;
  if (v === null || v === undefined || v === '') return false;
  const s = String(v).trim().toLowerCase();
  return ['true', 'yes', 'y', '1'].includes(s);
}

function styleHeader(ws) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.alignment = { vertical: 'middle', horizontal: 'center' };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3A8A' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF999999' } } };
  });
  row.height = 22;
}

async function getPageWithFields(id) {
  const { rows } = await db.query(
    `SELECT cp.*, COALESCE(json_agg(cpf.* ORDER BY cpf.sort_order) FILTER (WHERE cpf.id IS NOT NULL), '[]') AS fields
       FROM custom_pages cp
       LEFT JOIN custom_page_fields cpf ON cpf.page_id = cp.id
      WHERE cp.id::text = $1 OR cp.slug = $1
      GROUP BY cp.id`,
    [id]
  );
  return rows[0] || null;
}

async function downloadTemplate(req, res, next) {
  try {
    const page = await getPageWithFields(req.params.id);
    if (!page) throw new ApiError(404, 'Page not found');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Records');
    ws.columns = page.fields.map(f => ({
      header: `${f.label}${f.is_required ? ' *' : ''}`,
      key: f.field_key,
      width: Math.max(16, f.label.length + 4),
    }));
    styleHeader(ws);
    // Example row to guide users
    const example = {};
    page.fields.forEach((f) => {
      switch (f.field_type) {
        case 'toggle': example[f.field_key] = 'FALSE'; break;
        case 'date':   example[f.field_key] = '2026-01-15'; break;
        case 'number': example[f.field_key] = 0; break;
        default:       example[f.field_key] = `Example ${f.label}`;
      }
    });
    ws.addRow(example);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${page.slug}-template.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { next(e); }
}

async function importRecords(req, res, next) {
  try {
    if (!req.file) throw new ApiError(400, 'No file uploaded');
    const page = await getPageWithFields(req.params.id);
    if (!page) throw new ApiError(404, 'Page not found');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new ApiError(400, 'No worksheet found');

    // Build header → field_key map by matching label or field_key.
    const headerMap = {};
    ws.getRow(1).eachCell((cell, col) => {
      const text = String(cell.value || '').replace(/\s*\*\s*$/, '').trim().toLowerCase();
      const f = page.fields.find(
        f => f.label.toLowerCase() === text || f.field_key.toLowerCase() === text,
      );
      if (f) headerMap[col] = f;
    });

    const total = Math.max(0, ws.rowCount - 1);
    const successes = [];
    const failures = [];

    for (let i = 2; i <= ws.rowCount; i++) {
      const data = {};
      ws.getRow(i).eachCell((cell, col) => {
        const f = headerMap[col];
        if (!f) return;
        let v = cell.value;
        if (v && typeof v === 'object' && 'text' in v) v = v.text;
        if (typeof v === 'string') v = v.trim();
        if (f.field_type === 'toggle') v = parseBool(v);
        else if (f.field_type === 'number' && v !== null && v !== undefined && v !== '') v = Number(v);
        else if (f.field_type === 'date' && v) v = new Date(v).toISOString();
        data[f.field_key] = v;
      });
      if (!Object.keys(data).length) continue;

      const missing = page.fields.filter(f => f.is_required && (data[f.field_key] === undefined || data[f.field_key] === null || data[f.field_key] === ''));
      if (missing.length) {
        failures.push({ row: i, errors: missing.map(f => `${f.label} is required`) });
        continue;
      }

      try {
        const { rows } = await db.query(
          `INSERT INTO custom_page_records (page_id, data, created_by, updated_by)
           VALUES ($1,$2,$3,$3) RETURNING id`,
          [page.id, JSON.stringify(data), req.user.id]
        );
        successes.push({ row: i, id: rows[0].id });
      } catch (e) {
        failures.push({ row: i, errors: [e.message] });
      }
    }

    await db.query(
      `INSERT INTO import_logs (filename, total_rows, success_rows, failed_rows, error_details, imported_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [req.file.originalname || 'upload.xlsx', total, successes.length, failures.length, JSON.stringify(failures), req.user?.id || null]
    );

    await audit.log({
      user: req.user,
      action: 'IMPORT',
      entityType: 'custom_page_record',
      entityId: page.id,
      details: { page: page.name, total, success: successes.length, failed: failures.length },
      ipAddress: req.ip,
    });

    res.json({ total, success: successes.length, failed: failures.length, failures, successes });
  } catch (e) { next(e); }
}

module.exports = {
  list, get, create, update, remove,
  listRecords, createRecord, updateRecord, deleteRecord,
  downloadTemplate, importRecords,
};
