import { useEffect, useMemo, useState } from 'react';
import {
  Card, Table, Tabs, Tag, Space, Button, Input, App, Typography, Tooltip, Popconfirm, Empty, Alert, Modal, Select,
} from 'antd';
import {
  DeleteOutlined, RollbackOutlined, ReloadOutlined, SearchOutlined,
  DatabaseOutlined, GlobalOutlined, CloudServerOutlined, HddOutlined,
  AppstoreOutlined, DeleteFilled, WarningOutlined,
} from '@ant-design/icons';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';
import PasswordConfirmModal from '../../components/PasswordConfirmModal.jsx';
import { DASH_CSS } from '../../components/DashboardStatCard.jsx';

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
  const [locPickOpen, setLocPickOpen] = useState(false);
  const [locChoice, setLocChoice] = useState(null);
  const [locConfirmOpen, setLocConfirmOpen] = useState(false);

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
      // A 409 here carries the actual reason in `details` (e.g. the IP/asset
      // tag was reused by another active record since this one was deleted)
      // — the top-level "error" is just a generic label, show the specific
      // reason instead of leaving the user to guess why it failed.
      const details = e.response?.data?.details;
      const detailMsg = details && Object.values(details)[0];
      message.error(detailMsg || e.response?.data?.error || 'Restore failed');
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

  // Delete by location works on the inventory tab you are on ("All" = every
  // inventory). Custom records have no location, so they are never included.
  const INV = ['assets', 'beijing_assets', 'ext_assets', 'physical_esxi_servers'];
  const scopeTypes = activeTab === 'all' ? INV : INV.filter(t => t === activeTab);
  const locationCounts = useMemo(() => {
    const m = {};
    for (const i of items) {
      if (!scopeTypes.includes(i.type)) continue;
      const k = (i.location || '').trim() || '(blank)';
      m[k] = (m[k] || 0) + 1;
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [items, activeTab]); // eslint-disable-line
  const locChoiceCount = locationCounts.find(([k]) => k === locChoice)?.[1] || 0;

  async function onLocationPurgeConfirmed(password) {
    const { data } = await api.post('/recycle-bin/purge-location', { password, location: locChoice, types: scopeTypes });
    const total = Object.values(data.counts || {}).reduce((s, n) => s + n, 0);
    message.success(`${total} item(s) in "${locChoice}" permanently deleted`);
    setLocConfirmOpen(false); setLocChoice(null);
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
      className="dashcard"
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
          <Tooltip title="Reload the recycle bin"><Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button></Tooltip>
          {isSuper && (
            <Tooltip title="Permanently delete every recycle-bin item of one location">
              <Button danger icon={<DeleteOutlined />} onClick={() => { setLocChoice(null); setLocPickOpen(true); }}
                disabled={!items.length}>
                Delete by Location
              </Button>
            </Tooltip>
          )}
          {isSuper && (
            <Tooltip title="Permanently delete every item in the recycle bin">
              <Button danger icon={<DeleteFilled />} onClick={() => setEmptyAllOpen(true)} disabled={!items.length}>
                Empty Bin
              </Button>
            </Tooltip>
          )}
        </Space>
      }
    >
      <style>{DASH_CSS}</style>
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
        rowClassName="dashcard-row"
        scroll={{ x: 'max-content' }}
        pagination={{ showTotal: t => `${t} total`, pageSize: 20, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100] }}
        locale={{ emptyText: <Empty description="Recycle bin is empty" /> }}
      />

      <Modal
        open={locPickOpen}
        title="Delete by location"
        okText="Continue"
        okButtonProps={{ danger: true, disabled: !locChoice }}
        onCancel={() => setLocPickOpen(false)}
        onOk={() => { setLocPickOpen(false); setLocConfirmOpen(true); }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            Choose a location. Every recycle-bin item of that location in{' '}
            {activeTab === 'all' ? 'all inventories' : TYPE_META[activeTab]?.label} will be permanently deleted.
          </Typography.Text>
          <Select
            showSearch style={{ width: '100%' }} placeholder="Select location" value={locChoice}
            onChange={setLocChoice}
            options={locationCounts.map(([k, n]) => ({ value: k, label: `${k} (${n})` }))}
            notFoundContent="No items with a location on this tab"
          />
        </Space>
      </Modal>
      <PasswordConfirmModal
        open={locConfirmOpen}
        title={`Permanently delete all "${locChoice}" items?`}
        message={`${locChoiceCount} item${locChoiceCount === 1 ? '' : 's'} in ${activeTab === 'all' ? 'all inventories' : TYPE_META[activeTab]?.label} will be removed from the database. This cannot be undone.`}
        okText="Delete forever"
        onCancel={() => setLocConfirmOpen(false)}
        onConfirm={onLocationPurgeConfirmed}
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
