import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Card, Table, Input, Select, Space, Button, Tag, Popconfirm, App, Row, Col, Typography,
} from 'antd';
import {
  PlusOutlined, DownloadOutlined, UploadOutlined, SearchOutlined,
  EditOutlined, DeleteOutlined, ReloadOutlined,
} from '@ant-design/icons';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';

export default function AssetList({
  apiPrefix = '/assets',
  basePath = '/assets',
  title = 'Asset Inventory',
  exportFilename = 'assets-export.xlsx',
  pageKey = 'assets',
}) {
  const { user, getPageLabel } = useAuth();
  const effectiveTitle = getPageLabel ? getPageLabel(pageKey, title) : title;
  const { message } = App.useApp();
  const nav = useNavigate();
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [dropdowns, setDropdowns] = useState({});
  const [filters, setFilters] = useState({ search: '', osType: undefined, serverStatus: undefined, location: undefined, eolStatus: undefined });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [hiddenSet, setHiddenSet] = useState(new Set());
  const isHidden = (k) => hiddenSet.has(k);
  const [fieldLabels, setFieldLabels] = useState({});
  const labelOf = (k, fallback) => fieldLabels[k] || fallback;

  const canWrite = ['admin','superadmin','asset_manager'].includes(user?.role);
  const isAdmin = ['admin','superadmin'].includes(user?.role);

  async function load() {
    setLoading(true);
    try {
      const params = { page, pageSize, ...filters };
      const { data } = await api.get(apiPrefix, { params });
      setData(data);
    } finally { setLoading(false); }
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

  async function onDelete(id) {
    await api.delete(`${apiPrefix}/${id}`);
    message.success('Asset deleted');
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

  const ddOptions = (cat) => (dropdowns[cat] || []).map(d => ({ label: d.value, value: d.value }));

  return (
    <Card
      title={<Typography.Title level={4} style={{ margin: 0 }}>{effectiveTitle}</Typography.Title>}
      extra={
        <Space>
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

      <Table
        rowKey="id"
        loading={loading}
        dataSource={data.items}
        pagination={{
          current: page, pageSize, total: data.total,
          showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100],
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          showTotal: (t) => `${t} assets`,
        }}
        scroll={{ x: 1200 }}
        columns={[
          { title: labelOf('vm_name', 'VM Name'), dataIndex: 'vm_name', fixed: 'left', width: 160, key: 'vm_name',
            render: (v, r) => <Link to={`${basePath}/${r.id}`}>{v}</Link> },
          !isHidden('os_hostname') && { title: labelOf('os_hostname', 'Hostname'), dataIndex: 'os_hostname', width: 180, key: 'os_hostname' },
          { title: labelOf('ip_address', 'IP'), dataIndex: 'ip_address', width: 130, key: 'ip_address' },
          !isHidden('os_type') && { title: labelOf('os_type', 'OS'), dataIndex: 'os_type', width: 110, key: 'os_type' },
          !isHidden('os_version') && { title: labelOf('os_version', 'OS Version'), dataIndex: 'os_version', width: 150, key: 'os_version' },
          !isHidden('server_status') && { title: labelOf('server_status', 'Status'), dataIndex: 'server_status', width: 120, key: 'server_status',
            render: v => v && <Tag color={v === 'Active' ? 'green' : v === 'Decommissioned' ? 'red' : 'orange'}>{v}</Tag> },
          !isHidden('location') && { title: labelOf('location', 'Location'), dataIndex: 'location', width: 140, key: 'location' },
          !isHidden('eol_status') && { title: labelOf('eol_status', 'EOL'), dataIndex: 'eol_status', width: 130, key: 'eol_status',
            render: v => v && <Tag color={v === 'Supported' ? 'green' : v === 'EOL' ? 'red' : 'orange'}>{v}</Tag> },
          !isHidden('assigned_user') && { title: labelOf('assigned_user', 'Assigned User'), dataIndex: 'assigned_user', width: 150, key: 'assigned_user' },
          !isHidden('department') && { title: labelOf('department', 'Department'), dataIndex: 'department', width: 140, key: 'department' },
          (!isHidden('manage_engine_installed') || !isHidden('tenable_installed') || !isHidden('idrac_enabled')) && {
            title: 'Tools', width: 130, key: '__tools__', render: (_, r) => (
              <Space size={4}>
                {!isHidden('manage_engine_installed') && r.manage_engine_installed && <Tag color="blue">ME</Tag>}
                {!isHidden('tenable_installed') && r.tenable_installed && <Tag color="purple">Tenable</Tag>}
                {!isHidden('idrac_enabled') && r.idrac_enabled && <Tag color="cyan">iDRAC</Tag>}
              </Space>
            )
          },
          {
            title: 'Actions', fixed: 'right', width: 120, key: '__actions__', render: (_, r) => (
              <Space>
                <Button size="small" icon={<EditOutlined />} onClick={() => nav(`${basePath}/${r.id}`)} />
                {isAdmin && (
                  <Popconfirm title="Delete this asset?" onConfirm={() => onDelete(r.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                )}
              </Space>
            )
          },
        ].filter(Boolean)}
      />
    </Card>
  );
}
