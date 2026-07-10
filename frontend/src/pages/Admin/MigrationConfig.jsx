import { useState, useEffect, useCallback } from 'react';
import {
  Table, Button, Modal, Form, Input, Switch, Tag, Space,
  Typography, Popconfirm, message, Tooltip, Badge,
  Drawer, Checkbox, Divider, Collapse, Select,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, StarOutlined,
  ProjectOutlined, HddOutlined, CloudServerOutlined,
  SettingOutlined, DesktopOutlined, SafetyOutlined, ClusterOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import api from '../../api/client';
import { TAB_DEFAULTS, COLUMN_REGISTRY, CUSTOM_COLUMNS } from '../MigrationTracker/tabColumnRegistry.js';

const { Title, Text } = Typography;

const BUILTIN_TABS = [
  { key: 'bomgar_vms',      icon: <DesktopOutlined />,   defaultLabel: 'Bomgar VMs'      },
  { key: 'security_vms',    icon: <SafetyOutlined />,    defaultLabel: 'Security VMs'    },
  { key: 'standalone_esxi', icon: <ClusterOutlined />,   defaultLabel: 'Standalone ESXi' },
];

// ── Column checkbox panel ─────────────────────────────────────────────────────
function ColumnCheckboxes({ columns, hiddenColumns, onChange }) {
  const hiddenSet = new Set(hiddenColumns || []);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '4px 16px' }}>
      {columns.map(col => (
        <Checkbox
          key={col.key}
          checked={!hiddenSet.has(col.key)}
          onChange={e => {
            const arr = [...hiddenSet];
            if (!e.target.checked) {
              if (!arr.includes(col.key)) arr.push(col.key);
            } else {
              const i = arr.indexOf(col.key);
              if (i !== -1) arr.splice(i, 1);
            }
            onChange(arr);
          }}
        >
          {col.label}
        </Checkbox>
      ))}
    </div>
  );
}

// ── Field definition manager ──────────────────────────────────────────────────
const FIELD_TYPES = [
  { value: 'text',     label: 'Text'      },
  { value: 'textarea', label: 'Text Area' },
  { value: 'number',   label: 'Number'    },
  { value: 'date',     label: 'Date'      },
  { value: 'boolean',  label: 'Toggle'    },
  { value: 'dropdown', label: 'Dropdown'  },
];
const FIELD_TYPE_COLOR = { text: 'blue', textarea: 'cyan', number: 'green', date: 'orange', boolean: 'geekblue', dropdown: 'purple' };

function FieldDefManager({ projectId, tabKey }) {
  const [defs,        setDefs]        = useState([]);
  const [adding,      setAdding]      = useState(false);
  const [newLabel,    setNewLabel]    = useState('');
  const [newType,     setNewType]     = useState('text');
  const [newOptions,  setNewOptions]  = useState([]);
  const [optionInput, setOptionInput] = useState('');

  const loadDefs = useCallback(() => {
    if (!projectId || !tabKey) return;
    api.get(`/admin/migration-projects/${projectId}/field-definitions`, { params: { tab_key: tabKey } })
      .then(r => setDefs(r.data || []))
      .catch(() => {});
  }, [projectId, tabKey]);

  useEffect(() => { loadDefs(); }, [loadDefs]);

  const resetForm = () => { setAdding(false); setNewLabel(''); setNewType('text'); setNewOptions([]); setOptionInput(''); };

  const handleCreate = async () => {
    if (!newLabel.trim()) { message.warning('Field label is required'); return; }
    const body = { tab_key: tabKey, label: newLabel.trim(), field_type: newType };
    if (newType === 'dropdown') body.options = newOptions;
    try {
      await api.post(`/admin/migration-projects/${projectId}/field-definitions`, body);
      message.success(`Field "${newLabel.trim()}" created`);
      resetForm();
      loadDefs();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to create field');
    }
  };

  const handleDelete = async (def) => {
    try {
      await api.delete(`/admin/migration-projects/${projectId}/field-definitions/${def.id}`);
      message.success(`Field "${def.label}" deleted`);
      loadDefs();
    } catch {
      message.error('Failed to delete field');
    }
  };

  const addOption = () => {
    const v = optionInput.trim();
    if (v && !newOptions.includes(v)) { setNewOptions(p => [...p, v]); setOptionInput(''); }
  };

  return (
    <div style={{ marginTop: 4 }}>
      {defs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10 }}>
          {defs.map(def => (
            <div key={def.id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'rgba(0,0,0,0.025)', borderRadius: 6, padding: '4px 10px',
            }}>
              <Text style={{ flex: 1, fontSize: 13 }}>{def.label}</Text>
              <Tag color={FIELD_TYPE_COLOR[def.field_type] || 'default'} style={{ margin: 0 }}>
                {FIELD_TYPES.find(t => t.value === def.field_type)?.label || def.field_type}
              </Tag>
              {def.field_type === 'dropdown' && Array.isArray(def.options) && def.options.length > 0 && (
                <Tooltip title={def.options.join(', ')}>
                  <Text type="secondary" style={{ fontSize: 11 }}>{def.options.length} opts</Text>
                </Tooltip>
              )}
              <Popconfirm
                title={`Delete "${def.label}" field?`}
                description="All saved values for this field will be permanently deleted."
                okText="Delete" okButtonProps={{ danger: true }}
                onConfirm={() => handleDelete(def)}
              >
                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </div>
          ))}
        </div>
      )}

      {defs.length === 0 && !adding && (
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
          No custom fields defined for this tab.
        </Text>
      )}

      {adding ? (
        <div style={{ background: 'rgba(0,0,0,0.025)', borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <Input
              placeholder="Field label, e.g. Notes, Priority, Target Date…"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              onPressEnter={handleCreate}
              autoFocus
              style={{ flex: 1 }}
            />
            <Select
              value={newType}
              onChange={v => { setNewType(v); setNewOptions([]); setOptionInput(''); }}
              options={FIELD_TYPES}
              style={{ width: 130 }}
            />
          </div>
          {newType === 'dropdown' && (
            <div style={{ marginBottom: 10 }}>
              <Text style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                Options <Text type="secondary">(press Enter to add each)</Text>
              </Text>
              {newOptions.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                  {newOptions.map(opt => (
                    <Tag
                      key={opt} closable
                      onClose={() => setNewOptions(p => p.filter(o => o !== opt))}
                      style={{ margin: 0 }}
                    >
                      {opt}
                    </Tag>
                  ))}
                </div>
              )}
              <Input
                placeholder="Add option…"
                value={optionInput}
                onChange={e => setOptionInput(e.target.value)}
                onPressEnter={addOption}
                style={{ maxWidth: 240 }}
                suffix={
                  <Button type="link" size="small" onClick={addOption} style={{ padding: 0 }}>
                    Add
                  </Button>
                }
              />
            </div>
          )}
          <Space>
            <Button type="primary" size="small" onClick={handleCreate}>Add Field</Button>
            <Button size="small" onClick={resetForm}>Cancel</Button>
          </Space>
        </div>
      ) : (
        <Button size="small" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
          Add Field
        </Button>
      )}
    </div>
  );
}

// ── Tab config drawer ─────────────────────────────────────────────────────────
function TabConfigDrawer({ project, open, onClose, onSaved }) {
  const [saving,      setSaving]      = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [builtinCfg,  setBuiltinCfg]  = useState({});
  const [customTabs,  setCustomTabs]  = useState([]);
  const [addingNew,   setAddingNew]   = useState(false);
  const [newTabLabel, setNewTabLabel] = useState('');

  const reload = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    try {
      const [cfgRes, ctRes] = await Promise.all([
        api.get(`/admin/migration-projects/${project.id}/tab-config`),
        api.get(`/admin/migration-projects/${project.id}/custom-tabs`),
      ]);
      setBuiltinCfg(cfgRes.data || {});
      setCustomTabs(ctRes.data || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [project]);

  useEffect(() => { if (open && project) reload(); }, [open, project, reload]);

  const getBuiltin = (tabKey) => builtinCfg[tabKey] || { label: null, enabled: true, hidden_columns: [] };

  const setBuiltinField = (tabKey, field, value) => {
    setBuiltinCfg(prev => ({
      ...prev,
      [tabKey]: { ...getBuiltin(tabKey), [field]: value },
    }));
  };

  const handleSaveBuiltin = async () => {
    setSaving(true);
    try {
      await api.put(`/admin/migration-projects/${project.id}/tab-config`, builtinCfg);
      message.success('Tab configuration saved');
      onSaved?.();
      onClose();
    } catch {
      message.error('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const handleAddCustomTab = async () => {
    if (!newTabLabel.trim()) { message.warning('Enter a tab name'); return; }
    try {
      await api.post(`/admin/migration-projects/${project.id}/custom-tabs`, { label: newTabLabel.trim() });
      message.success(`"${newTabLabel}" tab created`);
      setNewTabLabel('');
      setAddingNew(false);
      reload();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to create tab');
    }
  };

  const handleUpdateCustomTab = async (tab, field, value) => {
    try {
      await api.patch(`/admin/migration-projects/${project.id}/custom-tabs/${tab.id}`, { [field]: value });
      reload();
    } catch {
      message.error('Update failed');
    }
  };

  const handleDeleteCustomTab = async (tab) => {
    try {
      await api.delete(`/admin/migration-projects/${project.id}/custom-tabs/${tab.id}`);
      message.success(`"${tab.label}" tab deleted`);
      reload();
    } catch {
      message.error('Failed to delete tab');
    }
  };

  const handleUpdateCustomHidden = async (tab, hiddenColumns) => {
    try {
      await api.patch(`/admin/migration-projects/${project.id}/custom-tabs/${tab.id}`, { hidden_columns: hiddenColumns });
      setCustomTabs(prev => prev.map(t => t.id === tab.id ? { ...t, hidden_columns: hiddenColumns } : t));
    } catch {
      message.error('Update failed');
    }
  };

  // Collapse items for built-in tabs
  const builtinItems = BUILTIN_TABS.map(tab => {
    const cfg  = getBuiltin(tab.key);
    const cols = COLUMN_REGISTRY[tab.key] || [];
    return {
      key:   tab.key,
      label: (
        <Space>
          {tab.icon}
          <Text strong>{cfg.label || tab.defaultLabel}</Text>
          {cfg.enabled === false && <Tag color="default">Disabled</Tag>}
        </Space>
      ),
      children: (
        <div style={{ padding: '4px 0' }}>
          <Space style={{ marginBottom: 12 }}>
            <Switch
              checked={cfg.enabled !== false}
              onChange={v => setBuiltinField(tab.key, 'enabled', v)}
              size="small"
            />
            <Text type="secondary" style={{ fontSize: 13 }}>
              {cfg.enabled !== false ? 'Visible in Migration Tracker' : 'Hidden from Migration Tracker'}
            </Text>
          </Space>
          <div style={{ marginBottom: 12 }}>
            <Text style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
              Tab Name <Text type="secondary">(leave blank to use default)</Text>
            </Text>
            <Input
              placeholder={`Default: ${tab.defaultLabel}`}
              value={cfg.label || ''}
              onChange={e => setBuiltinField(tab.key, 'label', e.target.value || null)}
              style={{ maxWidth: 320 }}
            />
          </div>
          <Divider plain style={{ margin: '12px 0 10px' }}>Visible Columns</Divider>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            VM Name is always shown. Uncheck to hide.
          </Text>
          <ColumnCheckboxes
            columns={cols}
            hiddenColumns={cfg.hidden_columns || []}
            onChange={v => setBuiltinField(tab.key, 'hidden_columns', v)}
          />
          <Divider plain style={{ margin: '14px 0 10px' }}>Custom Fields</Divider>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            Extra fields users fill in per VM row — text, number, toggle, dropdown, date, or text area.
          </Text>
          <FieldDefManager projectId={project?.id} tabKey={tab.key} />
        </div>
      ),
    };
  });

  // Collapse items for custom tabs
  const customItems = customTabs.map(tab => ({
    key: `custom-${tab.id}`,
    label: (
      <Space>
        <AppstoreOutlined />
        <Text strong>{tab.label}</Text>
        {!tab.enabled && <Tag color="default">Disabled</Tag>}
        <Tag color="purple">Custom</Tag>
      </Space>
    ),
    extra: (
      <Popconfirm
        title={`Delete "${tab.label}"?`}
        description="All VM data in this tab will be permanently deleted."
        okText="Delete"
        okButtonProps={{ danger: true }}
        onConfirm={() => handleDeleteCustomTab(tab)}
        onPopupClick={e => e.stopPropagation()}
      >
        <Button
          size="small" danger icon={<DeleteOutlined />}
          onClick={e => e.stopPropagation()}
        />
      </Popconfirm>
    ),
    children: (
      <div style={{ padding: '4px 0' }}>
        <Space style={{ marginBottom: 12 }}>
          <Switch
            checked={tab.enabled !== false}
            onChange={v => handleUpdateCustomTab(tab, 'enabled', v)}
            size="small"
          />
          <Text type="secondary" style={{ fontSize: 13 }}>
            {tab.enabled !== false ? 'Visible in Migration Tracker' : 'Hidden from Migration Tracker'}
          </Text>
        </Space>
        <div style={{ marginBottom: 12 }}>
          <Text style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Tab Name</Text>
          <Space.Compact style={{ maxWidth: 320 }}>
            <Input
              value={tab.label}
              onChange={e => setCustomTabs(prev => prev.map(t => t.id === tab.id ? { ...t, label: e.target.value } : t))}
              onBlur={e => {
                if (e.target.value.trim() && e.target.value !== tab.label)
                  handleUpdateCustomTab({ ...tab, label: e.target.value }, 'label', e.target.value);
              }}
            />
          </Space.Compact>
        </div>
        <Divider plain style={{ margin: '12px 0 10px' }}>Visible Columns</Divider>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
          VM Name is always shown. Uncheck to hide.
        </Text>
        <ColumnCheckboxes
          columns={CUSTOM_COLUMNS}
          hiddenColumns={tab.hidden_columns || []}
          onChange={v => handleUpdateCustomHidden(tab, v)}
        />
        <Divider plain style={{ margin: '14px 0 10px' }}>Custom Fields</Divider>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
          Extra fields users fill in per VM row — text, number, toggle, dropdown, date, or text area.
        </Text>
        <FieldDefManager projectId={project?.id} tabKey={`custom_${tab.id}`} />
      </div>
    ),
  }));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <Space>
          <SettingOutlined />
          <span>Configure Tabs{project ? ` — ${project.name}` : ''}</span>
        </Space>
      }
      width={620}
      extra={
        <Button type="primary" onClick={handleSaveBuiltin} loading={saving}>
          Save Built-in Tabs
        </Button>
      }
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Text type="secondary">Loading…</Text>
        </div>
      ) : (
        <>
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            Customise tab names, visibility, and column sets for this project. Custom tabs share the same VM fields as the built-in tabs.
          </Text>

          {/* ── Built-in tabs ───────────────────────────────────────── */}
          <Divider orientation="left" style={{ margin: '0 0 12px' }}>
            <Text strong style={{ fontSize: 13 }}>Built-in Tabs</Text>
          </Divider>
          <Collapse items={builtinItems} defaultActiveKey={BUILTIN_TABS.map(t => t.key)} style={{ marginBottom: 24 }} />

          {/* ── Custom tabs ─────────────────────────────────────────── */}
          <Divider orientation="left" style={{ margin: '0 0 12px' }}>
            <Space>
              <Text strong style={{ fontSize: 13 }}>Custom Tabs</Text>
              <Tag color="purple">{customTabs.length}</Tag>
            </Space>
          </Divider>

          {customTabs.length > 0 && (
            <Collapse items={customItems} style={{ marginBottom: 16 }} />
          )}

          {addingNew ? (
            <Space style={{ width: '100%', marginBottom: 12 }}>
              <Input
                placeholder="Tab name, e.g. DR VMs, Firewall Servers…"
                value={newTabLabel}
                onChange={e => setNewTabLabel(e.target.value)}
                onPressEnter={handleAddCustomTab}
                autoFocus
                style={{ width: 280 }}
              />
              <Button type="primary" onClick={handleAddCustomTab}>Create</Button>
              <Button onClick={() => { setAddingNew(false); setNewTabLabel(''); }}>Cancel</Button>
            </Space>
          ) : (
            <Button
              icon={<PlusOutlined />}
              onClick={() => setAddingNew(true)}
              style={{ marginBottom: 12 }}
            >
              Add Custom Tab
            </Button>
          )}

          <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
            Custom tab data is imported via XLSX — use the tab's exact name as the sheet name in your spreadsheet.
          </Text>
        </>
      )}
    </Drawer>
  );
}

export default function MigrationConfig() {
  const [projects, setProjects] = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [editing,  setEditing]  = useState(null);
  const [form]                  = Form.useForm();

  const [tabDrawerOpen,    setTabDrawerOpen]    = useState(false);
  const [tabDrawerProject, setTabDrawerProject] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/admin/migration-projects');
      setProjects(r.data);
    } catch { message.error('Failed to load migration projects'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (record) => {
    setEditing(record);
    form.setFieldsValue({
      name:        record.name,
      environment: record.environment,
      description: record.description,
      is_default:  record.is_default,
    });
    setModalOpen(true);
  };

  const openTabConfig = (record) => {
    setTabDrawerProject(record);
    setTabDrawerOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/admin/migration-projects/${editing.id}`, values);
        message.success('Project updated');
      } else {
        await api.post('/admin/migration-projects', values);
        message.success('Project created');
      }
      setModalOpen(false);
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/admin/migration-projects/${id}`);
      message.success('Project deleted. Data moved to default project.');
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Delete failed');
    }
  };

  const handleSetDefault = async (record) => {
    try {
      await api.patch(`/admin/migration-projects/${record.id}`, { is_default: true });
      message.success(`"${record.name}" is now the default project`);
      load();
    } catch (e) {
      message.error('Failed to set default');
    }
  };

  // Resolve the display label for a built-in tab from this project's tab_configs
  const builtinLabel = (record, tabKey) => {
    const override = record.tab_configs?.[tabKey]?.label;
    return override || TAB_DEFAULTS[tabKey]?.label || tabKey;
  };

  const totalVMs = (r) => {
    const builtinTotal = (r.bomgar_count ?? 0) + (r.security_count ?? 0) + (r.standalone_count ?? 0);
    const customTotal  = (r.custom_tabs || []).reduce((s, t) => s + (t.vm_count ?? 0), 0);
    return builtinTotal + customTotal;
  };

  const columns = [
    {
      title: 'Project',
      dataIndex: 'name',
      key: 'name',
      render: (v, r) => (
        <Space>
          <ProjectOutlined style={{ color: '#1677ff' }} />
          <Text strong>{v}</Text>
          {r.is_default && <Tag color="gold" style={{ marginLeft: 4 }}>Default</Tag>}
        </Space>
      ),
    },
    { title: 'Environment', dataIndex: 'environment', key: 'environment', width: 120,
      render: v => v ? <Tag>{v}</Tag> : <Text type="secondary">—</Text> },
    { title: 'Description', dataIndex: 'description', key: 'description', ellipsis: true,
      render: v => v || <Text type="secondary">—</Text> },
    {
      title: <><HddOutlined /> Hosts</>,
      dataIndex: 'host_count', key: 'host_count', width: 75, align: 'center',
      render: v => <Badge count={v ?? 0} showZero color="#1677ff" />,
    },
    {
      title: <><CloudServerOutlined /> Total VMs</>,
      key: 'total_vms', width: 90, align: 'center',
      render: (_, r) => <Badge count={totalVMs(r)} showZero color="#52c41a" />,
    },
    {
      title: 'VM Tabs',
      key: 'tab_breakdown',
      render: (_, r) => {
        const cfg = r.tab_configs || {};
        const builtins = [
          { key: 'bomgar_vms',      count: r.bomgar_count ?? 0,     icon: <DesktopOutlined /> },
          { key: 'security_vms',    count: r.security_count ?? 0,   icon: <SafetyOutlined />  },
          { key: 'standalone_esxi', count: r.standalone_count ?? 0, icon: <ClusterOutlined /> },
        ].filter(t => cfg[t.key]?.enabled !== false);

        const customs = (r.custom_tabs || []).filter(t => t.enabled !== false);

        return (
          <Space size={4} wrap>
            {builtins.map(t => (
              <Tooltip key={t.key} title={builtinLabel(r, t.key)}>
                <Tag
                  icon={t.icon}
                  style={{ margin: 0, cursor: 'default' }}
                  color={t.count > 0 ? 'default' : undefined}
                >
                  {builtinLabel(r, t.key).split(' ')[0]} <Text type="secondary" style={{ fontSize: 11 }}>{t.count}</Text>
                </Tag>
              </Tooltip>
            ))}
            {customs.map(t => (
              <Tooltip key={t.id} title={`Custom: ${t.label}`}>
                <Tag
                  icon={<AppstoreOutlined />}
                  color="purple"
                  style={{ margin: 0, cursor: 'default' }}
                >
                  {t.label} <Text style={{ fontSize: 11, color: 'inherit' }}>{t.vm_count ?? 0}</Text>
                </Tag>
              </Tooltip>
            ))}
            {builtins.length === 0 && customs.length === 0 && (
              <Text type="secondary" style={{ fontSize: 12 }}>No tabs</Text>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 210,
      render: (_, record) => (
        <Space size={4}>
          <Tooltip title="Configure tab names, columns & custom tabs">
            <Button size="small" icon={<SettingOutlined />} onClick={() => openTabConfig(record)}>
              Tabs
            </Button>
          </Tooltip>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>Edit</Button>
          {!record.is_default && (
            <Tooltip title="Set as default project">
              <Button size="small" icon={<StarOutlined />} onClick={() => handleSetDefault(record)} />
            </Tooltip>
          )}
          {!record.is_default && (
            <Popconfirm
              title="Delete this project?"
              description="All data will be reassigned to the default project."
              okText="Delete"
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDelete(record.id)}
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>Migration Projects</Title>
          <Text type="secondary">
            Create separate migration projects for different environments or migration waves.
            Each project has its own hosts, VMs, and fully configurable tabs.
          </Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          New Project
        </Button>
      </div>

      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={projects}
        columns={columns}
        pagination={false}
        locale={{ emptyText: 'No migration projects yet. Create your first project to get started.' }}
      />

      {/* Project create / edit modal */}
      <Modal
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        confirmLoading={saving}
        title={editing ? 'Edit Migration Project' : 'New Migration Project'}
        okText={editing ? 'Save Changes' : 'Create Project'}
        destroyOnClose
        width={480}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="Project Name"
            rules={[{ required: true, message: 'Project name is required' }]}
          >
            <Input placeholder="e.g. Bomgar Migration 2026, DR Environment" />
          </Form.Item>
          <Form.Item name="environment" label="Environment">
            <Input placeholder="e.g. Production, Staging, DR, Test" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={3} placeholder="Optional notes about this migration project..." />
          </Form.Item>
          <Form.Item name="is_default" label="Set as default project" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      {/* Tab config drawer */}
      <TabConfigDrawer
        project={tabDrawerProject}
        open={tabDrawerOpen}
        onClose={() => setTabDrawerOpen(false)}
        onSaved={load}
      />
    </div>
  );
}
