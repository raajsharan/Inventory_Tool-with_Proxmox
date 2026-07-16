import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card, Tabs, Form, Input, Select, Switch, Button, Space, Typography, App, Tag, Tooltip,
  Row, Col, Divider, Modal, Alert, InputNumber, Popconfirm, Empty,
} from 'antd';
import {
  SaveOutlined, ReloadOutlined, PlusOutlined, DeleteOutlined, EditOutlined,
  AppstoreOutlined, ArrowLeftOutlined, ArrowRightOutlined, ArrowUpOutlined, ArrowDownOutlined,
  LockOutlined, FontSizeOutlined, CheckOutlined, CloseOutlined,
} from '@ant-design/icons';
import api from '../../api/client';

const PAGE_TITLES = {
  assets:                'Asset Inventory Fields',
  beijing_assets:        'Beijing Inventory Fields',
  ext_assets:            'Ext. Inventory Fields',
  physical_esxi_servers: 'Physical & ESXi Fields',
};

const INPUT_TYPES = [
  { value: 'text',     label: 'Text Box' },
  { value: 'textarea', label: 'Text Area' },
  { value: 'number',   label: 'Number' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'toggle',   label: 'Toggle' },
  { value: 'date',     label: 'Date' },
];

// A <Select> for group/section names. Custom popup that shows each group
// with inline Rename and Delete actions, plus an Add row at the bottom.
function GroupSelect({ value, onChange, groups, addGroup, renameGroup, deleteGroup, size, style, placeholder }) {
  const [newName, setNewName] = useState('');
  const [editingGroup, setEditingGroup] = useState(null);
  const [editingValue, setEditingValue] = useState('');
  const [open, setOpen] = useState(false);

  function commitEdit(g) {
    const clean = (editingValue || '').trim();
    if (renameGroup && renameGroup(g, clean)) {
      if (value === g) onChange?.(clean);
      setEditingGroup(null);
    }
  }

  return (
    <Select
      size={size}
      value={value}
      onChange={(v) => { onChange?.(v); setOpen(false); }}
      open={open}
      onDropdownVisibleChange={(v) => { if (!v) setEditingGroup(null); setOpen(v); }}
      placeholder={placeholder || 'Pick a group'}
      style={style}
      // We use popupRender to fully control the list; native options are kept
      // for keyboard access and tag rendering.
      options={(groups || []).map(g => ({ value: g, label: g }))}
      popupRender={() => (
        <div onMouseDown={(e) => e.preventDefault()} style={{ padding: 4 }}>
          {(groups || []).length === 0 && (
            <div style={{ padding: 12, color: '#94a3b8', textAlign: 'center' }}>No groups yet</div>
          )}
          {(groups || []).map(g => {
            const isActive = value === g;
            const isEditing = editingGroup === g;
            return (
              <div
                key={g}
                onClick={() => { if (!isEditing) { onChange?.(g); setOpen(false); } }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 8px', borderRadius: 4, cursor: isEditing ? 'default' : 'pointer',
                  background: isActive ? 'rgba(22,119,255,0.10)' : 'transparent',
                }}
                onMouseEnter={(e) => { if (!isActive && !isEditing) e.currentTarget.style.background = 'rgba(0,0,0,0.04)'; }}
                onMouseLeave={(e) => { if (!isActive && !isEditing) e.currentTarget.style.background = 'transparent'; }}
              >
                {isEditing ? (
                  <>
                    <Input
                      size="small"
                      value={editingValue}
                      autoFocus
                      onChange={(e) => setEditingValue(e.target.value)}
                      onPressEnter={() => commitEdit(g)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ flex: 1 }}
                    />
                    <Tooltip title="Save">
                      <Button size="small" type="primary" icon={<CheckOutlined />}
                        onClick={(e) => { e.stopPropagation(); commitEdit(g); }} />
                    </Tooltip>
                    <Tooltip title="Cancel">
                      <Button size="small" icon={<CloseOutlined />}
                        onClick={(e) => { e.stopPropagation(); setEditingGroup(null); }} />
                    </Tooltip>
                  </>
                ) : (
                  <>
                    <span style={{ flex: 1, fontWeight: isActive ? 600 : 400 }}>{g}</span>
                    {renameGroup && (
                      <Tooltip title="Rename group">
                        <Button size="small" type="text"
                          icon={<EditOutlined style={{ color: '#1677ff' }} />}
                          onClick={(e) => { e.stopPropagation(); setEditingGroup(g); setEditingValue(g); }} />
                      </Tooltip>
                    )}
                    {deleteGroup && (
                      <Popconfirm
                        title={`Delete group "${g}"?`}
                        description="Fields in this group will be moved to a default group."
                        okType="danger"
                        onConfirm={(e) => { e?.stopPropagation?.(); deleteGroup(g); }}
                        onCancel={(e) => e?.stopPropagation?.()}
                      >
                        <Tooltip title="Delete group">
                          <Button size="small" type="text"
                            icon={<DeleteOutlined style={{ color: '#dc2626' }} />}
                            onClick={(e) => e.stopPropagation()} />
                        </Tooltip>
                      </Popconfirm>
                    )}
                  </>
                )}
              </div>
            );
          })}
          <Divider style={{ margin: '6px 0' }} />
          <div style={{ display: 'flex', gap: 6, padding: '4px 8px 8px' }}>
            <Input
              size="small"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New group name"
              onPressEnter={() => {
                if (addGroup(newName)) { onChange?.(newName.trim()); setNewName(''); setOpen(false); }
              }}
            />
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                if (addGroup(newName)) { onChange?.(newName.trim()); setNewName(''); setOpen(false); }
              }}
            >
              Add
            </Button>
          </div>
        </div>
      )}
    />
  );
}

export default function InventoryFields() {
  const { pageKey } = useParams();
  const nav = useNavigate();
  const { message } = App.useApp();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('groups');
  const [extraModal, setExtraModal] = useState({ open: false, editing: null });
  const [form] = Form.useForm();

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get(`/inventory-fields/${pageKey}`);
      setData(data);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load');
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [pageKey]); // eslint-disable-line

  function patchField(field_key, patch) {
    setData(d => ({
      ...d,
      fields: d.fields.map(f => f.field_key === field_key ? { ...f, ...patch } : f),
    }));
  }

  function addGroup(name) {
    const clean = String(name || '').trim();
    if (!clean) { message.warning('Group name cannot be empty'); return false; }
    if ((data?.groups || []).some(g => g.toLowerCase() === clean.toLowerCase())) {
      message.warning('Group already exists');
      return false;
    }
    setData(d => ({ ...d, groups: [...(d.groups || []), clean] }));
    message.success(`Group "${clean}" added — assign fields and click Save to persist`);
    return true;
  }

  function renameGroup(oldName, newName) {
    const clean = String(newName || '').trim();
    if (!clean || clean === oldName) return false;
    if ((data?.groups || []).some(g => g.toLowerCase() === clean.toLowerCase())) {
      message.warning('Another group already has that name');
      return false;
    }
    setData(d => ({
      ...d,
      groups: (d.groups || []).map(g => g === oldName ? clean : g),
      fields: d.fields.map(f => f.section === oldName ? { ...f, section: clean } : f),
    }));
    return true;
  }

  function deleteGroup(name) {
    const fallback = (data?.default_groups || data?.groups || []).find(g => g !== name) || 'Other';
    setData(d => ({
      ...d,
      groups: (d.groups || []).filter(g => g !== name),
      fields: d.fields.map(f => f.section === name ? { ...f, section: fallback } : f),
    }));
    message.success(`Group "${name}" removed — fields moved to "${fallback}"`);
    return true;
  }

  async function saveAll() {
    if (!data) return;
    setSaving(true);
    const updates = data.fields
      .filter(f => !f.is_extra)
      .map(f => ({
        field_key: f.field_key,
        label: f.label,
        section: f.section,
        input_type: f.frozen ? null : f.input_type,
        options: f.input_type === 'dropdown'
          ? (f.options || []).map(s => String(s ?? '').trim()).filter(Boolean)
          : null,
        is_required: !!f.is_required,
        sort_order: f.sort_order,
      }));
    try {
      const { data: fresh } = await api.put(`/inventory-fields/${pageKey}`, {
        updates,
        groups: data.groups || [],   // persist renames, deletions, new groups, empty groups
      });
      setData(fresh);
      message.success('Saved');
    } catch (e) {
      message.error(e.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  }

  async function resetField(field_key) {
    try {
      const { data: fresh } = await api.delete(`/inventory-fields/${pageKey}/${field_key}`);
      setData(fresh);
      message.success('Reset to default');
    } catch (e) {
      message.error(e.response?.data?.error || 'Reset failed');
    }
  }

  function openCreateExtra() {
    setExtraModal({ open: true, editing: null });
    form.resetFields();
    form.setFieldsValue({ section: data?.default_groups?.[0] || 'Other', input_type: 'text', is_required: false });
  }
  function openEditExtra(f) {
    setExtraModal({ open: true, editing: f });
    form.setFieldsValue({
      label: f.label,
      section: f.section,
      input_type: f.input_type,
      options: (f.options || []).join('\n'),
      is_required: f.is_required,
    });
  }
  async function submitExtra(values) {
    const body = {
      label: values.label,
      section: values.section,
      input_type: values.input_type,
      is_required: !!values.is_required,
      options: values.input_type === 'dropdown' && values.options
        ? values.options.split('\n').map(s => s.trim()).filter(Boolean)
        : null,
    };
    try {
      if (extraModal.editing) {
        const { data: fresh } = await api.put(`/inventory-fields/${pageKey}/extras/${extraModal.editing.field_key}`, body);
        setData(fresh);
      } else {
        const { data: fresh } = await api.post(`/inventory-fields/${pageKey}/extras`, body);
        setData(fresh);
      }
      message.success('Saved');
      setExtraModal({ open: false, editing: null });
    } catch (e) {
      message.error(e.response?.data?.error || 'Save failed');
    }
  }
  async function deleteExtra(field_key) {
    try {
      await api.delete(`/inventory-fields/${pageKey}/extras/${field_key}`);
      load();
      message.success('Removed');
    } catch (e) {
      message.error(e.response?.data?.error || 'Delete failed');
    }
  }

  const grouped = useMemo(() => {
    if (!data) return [];
    const map = new Map();
    for (const g of data.groups) map.set(g, []);
    for (const f of data.fields) {
      const sec = f.section || 'Other';
      if (!map.has(sec)) map.set(sec, []);
      map.get(sec).push(f);
    }
    return Array.from(map.entries()).map(([name, fields]) => ({ name, fields: [...fields].sort((a,b)=>a.sort_order-b.sort_order) }));
  }, [data]);

  if (!data && loading) return null;

  return (
    <Card
      title={
        <Space>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => nav('/admin/custom-pages')} />
          <AppstoreOutlined style={{ color: '#1f3a8a', fontSize: 22 }} />
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>
              {PAGE_TITLES[pageKey] || pageKey}
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Add fields by group · Edit custom fields inline · Reassign to different groups
            </Typography.Text>
          </div>
        </Space>
      }
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Reload</Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={saveAll}>Save</Button>
        </Space>
      }
    >
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: 'groups', label: 'Fields & Groups' },
          { key: 'move',   label: 'Move Built-in Fields' },
          { key: 'types',  label: 'Change Field Types' },
        ]}
      />

      {tab === 'groups' && (
        <FieldsAndGroups
          data={data}
          grouped={grouped}
          patchField={patchField}
          addGroup={addGroup}
          renameGroup={renameGroup}
          deleteGroup={deleteGroup}
          openCreateExtra={openCreateExtra}
          openEditExtra={openEditExtra}
          deleteExtra={deleteExtra}
          resetField={resetField}
        />
      )}

      {tab === 'move' && (
        <MoveBuiltInFields data={data} grouped={grouped} patchField={patchField}
          addGroup={addGroup} renameGroup={renameGroup} deleteGroup={deleteGroup} />
      )}

      {tab === 'types' && (
        <ChangeFieldTypes data={data} grouped={grouped} patchField={patchField} resetField={resetField} nav={nav} />
      )}

      <Modal
        open={extraModal.open}
        title={extraModal.editing ? `Edit custom field — ${extraModal.editing.label}` : 'Add custom field'}
        onCancel={() => setExtraModal({ open: false, editing: null })}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={submitExtra}>
          <Form.Item name="label" label="Field Label" rules={[{ required: true }]}>
            <Input placeholder="e.g. Cost Center" />
          </Form.Item>
          <Form.Item name="section" label="Group" rules={[{ required: true }]}>
            <GroupSelect groups={data?.groups || []} addGroup={addGroup} renameGroup={renameGroup} deleteGroup={deleteGroup} />
          </Form.Item>
          <Form.Item name="input_type" label="Input Type" rules={[{ required: true }]}>
            <Select options={INPUT_TYPES} />
          </Form.Item>
          <Form.Item shouldUpdate noStyle>
            {({ getFieldValue }) => getFieldValue('input_type') === 'dropdown' && (
              <Form.Item name="options" label="Dropdown Options (one per line)">
                <Input.TextArea rows={4} placeholder="Option A&#10;Option B&#10;Option C" />
              </Form.Item>
            )}
          </Form.Item>
          <Form.Item name="is_required" label="Required" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

// ===== Tab 1: Fields & Groups =====
function FieldsAndGroups({ data, grouped, openCreateExtra, openEditExtra, deleteExtra, resetField, patchField, addGroup, renameGroup, deleteGroup }) {
  const [newGroup, setNewGroup] = useState('');
  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={
          <span>
            Add Asset fields by group · Edit custom fields inline · Reassign to different groups
          </span>
        }
        action={
          <Space>
            <Input
              size="small"
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              placeholder="New group name"
              style={{ width: 180 }}
              onPressEnter={() => { if (addGroup(newGroup)) setNewGroup(''); }}
            />
            <Button size="small" icon={<PlusOutlined />} onClick={() => { if (addGroup(newGroup)) setNewGroup(''); }}>
              Add Group
            </Button>
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openCreateExtra}>Add Field</Button>
          </Space>
        }
      />
      {grouped.map(g => (
        <div key={g.name} style={{ marginBottom: 16 }}>
          <Divider orientation="left" style={{ fontSize: 11, letterSpacing: 1.5, color: '#94a3b8', textTransform: 'uppercase' }}>
            {g.name}
          </Divider>
          {g.fields.length === 0 && <Typography.Text type="secondary">No fields in this group.</Typography.Text>}
          {g.fields.map(f => (
            <Row key={f.field_key} gutter={16} align="middle" style={{
              padding: '10px 12px', marginBottom: 8, borderRadius: 6,
            }} className="inv-field-row">
              <Col xs={24} md={6}>
                <Space direction="vertical" size={2}>
                  <Typography.Text strong>{f.label}</Typography.Text>
                  <Tag style={{ fontFamily: 'monospace' }}>{f.field_key}</Tag>
                </Space>
              </Col>
              <Col xs={24} md={6}>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>Field Label</Typography.Text>
                <Input
                  value={f.label}
                  disabled={f.frozen && f.field_key === 'asset_password'}
                  onChange={e => patchField(f.field_key, { label: e.target.value })}
                  className="inv-edit-input"
                />
              </Col>
              <Col xs={24} md={5}>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>Group</Typography.Text>
                <GroupSelect
                  value={f.section}
                  onChange={(v) => patchField(f.field_key, { section: v })}
                  groups={data.groups}
                  addGroup={addGroup}
                  renameGroup={renameGroup}
                  deleteGroup={deleteGroup}
                  style={{ width: '100%' }}
                />
              </Col>
              <Col xs={24} md={3} style={{ textAlign: 'center' }}>
                {f.frozen && (
                  <Tooltip title={f.frozen_reason}>
                    <Tag icon={<LockOutlined />} color="default">locked</Tag>
                  </Tooltip>
                )}
                {f.linked_to_table && <Tag color="blue">DB-linked</Tag>}
                {f.is_extra && <Tag color="purple">Custom</Tag>}
              </Col>
              <Col xs={24} md={4} style={{ textAlign: 'right' }}>
                <Space>
                  {f.is_extra ? (
                    <>
                      <Button size="small" icon={<EditOutlined />} onClick={() => openEditExtra(f)} />
                      <Popconfirm title="Remove this custom field?" onConfirm={() => deleteExtra(f.field_key)}>
                        <Button size="small" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </>
                  ) : (
                    <Tooltip title="Reset this field to default">
                      <Button size="small" icon={<ReloadOutlined />} onClick={() => resetField(f.field_key)} />
                    </Tooltip>
                  )}
                </Space>
              </Col>
            </Row>
          ))}
        </div>
      ))}
    </>
  );
}

// ===== Tab 2: Move Built-in Fields =====
function MoveBuiltInFields({ data, grouped, patchField, addGroup, renameGroup, deleteGroup }) {
  const [newGroup, setNewGroup] = useState('');
  const [editingGroup, setEditingGroup] = useState(null);
  const [editingValue, setEditingValue] = useState('');

  function move(field_key, direction) {
    const current = data.fields.find(f => f.field_key === field_key);
    if (!current) return;
    const sameGroup = data.fields.filter(f => f.section === current.section).sort((a,b)=>a.sort_order-b.sort_order);
    const idx = sameGroup.findIndex(f => f.field_key === field_key);
    const swap = direction === 'up' ? sameGroup[idx-1] : sameGroup[idx+1];
    if (!swap) return;
    patchField(field_key, { sort_order: swap.sort_order });
    patchField(swap.field_key, { sort_order: current.sort_order });
  }

  // Include empty groups (no fields yet) so users can see and target them.
  const allGroups = useMemo(() => {
    const used = new Set(grouped.map(g => g.name));
    const all = [...grouped];
    for (const g of (data?.groups || [])) {
      if (!used.has(g)) all.push({ name: g, fields: [] });
    }
    return all;
  }, [grouped, data]);

  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="Reassign built-in fields to a different group, or change their order within a group. Save when you're done."
        action={
          <Space>
            <Input
              size="small"
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              placeholder="New group name"
              style={{ width: 200 }}
              onPressEnter={() => { if (addGroup(newGroup)) setNewGroup(''); }}
            />
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => { if (addGroup(newGroup)) setNewGroup(''); }}>
              Add Group
            </Button>
          </Space>
        }
      />
      {allGroups.map(g => (
        <div key={g.name} style={{ marginBottom: 16 }}>
          <Divider orientation="left" style={{ fontSize: 11, letterSpacing: 1.5, color: '#94a3b8', textTransform: 'uppercase' }}>
            {editingGroup === g.name ? (
              <Space size={4}>
                <Input
                  size="small"
                  value={editingValue}
                  autoFocus
                  onChange={(e) => setEditingValue(e.target.value)}
                  onPressEnter={() => { if (renameGroup(g.name, editingValue)) setEditingGroup(null); }}
                  style={{ width: 180 }}
                />
                <Button size="small" type="primary" onClick={() => { if (renameGroup(g.name, editingValue)) setEditingGroup(null); }}>Save</Button>
                <Button size="small" onClick={() => setEditingGroup(null)}>Cancel</Button>
              </Space>
            ) : (
              <Space size={4}>
                <span>{g.name}</span>
                <Tooltip title="Rename group">
                  <Button size="small" type="text" icon={<EditOutlined style={{ color: '#94a3b8' }} />}
                    onClick={() => { setEditingGroup(g.name); setEditingValue(g.name); }} />
                </Tooltip>
              </Space>
            )}
          </Divider>
          {g.fields.length === 0 && <Typography.Text type="secondary">No fields in this group yet — drop one here using the dropdown on any field below.</Typography.Text>}
          {g.fields.map((f, i) => (
            <Row key={f.field_key} gutter={8} align="middle" style={{
              padding: '8px 12px', marginBottom: 6,
              borderRadius: 6,
            }} className="inv-field-row">
              <Col flex="auto">
                <Space>
                  <Typography.Text strong>{f.label}</Typography.Text>
                  <Tag style={{ fontFamily: 'monospace' }}>{f.field_key}</Tag>
                  {f.is_extra && <Tag color="purple">Custom</Tag>}
                </Space>
              </Col>
              <Col>
                <Space>
                  <Button size="small" icon={<ArrowUpOutlined />} disabled={i === 0} onClick={() => move(f.field_key, 'up')} />
                  <Button size="small" icon={<ArrowDownOutlined />} disabled={i === g.fields.length-1} onClick={() => move(f.field_key, 'down')} />
                  <GroupSelect
                    size="small"
                    value={f.section}
                    onChange={(v) => patchField(f.field_key, { section: v })}
                    groups={data.groups}
                    addGroup={addGroup}
                    renameGroup={renameGroup}
                    deleteGroup={deleteGroup}
                    style={{ width: 220 }}
                  />
                </Space>
              </Col>
            </Row>
          ))}
        </div>
      ))}
    </>
  );
}

// ===== Tab 3: Change Field Types =====
function ChangeFieldTypes({ data, grouped, patchField, resetField, nav }) {
  return (
    <>
      <Alert
        type="warning"
        icon={<FontSizeOutlined />}
        showIcon
        style={{ marginBottom: 12 }}
        message={<><strong>Change Built-in Field Types</strong></>}
        description={
          <>
            Override the input type for any built-in field. For example, change <strong>Assigned User</strong> from
            a text box to a dropdown with predefined values, or convert <strong>Additional Remarks</strong> to a radio button selector.
            Switching a field to <strong>Dropdown</strong> automatically links it to its own category on the{' '}
            <strong>Dropdown Master</strong> page, where its values are then managed — the same place every other
            dropdown in the app is managed.
            <br />
            <Typography.Text type="warning" style={{ fontSize: 12 }}>
              ⚠ Fields linked to database tables (OS Type, Department, Server Model, etc.) always remain as dropdowns — shown below as <strong>Locked</strong>, but you can still rename their label.
            </Typography.Text>
          </>
        }
      />
      {grouped.map(g => {
        const editable = g.fields;
        if (!editable.length) return null;
        return (
          <div key={g.name} style={{ marginBottom: 24 }}>
            <Divider orientation="left" style={{ fontSize: 11, letterSpacing: 1.5, color: '#94a3b8', textTransform: 'uppercase' }}>
              {g.name}
            </Divider>
            {editable.map(f => (
              <Row key={f.field_key} gutter={16} align="middle" style={{
                padding: '12px 14px', marginBottom: 10, borderRadius: 6,
              }} className="inv-field-row">
                <Col xs={24} md={5}>
                  <Space direction="vertical" size={0}>
                    <Typography.Text strong>{f.default_label || f.label}</Typography.Text>
                    <Tag style={{ fontFamily: 'monospace' }}>{f.field_key}</Tag>
                  </Space>
                </Col>
                <Col xs={24} md={8}>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>Field Label</Typography.Text>
                  <Input
                    value={f.label}
                    onChange={e => patchField(f.field_key, { label: e.target.value })}
                    className="inv-edit-input"
                  />
                </Col>
                <Col xs={24} md={4}>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>Input Type</Typography.Text>
                  <Input
                    value={INPUT_TYPES.find(t => t.value === f.default_type)?.label || f.default_type}
                    disabled
                    className="inv-edit-input"
                  />
                </Col>
                <Col xs={24} md={4}>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>&nbsp;</Typography.Text>
                  {f.frozen ? (
                    <Tooltip title={f.frozen_reason}>
                      <Input value="Locked" disabled />
                    </Tooltip>
                  ) : (
                    <Select
                      value={f.input_type}
                      onChange={(v) => patchField(f.field_key, { input_type: v, options: v === 'dropdown' ? (f.options || []) : null })}
                      options={INPUT_TYPES}
                      style={{ width: '100%' }}
                    />
                  )}
                </Col>
                <Col xs={24} md={3} style={{ textAlign: 'right' }}>
                  <Tooltip title="Reset to default">
                    <Button size="small" icon={<ReloadOutlined />} onClick={() => resetField(f.field_key)} />
                  </Tooltip>
                </Col>

                {f.input_type === 'dropdown' && !f.frozen && (
                  <Col xs={24} style={{ marginTop: 10 }}>
                    {f.dropdown_category ? (
                      <Alert
                        type="info"
                        showIcon
                        message={
                          <Space size={4} wrap>
                            <span>Values for this dropdown are managed on the Dropdown Master page.</span>
                            <Button size="small" type="link" style={{ padding: 0 }}
                              onClick={() => nav('/admin/dropdowns')}>
                              Manage on Dropdown Master →
                            </Button>
                          </Space>
                        }
                      />
                    ) : (
                      <Alert
                        type="warning"
                        showIcon
                        message="Click Save to link this field to a new Dropdown Master category, where you'll add its values."
                      />
                    )}
                  </Col>
                )}
              </Row>
            ))}
          </div>
        );
      })}
    </>
  );
}
