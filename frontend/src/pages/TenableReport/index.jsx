import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Badge, Button, Card, Col, Descriptions, Drawer, Form, Input,
  Modal, Row, Select, Space, Spin, Table, Tag, Tooltip, Typography, Upload,
} from 'antd';
import {
  CheckCircleFilled, CloseCircleFilled, CloudUploadOutlined,
  DeleteOutlined, DownloadOutlined, ExclamationCircleOutlined,
  FileExcelOutlined, InfoCircleOutlined, ReloadOutlined, SafetyCertificateOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../api/client';

const { Title, Text } = Typography;

const ACCENT = '#1677ff';

const PAGE_SIZE = 50;

// ── helpers ──────────────────────────────────────────────────────────────────
function relTime(str) {
  if (!str) return '—';
  const d = new Date(str);
  if (isNaN(d)) return str;
  const diff = Math.round((Date.now() - d) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)} day${Math.floor(diff / 86400) > 1 ? 's' : ''} ago`;
}

function fmtDate(str) {
  if (!str) return '—';
  const d = new Date(str);
  if (isNaN(d)) return str;
  return d.toLocaleDateString();
}

function exportCSV(data, columns, filename) {
  const header = columns.map(c => c.title).join(',');
  const rows   = data.map(row =>
    columns.map(c => {
      const v = String(row[c.key] ?? '').replace(/"/g, '""');
      return `"${v}"`;
    }).join(',')
  );
  const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── column definitions ────────────────────────────────────────────────────────
const MATCHED_COLS = [
  { title: 'SOURCE',       key: 'source',       dataIndex: 'source',       width: 160,
    render: v => <Tag color={v === 'Asset Inventory' ? 'blue' : 'purple'} style={{ fontSize: 11 }}>{v}</Tag> },
  { title: 'ASSET NAME',   key: 'asset_name',   dataIndex: 'asset_name',   ellipsis: true },
  { title: 'MATCHED IP',   key: 'matched_ip',   dataIndex: 'matched_ip',   width: 140,
    render: v => <Text code style={{ color: '#52c41a', fontSize: 12 }}>{v}</Text> },
  { title: 'ALL IPs',      key: 'all_ips',      dataIndex: 'all_ips',      width: 140,
    render: v => <Text style={{ fontSize: 12 }}>{v}</Text> },
  { title: 'ASSET TYPE',   key: 'asset_type',   dataIndex: 'asset_type',   width: 110 },
  { title: 'TENABLE HOST', key: 'tenable_host', dataIndex: 'tenable_host', ellipsis: true },
  { title: 'TENABLE NAME', key: 'tenable_name', dataIndex: 'tenable_name', ellipsis: true },
  { title: 'MAC ADDRESS',  key: 'mac_address',  dataIndex: 'mac_address',  width: 150,
    render: v => v ? <Text code style={{ fontSize: 11 }}>{v}</Text> : '—' },
  { title: 'LAST OBSERVED',key: 'last_observed',dataIndex: 'last_observed',width: 130,
    render: v => <Tooltip title={v}><Text type="secondary">{relTime(v)}</Text></Tooltip> },
  { title: 'OS',           key: 'os',           dataIndex: 'os',           ellipsis: true },
];

const NOT_IN_TENABLE_COLS = [
  { title: 'SOURCE',      key: 'source',     dataIndex: 'source',     width: 160,
    render: v => <Tag color={v === 'Asset Inventory' ? 'blue' : 'purple'} style={{ fontSize: 11 }}>{v}</Tag> },
  { title: 'ASSET NAME',  key: 'asset_name', dataIndex: 'asset_name', ellipsis: true },
  { title: 'IP ADDRESS',  key: 'ip_address', dataIndex: 'ip_address', width: 140,
    render: v => <Text code style={{ color: '#ff4d4f', fontSize: 12 }}>{v}</Text> },
  { title: 'ALL IPs',     key: 'all_ips',    dataIndex: 'all_ips',    width: 140 },
  { title: 'ASSET TYPE',  key: 'asset_type', dataIndex: 'asset_type', width: 110 },
  { title: 'LOCATION',    key: 'location',   dataIndex: 'location',   width: 120 },
  { title: 'DEPARTMENT',  key: 'department', dataIndex: 'department', ellipsis: true },
];

const TENABLE_ONLY_COLS = [
  { title: 'IP ADDRESS',       key: 'ip_address',        dataIndex: 'ip_address',        width: 140,
    render: v => <Text code style={{ color: '#fa8c16', fontSize: 12 }}>{v}</Text> },
  { title: 'HOST NAME',        key: 'host_name',         dataIndex: 'host_name',         ellipsis: true },
  { title: 'NAME',             key: 'name',              dataIndex: 'name',              ellipsis: true },
  { title: 'MAC ADDRESS',      key: 'mac_address',       dataIndex: 'mac_address',       width: 150,
    render: v => v ? <Text code style={{ fontSize: 11 }}>{v}</Text> : '—' },
  { title: 'ALL IPs (raw)',    key: 'all_ips',           dataIndex: 'all_ips',           ellipsis: true },
  { title: 'LAST OBSERVED',    key: 'last_observed',     dataIndex: 'last_observed',     width: 130,
    render: v => <Tooltip title={v}><Text type="secondary">{relTime(v)}</Text></Tooltip> },
  { title: 'OPERATING SYSTEM', key: 'operating_systems', dataIndex: 'operating_systems', ellipsis: true },
];

// ── stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, color, bg }) {
  return (
    <Card style={{ background: bg, border: `1px solid ${color}33`, borderRadius: 10 }} styles={{ body: { padding: '16px 20px' } }}>
      <Text type="secondary" style={{ fontSize: 12 }}>{label}</Text>
      <div style={{ fontSize: 32, fontWeight: 700, color, lineHeight: 1.3 }}>{value?.toLocaleString() ?? '—'}</div>
    </Card>
  );
}

// ── main component ────────────────────────────────────────────────────────────
export default function TenableReport() {
  const { user } = useAuth();
  const isAdmin = ['admin', 'superadmin'].includes(user?.role);

  const [loading,  setLoading]  = useState(false);
  const [summary,  setSummary]  = useState(null);
  const [matched,  setMatched]  = useState([]);
  const [notIn,    setNotIn]    = useState([]);
  const [tenOnly,  setTenOnly]  = useState([]);
  const [lastInfo, setLastInfo] = useState(null);
  const [tab,      setTab]      = useState('matched');
  const [search,   setSearch]   = useState('');
  const [source,   setSource]   = useState('all');

  // import drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [imports,    setImports]    = useState([]);
  const [uploading,  setUploading]  = useState(false);
  const [uploadErr,  setUploadErr]  = useState('');
  const fileRef = useRef(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const [rep, total] = await Promise.all([
        api.get('/tenable/report'),
        api.get('/tenable/total-ips'),
      ]);
      setSummary(rep.data.summary);
      setMatched(rep.data.matched);
      setNotIn(rep.data.not_in_tenable);
      setTenOnly(rep.data.tenable_only);
      setLastInfo(total.data);
    } catch { /* error shown by global handler */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadReport(); }, [loadReport]);

  const loadImports = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const r = await api.get('/tenable/imports');
      setImports(r.data.items || []);
    } catch {}
  }, [isAdmin]);

  useEffect(() => { if (drawerOpen) loadImports(); }, [drawerOpen, loadImports]);

  // ── filtering ──────────────────────────────────────────────────────────────
  function filterRows(rows, fields) {
    let out = rows;
    if (source !== 'all') out = out.filter(r => r.source === source);
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter(r => fields.some(f => (r[f] || '').toLowerCase().includes(q)));
    }
    return out;
  }

  const matchedFiltered = filterRows(matched, ['asset_name', 'matched_ip', 'all_ips', 'source', 'asset_type', 'tenable_host', 'tenable_name', 'os', 'location', 'department']);
  const notInFiltered   = filterRows(notIn,   ['asset_name', 'ip_address', 'all_ips', 'source', 'asset_type', 'location', 'department']);
  const tenOnlyFiltered = tenOnly.filter(r => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return ['ip_address','host_name','name','operating_systems','mac_address'].some(f => (r[f] || '').toLowerCase().includes(q));
  });

  const activeData = tab === 'matched' ? matchedFiltered : tab === 'not_in_tenable' ? notInFiltered : tenOnlyFiltered;
  const activeCols = tab === 'matched' ? MATCHED_COLS : tab === 'not_in_tenable' ? NOT_IN_TENABLE_COLS : TENABLE_ONLY_COLS;
  const exportFilename = `tenable-${tab}-${new Date().toISOString().slice(0, 10)}.csv`;

  // ── upload ─────────────────────────────────────────────────────────────────
  async function handleUpload(file) {
    setUploading(true); setUploadErr('');
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api.post('/tenable/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await Promise.all([loadReport(), loadImports()]);
    } catch (e) {
      setUploadErr(e?.response?.data?.error || 'Upload failed');
    }
    setUploading(false);
    return false; // prevent antd auto-upload
  }

  async function handleDeleteImport(id) {
    Modal.confirm({
      title: 'Delete import?',
      icon: <ExclamationCircleOutlined />,
      content: 'Tenable assets from this import that were not overwritten by a later import will be removed.',
      okText: 'Delete', okType: 'danger',
      onOk: async () => {
        await api.delete(`/tenable/imports/${id}`);
        await Promise.all([loadReport(), loadImports()]);
      },
    });
  }

  // ── tabs ───────────────────────────────────────────────────────────────────
  const TABS = [
    { key: 'matched',        label: 'Matched',       count: summary?.matched_count,        color: '#1677ff' },
    { key: 'not_in_tenable', label: 'Not in Tenable',count: summary?.not_in_tenable_count, color: '#fa541c' },
    { key: 'tenable_only',   label: 'Tenable Only',  count: summary?.tenable_only_count,   color: '#f5222d' },
  ];

  // ── import history table ───────────────────────────────────────────────────
  const importCols = [
    { title: 'File',       dataIndex: 'filename',         render: v => <Text code style={{ fontSize: 11 }}>{v}</Text> },
    { title: 'Imported',   dataIndex: 'imported_at',      width: 120, render: v => fmtDate(v) },
    { title: 'By',         dataIndex: 'imported_by_name', width: 120 },
    { title: 'Total IPs',  dataIndex: 'total_ips',        width: 90,  render: v => <Tag color="blue">{v}</Tag> },
    { title: 'New',        dataIndex: 'new_ips',          width: 70,  render: v => <Tag color="green">{v}</Tag> },
    { title: 'Updated',    dataIndex: 'updated_ips',      width: 80,  render: v => <Tag color="orange">{v}</Tag> },
    { title: '',           key: 'del',                    width: 50,
      render: (_, row) => (
        <Button size="small" danger type="text" icon={<DeleteOutlined />}
          onClick={() => handleDeleteImport(row.id)} />
      ),
    },
  ];

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1600 }}>

      {/* ── Header ── */}
      <Row justify="space-between" align="top" style={{ marginBottom: 16 }}>
        <Col>
          <Space align="center">
            <SafetyCertificateOutlined style={{ fontSize: 22, color: ACCENT }} />
            <Title level={4} style={{ margin: 0 }}>Tenable Report</Title>
          </Space>
          <div style={{ marginTop: 4 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Comparing 192.168.x.x &amp; 10.x.x.x IPs against Asset Inventory &amp; Ext. Asset Inventory
            </Text>
            {lastInfo?.last_filename && (
              <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                · Last import: {fmtDate(lastInfo.last_import_at)}
                <Text code style={{ fontSize: 11, marginLeft: 4 }}>{lastInfo.last_filename}</Text>
              </Text>
            )}
          </div>
        </Col>
        <Col>
          <Space>
            {isAdmin && (
              <Button icon={<UploadOutlined />} onClick={() => setDrawerOpen(true)}>
                Import Tenable File
              </Button>
            )}
            <Button icon={<ReloadOutlined />} onClick={loadReport} loading={loading}>
              Refresh
            </Button>
          </Space>
        </Col>
      </Row>

      {/* ── Stat cards ── */}
      <Row gutter={16} style={{ marginBottom: 20 }}>
        <Col xs={24} sm={12} md={6}>
          <StatCard label="Total Tenable IPs" value={summary?.total_tenable_ips} color="#1677ff" bg="#e6f4ff" />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <StatCard label="Matched"       value={summary?.matched_count}        color="#52c41a" bg="#f6ffed" />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <StatCard label="Not in Tenable" value={summary?.not_in_tenable_count} color="#fa541c" bg="#fff2e8" />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <StatCard label="Tenable Only"  value={summary?.tenable_only_count}   color="#f5222d" bg="#fff1f0" />
        </Col>
      </Row>

      {/* ── Tab bar ── */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #f0f0f0', marginBottom: 16 }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              border: 'none', background: 'none', cursor: 'pointer', padding: '10px 20px',
              fontWeight: tab === t.key ? 600 : 400,
              color:      tab === t.key ? t.color : '#595959',
              borderBottom: tab === t.key ? `2px solid ${t.color}` : '2px solid transparent',
              fontSize: 14, transition: 'all .15s',
            }}
          >
            {t.label}
            {t.count != null && (
              <span style={{
                marginLeft: 8, background: tab === t.key ? t.color : '#d9d9d9',
                color: 'white', borderRadius: 10, padding: '1px 8px', fontSize: 12,
              }}>
                {t.count.toLocaleString()}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Toolbar ── */}
      <Row gutter={12} align="middle" style={{ marginBottom: 12 }}>
        <Col flex="1">
          <Input.Search
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            allowClear
            style={{ maxWidth: 500 }}
          />
        </Col>
        {tab !== 'tenable_only' && (
          <Col>
            <Select value={source} onChange={setSource} style={{ width: 180 }}>
              <Select.Option value="all">All Sources</Select.Option>
              <Select.Option value="Asset Inventory">Asset Inventory</Select.Option>
              <Select.Option value="Ext. Asset Inventory">Ext. Asset Inventory</Select.Option>
              <Select.Option value="Beijing Inventory">Beijing Inventory</Select.Option>
              <Select.Option value="Physical / ESXi">Physical / ESXi</Select.Option>
            </Select>
          </Col>
        )}
        <Col>
          <Button icon={<DownloadOutlined />} onClick={() => exportCSV(activeData, activeCols, exportFilename)}>
            Export CSV
          </Button>
        </Col>
        <Col>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {activeData.length.toLocaleString()} records
          </Text>
        </Col>
      </Row>

      {/* ── Data sources info ── */}
      {tab !== 'tenable_only' && (
        <div style={{
          background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 6,
          padding: '8px 14px', marginBottom: 12, fontSize: 12, display: 'flex', gap: 8, alignItems: 'center',
        }}>
          <Text type="secondary">Data sources:</Text>
          <Tag color="blue" style={{ margin: 0 }}>Tenable Import</Tag>
          <Text type="secondary">vs</Text>
          <Tag color="purple" style={{ margin: 0 }}>Asset &amp; Ext. Asset Inventory</Tag>
          <Text type="secondary">·</Text>
          <Text type="secondary">
            {tab === 'matched'
              ? 'IPs found in both sources — fully covered assets'
              : 'Inventory IPs with no match in Tenable scan data'}
          </Text>
        </div>
      )}

      {/* ── Table ── */}
      <Spin spinning={loading}>
        <Table
          dataSource={activeData}
          columns={activeCols}
          rowKey={(r, i) => `${r.ip_address || r.matched_ip || ''}_${i}`}
          size="small"
          scroll={{ x: 'max-content' }}
          pagination={{ pageSize: PAGE_SIZE, showSizeChanger: false, showTotal: t => `${t} records` }}
          rowClassName={() => 'tenable-row'}
        />
      </Spin>

      {/* ── Import drawer ── */}
      <Drawer
        title={
          <Space>
            <FileExcelOutlined style={{ color: '#52c41a' }} />
            <span>Import Tenable Excel File</span>
          </Space>
        }
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={720}
      >
        {/* Expected columns info */}
        <Alert
          type="info" showIcon icon={<InfoCircleOutlined />}
          style={{ marginBottom: 16 }}
          message="Expected Excel columns"
          description={
            <Text style={{ fontSize: 12 }}>
              The file must contain an <strong>IP Addresses</strong> / <code>ipv4_addresses</code> column.
              Optional: <code>host_name</code>, <code>name</code>, <code>display_mac_address</code>,{' '}
              <code>last_observed</code>, <code>operating_systems</code>.
              Only <strong>192.168.x.x</strong> and <strong>10.x.x.x</strong> IPs are imported.
            </Text>
          }
        />

        <Upload.Dragger
          accept=".xlsx,.xls"
          beforeUpload={handleUpload}
          showUploadList={false}
          disabled={uploading}
          style={{ marginBottom: 16 }}
        >
          <p className="ant-upload-drag-icon"><CloudUploadOutlined style={{ color: ACCENT, fontSize: 36 }} /></p>
          <p className="ant-upload-text">Click or drag an Excel file here</p>
          <p className="ant-upload-hint">Accepts .xlsx / .xls · Max 50 MB</p>
          {uploading && <Spin style={{ marginTop: 8 }} />}
        </Upload.Dragger>

        {uploadErr && <Alert type="error" message={uploadErr} showIcon style={{ marginBottom: 16 }} />}

        <Title level={5} style={{ marginBottom: 10 }}>Import History</Title>
        <Table
          dataSource={imports}
          columns={importCols}
          rowKey="id"
          size="small"
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: 'No imports yet' }}
        />
      </Drawer>
    </div>
  );
}
