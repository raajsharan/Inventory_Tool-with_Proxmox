import { useEffect, useMemo, useState } from 'react';
import {
  Card, Table, Tabs, Tag, Space, Button, Input, App, Typography, Tooltip, Popconfirm, Empty, Alert,
} from 'antd';
import {
  DeleteOutlined, RollbackOutlined, ReloadOutlined, SearchOutlined,
  DatabaseOutlined, GlobalOutlined, CloudServerOutlined, HddOutlined,
  AppstoreOutlined, DeleteFilled, WarningOutlined,
} from '@ant-design/icons';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';
import PasswordConfirmModal from '../../components/PasswordConfirmModal.jsx';

const TYPE_META = {
  assets:                { label: 'Assets',           icon: <DatabaseOutlined />,    color: 'blue' },
  beijing_assets:        { label: 'Beijing',          icon: <GlobalOutlined />,      color: 'magenta' },
  ext_assets:            { label: 'Ext. Assets',      icon: <CloudServerOutlined />, color: 'purple' },
  physical_esxi_servers: { label: 'Physical & ESXi',  icon: <HddOutlined />,         color: 'cyan' },
  custom_page_records:   { label: 'Custom Records',   icon: <AppstoreOutlined />,    color: 'orange' },
};

export default function RecycleBin() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [purgeTarget, setPurgeTarget] = useState(null);
  const [emptyAllOpen, setEmptyAllOpen] = useState(false);

  const isSuper = user?.role === 'superadmin';

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/recycle-bin', { params: { search: search || undefined } });
      setItems(data.items || []);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load recycle bin');
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line

  async function onRestore(row) {
    try {
      await api.post(`/recycle-bin/${row.type}/${row.id}/restore`);
      message.success(`Restored "${row.name || row.id}"`);
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Restore failed');
    }
  }

  async function onPurgeConfirmed(password) {
    if (!purgeTarget) return;
    await api.delete(`/recycle-bin/${purgeTarget.type}/${purgeTarget.id}`, { data: { password } });
    message.success(`Permanently deleted "${purgeTarget.name || purgeTarget.id}"`);
    setPurgeTarget(null);
    load();
  }

  async function onEmptyAllConfirmed(password) {
    const { data } = await api.post('/recycle-bin/empty', { password });
    const total = Object.values(data.counts || {}).reduce((s, n) => s + n, 0);
    message.success(`Recycle bin emptied — ${total} item(s) permanently deleted`);
    setEmptyAllOpen(false);
    load();
  }

  const filtered = useMemo(() => {
    let list = items;
    if (activeTab !== 'all') list = list.filter(i => i.type === activeTab);
    const q = (search || '').trim().toLowerCase();
    if (q) {
      list = list.filter(r =>
        [r.name, r.ip, r.tag, r.page_name, r.deleted_by_name].filter(Boolean)
          .some(v => String(v).toLowerCase().includes(q))
      );
    }
    return list;
  }, [items, activeTab, search]);

  const countByType = useMemo(() => {
    const m = { all: items.length };
    for (const i of items) m[i.type] = (m[i.type] || 0) + 1;
    return m;
  }, [items]);

  const columns = [
    {
      title: 'Type', dataIndex: 'type', width: 160,
      render: t => {
        const meta = TYPE_META[t] || { label: t, color: 'default' };
        return <Tag icon={meta.icon} color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: 'Name', dataIndex: 'name', ellipsis: true,
      render: (v, r) => (
        <Space size={6} wrap>
          <strong>{v || '(unnamed)'}</strong>
          {r.page_name && <Tag color="orange">{r.page_name}</Tag>}
        </Space>
      ),
    },
    { title: 'IP', dataIndex: 'ip', width: 140,
      render: v => v || <Typography.Text type="secondary">—</Typography.Text> },
    { title: 'Asset Tag', dataIndex: 'tag', width: 110,
      render: v => v ? <Tag>{v}</Tag> : <Typography.Text type="secondary">—</Typography.Text> },
    { title: 'Deleted By', dataIndex: 'deleted_by_name', width: 160,
      render: v => v || <Typography.Text type="secondary">—</Typography.Text> },
    { title: 'Deleted At', dataIndex: 'deleted_at', width: 180,
      render: v => v ? new Date(v).toLocaleString() : '' },
    {
      title: 'Actions', width: 200, fixed: 'right', align: 'right',
      render: (_, r) => (
        <Space>
          <Tooltip title="Restore">
            <Button size="small" type="primary" ghost icon={<RollbackOutlined />}
              onClick={() => onRestore(r)}>Restore</Button>
          </Tooltip>
          <Tooltip title={isSuper ? 'Permanently delete' : 'Only the superadmin can permanently delete'}>
            <Button size="small" danger icon={<DeleteOutlined />}
              disabled={!isSuper}
              onClick={() => setPurgeTarget(r)}>Delete</Button>
          </Tooltip>
        </Space>
      ),
    },
  ];

  const tabs = [
    { key: 'all',                    label: <span>All <Tag style={{ marginLeft: 6 }}>{countByType.all || 0}</Tag></span> },
    ...Object.keys(TYPE_META).map(t => ({
      key: t,
      label: (
        <span>
          {TYPE_META[t].icon} {TYPE_META[t].label}
          <Tag style={{ marginLeft: 6 }}>{countByType[t] || 0}</Tag>
        </span>
      ),
    })),
  ];

  return (
    <Card
      title={
        <Space>
          <DeleteFilled style={{ color: '#dc2626' }} />
          <Typography.Title level={4} style={{ margin: 0 }}>Recycle Bin</Typography.Title>
        </Space>
      }
      extra={
        <Space>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Search name / IP / tag / user"
            style={{ width: 260 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onPressEnter={load}
          />
          <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
          {isSuper && (
            <Button danger icon={<DeleteFilled />} onClick={() => setEmptyAllOpen(true)} disabled={!items.length}>
              Empty Bin
            </Button>
          )}
        </Space>
      }
    >
      <Alert
        type="info" showIcon
        icon={<WarningOutlined />}
        message={
          isSuper
            ? "Restoring brings the record back to its original inventory. Permanent delete cannot be undone."
            : "You can restore items. Permanent deletion is restricted to the superadmin."
        }
        style={{ marginBottom: 12 }}
      />
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabs} />
      <Table
        rowKey={(r) => `${r.type}:${r.id}`}
        loading={loading}
        dataSource={filtered}
        columns={columns}
        size="small"
        scroll={{ x: 'max-content' }}
        pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100] }}
        locale={{ emptyText: <Empty description="Recycle bin is empty" /> }}
      />

      <PasswordConfirmModal
        open={!!purgeTarget}
        title={`Permanently delete "${purgeTarget?.name || 'item'}"?`}
        message="This cannot be undone. The record will be removed from the database."
        okText="Delete forever"
        onCancel={() => setPurgeTarget(null)}
        onConfirm={onPurgeConfirmed}
      />
      <PasswordConfirmModal
        open={emptyAllOpen}
        title="Empty the entire Recycle Bin?"
        message={`Every deleted record across all inventories will be permanently removed (${items.length} item${items.length === 1 ? '' : 's'}). This cannot be undone.`}
        okText="Empty Bin"
        onCancel={() => setEmptyAllOpen(false)}
        onConfirm={onEmptyAllConfirmed}
      />
    </Card>
  );
}
