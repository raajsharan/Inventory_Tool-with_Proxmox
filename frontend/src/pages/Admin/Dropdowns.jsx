import { useEffect, useMemo, useState } from 'react';
import {
  Card, Collapse, Input, Select, Button, Space, Typography, Tag, App, Popconfirm, Tooltip, Empty, InputNumber,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, CheckOutlined, CloseOutlined,
  TagsOutlined, EnvironmentOutlined, AppstoreOutlined, ClockCircleOutlined,
  ThunderboltOutlined, DesktopOutlined, FileTextOutlined, SafetyOutlined,
  HddOutlined,
} from '@ant-design/icons';
import api from '../../api/client';

// Each entry below describes one dropdown category and (optionally)
// which parent category it links to (used by OS Versions -> OS Types).
const CATEGORIES = [
  { key: 'location',          label: 'Locations',         icon: <EnvironmentOutlined /> },
  { key: 'os_type',           label: 'OS Types',          icon: <DesktopOutlined /> },
  { key: 'os_version',        label: 'OS Versions',       icon: <DesktopOutlined />, parentCategory: 'os_type', parentLabel: 'OS Types' },
  { key: 'server_status',     label: 'Server Status',     icon: <SafetyOutlined /> },
  { key: 'server_model',      label: 'Server Models',     icon: <HddOutlined /> },
  { key: 'patching_type',     label: 'Patching Type',     icon: <ThunderboltOutlined /> },
  { key: 'server_patch_type', label: 'Server Patch Type', icon: <ThunderboltOutlined /> },
  { key: 'patching_schedule', label: 'Patching Schedule', icon: <ClockCircleOutlined /> },
  { key: 'eol_status',        label: 'EOL Status',        icon: <FileTextOutlined /> },
];

function CategoryPanel({ meta, items, onAdd, onUpdate, onDelete, parentOptions }) {
  const { message } = App.useApp();
  const [editingId, setEditingId] = useState(null);
  const [editingValue, setEditingValue] = useState('');
  const [editingParent, setEditingParent] = useState(null);
  const [editingSort, setEditingSort] = useState(0);
  const [newValue, setNewValue] = useState('');
  const [newParent, setNewParent] = useState(null);
  const [parentFilter, setParentFilter] = useState(undefined);
  const [busy, setBusy] = useState(false);

  const hasParent = !!meta.parentCategory;
  const sorted = useMemo(() => {
    let xs = [...items].sort((a, b) =>
      (a.parent_value || '').localeCompare(b.parent_value || '') ||
      (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
      a.value.localeCompare(b.value)
    );
    if (hasParent && parentFilter) {
      xs = xs.filter(i => i.parent_value === parentFilter);
    }
    return xs;
  }, [items, parentFilter, hasParent]);

  function beginEdit(item) {
    setEditingId(item.id);
    setEditingValue(item.value);
    setEditingParent(item.parent_value || null);
    setEditingSort(item.sort_order ?? 0);
  }
  function cancelEdit() {
    setEditingId(null);
    setEditingValue('');
    setEditingParent(null);
  }
  async function saveEdit() {
    if (!editingValue.trim()) { message.warning('Value cannot be empty'); return; }
    setBusy(true);
    try {
      await onUpdate(editingId, {
        value: editingValue.trim(),
        parent_value: hasParent ? (editingParent || null) : null,
        sort_order: Number(editingSort) || 0,
      });
      cancelEdit();
    } catch (e) { /* parent shows message */ } finally { setBusy(false); }
  }
  async function addNew() {
    if (!newValue.trim()) { message.warning(`Enter a ${meta.label.toLowerCase()} value`); return; }
    if (hasParent && !newParent) { message.warning(`Pick a parent ${meta.parentLabel} first`); return; }
    setBusy(true);
    try {
      await onAdd({
        category: meta.key,
        value: newValue.trim(),
        parent_value: hasParent ? newParent : null,
        sort_order: items.length + 1,
      });
      setNewValue('');
      if (!hasParent) {/* keep newParent */}
    } catch (e) { /* parent shows message */ } finally { setBusy(false); }
  }

  return (
    <div>
      {hasParent && (
        <div style={{ marginBottom: 12 }}>
          <Space size={8} wrap>
            <Select
              allowClear
              value={parentFilter}
              onChange={setParentFilter}
              placeholder={`All ${meta.parentLabel}`}
              style={{ minWidth: 320, flex: 1 }}
              options={parentOptions || []}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {sorted.length} versions
            </Typography.Text>
          </Space>
        </div>
      )}

      {sorted.length === 0
        ? <Empty description={`No ${meta.label.toLowerCase()} yet`} />
        : (
          <div className="dd-list">
            {sorted.map(item => (
              <div key={item.id} className="dd-row">
                <div className="dd-row-main">
                  {hasParent && item.parent_value && (
                    <Tag color="default" style={{ minWidth: 72, textAlign: 'center' }}>
                      {item.parent_value}
                    </Tag>
                  )}
                  {editingId === item.id ? (
                    <Space size={6} style={{ flex: 1 }} wrap>
                      {hasParent && (
                        <Select
                          value={editingParent}
                          onChange={setEditingParent}
                          placeholder={meta.parentLabel}
                          style={{ minWidth: 160 }}
                          options={parentOptions || []}
                          allowClear
                        />
                      )}
                      <Input
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onPressEnter={saveEdit}
                        style={{ flex: 1, minWidth: 200 }}
                      />
                      <InputNumber
                        value={editingSort}
                        onChange={(v) => setEditingSort(v ?? 0)}
                        min={0}
                        style={{ width: 80 }}
                      />
                    </Space>
                  ) : (
                    <a className="dd-row-value">{item.value}</a>
                  )}
                </div>
                <Space size={4}>
                  {editingId === item.id ? (
                    <>
                      <Tooltip title="Save">
                        <Button size="small" type="primary" icon={<CheckOutlined />} onClick={saveEdit} loading={busy} />
                      </Tooltip>
                      <Tooltip title="Cancel">
                        <Button size="small" icon={<CloseOutlined />} onClick={cancelEdit} />
                      </Tooltip>
                    </>
                  ) : (
                    <>
                      <Tooltip title="Edit">
                        <Button size="small" type="text" icon={<EditOutlined style={{ color: '#1677ff' }} />} onClick={() => beginEdit(item)} />
                      </Tooltip>
                      <Popconfirm title={`Delete "${item.value}"?`} onConfirm={() => onDelete(item.id)} okType="danger">
                        <Tooltip title="Delete">
                          <Button size="small" type="text" icon={<DeleteOutlined style={{ color: '#dc2626' }} />} />
                        </Tooltip>
                      </Popconfirm>
                    </>
                  )}
                </Space>
              </div>
            ))}
          </div>
        )
      }

      <div className="dd-add-row">
        {hasParent && (
          <Select
            value={newParent}
            onChange={setNewParent}
            placeholder={`${meta.parentLabel}...`}
            style={{ minWidth: 140 }}
            options={parentOptions || []}
            allowClear
          />
        )}
        <Input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onPressEnter={addNew}
          placeholder={hasParent ? `New ${meta.label.toLowerCase().replace(/s$/, '')} name...` : `Add new ${meta.label.toLowerCase()} value...`}
          style={{ flex: 1 }}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={addNew} loading={busy}>Add</Button>
      </div>
    </div>
  );
}

export default function Dropdowns() {
  const { message } = App.useApp();
  const [all, setAll] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeKeys, setActiveKeys] = useState([]); // collapsed by default

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/dropdowns');
      setAll(data.items || []);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load');
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const byCategory = useMemo(() => {
    const m = {};
    for (const c of CATEGORIES) m[c.key] = [];
    for (const r of all) {
      if (!m[r.category]) m[r.category] = [];
      m[r.category].push(r);
    }
    return m;
  }, [all]);

  // Build parent options for cascading categories (e.g. OS Type list for OS Version).
  const parentOptionsByCategory = useMemo(() => {
    const out = {};
    for (const cat of CATEGORIES) {
      if (cat.parentCategory) {
        const parents = byCategory[cat.parentCategory] || [];
        out[cat.key] = parents
          .slice()
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.value.localeCompare(b.value))
          .map(p => ({ label: p.value, value: p.value }));
      }
    }
    return out;
  }, [byCategory]);

  async function onAdd(body) {
    try {
      await api.post('/dropdowns', body);
      message.success('Added');
      await load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Add failed');
      throw e;
    }
  }
  async function onUpdate(id, body) {
    try {
      await api.put(`/dropdowns/${id}`, body);
      message.success('Saved');
      await load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Update failed');
      throw e;
    }
  }
  async function onDelete(id) {
    try {
      await api.delete(`/dropdowns/${id}`);
      message.success('Deleted');
      await load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Delete failed');
    }
  }

  const items = CATEGORIES.map(cat => {
    const count = (byCategory[cat.key] || []).length;
    return {
      key: cat.key,
      label: (
        <Space size={8}>
          <span style={{
            width: 28, height: 28, borderRadius: 6,
            background: 'rgba(22,119,255,0.10)', color: '#1677ff',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {cat.icon}
          </span>
          <strong>{cat.label}</strong>
          {cat.parentCategory && (
            <Typography.Text type="secondary" style={{ fontWeight: 400, fontSize: 12 }}>
              (linked to {cat.parentLabel})
            </Typography.Text>
          )}
          <Tag color="blue" style={{ marginLeft: 4 }}>{count}</Tag>
        </Space>
      ),
      children: (
        <CategoryPanel
          meta={cat}
          items={byCategory[cat.key] || []}
          onAdd={onAdd}
          onUpdate={onUpdate}
          onDelete={onDelete}
          parentOptions={parentOptionsByCategory[cat.key]}
        />
      ),
    };
  });

  return (
    <Card
      loading={loading && !all.length}
      title={
        <Space>
          <TagsOutlined style={{ color: '#1677ff' }} />
          <Typography.Title level={4} style={{ margin: 0 }}>Dropdown Master</Typography.Title>
        </Space>
      }
      extra={
        <Space>
          <Button size="small" onClick={() => setActiveKeys(CATEGORIES.map(c => c.key))}>Expand all</Button>
          <Button size="small" onClick={() => setActiveKeys([])}>Collapse all</Button>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
        Manage dropdown options used by Asset and Custom Page forms. OS Versions are linked to OS Types — pick the parent when adding.
      </Typography.Paragraph>

      <Collapse
        activeKey={activeKeys}
        onChange={(k) => setActiveKeys(Array.isArray(k) ? k : [k])}
        items={items}
        bordered={false}
        className="dd-collapse"
      />
    </Card>
  );
}
