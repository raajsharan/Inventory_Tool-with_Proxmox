import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Card, Table, Input, Select, Space, Button, Tag, App, Row, Col, Typography, Tooltip, Modal, Form,
} from 'antd';
import {
  PlusOutlined, DownloadOutlined, UploadOutlined, SearchOutlined,
  EditOutlined, DeleteOutlined, ReloadOutlined, EyeOutlined, EyeInvisibleOutlined,
  LockOutlined, UnlockOutlined,
} from '@ant-design/icons';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';
import PasswordConfirmModal from '../../components/PasswordConfirmModal.jsx';

export default function AssetList({
  apiPrefix = '/assets',
  basePath = '/assets',
  title = 'Asset Inventory',
  exportFilename = 'assets-export.xlsx',
  pageKey = 'assets',
}) {
  const { user, getPageLabel, canViewPasswords } = useAuth();
  const effectiveTitle = getPageLabel ? getPageLabel(pageKey, title) : title;
  const { message } = App.useApp();
  const nav = useNavigate();
  // Filters, page and search live in the URL — a round trip to a record's
  // detail view (or a shared link) restores the exact same table view.
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [dropdowns, setDropdowns] = useState({});
  const [filters, setFilters] = useState(() => ({
    search:       searchParams.get('q')      || '',
    osType:       searchParams.get('os')     || undefined,
    serverStatus: searchParams.get('status') || undefined,
    location:     searchParams.get('loc')    || undefined,
    eolStatus:    searchParams.get('eol')    || undefined,
  }));
  const [page, setPage] = useState(() => Number(searchParams.get('page')) || 1);
  const [pageSize, setPageSize] = useState(() => Number(searchParams.get('size')) || 20);

  const hasFilters = !!(filters.search || filters.osType || filters.serverStatus
    || filters.location || filters.eolStatus);

  // Mirror the view state into the URL (replace — no history spam).
  useEffect(() => {
    const p = {};
    if (filters.search)       p.q      = filters.search;
    if (filters.osType)       p.os     = filters.osType;
    if (filters.serverStatus) p.status = filters.serverStatus;
    if (filters.location)     p.loc    = filters.location;
    if (filters.eolStatus)    p.eol    = filters.eolStatus;
    if (page > 1)             p.page   = String(page);
    if (pageSize !== 20)      p.size   = String(pageSize);
    setSearchParams(p, { replace: true });
  }, [filters, page, pageSize]); // eslint-disable-line
  const [hiddenSet, setHiddenSet] = useState(new Set());
  const isHidden = (k) => hiddenSet.has(k);
  const [fieldLabels, setFieldLabels] = useState({});
  const labelOf = (k, fallback) => fieldLabels[k] || fallback;
  const [revealed, setRevealed] = useState({}); // id -> decrypted password
  const [revealing, setRevealing] = useState({}); // id -> bool
  const [deleteTarget, setDeleteTarget] = useState(null); // { id, vm_name } awaiting password confirm
  const [setpwTarget, setSetpwTarget]   = useState(null); // { id, vm_name } for inline set-password modal
  const [setpwForm]                     = Form.useForm();
  const [setpwLoading, setSetpwLoading] = useState(false);
  const [selectedIds, setSelectedIds]   = useState([]);   // bulk-action selection
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkWorking, setBulkWorking]   = useState(false);
  const [bulkResetKey, setBulkResetKey] = useState(0);    // remounts the bulk selects after each action

  const canWrite = ['admin', 'superadmin', 'asset_manager'].includes(user?.role);
  const isAdmin  = ['admin', 'superadmin'].includes(user?.role);
  const canSeePasswords = canWrite || !!canViewPasswords;

  async function load(overrides = {}) {
    setLoading(true);
    try {
      const params = { page, pageSize, ...filters, ...overrides };
      const { data } = await api.get(apiPrefix, { params });
      setData(data);
      setRevealed({});
    } finally { setLoading(false); }
  }

  async function onBulkUpdate(fieldKey, value) {
    if (value === undefined || value === null) return;
    setBulkWorking(true);
    try {
      const { data: r } = await api.post(`${apiPrefix}/bulk-update`, {
        ids: selectedIds, fields: { [fieldKey]: value },
      });
      if (r.failed) {
        message.warning(`Updated ${r.success} of ${selectedIds.length} — ${r.failed} failed${r.failures[0]?.error ? ` (${r.failures[0].error})` : ''}`);
      } else {
        message.success(`Updated ${r.success} record${r.success !== 1 ? 's' : ''}`);
      }
      setSelectedIds([]);
      setBulkResetKey(k => k + 1);
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Bulk update failed');
    } finally { setBulkWorking(false); }
  }

  async function onBulkDeleteConfirmed(password) {
    const { data: r } = await api.post(`${apiPrefix}/bulk-delete`, { ids: selectedIds, password });
    message.success(`Moved ${r.success} record${r.success !== 1 ? 's' : ''} to Recycle Bin${r.failed ? ` — ${r.failed} failed` : ''}`);
    setBulkDeleteOpen(false);
    setSelectedIds([]);
    load();
  }

  function clearFilters() {
    setFilters({ search: '', osType: undefined, serverStatus: undefined, location: undefined, eolStatus: undefined });
    setPage(1);
    load({ page: 1, search: '', osType: undefined, serverStatus: undefined, location: undefined, eolStatus: undefined });
  }

  useEffect(() => { load(); }, [page, pageSize, filters.osType, filters.serverStatus, filters.location, filters.eolStatus]); // eslint-disable-line
  useEffect(() => {
    api.get('/dropdowns').then(r => setDropdowns(r.data.grouped || {}));
    api.get(`/field-visibility/${pageKey}`)
      .then(r => setHiddenSet(new Set(r.data.hidden || [])))
      .catch(() => {});
    api.get(`/inventory-fields/${pageKey}`)
      .then(r => {
        const m = {};
        for (const f of r.data.fields || []) m[f.field_key] = f.label;
        setFieldLabels(m);
      })
      .catch(() => {});
  }, [pageKey]);

  function onSearch() { setPage(1); load(); }

  async function onDeleteConfirmed(password) {
    if (!deleteTarget) return;
    await api.delete(`${apiPrefix}/${deleteTarget.id}`, { data: { password } });
    message.success('Moved to Recycle Bin');
    setDeleteTarget(null);
    load();
  }

  async function onExport() {
    const params = new URLSearchParams(
      Object.entries(filters).filter(([_, v]) => v !== undefined && v !== '')
    ).toString();
    const res = await api.get(`${apiPrefix}/export?${params}`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement('a');
    a.href = url; a.download = exportFilename; a.click();
    URL.revokeObjectURL(url);
  }

  async function onSetPassword({ newPassword }) {
    if (!setpwTarget) return;
    setSetpwLoading(true);
    try {
      await api.put(`${apiPrefix}/${setpwTarget.id}`, { assetPassword: newPassword });
      message.success('Password saved');
      setRevealed(prev => { const n = { ...prev }; delete n[setpwTarget.id]; return n; });
      setSetpwTarget(null);
      setpwForm.resetFields();
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to save password');
    } finally {
      setSetpwLoading(false);
    }
  }

  async function togglePassword(id, hasPassword) {
    if (!hasPassword) return;
    if (revealed[id]) {
      setRevealed(prev => { const n = { ...prev }; delete n[id]; return n; });
      return;
    }
    setRevealing(prev => ({ ...prev, [id]: true }));
    try {
      const { data } = await api.get(`${apiPrefix}/${id}/password`);
      setRevealed(prev => ({ ...prev, [id]: data.password || '' }));
    } catch (e) {
      message.error(e.response?.data?.error || 'Cannot view password');
    } finally {
      setRevealing(prev => { const n = { ...prev }; delete n[id]; return n; });
    }
  }

  const ddOptions = (cat) => (dropdowns[cat] || []).map(d => ({ label: d.value, value: d.value }));

  const yesNo = (v) => v == null ? '' : (v ? <Tag color="green">Yes</Tag> : <Tag>No</Tag>);
  const cell = (v) => (v === null || v === undefined || v === '') ? <Typography.Text type="secondary">—</Typography.Text> : v;

  const allColumns = [
    { key: 'vm_name', dataIndex: 'vm_name', fixed: 'left', width: 160,
      title: labelOf('vm_name', 'VM Name'),
      render: (v, r) => <Link to={`${basePath}/${r.id}`}>{v || '(unnamed)'}</Link> },
    { key: 'ip_address', dataIndex: 'ip_address', width: 130,
      title: labelOf('ip_address', 'IP Address'), render: cell },
    { key: 'os_hostname', dataIndex: 'os_hostname', width: 180,
      title: labelOf('os_hostname', 'Hostname'), render: cell },
    { key: 'asset_type', dataIndex: 'asset_type', width: 140,
      title: labelOf('asset_type', 'Asset Type'), render: cell },
    { key: 'os_type', dataIndex: 'os_type', width: 110,
      title: labelOf('os_type', 'OS Type'), render: cell },
    { key: 'os_version', dataIndex: 'os_version', width: 150,
      title: labelOf('os_version', 'OS Version'), render: cell },
    { key: 'assigned_user', dataIndex: 'assigned_user', width: 150,
      title: labelOf('assigned_user', 'Assigned User'), render: cell },
    { key: 'department', dataIndex: 'department', width: 140,
      title: labelOf('department', 'Department'), render: cell },
    { key: 'asset_tag', dataIndex: 'asset_tag', width: 110,
      title: labelOf('asset_tag', 'Asset Tag'), render: v => v ? <Tag>{v}</Tag> : cell(v) },
    { key: 'server_status', dataIndex: 'server_status', width: 130,
      title: labelOf('server_status', 'Server Status'),
      render: v => v ? <Tag color={v === 'Active' ? 'green' : v === 'Decommissioned' ? 'red' : 'orange'}>{v}</Tag> : cell(v) },
    { key: 'server_patch_type', dataIndex: 'server_patch_type', width: 150,
      title: labelOf('server_patch_type', 'Server Patch Type'), render: cell },
    { key: 'patching_type', dataIndex: 'patching_type', width: 130,
      title: labelOf('patching_type', 'Patching Type'), render: cell },
    { key: 'patching_schedule', dataIndex: 'patching_schedule', width: 150,
      title: labelOf('patching_schedule', 'Patching Schedule'), render: cell },
    { key: 'business_purpose', dataIndex: 'business_purpose', width: 200,
      title: labelOf('business_purpose', 'Business Purpose'), ellipsis: true,
      render: v => v ? <Tooltip title={v}>{v}</Tooltip> : cell(v) },
    { key: 'location', dataIndex: 'location', width: 140,
      title: labelOf('location', 'Location'), render: cell },
    { key: 'serial_number', dataIndex: 'serial_number', width: 140,
      title: labelOf('serial_number', 'Serial'), render: cell },
    { key: 'idrac_enabled', dataIndex: 'idrac_enabled', width: 90,
      title: labelOf('idrac_enabled', 'iDRAC'), align: 'center', render: yesNo },
    { key: 'idrac_ip', dataIndex: 'idrac_ip', width: 130,
      title: labelOf('idrac_ip', 'iDRAC IP'), render: cell },
    { key: 'ome_status', dataIndex: 'ome_status', width: 120,
      title: labelOf('ome_status', 'OME Status'), render: cell },
    { key: 'eol_status', dataIndex: 'eol_status', width: 130,
      title: labelOf('eol_status', 'EOL Status'),
      render: v => v ? <Tag color={v === 'Supported' ? 'green' : v === 'EOL' ? 'red' : 'orange'}>{v}</Tag> : cell(v) },
    { key: 'manage_engine_installed', dataIndex: 'manage_engine_installed', width: 130,
      title: labelOf('manage_engine_installed', 'Manage Engine'), align: 'center', render: yesNo },
    { key: 'tenable_installed', dataIndex: 'tenable_installed', width: 100,
      title: labelOf('tenable_installed', 'Tenable'), align: 'center', render: yesNo },
    { key: 'hosted_ip', dataIndex: 'hosted_ip', width: 130,
      title: labelOf('hosted_ip', 'Hosted IP'), render: cell },
    { key: 'created_by_name', dataIndex: 'created_by_name', width: 160,
      title: 'Submitted By', render: cell },
    { key: 'created_at', dataIndex: 'created_at', width: 170,
      title: 'Created', render: v => v ? new Date(v).toLocaleString() : cell(v) },
    { key: 'updated_by_name', dataIndex: 'updated_by_name', width: 160,
      title: 'Modified By', render: cell },
    { key: 'updated_at', dataIndex: 'updated_at', width: 170,
      title: 'Modified', render: v => v ? new Date(v).toLocaleString() : cell(v) },
    { key: 'asset_username', dataIndex: 'asset_username', width: 150,
      title: labelOf('asset_username', 'Asset Username'), render: cell },
    {
      key: 'asset_password', width: 200,
      title: labelOf('asset_password', 'Asset Password'),
      render: (_, r) => {
        const shown = revealed[r.id];
        const openSetModal = () => { setSetpwTarget({ id: r.id, vm_name: r.vm_name }); setpwForm.resetFields(); };

        if (!canSeePasswords) {
          return r.hasPassword
            ? <Space size={4}><span style={{ fontFamily: 'monospace' }}>••••••••</span><LockOutlined style={{ color: '#bbb' }} /></Space>
            : <Typography.Text type="secondary">—</Typography.Text>;
        }

        if (!r.hasPassword) {
          return canWrite ? (
            <Space size={4}>
              <Typography.Text type="secondary" style={{ fontFamily: 'monospace' }}>—</Typography.Text>
              <Tooltip title="Set password">
                <Button size="small" type="text" icon={<EyeOutlined style={{ color: '#bbb' }} />}
                  onClick={openSetModal} />
              </Tooltip>
            </Space>
          ) : <Typography.Text type="secondary">—</Typography.Text>;
        }

        return (
          <Space size={4}>
            <span style={{ fontFamily: 'monospace', minWidth: 70, display: 'inline-block' }}>
              {shown || '••••••••'}
            </span>
            <Tooltip title={shown ? 'Hide' : 'Reveal password'}>
              <Button size="small" type="text"
                icon={shown ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                loading={!!revealing[r.id]}
                onClick={() => togglePassword(r.id, r.hasPassword)} />
            </Tooltip>
            {canWrite && (
              <Tooltip title="Change password">
                <Button size="small" type="text"
                  icon={<UnlockOutlined style={{ color: '#aaa', fontSize: 12 }} />}
                  onClick={openSetModal} />
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    { key: 'additional_remarks', dataIndex: 'additional_remarks', width: 220,
      title: labelOf('additional_remarks', 'Additional Remarks'), ellipsis: true,
      render: v => v ? <Tooltip title={v}>{v}</Tooltip> : cell(v) },
    {
      key: '__actions__', title: 'Actions', fixed: 'right', width: 110,
      render: (_, r) => (
        <Space>
          <Tooltip title="Edit">
            <Button size="small" icon={<EditOutlined />} onClick={() => nav(`${basePath}/${r.id}/edit`)} />
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

  const visibleColumns = allColumns.filter(c => {
    if (c.key === 'vm_name' || c.key === '__actions__' || c.key === 'asset_password'
      || c.key === 'created_by_name' || c.key === 'created_at'
      || c.key === 'updated_by_name' || c.key === 'updated_at') return true;
    return !isHidden(c.key);
  });

  return (
    <Card
      title={<Typography.Title level={4} style={{ margin: 0 }}>{effectiveTitle}</Typography.Title>}
      extra={
        <Space>
          {!loading && data.total > 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              {data.total} asset{data.total !== 1 ? 's' : ''}
            </Typography.Text>
          )}
          <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
          <Button icon={<DownloadOutlined />} onClick={onExport}>Export</Button>
          {canWrite && <Link to={`${basePath}/import`}><Button icon={<UploadOutlined />}>Import</Button></Link>}
          {canWrite && <Link to={`${basePath}/new`}><Button type="primary" icon={<PlusOutlined />}>Add Asset</Button></Link>}
        </Space>
      }
    >
      <Row gutter={[8, 8]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={8}>
          <Input prefix={<SearchOutlined />} placeholder="Search VM, hostname, IP, user, dept"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            onPressEnter={onSearch} allowClear />
        </Col>
        <Col xs={12} md={4}>
          <Select allowClear placeholder="OS Type" style={{ width: '100%' }} value={filters.osType}
            onChange={(v) => setFilters({ ...filters, osType: v })} options={ddOptions('os_type')} />
        </Col>
        <Col xs={12} md={4}>
          <Select allowClear placeholder="Server Status" style={{ width: '100%' }} value={filters.serverStatus}
            onChange={(v) => setFilters({ ...filters, serverStatus: v })} options={ddOptions('server_status')} />
        </Col>
        <Col xs={12} md={4}>
          <Select allowClear placeholder="Location" style={{ width: '100%' }} value={filters.location}
            onChange={(v) => setFilters({ ...filters, location: v })} options={ddOptions('location')} />
        </Col>
        <Col xs={12} md={4}>
          <Select allowClear placeholder="EOL Status" style={{ width: '100%' }} value={filters.eolStatus}
            onChange={(v) => setFilters({ ...filters, eolStatus: v })} options={ddOptions('eol_status')} />
        </Col>
      </Row>

      {canWrite && selectedIds.length > 0 && (
        <div className="bulk-bar" key={bulkResetKey}>
          <Space wrap size={10}>
            <Typography.Text strong>{selectedIds.length} selected</Typography.Text>
            <Select size="small" style={{ minWidth: 150 }} placeholder="Set status…"
              options={ddOptions('server_status')} loading={bulkWorking}
              onChange={(v) => onBulkUpdate('serverStatus', v)} />
            <Select size="small" style={{ minWidth: 150 }} placeholder="Set location…"
              options={ddOptions('location')} loading={bulkWorking}
              onChange={(v) => onBulkUpdate('location', v)} />
            <Select size="small" style={{ minWidth: 150 }} placeholder="Set EOL status…"
              options={ddOptions('eol_status')} loading={bulkWorking}
              onChange={(v) => onBulkUpdate('eolStatus', v)} />
            {isAdmin && (
              <Button size="small" danger icon={<DeleteOutlined />}
                onClick={() => setBulkDeleteOpen(true)} loading={bulkWorking}>
                Delete selected
              </Button>
            )}
            <Button size="small" type="text" onClick={() => setSelectedIds([])}>
              Clear selection
            </Button>
          </Space>
        </div>
      )}

      <Table
        rowKey="id"
        loading={loading}
        dataSource={data.items}
        size="small"
        sticky
        rowSelection={canWrite ? {
          selectedRowKeys: selectedIds,
          onChange: (keys) => setSelectedIds(keys),
          columnWidth: 44,
          fixed: true,
        } : undefined}
        pagination={{
          current: page, pageSize, total: data.total,
          showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100],
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          showTotal: (t) => `${t} assets`,
        }}
        scroll={{ x: 'max-content' }}
        columns={visibleColumns}
        locale={{
          emptyText: (
            <div style={{ padding: '36px 0', textAlign: 'center' }}>
              {hasFilters ? (
                <>
                  <Typography.Text type="secondary">
                    No records match the current filters.
                  </Typography.Text>
                  <div style={{ marginTop: 14 }}>
                    <Button size="small" onClick={clearFilters}>Clear filters</Button>
                  </div>
                </>
              ) : (
                <>
                  <Typography.Text type="secondary">
                    No records yet.
                  </Typography.Text>
                  {canWrite && (
                    <div style={{ marginTop: 14 }}>
                      <Space>
                        <Link to={`${basePath}/new`}>
                          <Button type="primary" size="small" icon={<PlusOutlined />}>Add Asset</Button>
                        </Link>
                        <Link to={`${basePath}/import`}>
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
      <PasswordConfirmModal
        open={!!deleteTarget}
        title={`Delete "${deleteTarget?.vm_name || 'asset'}"?`}
        message="This will move the record to the Recycle Bin. A superadmin can restore it later."
        okText="Delete"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={onDeleteConfirmed}
      />

      <PasswordConfirmModal
        open={bulkDeleteOpen}
        title={`Delete ${selectedIds.length} selected record${selectedIds.length !== 1 ? 's' : ''}?`}
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
            name="newPassword"
            label="New Password"
            rules={[{ required: true, message: 'Please enter a password' }]}
          >
            <Input.Password autoComplete="new-password" autoFocus />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
