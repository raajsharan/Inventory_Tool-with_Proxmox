import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Card, Table, Input, Select, Space, Button, Tag, App,
  Row, Col, Typography, Tooltip, Modal, Form, Statistic,
} from 'antd';
import {
  PlusOutlined, DownloadOutlined, UploadOutlined, SearchOutlined,
  EditOutlined, DeleteOutlined, ReloadOutlined,
  EyeOutlined, EyeInvisibleOutlined, LockOutlined, UnlockOutlined, CopyOutlined,
  CheckCircleFilled, CloseCircleFilled, SyncOutlined, HddOutlined,
} from '@ant-design/icons';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';
import PasswordConfirmModal from '../../components/PasswordConfirmModal.jsx';
import { copyToClipboard } from '../../utils/clipboard';
import { DASH_CSS } from '../../components/DashboardStatCard.jsx';

const PAGE_KEY = 'physical_esxi_servers';

export default function PhysicalEsxiList() {
  const { user, getPageLabel, canViewPasswords } = useAuth();
  const title = getPageLabel ? getPageLabel(PAGE_KEY, 'Physical & ESXi Servers') : 'Physical & ESXi Servers';
  const { message } = App.useApp();
  const nav = useNavigate();

  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [serverModels, setServerModels] = useState([]);
  const [ddStatus, setDdStatus] = useState([]);
  const [ddLocation, setDdLocation] = useState([]);

  const [filters, setFilters] = useState(() => ({
    search:       searchParams.get('q')      || '',
    serverStatus: searchParams.get('status') || undefined,
    location:     searchParams.get('loc')    || undefined,
    serverModel:  searchParams.get('model')  || undefined,
  }));
  const [page, setPage]         = useState(() => Number(searchParams.get('page')) || 1);
  const [pageSize, setPageSize] = useState(() => Number(searchParams.get('size')) || 20);

  const hasFilters = !!(filters.search || filters.serverStatus || filters.location || filters.serverModel);

  // ── URL sync ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const p = {};
    if (filters.search)       p.q      = filters.search;
    if (filters.serverStatus) p.status = filters.serverStatus;
    if (filters.location)     p.loc    = filters.location;
    if (filters.serverModel)  p.model  = filters.serverModel;
    if (page > 1)             p.page   = String(page);
    if (pageSize !== 20)      p.size   = String(pageSize);
    setSearchParams(p, { replace: true });
  }, [filters, page, pageSize]); // eslint-disable-line

  // ── State for inline actions ─────────────────────────────────────────────
  const [hiddenSet, setHiddenSet] = useState(new Set());
  const [fieldLabels, setFieldLabels] = useState({});
  const [extraFields, setExtraFields] = useState([]); // admin-added custom fields (is_extra), stored per-record in `extras`
  const labelOf = (k, fallback) => fieldLabels[k] || fallback;

  const [revealed, setRevealed]   = useState({});
  const [revealing, setRevealing] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [setpwTarget, setSetpwTarget]   = useState(null);
  const [setpwForm]                     = Form.useForm();
  const [setpwLoading, setSetpwLoading] = useState(false);

  const [selectedIds, setSelectedIds]     = useState([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkWorking, setBulkWorking]     = useState(false);
  const [bulkResetKey, setBulkResetKey]   = useState(0);

  const [syncConfirmOpen, setSyncConfirmOpen] = useState(false);
  const [syncing, setSyncing]                 = useState(false);
  const [syncResult, setSyncResult]           = useState(null);

  const canWrite      = ['admin', 'superadmin', 'asset_manager'].includes(user?.role);
  const isAdmin       = ['admin', 'superadmin'].includes(user?.role);
  const canSeePasswords = canWrite || !!canViewPasswords;

  // ── Load ─────────────────────────────────────────────────────────────────
  async function load(overrides = {}) {
    setLoading(true);
    try {
      const params = { page, pageSize, ...filters, ...overrides };
      const { data: d } = await api.get('/physical-esxi', { params });
      setData(d);
      setRevealed({});
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [page, pageSize, filters.serverStatus, filters.location, filters.serverModel]); // eslint-disable-line
  useEffect(() => {
    api.get('/dropdowns').then(r => {
      const g = r.data.grouped || {};
      setDdStatus((g.server_status || []).map(d => ({ label: d.value, value: d.value })));
      setDdLocation((g.location    || []).map(d => ({ label: d.value, value: d.value })));
    });
    api.get('/server-models').then(r => setServerModels(r.data || [])).catch(() => {});
    api.get(`/field-visibility/${PAGE_KEY}`)
      .then(r => setHiddenSet(new Set(r.data.hidden || []))).catch(() => {});
    api.get(`/inventory-fields/${PAGE_KEY}`)
      .then(r => {
        const m = {};
        for (const f of r.data.fields || []) m[f.field_key] = f.label;
        setFieldLabels(m);
        setExtraFields((r.data.fields || []).filter(f => f.is_extra));
      }).catch(() => {});
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function onSearch() { setPage(1); load(); }
  function clearFilters() {
    const blank = { search: '', serverStatus: undefined, location: undefined, serverModel: undefined };
    setFilters(blank);
    setPage(1);
    load({ page: 1, ...blank });
  }

  async function onDeleteConfirmed(password) {
    if (!deleteTarget) return;
    await api.delete(`/physical-esxi/${deleteTarget.id}`, { data: { password } });
    message.success('Moved to Recycle Bin');
    setDeleteTarget(null);
    load();
  }

  async function onBulkDeleteConfirmed(password) {
    const { data: r } = await api.post('/physical-esxi/bulk-delete', { ids: selectedIds, password });
    message.success(`Moved ${r.success} record${r.success !== 1 ? 's' : ''} to Recycle Bin`);
    setBulkDeleteOpen(false);
    setSelectedIds([]);
    load();
  }

  async function onBulkUpdate(fieldKey, value) {
    if (value == null) return;
    setBulkWorking(true);
    try {
      const { data: r } = await api.post('/physical-esxi/bulk-update', {
        ids: selectedIds, fields: { [fieldKey]: value },
      });
      message.success(`Updated ${r.success} record${r.success !== 1 ? 's' : ''}`);
      setSelectedIds([]);
      setBulkResetKey(k => k + 1);
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Bulk update failed');
    } finally { setBulkWorking(false); }
  }

  async function onExport() {
    const p = new URLSearchParams(
      Object.entries(filters).filter(([, v]) => v !== undefined && v !== '')
    ).toString();
    const res = await api.get(`/physical-esxi/export?${p}`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a'); a.href = url;
    a.download = 'physical-esxi-export.xlsx'; a.click();
    URL.revokeObjectURL(url);
  }

  async function onSyncFromDiscovery() {
    setSyncing(true);
    try {
      const { data } = await api.post('/physical-esxi/sync-from-discovery');
      setSyncResult(data);
      setSyncConfirmOpen(false);
      if (data.created > 0) load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Sync failed');
    } finally { setSyncing(false); }
  }

  // kind: 'asset' | 'idrac' — reveal/set share one mechanism keyed by `${kind}:${id}`.
  const PW_KINDS = {
    asset: { endpoint: 'password',       payloadKey: 'assetPassword', hasFlag: 'hasPassword' },
    idrac: { endpoint: 'idrac-password', payloadKey: 'idracPassword', hasFlag: 'hasIdracPassword' },
  };

  async function togglePassword(id, hasPassword, kind = 'asset') {
    if (!hasPassword) return;
    const key = `${kind}:${id}`;
    if (revealed[key]) { setRevealed(p => { const n = { ...p }; delete n[key]; return n; }); return; }
    setRevealing(p => ({ ...p, [key]: true }));
    try {
      const { data: d } = await api.get(`/physical-esxi/${id}/${PW_KINDS[kind].endpoint}`);
      setRevealed(p => ({ ...p, [key]: d.password || '' }));
    } catch (e) { message.error(e.response?.data?.error || 'Cannot view password'); }
    finally { setRevealing(p => { const n = { ...p }; delete n[key]; return n; }); }
  }

  async function copyPassword(id, hasPassword, kind = 'asset') {
    if (!hasPassword) return;
    const key = `${kind}:${id}`;
    try {
      let pwd = revealed[key];
      if (pwd === undefined) {
        const { data: d } = await api.get(`/physical-esxi/${id}/${PW_KINDS[kind].endpoint}`);
        pwd = d.password || '';
      }
      await copyToClipboard(pwd);
      message.success('Password copied to clipboard');
    } catch (e) { message.error(e.response?.data?.error || 'Cannot copy password'); }
  }

  async function onSetPassword({ newPassword }) {
    if (!setpwTarget) return;
    setSetpwLoading(true);
    try {
      await api.put(`/physical-esxi/${setpwTarget.id}`, { [PW_KINDS[setpwTarget.kind || 'asset'].payloadKey]: newPassword });
      message.success('Password saved');
      setSetpwTarget(null); setpwForm.resetFields(); load();
    } catch (e) { message.error(e.response?.data?.error || 'Failed to save password'); }
    finally { setSetpwLoading(false); }
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  const dash = (v) =>
    v === null || v === undefined || v === ''
      ? <Typography.Text type="secondary">—</Typography.Text>
      : v;

  const statusTag = (v) =>
    v ? <Tag color={v === 'Active' ? 'green' : v === 'Decommissioned' ? 'red' : 'orange'}>{v}</Tag> : dash(v);

  const omeTag = (v) =>
    v === 'Active'
      ? <Space size={4}><CheckCircleFilled style={{ color: '#52c41a' }} /><span style={{ color: '#52c41a' }}>Active</span></Space>
      : v === 'Expired'
        ? <Space size={4}><CloseCircleFilled style={{ color: '#ff4d4f' }} /><span style={{ color: '#ff4d4f' }}>Expired</span></Space>
        : dash(v);

  const numCell = (v) =>
    v == null || v === 0 ? <Typography.Text type="secondary">—</Typography.Text> : v;

  const makePwCell = (kind) => (_, r) => {
    const key = `${kind}:${r.id}`;
    const shown = revealed[key];
    const hasPw = r[PW_KINDS[kind].hasFlag];
    const openSetModal = () => { setSetpwTarget({ id: r.id, vm_name: r.vm_name, kind }); setpwForm.resetFields(); };
    if (!canSeePasswords)
      return hasPw
        ? <Space size={4}><span style={{ fontFamily: 'monospace' }}>••••••••</span><LockOutlined style={{ color: '#bbb' }} /></Space>
        : dash(null);
    if (!hasPw)
      return canWrite
        ? <Space size={4}><Typography.Text type="secondary" style={{ fontFamily: 'monospace' }}>—</Typography.Text>
            <Tooltip title="Set password"><Button size="small" type="text" icon={<EyeOutlined style={{ color: '#bbb' }} />} onClick={openSetModal} /></Tooltip></Space>
        : dash(null);
    return (
      <Space size={4}>
        <span style={{ fontFamily: 'monospace', minWidth: 70, display: 'inline-block' }}>{shown || '••••••••'}</span>
        <Tooltip title={shown ? 'Hide' : 'Reveal password'}>
          <Button size="small" type="text" icon={shown ? <EyeInvisibleOutlined /> : <EyeOutlined />}
            loading={!!revealing[key]} onClick={() => togglePassword(r.id, hasPw, kind)} />
        </Tooltip>
        <Tooltip title="Copy password">
          <Button size="small" type="text" icon={<CopyOutlined style={{ color: '#aaa' }} />}
            onClick={() => copyPassword(r.id, hasPw, kind)} />
        </Tooltip>
        {canWrite && (
          <Tooltip title="Change password">
            <Button size="small" type="text" icon={<UnlockOutlined style={{ color: '#aaa', fontSize: 12 }} />} onClick={openSetModal} />
          </Tooltip>
        )}
      </Space>
    );
  };
  const pwCell = makePwCell('asset');
  const idracPwCell = makePwCell('idrac');

  // ── Columns — order mirrors the Register Physical Server form ─────────────
  const allColumns = [
    // ── Fixed: Device Name ──────────────────────────────────────────────────
    {
      key: 'vm_name', dataIndex: 'vm_name', fixed: 'left', width: 180,
      title: labelOf('vm_name', 'Device Name'),
      render: (v, r) => <Link className="vm-name-link" to={`/physical-esxi/${r.id}`}>{v || '(unnamed)'}</Link>,
    },

    // ── HARDWARE INFORMATION (top section of form) ──────────────────────────
    {
      key: 'ip_address', dataIndex: 'ip_address', width: 140,
      title: labelOf('ip_address', 'Hosted IP'), render: dash,
    },
    {
      key: 'server_status', dataIndex: 'server_status', width: 130,
      title: labelOf('server_status', 'Status'), render: statusTag,
    },
    {
      key: 'patching_type', dataIndex: 'patching_type', width: 140,
      title: labelOf('patching_type', 'Patching Type'), render: dash,
    },
    {
      key: 'department', dataIndex: 'department', width: 140,
      title: labelOf('department', 'Department'), render: dash,
    },
    {
      key: 'assigned_user', dataIndex: 'assigned_user', width: 150,
      title: labelOf('assigned_user', 'Owner'), render: dash,
    },
    {
      key: 'location', dataIndex: 'location', width: 140,
      title: labelOf('location', 'Location'), render: dash,
    },
    {
      key: 'server_model', dataIndex: 'server_model', width: 190,
      title: labelOf('server_model', 'Server Model'), render: dash,
    },
    {
      key: 'serial_number', dataIndex: 'serial_number', width: 150,
      title: labelOf('serial_number', 'Serial Number'), render: dash,
    },
    {
      key: 'cpu_cores', dataIndex: 'cpu_cores', width: 100,
      title: labelOf('cpu_cores', 'CPU Cores'), align: 'right', render: numCell,
    },
    {
      key: 'ram_gb', dataIndex: 'ram_gb', width: 100,
      title: labelOf('ram_gb', 'RAM (GB)'), align: 'right', render: numCell,
    },
    {
      key: 'total_disks', dataIndex: 'total_disks', width: 110,
      title: labelOf('total_disks', 'Total Disks'), align: 'right', render: numCell,
    },
    {
      key: 'ome_status', dataIndex: 'ome_status', width: 150,
      title: labelOf('ome_status', 'OME Support Status'), render: omeTag,
    },

    // ── RACK INFORMATION (second section of form) ───────────────────────────
    {
      key: 'rack_number', dataIndex: 'rack_number', width: 130,
      title: labelOf('rack_number', 'Rack Number'), render: dash,
    },
    {
      key: 'server_position', dataIndex: 'server_position', width: 140,
      title: labelOf('server_position', 'Server Position (U)'), render: dash,
    },
    {
      key: 'additional_remarks', dataIndex: 'additional_remarks', width: 220,
      title: labelOf('additional_remarks', 'Additional Notes'), ellipsis: true,
      render: v => v ? <Tooltip title={v}>{v}</Tooltip> : dash(v),
    },

    // ── iDRAC (bottom hardware section of form) ─────────────────────────────
    {
      key: 'idrac_ip', dataIndex: 'idrac_ip', width: 140,
      title: labelOf('idrac_ip', 'iDRAC IP'), render: dash,
    },
    {
      key: 'idrac_username', dataIndex: 'idrac_username', width: 150,
      title: labelOf('idrac_username', 'iDRAC Username'), render: dash,
    },
    {
      key: 'idrac_password', width: 210,
      title: labelOf('idrac_password', 'iDRAC Password'),
      render: idracPwCell,
    },

    // ── Secondary / extended fields ─────────────────────────────────────────
    {
      key: 'os_type', dataIndex: 'os_type', width: 110,
      title: labelOf('os_type', 'OS Type'), render: dash,
    },
    {
      key: 'os_version', dataIndex: 'os_version', width: 150,
      title: labelOf('os_version', 'OS Version'), render: dash,
    },
    {
      key: 'asset_type', dataIndex: 'asset_type', width: 140,
      title: labelOf('asset_type', 'Asset Type'), render: dash,
    },
    {
      key: 'asset_tag', dataIndex: 'asset_tag', width: 110,
      title: labelOf('asset_tag', 'Asset Tag'),
      render: v => v ? <Tag>{v}</Tag> : dash(v),
    },
    {
      key: 'asset_username', dataIndex: 'asset_username', width: 150,
      title: labelOf('asset_username', 'Asset Username'), render: dash,
    },
    {
      key: 'asset_password', width: 210,
      title: labelOf('asset_password', 'Asset Password'),
      render: pwCell,
    },

    // ── Audit ───────────────────────────────────────────────────────────────
    { key: 'created_by_name', dataIndex: 'created_by_name', width: 160, title: 'Submitted By', render: dash },
    { key: 'created_at', dataIndex: 'created_at', width: 170, title: 'Created',
      render: v => v ? new Date(v).toLocaleString() : dash(v) },
    { key: 'updated_by_name', dataIndex: 'updated_by_name', width: 160, title: 'Modified By', render: dash },
    { key: 'updated_at', dataIndex: 'updated_at', width: 170, title: 'Modified',
      render: v => v ? new Date(v).toLocaleString() : dash(v) },

    // ── Admin-added custom fields (Inventory Fields → "Custom") ────────────
    // Stored per-record under `extras`, never on the row itself, so these
    // are appended dynamically rather than hardcoded like the columns above.
    ...extraFields.map(f => ({
      key: f.field_key, dataIndex: ['extras', f.field_key], width: 160, ellipsis: true,
      title: labelOf(f.field_key, f.label),
      render: (v) => {
        if (v === null || v === undefined || v === '') return dash(v);
        if (typeof v === 'boolean') return v ? 'Yes' : 'No';
        if (Array.isArray(v)) return v.length ? v.join(', ') : dash(v);
        return String(v);
      },
    })),

    // ── Fixed: Actions ──────────────────────────────────────────────────────
    {
      key: '__actions__', title: 'Actions', fixed: 'right', width: 110,
      render: (_, r) => (
        <Space>
          <Tooltip title="Edit">
            <Button size="small" icon={<EditOutlined />} onClick={() => nav(`/physical-esxi/${r.id}/edit`)} />
          </Tooltip>
          {isAdmin && (
            <Tooltip title="Delete">
              <Button size="small" danger icon={<DeleteOutlined />}
                onClick={() => setDeleteTarget({ id: r.id, vm_name: r.vm_name })} />
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  // Always-visible keys (never controlled by field-visibility toggle).
  const pinned = new Set(['vm_name', 'asset_tag', '__actions__', 'asset_password', 'idrac_password',
    'created_by_name', 'created_at', 'updated_by_name', 'updated_at']);

  const visibleColumns = allColumns.filter(c => pinned.has(c.key) || !hiddenSet.has(c.key));

  const modelOptions = serverModels.map(m => ({
    label: m.manufacturer ? `${m.manufacturer} ${m.model_name}` : m.model_name,
    value: m.model_name,
  }));

  return (
    <Card
      className="dashcard"
      title={<Space><HddOutlined style={{ color: '#1677ff' }} /><Typography.Title level={4} style={{ margin: 0 }}>{title}</Typography.Title></Space>}
      extra={
        <Space>
          {!loading && data.total > 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              {data.total} server{data.total !== 1 ? 's' : ''}
            </Typography.Text>
          )}
          <Tooltip title="Reload the current view"><Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button></Tooltip>
          <Tooltip title="Export this view to Excel"><Button icon={<DownloadOutlined />} onClick={onExport}>Export</Button></Tooltip>
          {canWrite && <Link to="/physical-esxi/import"><Tooltip title="Bulk import from a spreadsheet"><Button icon={<UploadOutlined />}>Import</Button></Tooltip></Link>}
          {canWrite && (
            <Tooltip title="Copy new ESXi hosts discovered by VM Discovery into this list">
              <Button icon={<SyncOutlined />} onClick={() => { setSyncResult(null); setSyncConfirmOpen(true); }}>
                Copy from VM Discovery
              </Button>
            </Tooltip>
          )}
          {canWrite && (
            <Link to="/physical-esxi/new">
              <Button type="primary" icon={<PlusOutlined />}>Register Server</Button>
            </Link>
          )}
        </Space>
      }
    >
      <style>{DASH_CSS}</style>
      {/* ── Filters ── */}
      <Row gutter={[8, 8]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <Input
            prefix={<SearchOutlined />}
            placeholder="Search by name, IP, department…"
            value={filters.search}
            onChange={e => {
              const search = e.target.value;
              setFilters({ ...filters, search });
              if (!search) { setPage(1); load({ page: 1, search: '' }); }
            }}
            onPressEnter={onSearch}
            allowClear
          />
        </Col>
        <Col xs={12} md={4}>
          <Select
            allowClear showSearch optionFilterProp="label"
            placeholder="Server Status"
            style={{ width: '100%' }}
            value={filters.serverStatus}
            onChange={v => setFilters({ ...filters, serverStatus: v })}
            options={ddStatus}
          />
        </Col>
        <Col xs={12} md={4}>
          <Select
            allowClear showSearch optionFilterProp="label"
            placeholder="Location"
            style={{ width: '100%' }}
            value={filters.location}
            onChange={v => setFilters({ ...filters, location: v })}
            options={ddLocation}
          />
        </Col>
        <Col xs={12} md={4}>
          <Select
            allowClear showSearch optionFilterProp="label"
            placeholder="Server Model"
            style={{ width: '100%' }}
            value={filters.serverModel}
            onChange={v => setFilters({ ...filters, serverModel: v })}
            options={modelOptions}
          />
        </Col>
        <Col xs={12} md={4}>
          <Button onClick={onSearch} type="default" block>Search</Button>
        </Col>
      </Row>

      {/* ── Bulk bar ── */}
      {canWrite && selectedIds.length > 0 && (
        <div className="bulk-bar" key={bulkResetKey}>
          <Space wrap size={10}>
            <Typography.Text strong>{selectedIds.length} selected</Typography.Text>
            <Select size="small" style={{ minWidth: 160 }} placeholder="Set status…"
              options={ddStatus} loading={bulkWorking}
              onChange={v => onBulkUpdate('serverStatus', v)} />
            <Select size="small" style={{ minWidth: 160 }} placeholder="Set location…"
              options={ddLocation} loading={bulkWorking}
              onChange={v => onBulkUpdate('location', v)} />
            {isAdmin && (
              <Button size="small" danger icon={<DeleteOutlined />}
                onClick={() => setBulkDeleteOpen(true)} loading={bulkWorking}>
                Delete selected
              </Button>
            )}
            <Button size="small" type="text" onClick={() => setSelectedIds([])}>Clear selection</Button>
          </Space>
        </div>
      )}

      {/* ── Table ── */}
      <Table
        rowKey="id"
        loading={loading}
        dataSource={data.items}
        size="small"
        rowClassName="dashcard-row"
        sticky
        rowSelection={canWrite ? {
          selectedRowKeys: selectedIds,
          onChange: keys => setSelectedIds(keys),
          columnWidth: 44,
          fixed: true,
        } : undefined}
        pagination={{
          current: page, pageSize, total: data.total,
          showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100],
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          showTotal: t => `${t} server${t !== 1 ? 's' : ''}`,
        }}
        scroll={{ x: 'max-content' }}
        columns={visibleColumns}
        locale={{
          emptyText: (
            <div style={{ padding: '36px 0', textAlign: 'center' }}>
              {hasFilters ? (
                <>
                  <Typography.Text type="secondary">No records match the current filters.</Typography.Text>
                  <div style={{ marginTop: 14 }}>
                    <Button size="small" onClick={clearFilters}>Clear filters</Button>
                  </div>
                </>
              ) : (
                <>
                  <Typography.Text type="secondary">No servers registered yet.</Typography.Text>
                  {canWrite && (
                    <div style={{ marginTop: 14 }}>
                      <Space>
                        <Link to="/physical-esxi/new">
                          <Button type="primary" size="small" icon={<PlusOutlined />}>Register Server</Button>
                        </Link>
                        <Link to="/physical-esxi/import">
                          <Button size="small" icon={<UploadOutlined />}>Import from Excel</Button>
                        </Link>
                      </Space>
                    </div>
                  )}
                </>
              )}
            </div>
          ),
        }}
      />

      {/* ── Modals ── */}
      <PasswordConfirmModal
        open={!!deleteTarget}
        title={`Delete "${deleteTarget?.vm_name || 'server'}"?`}
        message="This will move the record to the Recycle Bin. A superadmin can restore it later."
        okText="Delete"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={onDeleteConfirmed}
      />
      <PasswordConfirmModal
        open={bulkDeleteOpen}
        title={`Delete ${selectedIds.length} selected server${selectedIds.length !== 1 ? 's' : ''}?`}
        message="All selected records move to the Recycle Bin. A superadmin can restore them later."
        okText={`Delete ${selectedIds.length}`}
        onCancel={() => setBulkDeleteOpen(false)}
        onConfirm={onBulkDeleteConfirmed}
      />
      <Modal
        title={(() => {
          const kind = setpwTarget?.kind || 'asset';
          const row = data.items.find(x => x.id === setpwTarget?.id);
          const has = row?.[PW_KINDS[kind].hasFlag];
          const label = kind === 'idrac' ? 'iDRAC Password' : 'Asset Password';
          return `${has ? 'Change' : 'Set'} ${label} — ${setpwTarget?.vm_name || ''}`;
        })()}
        open={!!setpwTarget}
        onCancel={() => { setSetpwTarget(null); setpwForm.resetFields(); }}
        onOk={() => setpwForm.submit()}
        okText="Save Password"
        confirmLoading={setpwLoading}
        destroyOnClose
      >
        <Form form={setpwForm} layout="vertical" onFinish={onSetPassword} style={{ marginTop: 12 }}>
          <Form.Item
            name="newPassword" label="New Password"
            rules={[{ required: true, message: 'Please enter a password' }]}
          >
            <Input.Password autoComplete="new-password" autoFocus />
          </Form.Item>
        </Form>
      </Modal>
      {/* ── Sync confirm modal ── */}
      <Modal
        title="Copy from VM Discovery"
        open={syncConfirmOpen}
        onCancel={() => setSyncConfirmOpen(false)}
        onOk={onSyncFromDiscovery}
        okText="Copy Now"
        confirmLoading={syncing}
        okButtonProps={{ icon: <SyncOutlined /> }}
      >
        <Typography.Paragraph>
          This will copy the <b>ESXi / vCenter host addresses</b> and <b>Proxmox VE host addresses</b>
          registered in VM Discovery into Physical &amp; ESXi Servers.
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary">
          Only the host machines themselves are copied — not the VMs running on them.
          Hosts whose IP is already present in this list will be skipped automatically.
        </Typography.Paragraph>
      </Modal>

      {/* ── Sync result modal ── */}
      <Modal
        title="Copy from VM Discovery — Results"
        open={!!syncResult}
        onCancel={() => setSyncResult(null)}
        footer={<Button type="primary" onClick={() => setSyncResult(null)}>Close</Button>}
      >
        {syncResult && (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <Row gutter={16}>
              <Col span={8}>
                <Statistic title="ESXi Hosts Found" value={syncResult.esxiTotal} />
              </Col>
              <Col span={8}>
                <Statistic title="Proxmox Hosts Found" value={syncResult.proxmoxTotal} />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={8}>
                <Statistic title="Created" value={syncResult.created} valueStyle={{ color: '#16a34a' }} />
              </Col>
              <Col span={8}>
                <Statistic title="Skipped (already exist)" value={syncResult.skipped} valueStyle={{ color: '#6b7280' }} />
              </Col>
            </Row>
            {syncResult.errors?.length > 0 && (
              <>
                <Typography.Text type="secondary">Errors ({syncResult.errors.length}):</Typography.Text>
                {syncResult.errors.map((e, i) => (
                  <Tag key={i} color="red">[{e.source}] {e.name} ({e.ip}): {e.error}</Tag>
                ))}
              </>
            )}
          </Space>
        )}
      </Modal>
    </Card>
  );
}
