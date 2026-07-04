/**
 * macLookupService.js
 * -------------------
 * Store and index MAC-to-IP mapping files uploaded by users.
 * Matching is done by normalising MACs to 12-char lowercase hex.
 */

const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const ExcelJS = require('exceljs');

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'mac_mappings');

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// MAC normalisation
// ---------------------------------------------------------------------------

function normalizeMAC(mac) {
  if (!mac) return '';
  const hex = mac.replace(/[^0-9a-fA-F]/g, '');
  return hex.length === 12 ? hex.toLowerCase() : '';
}

// ---------------------------------------------------------------------------
// Column auto-detection
// ---------------------------------------------------------------------------

const COL_ALIASES = {
  mac:           ['mac address', 'mac_address', 'macaddress', 'mac', 'mac addr'],
  ip:            ['ip address', 'ip_address', 'ipaddress', 'ip', 'ip addr', 'mapped ip'],
  lan_segment:   ['lan segment', 'lan_segment', 'segment', 'network', 'subnet'],
  vlan_group:    ['vlan group', 'vlan_group', 'vlan', 'vlan name'],
  data_retrieved:['data retrieved', 'date retrieved', 'retrieved', 'timestamp',
                  'date', 'last updated', 'updated'],
};

function findCol(headers, key) {
  const aliases = COL_ALIASES[key] || [];
  for (const h of headers) {
    if (aliases.includes(h.toLowerCase().trim())) return h;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const nonEmpty = lines.filter(l => l.trim());
  if (nonEmpty.length < 2) return [];

  function splitLine(line) {
    const fields = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { fields.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    fields.push(cur.trim());
    return fields;
  }

  const headers = splitLine(nonEmpty[0]);
  return nonEmpty.slice(1).map(line => {
    const vals = splitLine(line);
    const row  = {};
    headers.forEach((h, i) => { row[h] = (vals[i] || '').trim(); });
    return row;
  });
}

async function parseXLSX(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const rows = [];
  let headers = null;
  ws.eachRow((row, rowNum) => {
    const vals = row.values.slice(1).map(v => (v == null ? '' : String(v).trim()));
    if (rowNum === 1) { headers = vals; return; }
    if (vals.every(v => !v)) return;
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
    rows.push(obj);
  });
  return rows;
}

async function parseFile(buffer, filename) {
  let rawRows = [];
  const ext = path.extname(filename).toLowerCase();

  if (ext === '.csv') {
    rawRows = parseCSV(buffer.toString('utf-8'));
  } else if (ext === '.xlsx' || ext === '.xls') {
    rawRows = await parseXLSX(buffer);
  } else {
    throw new Error(`Unsupported file type "${ext}". Use .csv or .xlsx`);
  }

  if (!rawRows.length) {
    return { rows: [], meta: { filename, row_count: 0, total_rows: 0, cols_detected: {} } };
  }

  const headers = Object.keys(rawRows[0]);
  const macCol  = findCol(headers, 'mac');
  const ipCol   = findCol(headers, 'ip');
  const lanCol  = findCol(headers, 'lan_segment');
  const vlanCol = findCol(headers, 'vlan_group');
  const dataCol = findCol(headers, 'data_retrieved');

  const normalised = [];
  for (const row of rawRows) {
    const macRaw = macCol ? (row[macCol] || '') : '';
    if (!macRaw) continue;
    const norm = normalizeMAC(macRaw);
    if (!norm) continue;
    normalised.push({
      mac_raw:        macRaw,
      mac_norm:       norm,
      ip_address:     ipCol   ? (row[ipCol]   || '') : '',
      lan_segment:    lanCol  ? (row[lanCol]  || '') : '',
      vlan_group:     vlanCol ? (row[vlanCol] || '') : '',
      data_retrieved: dataCol ? (row[dataCol] || '') : '',
    });
  }

  const meta = {
    filename,
    uploaded_at:   new Date().toISOString(),
    row_count:     normalised.length,
    total_rows:    rawRows.length,
    cols_detected: { mac: macCol, ip: ipCol, lan: lanCol, vlan: vlanCol, data: dataCol },
  };

  return { rows: normalised, meta };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function newFileId() {
  const ts  = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 15);
  const rnd = crypto.randomBytes(3).toString('hex');
  return `${ts}_${rnd}`;
}

function filePath(id) {
  return path.join(DATA_DIR, `${id}.json`);
}

function saveFile(rows, meta) {
  ensureDir();
  const id      = newFileId();
  const payload = { id, ...meta, rows };
  fs.writeFileSync(filePath(id), JSON.stringify(payload, null, 2), 'utf-8');
  return id;
}

function listFiles() {
  ensureDir();
  const files = [];
  for (const fname of fs.readdirSync(DATA_DIR)) {
    if (!fname.endsWith('.json')) continue;
    try {
      const raw  = fs.readFileSync(path.join(DATA_DIR, fname), 'utf-8');
      const data = JSON.parse(raw);
      files.push({
        id:            data.id || fname.replace('.json', ''),
        filename:      data.filename || fname,
        uploaded_at:   data.uploaded_at || '',
        row_count:     data.row_count   || 0,
        cols_detected: data.cols_detected || {},
      });
    } catch (_) { /* skip corrupt */ }
  }
  return files.sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
}

function loadAllRows() {
  ensureDir();
  const all = [];
  for (const fname of fs.readdirSync(DATA_DIR)) {
    if (!fname.endsWith('.json')) continue;
    try {
      const raw  = fs.readFileSync(path.join(DATA_DIR, fname), 'utf-8');
      const data = JSON.parse(raw);
      all.push(...(data.rows || []));
    } catch (_) { /* skip */ }
  }
  return all;
}

function buildIndex(rows) {
  const index = {};
  for (const r of rows) {
    const norm = r.mac_norm;
    if (norm && !index[norm]) index[norm] = r;
  }
  return index;
}

function deleteFile(id) {
  const p = filePath(id);
  if (!fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  return true;
}

function clearAll() {
  ensureDir();
  let count = 0;
  for (const fname of fs.readdirSync(DATA_DIR)) {
    if (fname.endsWith('.json')) {
      fs.unlinkSync(path.join(DATA_DIR, fname));
      count++;
    }
  }
  return count;
}

module.exports = {
  normalizeMAC,
  parseFile,
  saveFile,
  listFiles,
  loadAllRows,
  buildIndex,
  deleteFile,
  clearAll,
};
