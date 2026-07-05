const ExcelJS = require('exceljs');
const db = require('../config/db');
const deptSvc  = require('./departmentService');
const cryptoUtil = require('../utils/crypto');

const COLUMN_ALIASES = {
  vm_name: ['vm name', 'vmname', 'name', 'hostname (vm)'],
  os_hostname: ['os hostname', 'hostname', 'host name'],
  ip_address: ['ip address', 'ip', 'ipv4'],
  asset_type: ['asset type', 'type'],
  os_type: ['os type', 'operating system', 'os'],
  os_version: ['os version', 'version'],
  assigned_user: ['assigned user', 'owner', 'assigned to'],
  department: ['department', 'dept', 'team'],
  business_purpose: ['business purpose', 'purpose'],
  server_status: ['server status', 'status'],
  patching_type: ['patching type'],
  server_patch_type: ['server patch type'],
  patching_schedule: ['patching schedule', 'patch schedule'],
  location: ['location', 'site', 'data center', 'datacenter'],
  eol_status: ['eol status', 'eol', 'end of life'],
  serial_number: ['serial number', 'serial', 'sn'],
  ome_status: ['ome status', 'ome'],
  hosted_ip: ['hosted ip'],
  asset_tag: ['asset tag', 'tag'],
  asset_username: ['asset username', 'username'],
  asset_password: ['asset password', 'password'],
  additional_remarks: ['additional remarks', 'remarks', 'notes', 'comments'],
  manage_engine_installed: ['manageengine installed', 'manage engine installed', 'manageengine', 'me'],
  tenable_installed: ['tenable installed', 'tenable'],
  idrac_enabled: ['idrac enabled', 'idrac'],
};

const EOL_ALIASES = {
  insupport: 'Supported',  in_support: 'Supported',  supported: 'Supported',
  eol: 'EOL',  decom: 'Decommissioned',  decommissioned: 'Decommissioned',
  'not applicable': 'Not Applicable',  na: 'Not Applicable',  'n/a': 'Not Applicable',
};

const IP_RE = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
const BOOL_COLS = new Set(['manage_engine_installed', 'tenable_installed', 'idrac_enabled']);

function normalize(s) {
  return String(s || '').replace(/\*/g, '').replace(/[_\-\s]+/g, ' ').trim().toLowerCase();
}

function parseBool(v) {
  if (v === true || v === false) return v;
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim().toLowerCase();
  if (['true', 'yes', 'y', '1'].includes(s)) return true;
  if (['false', 'no', 'n', '0'].includes(s)) return false;
  return null;
}

function cellValue(cell) {
  if (!cell || cell.value === null || cell.value === undefined) return '';
  const v = cell.value;
  if (typeof v === 'object' && v !== null) {
    if ('text' in v) return v.text;
    if ('result' in v) return v.result;
    if ('richText' in v) return v.richText.map(p => p.text).join('');
  }
  if (typeof v === 'string') return v.trim();
  return v;
}

function buildHeaderMap(ws, allowedCols) {
  const map = {};
  ws.getRow(1).eachCell((cell, col) => {
    const txt = normalize(cellValue(cell));
    for (const key of allowedCols) {
      const aliases = COLUMN_ALIASES[key] || [key.replace(/_/g, ' ')];
      if (aliases.includes(txt) || normalize(key) === txt) {
        map[col] = key;
        break;
      }
    }
  });
  return map;
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { q = false; }
      else cur += ch;
    } else {
      if (ch === ',') { out.push(cur); cur = ''; }
      else if (ch === '"') q = true;
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function isCsv(buffer) {
  const head = buffer.slice(0, 4).toString('utf8');
  return !(head.charCodeAt(0) === 0x50 && head.charCodeAt(1) === 0x4B); // not zip/xlsx
}

function postProcessRow(r) {
  for (const b of BOOL_COLS) {
    if (r[b] !== undefined && r[b] !== '') r[b] = parseBool(r[b]);
  }
  // Exports mask stored passwords as bullet dots — never import the mask.
  if (r.asset_password && /^[•*]+$/.test(String(r.asset_password).trim())) {
    delete r.asset_password;
  }
  if (r.eol_status) {
    const key = normalize(r.eol_status).replace(/\s+/g, ' ');
    const mapped = EOL_ALIASES[key] || EOL_ALIASES[key.replace(/\s/g, '')];
    if (mapped) r.eol_status = mapped;
  }
}

async function parseCsv(buffer, allowedCols) {
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(l => l.length);
  if (!lines.length) return { rows: [], headerMap: {} };
  const headers = splitCsvLine(lines[0]);
  const headerMap = {};
  headers.forEach((h, i) => {
    const txt = normalize(h);
    for (const key of allowedCols) {
      const aliases = COLUMN_ALIASES[key] || [key.replace(/_/g, ' ')];
      if (aliases.includes(txt) || normalize(key) === txt) { headerMap[i + 1] = key; break; }
    }
  });
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const r = {};
    cells.forEach((v, idx) => {
      const k = headerMap[idx + 1];
      if (!k) return;
      r[k] = typeof v === 'string' ? v.trim() : v;
    });
    if (!Object.keys(r).some(k => r[k] !== '' && r[k] !== null && r[k] !== undefined)) continue;
    postProcessRow(r);
    rows.push({ rowIdx: i + 1, data: r });
  }
  return { rows, headerMap };
}

async function parseXlsx(buffer, allowedCols) {
  const wb = await new ExcelJS.Workbook().xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], headerMap: {} };
  const headerMap = buildHeaderMap(ws, allowedCols);
  const rows = [];
  for (let i = 2; i <= ws.rowCount; i++) {
    const r = {};
    ws.getRow(i).eachCell((cell, col) => {
      const k = headerMap[col];
      if (!k) return;
      let v = cellValue(cell);
      if (typeof v === 'string') v = v.trim();
      r[k] = v;
    });
    if (!Object.keys(r).some(k => r[k] !== '' && r[k] !== null && r[k] !== undefined)) continue;
    postProcessRow(r);
    rows.push({ rowIdx: i, data: r });
  }
  return { rows, headerMap };
}

async function parseSheet(buffer, allowedCols) {
  if (isCsv(buffer)) return parseCsv(buffer, allowedCols);
  return parseXlsx(buffer, allowedCols);
}

function isEmpty(v) {
  return v === null || v === undefined || v === '' || (typeof v === 'string' && !v.trim());
}

// ASSET_COLUMNS excludes asset_password (the DB column is
// asset_password_encrypted, handled by mapBody) — but imports must still be
// able to carry it, so treat it as an always-importable virtual column.
function withPassword(cols) {
  return cols.includes('asset_password') ? cols : [...cols, 'asset_password'];
}

function diffFillOnlyEmpty(existing, incoming, cols) {
  const updates = {};
  const diffs = [];
  for (const c of cols) {
    if (incoming[c] === undefined || incoming[c] === null || incoming[c] === '') continue;
    if (BOOL_COLS.has(c)) {
      if (existing[c] === null || existing[c] === undefined) {
        if (incoming[c] !== null) {
          updates[c] = incoming[c];
          diffs.push({ field: c, from: existing[c], to: incoming[c] });
        }
      }
    } else if (c === 'asset_password') {
      // The DB row stores asset_password_encrypted, not asset_password —
      // only fill when no password is stored yet, never overwrite one.
      if (isEmpty(existing.asset_password_encrypted)) {
        updates[c] = incoming[c];
        diffs.push({ field: c, from: '', to: '••••••••' });
      }
    } else if (isEmpty(existing[c])) {
      updates[c] = incoming[c];
      diffs.push({ field: c, from: existing[c] ?? '', to: incoming[c] });
    }
  }
  return { updates, diffs };
}

// If the source DB stored asset_password already encrypted with our key,
// decrypt it first so mapBody doesn't double-encrypt it.
function resolveAssetPassword(raw) {
  if (raw === null || raw === undefined || raw === '') return raw;
  try {
    const decrypted = cryptoUtil.decrypt(String(raw));
    if (decrypted) return decrypted;
  } catch (_) {}
  return raw;
}

async function findByIp(table, ip) {
  if (!ip) return null;
  const { rows } = await db.query(
    `SELECT * FROM ${table} WHERE ip_address = $1 AND deleted_at IS NULL LIMIT 1`, [ip]
  );
  return rows[0] || null;
}

async function preview(buffer, { table, cols, verifyByIp }) {
  cols = withPassword(cols);
  const { rows } = await parseSheet(buffer, cols);
  const out = [];
  for (const r of rows) {
    const d = r.data;
    const errors = [];
    if (!d.vm_name) errors.push('VM Name is required');
    if (!d.ip_address) errors.push('IP Address is required');
    if (d.ip_address && !IP_RE.test(String(d.ip_address).trim())) errors.push('Invalid IP Address');

    let action = 'create';
    let existing = null;
    let diffs = [];
    let updates = {};

    if (verifyByIp && d.ip_address && !errors.length) {
      existing = await findByIp(table, d.ip_address);
      if (existing) {
        action = 'merge';
        const r = diffFillOnlyEmpty(existing, d, cols);
        updates = r.updates;
        diffs = r.diffs;
      } else {
        const otherTable = await deptSvc.isValueUsedAnywhere('ip_address', d.ip_address, { excludeTable: table });
        if (otherTable) {
          errors.push(`IP already exists in "${otherTable}" inventory — cannot import into "${table}"`);
        }
      }
    }

    out.push({
      rowIdx: r.rowIdx,
      data: d,
      action,                                  // 'create' | 'merge' | 'skip'
      existingId: existing?.id || null,
      existingSnapshot: existing
        ? Object.fromEntries(cols.filter(c => existing[c] !== undefined).map(c => [c, existing[c]]))
        : null,
      diffs,
      updates,
      errors,
    });
  }
  return { rows: out };
}

async function apply(buffer, { table, cols, verifyByIp, selectedRowIdxs, createFn, updateRowDirect }, user) {
  const preview = await module.exports.preview(buffer, { table, cols, verifyByIp });
  const sel = selectedRowIdxs && selectedRowIdxs.length
    ? new Set(selectedRowIdxs.map(Number))
    : null;
  const successes = [];
  const failures = [];
  for (const r of preview.rows) {
    if (sel && !sel.has(r.rowIdx)) continue;
    if (r.errors.length) {
      failures.push({ row: r.rowIdx, errors: r.errors, data: r.data });
      continue;
    }
    try {
      if (r.action === 'merge' && r.existingId) {
        if (!Object.keys(r.updates).length) {
          successes.push({ row: r.rowIdx, id: r.existingId, action: 'noop' });
          continue;
        }
        const mergePayload = { ...r.updates };
        if (mergePayload.asset_password !== undefined) {
          mergePayload.assetPassword = resolveAssetPassword(mergePayload.asset_password);
          delete mergePayload.asset_password;
        }
        await updateRowDirect(r.existingId, mergePayload, user?.id);
        successes.push({ row: r.rowIdx, id: r.existingId, action: 'merged', filled: Object.keys(r.updates) });
      } else {
        const payload = { ...r.data };
        if (payload.asset_password !== undefined) {
          payload.assetPassword = resolveAssetPassword(payload.asset_password);
          delete payload.asset_password;
        }
        const created = await createFn(payload, user?.id);
        successes.push({ row: r.rowIdx, id: created.id, action: 'created' });
      }
    } catch (e) {
      let msg = e.message || 'Failed to save';
      if (e.status === 409 && e.details) {
        const detail = Object.values(e.details)[0];
        if (detail) msg = detail;
      }
      failures.push({ row: r.rowIdx, errors: [msg], details: e.details, data: r.data });
    }
  }
  return {
    total: preview.rows.length,
    selected: sel ? sel.size : preview.rows.length,
    success: successes.length,
    failed: failures.length,
    successes,
    failures,
  };
}

// Accepts pre-parsed rows [{rowIdx, data}] — used by DB import (skips file parsing)
async function previewRows(mappedRows, { table, cols, verifyByIp }) {
  cols = withPassword(cols);
  const out = [];
  for (const r of mappedRows) {
    const d = r.data;
    const errors = [];
    if (!d.vm_name)    errors.push('VM Name is required');
    if (!d.ip_address) errors.push('IP Address is required');
    if (d.ip_address && !IP_RE.test(String(d.ip_address).trim())) errors.push('Invalid IP Address');

    let action = 'create';
    let existing = null;
    let diffs = [];
    let updates = {};

    if (verifyByIp && d.ip_address && !errors.length) {
      existing = await findByIp(table, d.ip_address);
      if (existing) {
        action = 'merge';
        const res = diffFillOnlyEmpty(existing, d, cols);
        updates = res.updates;
        diffs   = res.diffs;
      } else {
        // Check cross-inventory tables — create would fail if IP exists elsewhere
        const otherTable = await deptSvc.isValueUsedAnywhere('ip_address', d.ip_address, { excludeTable: table });
        if (otherTable) {
          errors.push(`IP already exists in "${otherTable}" inventory — cannot import into "${table}"`);
        }
      }
    }

    out.push({
      rowIdx: r.rowIdx,
      data: d,
      action,
      existingId: existing?.id || null,
      existingSnapshot: existing
        ? Object.fromEntries(cols.filter(c => existing[c] !== undefined).map(c => [c, existing[c]]))
        : null,
      diffs,
      updates,
      errors,
    });
  }
  return { rows: out };
}

async function applyRows(mappedRows, { table, cols, verifyByIp, selectedRowIdxs, createFn, updateRowDirect }, user) {
  const prev = await previewRows(mappedRows, { table, cols, verifyByIp });
  const sel  = selectedRowIdxs?.length ? new Set(selectedRowIdxs.map(Number)) : null;
  const successes = [];
  const failures  = [];
  for (const r of prev.rows) {
    if (sel && !sel.has(r.rowIdx)) continue;
    if (r.errors.length) { failures.push({ row: r.rowIdx, errors: r.errors, data: r.data }); continue; }
    try {
      if (r.action === 'merge' && r.existingId) {
        if (!Object.keys(r.updates).length) {
          successes.push({ row: r.rowIdx, id: r.existingId, action: 'noop' }); continue;
        }
        const mergePayload = { ...r.updates };
        if (mergePayload.asset_password !== undefined) {
          mergePayload.assetPassword = resolveAssetPassword(mergePayload.asset_password);
          delete mergePayload.asset_password;
        }
        await updateRowDirect(r.existingId, mergePayload, user?.id);
        successes.push({ row: r.rowIdx, id: r.existingId, action: 'merged', filled: Object.keys(r.updates) });
      } else {
        const payload = { ...r.data };
        if (payload.asset_password !== undefined) {
          payload.assetPassword = resolveAssetPassword(payload.asset_password);
          delete payload.asset_password;
        }
        const created = await createFn(payload, user?.id);
        successes.push({ row: r.rowIdx, id: created.id, action: 'created' });
      }
    } catch (e) {
      // Surface the specific duplicate field instead of "Duplicate values"
      let msg = e.message || 'Failed to save';
      if (e.status === 409 && e.details) {
        const detail = Object.values(e.details)[0];
        if (detail) msg = detail;
      }
      failures.push({ row: r.rowIdx, errors: [msg], details: e.details, data: r.data });
    }
  }
  return {
    total: prev.rows.length,
    selected: sel ? sel.size : prev.rows.length,
    success: successes.length,
    failed:  failures.length,
    successes,
    failures,
  };
}

module.exports = { preview, apply, parseSheet, previewRows, applyRows };
