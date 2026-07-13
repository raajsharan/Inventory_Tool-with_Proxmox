import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Card, Table, Input, Select, Space, Button, Tag, App,
  Row, Col, Typography, Tooltip, Modal, Form,
} from 'antd';
import {
  PlusOutlined, DownloadOutlined, UploadOutlined, SearchOutlined,
  EditOutlined, DeleteOutlined, ReloadOutlined,
  EyeOutlined, EyeInvisibleOutlined, LockOutlined, UnlockOutlined,
  CheckCircleFilled, CloseCircleFilled,
} from '@ant-design/icons';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';
import PasswordConfirmModal from '../../components/PasswordConfirmModal.jsx';

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

  async function togglePassword(id, hasPassword) {
    if (!hasPassword) return;
    if (revealed[id]) { setRevealed(p => { const n = { ...p }; delete n[id]; return n; }); return; }
    setRevealing(p => ({ ...p, [id]: true }));
    try {
      const { data: d } = await api.get(`/physical-esxi/${id}/password`);
      setRevealed(p => ({ ...p, [id]: d.password || '' }));
    } catch (e) { message.error(e.response?.data?.error || 'Cannot view password'); }
    finally { setRevealing(p => { const n = { ...p }; delete n[id]; return n; }); }
  }

  async function onSetPassword({ newPassword }) {
    if (!setpwTarget) return;
    setSetpwLoading(true);
    try {
      await api.put(`/physical-esxi/${setpwTarget.id}`, { assetPassword: newPassword });
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

  const yesNo = (v) =>
    v == null ? dash(v) : v ? <Tag color="green">Yes</Tag> : <Tag>No</Tag>;

  const numCell = (v) =>
    v == null || v === 0 ? <Typography.Text type="secondary">—</Typography.Text> : v;

  const pwCell = (_, r) => {
    const shown = revealed[r.id];
    const openSetModal = () => { setSetpwTarget({ id: r.id, vm_name: r.vm_name }); setpwForm.resetFields(); };
    if (!canSeePasswords)
      return r.hasPassword
        ? <Space size={4}><span style={{ fontFamily: 'monospace' }}>••••••••</span><LockOutlined style={{ color: '#bbb' }} /></Space>
        : dash(null);
    if (!r.hasPassword)
      return canWrite
        ? <Space size={4}><Typography.Text type="secondary" style={{ fontFamily: 'monospace' }}>—</Typography.Text>
            <Tooltip title="Set password"><Button size="small" type="text" icon={<EyeOutlined style={{ color: '#bbb' }} />} onClick={openSetModal} /></Tooltip></Space>
        : dash(null);
    return (
      <Space size={4}>
        <span style={{ fontFamily: 'monospace', minWidth: 70, display: 'inline-block' }}>{shown || '••••••••'}</span>
        <Tooltip title={shown ? 'Hide' : 'Reveal password'}>
          <Button size="small" type="text" icon={shown ? <EyeInvisibleOutlined /> : <EyeOutlined />}
            loading={!!revealing[r.id]} onClick={() => togglePassword(r.id, r.hasPassword)} />
        </Tooltip>
        {canWrite && (
          <Tooltip title="Change password">
            <Button size="small" type="text" icon={<UnlockOutlined style={{ color: '#aaa', fontSize: 12 }} />} onClick={openSetModal} />
          </Tooltip>
        )}
      </Space>
    );
  };

  // ── Columns ───────────────────────────────────────────────────────────────
  const allColumns = [
    {
      key: 'vm_name', dataIndex: 'vm_name', fixed: 'left', width: 180,
      title: labelOf('vm_name', 'Device Name'),
      render: (v, r) => <Link to={`/physical-esxi/${r.id}`}>{v || '(unnamed)'}</Link>,
    },
    {
      key: 'ip_address', dataIndex: 'ip_address', width: 140,
      title: labelOf('ip_address', 'Hosted IP'), render: dash,
    },
    {
      key: 'server_status', dataIndex: 'server_status', width: 130,
      title: labelOf('server_status', 'Status'), render: statusTag,
    },
    {
      key: 'department', dataIndex: 'department', width: 140,
      title: labelOf('department', 'Department'), render: dash,
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
      key: 'cpu_cores', dataIndex: 'cpu_cores', width: 100,
      title: labelOf('cpu_cores', 'CPU Cores'), align: 'right', render: numCell,
    },
    {
      key: 'ram_gb', dataIndex: 'ram_gb', width: 100,
      title: labelOf('ram_gb', 'RAM (GB)'), align: 'right', render: numCell,
    },
    {
      key: 'total_disks', dataIndex: 'total_disks', width: 100,
      title: labelOf('total_disks', 'Disks'), align: 'right', render: numCell,
    },
    {
      key: 'ome_status', dataIndex: 'ome_status', width: 130,
      title: labelOf('ome_status', 'OME Support'), render: omeTag,
    },
    {
      key: 'rack_number', dataIndex: 'rack_number', width: 120,
      title: labelOf('rack_number', 'Rack'), render: dash,
    },
    {
      key: 'server_position', dataIndex: 'server_position', width: 110,
      title: labelOf('server_position', 'Position (U)'), render: dash,
    },
    {
      key: 'serial_number', dataIndex: 'serial_number', width: 150,
      title: labelOf('serial_number', 'Serial Number'), render: dash,
    },
    {
      key: 'idrac_enabled', dataIndex: 'idrac_enabled', width: 90,
      title: labelOf('idrac_enabled', 'iDRAC'), align: 'center', render: yesNo,
    },
    {
      key: 'idrac_ip', dataIndex: 'idrac_ip', width: 130,
      title: labelOf('idrac_ip', 'iDRAC IP'), render: dash,
    },
    {
      key: 'os_type', dataIndex: 'os_type', width: 110,
      title: labelOf('os_type', 'OS Type'), render: dash,
    },
    {
      key: 'os_version', dataIndex: 'os_version', width: 150,
      title: labelOf('os_version', 'OS Version'), render: dash,
    },
    {
      key: 'os_hostname', dataIndex: 'os_hostname', width: 180,
      title: labelOf('os_hostname', 'Hostname'), render: dash,
    },
    {
      key: 'asset_type', dataIndex: 'asset_type', width: 140,
      title: labelOf('asset_type', 'Asset Type'), render: dash,
    },
    {
      key: 'assigned_user', dataIndex: 'assigned_user', width: 150,
      title: labelOf('assigned_user', 'Assigned User'), render: dash,
    },
    {
      key: 'asset_tag', dataIndex: 'asset_tag', width: 110,
      title: labelOf('asset_tag', 'Asset Tag'),
      render: v => v ? <Tag>{v}</Tag> : dash(v),
    },
    {
      key: 'hosted_ip', dataIndex: 'hosted_ip', width: 130,
      title: labelOf('hosted_ip', 'Hosted IP (alt)'), render: dash,
    },
    {
      key: 'mac_address', dataIndex: 'mac_address', width: 150,
      title: labelOf('mac_address', 'MAC Address'), render: dash,
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
    {
      key: 'additional_remarks', dataIndex: 'additional_remarks', width: 220,
      title: labelOf('additional_remarks', 'Notes'), ellipsis: true,
      render: v => v ? <Tooltip title={v}>{v}</Tooltip> : dash(v),
    },
    { key: 'created_by_name', dataIndex: 'created_by_name', width: 160, title: 'Submitted By', render: dash },
    { key: 'created_at', dataIndex: 'created_at', width: 170, title: 'Created',
      render: v => v ? new Date(v).toLocaleString() : dash(v) },
    { key: 'updated_by_name', dataIndex: 'updated_by_name', width: 160, title: 'Modified By', render: dash },
    { key: 'updated_at', dataIndex: 'updated_at', width: 170, title: 'Modified',
      render: v => v ? new Date(v).toLocaleString() : dash(v) },
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
  const pinned = new Set(['vm_name', '__actions__', 'asset_password',
    'created_by_name', 'created_at', 'updated_by_name', 'updated_at']);

  const visibleColumns = allColumns.filter(c => pinned.has(c.key) || !hiddenSet.has(c.key));

  const modelOptions = serverModels.map(m => ({
    label: m.manufacturer ? `${m.manufacturer} ${m.model_name}` : m.model_name,
    value: m.model_name,
  }));

  return (
    <Card
      title={<Typography.Title level={4} style={{ margin: 0 }}>{title}</Typography.Title>}
      extra={
        <Space>
          {!loading && data.total > 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              {data.total} server{data.total !== 1 ? 's' : ''}
            </Typography.Text>
          )}
          <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
          <Button icon={<DownloadOutlined />} onClick={onExport}>Export</Button>
          {canWrite && <Link to="/physical-esxi/import"><Button icon={<UploadOutlined />}>Import</Button></Link>}
          {canWrite && (
            <Link to="/physical-esxi/new">
              <Button type="primary" icon={<PlusOutlined />}>Register Server</Button>
            </Link>
          )}
        </Space>
      }
    >
      {/* ── Filters ── */}
      <Row gutter={[8, 8]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <Input
            prefix={<SearchOutlined />}
            placeholder="Search by name, hostname, IP, user, department…"
            value={filters.search}
            onChange={e => setFilters({ ...filters, search: e.target.value })}
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
        title={`${data.items.find(x => x.id === setpwTarget?.id)?.hasPassword ? 'Change' : 'Set'} Password — ${setpwTarget?.vm_name || ''}`}
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
    </Card>
  );
}
