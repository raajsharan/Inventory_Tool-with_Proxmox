import { useEffect, useMemo, useState } from 'react';
import { Alert, App, Button, Card, Checkbox, Empty, Input, Popconfirm, Segmented, Select, Space, Spin, Table, Tag, Typography } from 'antd';
import { DeleteOutlined, DownloadOutlined, ReloadOutlined, SaveOutlined, SwapOutlined } from '@ant-design/icons';
import api from '../../api/client';

const { Text } = Typography;

const FIELD_LABELS = {
  vm_name: 'VM Name', os_hostname: 'Hostname', ip_address: 'IP Address', os_type: 'Operating System',
  department: 'Department', location: 'Location', server_status: 'Status', patching_type: 'Patching Type',
  eol_status: 'EOL Status', asset_type: 'Asset Type', asset_tag: 'Asset Tag', assigned_user: 'Assigned User',
  serial_number: 'Serial Number', source: 'Inventory',
};
const VALUE_LABELS = { count: 'Count', pct: '% of all', rowpct: '% of row' };

// Same grouping as the server export (WEEKLY_REPORT_CONFIG.md 6.3).
function pivot(rows, rowKey, colKey) {
  const grid = {}; const rowTot = {}; const colTot = {}; let grand = 0;
  for (const r of rows) {
    const a = r[rowKey] || '(blank)';
    const b = colKey ? (r[colKey] || '(blank)') : 'Assets';
    grid[`${a}||${b}`] = (grid[`${a}||${b}`] || 0) + 1;
    rowTot[a] = (rowTot[a] || 0) + 1; colTot[b] = (colTot[b] || 0) + 1; grand++;
  }
  return {
    grid, rowTot, colTot, grand,
    rowVals: Object.keys(rowTot).sort((x, y) => rowTot[y] - rowTot[x]),
    colVals: Object.keys(colTot).sort(),
  };
}

function Pivot({ rows, rowKey, colKey, value }) {
  const g = useMemo(() => pivot(rows, rowKey, colKey), [rows, rowKey, colKey]);
  const max = useMemo(() => Math.max(1, ...Object.values(g.grid)), [g]);
  const show = (n, base) => (value === 'pct' ? `${((n / (g.grand || 1)) * 100).toFixed(1)}%`
    : value === 'rowpct' ? `${((n / (base || 1)) * 100).toFixed(1)}%` : n.toLocaleString());

  if (!g.grand) return <Empty description="No assets" />;
  const columns = [
    { title: FIELD_LABELS[rowKey] || rowKey, dataIndex: 'k', fixed: 'left', render: v => <strong>{v}</strong> },
    ...g.colVals.map(b => ({
      title: b, key: b, align: 'center',
      onCell: (r) => {
        const n = g.grid[`${r.k}||${b}`] || 0;
        return { style: n ? { background: `rgba(22,119,255,${(0.08 + 0.4 * (n / max)).toFixed(2)})` } : {} };
      },
      render: (_, r) => { const n = g.grid[`${r.k}||${b}`] || 0; return n ? show(n, g.rowTot[r.k]) : ''; },
    })),
    { title: 'Total', key: '__t', align: 'center', render: (_, r) => <strong>{g.rowTot[r.k].toLocaleString()}</strong> },
  ];
  return (
    <Table
      size="small" rowKey="k" pagination={false} scroll={{ x: 'max-content' }} columns={columns}
      dataSource={g.rowVals.map(k => ({ k }))}
      summary={() => (
        <Table.Summary.Row style={{ fontWeight: 700 }}>
          <Table.Summary.Cell index={0}>Total</Table.Summary.Cell>
          {g.colVals.map((b, i) => <Table.Summary.Cell key={b} index={i + 1} align="center">{g.colTot[b].toLocaleString()}</Table.Summary.Cell>)}
          <Table.Summary.Cell index={g.colVals.length + 1} align="center">{g.grand.toLocaleString()}</Table.Summary.Cell>
        </Table.Summary.Row>
      )}
    />
  );
}

function DetailTable({ t }) {
  return (
    <Card size="small" title={`${t.title}${t.rows.length ? ` (${t.rows.length.toLocaleString()})` : ''}`}>
      <Table
        size="small" rowKey={(_, i) => i} dataSource={t.rows} scroll={{ x: 'max-content' }}
        pagination={{ pageSize: 25, showSizeChanger: false, hideOnSinglePage: true }}
        columns={t.columns.map(c => ({
          title: c.label || FIELD_LABELS[c.key] || c.key, dataIndex: c.key, width: c.width,
          sorter: c.sortable ? (a, b) => String(a[c.key] ?? '').localeCompare(String(b[c.key] ?? '')) : undefined,
          render: c.format === 'tag' ? (v) => (v ? <Tag>{v}</Tag> : null) : undefined,
        }))}
      />
    </Card>
  );
}

export default function PivotBuilder() {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [opts, setOpts] = useState(null);
  const [rows, setRows] = useState([]);
  const [details, setDetails] = useState([]);
  const [views, setViews] = useState([]);
  const [rowKey, setRowKey] = useState(null);
  const [colKey, setColKey] = useState('');
  const [value, setValue] = useState('count');
  const [includeDecom, setIncludeDecom] = useState(false);
  const [filters, setFilters] = useState([]);   // [{ field, values }]
  const [viewName, setViewName] = useState('');
  const [busy, setBusy] = useState(false);

  const loadData = (decom) => api.get('/weekly-report/pivot-data', { params: { includeDecom: decom } })
    .then(r => { setRows(r.data.rows || []); return r.data.options; });

  useEffect(() => {
    Promise.all([
      loadData(false), api.get('/weekly-report/detail-tables'), api.get('/weekly-report/views'),
    ]).then(([o, d, v]) => {
      setOpts(o); setRowKey(o.default_rows); setColKey(o.default_cols || '');
      setDetails(d.data.tables || []); setViews(v.data || []);
    }).catch(e => message.error(e.response?.data?.error || 'Failed to load pivot'))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line

  // Filters: keep only assets whose value is among the chosen ones (AND across fields).
  const blank = (v) => (v === null || v === undefined || String(v).trim() === '' ? '(blank)' : String(v));
  const activeFilters = filters.filter(f => f.values.length);
  const shown = useMemo(
    () => (activeFilters.length ? rows.filter(r => activeFilters.every(f => f.values.includes(blank(r[f.field])))) : rows),
    [rows, filters], // eslint-disable-line
  );
  const valuesFor = (field) => [...new Set(rows.map(r => blank(r[field])))].sort();
  const setFilter = (field, values) => setFilters(fs => fs.map(f => (f.field === field ? { ...f, values } : f)));

  const fieldOpts = (opts?.row_fields || []).map(k => ({ value: k, label: FIELD_LABELS[k] || k }));
  // Rows and Columns on the same field make no sense — Columns falls back to None.
  const pickRows = (k) => { setRowKey(k); if (k === colKey) setColKey(''); };
  const pickCols = (k) => setColKey(k === rowKey ? '' : (k || ''));
  const swap = () => { if (!colKey) return; setRowKey(colKey); setColKey(rowKey); };
  const reset = () => { setRowKey(opts.default_rows); setColKey(opts.default_cols || ''); setValue('count'); setFilters([]); toggleDecom(false); };

  const toggleDecom = (v) => { setIncludeDecom(v); loadData(v).catch(() => message.error('Failed to reload')); };

  const exportFile = async (format) => {
    setBusy(true);
    try {
      const params = { format, ...(opts.allow_pivot ? { rows: rowKey, cols: colKey, value, includeDecom, filters: JSON.stringify(activeFilters) } : {}) };
      const res = await api.get('/weekly-report/export', { params, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = `weekly-report.${format}`; a.click();
      URL.revokeObjectURL(url);
    } catch { message.error('Export failed'); } finally { setBusy(false); }
  };

  const saveView = async () => {
    try {
      const { data } = await api.post('/weekly-report/views', {
        name: viewName, view_config: { rows: rowKey, cols: colKey, value, includeDecom, filters } });
      setViews(v => [...v.filter(x => x.name !== data.name), data].sort((a, b) => a.name.localeCompare(b.name)));
      setViewName(''); message.success('View saved');
    } catch (e) { message.error(e.response?.data?.error || 'Could not save view'); }
  };
  const applyView = (id) => {
    const v = views.find(x => x.id === id)?.view_config;
    if (!v) return;
    if (v.rows && opts.row_fields.includes(v.rows)) setRowKey(v.rows);
    setColKey(v.cols && opts.row_fields.includes(v.cols) && v.cols !== v.rows ? v.cols : '');
    if (opts.value_options.includes(v.value)) setValue(v.value);
    setFilters((v.filters || []).filter(f => opts.row_fields.includes(f.field)));
    toggleDecom(!!v.includeDecom);
  };
  const removeView = async (id) => {
    await api.delete(`/weekly-report/views/${id}`).catch(() => message.error('Could not delete view'));
    setViews(v => v.filter(x => x.id !== id));
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>;
  if (!opts) return <Alert type="error" showIcon message="Pivot settings are unavailable." />;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" title="Pivot"
        extra={(
          <Space>
            <Button icon={<DownloadOutlined />} loading={busy} onClick={() => exportFile('csv')}>CSV</Button>
            <Button icon={<DownloadOutlined />} loading={busy} onClick={() => exportFile('xlsx')}>Excel</Button>
          </Space>
        )}>
        {!opts.allow_pivot ? (
          <Alert type="info" showIcon message="Pivoting is turned off by an admin. Detail tables below are still available." />
        ) : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space wrap>
              <Text>Rows</Text>
              <Select style={{ width: 190 }} value={rowKey} options={fieldOpts} onChange={pickRows} />
              <Button icon={<SwapOutlined />} disabled={!colKey} onClick={swap} title="Swap rows and columns" />
              <Text>Columns</Text>
              <Select style={{ width: 190 }} allowClear placeholder="None" value={colKey || undefined}
                options={fieldOpts.filter(o => o.value !== rowKey)} onChange={pickCols} />
              <Segmented value={value} onChange={setValue}
                options={opts.value_options.map(v => ({ value: v, label: VALUE_LABELS[v] }))} />
              <Checkbox checked={includeDecom} onChange={e => toggleDecom(e.target.checked)}>Include decommissioned</Checkbox>
              <Button icon={<ReloadOutlined />} onClick={reset}>Reset</Button>
            </Space>
            <Space wrap align="start">
              <Select style={{ width: 200 }} placeholder="+ Add filter" value={null}
                options={fieldOpts.filter(o => !filters.some(f => f.field === o.value))}
                onChange={(field) => setFilters(fs => [...fs, { field, values: [] }])} />
              {filters.map(f => (
                <Space.Compact key={f.field}>
                  <Button disabled style={{ cursor: 'default' }}>{FIELD_LABELS[f.field] || f.field}</Button>
                  <Select
                    mode="multiple" maxTagCount="responsive" style={{ minWidth: 220, maxWidth: 360 }}
                    placeholder="Show only…" value={f.values} onChange={v => setFilter(f.field, v)}
                    options={valuesFor(f.field).map(v => ({ value: v, label: v }))}
                  />
                  <Button icon={<DeleteOutlined />} onClick={() => setFilters(fs => fs.filter(x => x.field !== f.field))} />
                </Space.Compact>
              ))}
              {activeFilters.length > 0 && (
                <Text type="secondary">{shown.length.toLocaleString()} of {rows.length.toLocaleString()} assets</Text>
              )}
            </Space>
            <Space wrap>
              <Select style={{ width: 220 }} placeholder="My saved views" value={null}
                options={views.map(v => ({ value: v.id, label: v.name }))} onChange={applyView}
              />
              <Input style={{ width: 180 }} placeholder="Name this view" maxLength={80} value={viewName} onChange={e => setViewName(e.target.value)} />
              <Button icon={<SaveOutlined />} disabled={!viewName.trim()} onClick={saveView}>Save this view</Button>
              {views.map(v => (
                <Popconfirm key={v.id} title={`Delete view “${v.name}”?`} onConfirm={() => removeView(v.id)}>
                  <Tag closable={false} style={{ cursor: 'pointer' }}>{v.name} <DeleteOutlined /></Tag>
                </Popconfirm>
              ))}
            </Space>
            <Pivot rows={shown} rowKey={rowKey} colKey={colKey} value={value} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Assets with status NA or Not in Scope are never counted. Export matches what you see above.
            </Text>
          </Space>
        )}
      </Card>
      {details.map(t => <DetailTable key={t.key} t={t} />)}
    </Space>
  );
}
