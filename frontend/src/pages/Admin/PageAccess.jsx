import { useEffect, useMemo, useState } from 'react';
import {
  Card, Table, Switch, Button, Space, Typography, App, Tag, Alert, Tooltip,
} from 'antd';
import { SaveOutlined, ReloadOutlined, SafetyOutlined } from '@ant-design/icons';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';
import { DASH_CSS } from '../../components/DashboardStatCard.jsx';

export default function PageAccess() {
  const { message } = App.useApp();
  const { refreshPageAccess } = useAuth();
  const [pages, setPages] = useState([]);
  const [roles, setRoles] = useState([]);
  const [matrix, setMatrix] = useState({}); // 'pageKey:role' -> boolean
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState({}); // same shape as matrix, only changed cells

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/page-access');
      setPages(data.pages || []);
      setRoles(data.roles || []);
      setMatrix(data.matrix || {});
      setDirty({});
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load');
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function toggle(pageKey, role) {
    const k = `${pageKey}:${role}`;
    const current = matrix[k] === undefined ? true : !!matrix[k]; // default-allow
    const next = !current;
    setMatrix(m => ({ ...m, [k]: next }));
    setDirty(d => ({ ...d, [k]: next }));
  }

  async function save() {
    const updates = Object.entries(dirty).map(([k, allowed]) => {
      const [page_key, role] = k.split(':');
      return { page_key, role, allowed };
    });
    if (!updates.length) {
      message.info('No changes to save');
      return;
    }
    setSaving(true);
    try {
      await api.put('/page-access', { updates });
      message.success('Page access updated');
      await refreshPageAccess();
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  }

  // Group pages by `group` field, preserving order.
  const grouped = useMemo(() => {
    const groups = new Map();
    for (const p of pages) {
      const g = p.group || 'Other';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(p);
    }
    return Array.from(groups.entries()).map(([name, items]) => ({ name, items }));
  }, [pages]);

  const dataSource = grouped.flatMap(g => [
    { key: `__group:${g.name}`, isGroup: true, group: g.name },
    ...g.items.map(p => ({ key: p.key, ...p })),
  ]);

  const columns = [
    {
      title: 'Page',
      dataIndex: 'label',
      render: (_, r) => r.isGroup
        ? <Typography.Text strong style={{ color: '#94a3b8', textTransform: 'uppercase', fontSize: 11, letterSpacing: 1 }}>{r.group}</Typography.Text>
        : <span>{r.label}</span>,
      onCell: (r) => r.isGroup ? { colSpan: roles.length + 2 } : {},
    },
    {
      title: 'Key',
      dataIndex: 'key',
      width: 220,
      render: (v, r) => r.isGroup ? null : <Tag>{v}</Tag>,
      onCell: (r) => r.isGroup ? { colSpan: 0 } : {},
    },
    ...roles.map(role => ({
      title: role.replace('_', ' '),
      key: role,
      width: 130,
      align: 'center',
      render: (_, r) => {
        if (r.isGroup) return null;
        const k = `${r.key}:${role}`;
        const checked = matrix[k] === undefined ? true : !!matrix[k];
        const changed = dirty[k] !== undefined;
        return (
          <Space>
            <Switch checked={checked} onChange={() => toggle(r.key, role)} />
            {changed && <Tag color="orange" style={{ marginLeft: 4 }}>changed</Tag>}
          </Space>
        );
      },
      onCell: (r) => r.isGroup ? { colSpan: 0 } : {},
    })),
  ];

  const dirtyCount = Object.keys(dirty).length;

  return (
    <Card
      className="dashcard"
      title={<Space><SafetyOutlined style={{ color: '#1677ff' }} /><Typography.Title level={4} style={{ margin: 0 }}>Page Access</Typography.Title></Space>}
      extra={
        <Space>
          <Tag color={dirtyCount ? 'orange' : 'default'}>{dirtyCount} pending</Tag>
          <Tooltip title="Discard unsaved changes and reload"><Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Reload</Button></Tooltip>
          <Tooltip title="Apply the pending access changes"><Button type="primary" icon={<SaveOutlined />} onClick={save} loading={saving} disabled={!dirtyCount}>
            Save
          </Button></Tooltip>
        </Space>
      }
    >
      <style>{DASH_CSS}</style>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Toggle off to deny a role access to a page. Default is allowed when no row exists. Superadmin always has access. Admin sub-pages (Users, Audit, …) also require the admin role on top of this matrix."
      />
      <Table
        rowKey="key"
        dataSource={dataSource}
        columns={columns}
        pagination={false}
        loading={loading}
        size="small"
        scroll={{ x: 'max-content' }}
        sticky={{ offsetScroll: 0 }}
        rowClassName={(r) => r.isGroup ? '' : 'dashcard-row'}
      />
    </Card>
  );
}
