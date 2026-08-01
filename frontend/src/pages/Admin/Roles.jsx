import { useEffect, useState } from 'react';
import {
  App, Alert, Badge, Button, Card, Col, Form, Input, Modal, Popconfirm,
  Row, Space, Tag, Tooltip, Typography,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, LockOutlined, TeamOutlined, KeyOutlined,
} from '@ant-design/icons';
import api from '../../api/client';
import { DASH_CSS } from '../../components/DashboardStatCard.jsx';

const SYSTEM_ROLE_NAMES = ['superadmin', 'admin', 'asset_manager', 'viewer'];

const SYSTEM_ROLE_META = {
  superadmin:    { color: 'purple', capabilities: ['All pages', 'All write operations', 'User management', 'Cannot be limited'] },
  admin:         { color: 'red',    capabilities: ['All inventory pages', 'All admin pages', 'Write + import operations'] },
  asset_manager: { color: 'blue',   capabilities: ['All inventory pages', 'Write + import operations', 'No admin pages'] },
  viewer:        { color: 'default', capabilities: ['Read-only access', 'No write operations', 'Subject to page restrictions'] },
};

function toSlug(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export default function RolesPage() {
  const { message } = App.useApp();
  const [systemRoles, setSystemRoles] = useState([]);
  const [customRoles, setCustomRoles] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [modalOpen, setModalOpen]     = useState(false);
  const [editing, setEditing]         = useState(null);  // { ...role, isSystem? }
  const [saving, setSaving]           = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/roles');
      setSystemRoles(data.system || []);
      setCustomRoles(data.custom || []);
    } catch {
      message.error('Failed to load roles.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // ─── modal helpers ────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEditCustom = (role) => {
    setEditing({ ...role, isSystem: false });
    form.setFieldsValue({ label: role.label, name: role.name, description: role.description || '' });
    setModalOpen(true);
  };

  const openEditSystem = (role) => {
    setEditing({ ...role, isSystem: true });
    form.setFieldsValue({ label: role.label, description: role.description || '' });
    setModalOpen(true);
  };

  const handleLabelChange = (e) => {
    if (!editing) form.setFieldValue('name', toSlug(e.target.value));
  };

  const onSubmit = async (values) => {
    setSaving(true);
    try {
      if (editing?.isSystem) {
        await api.put(`/roles/system/${editing.name}`, {
          label: values.label,
          description: values.description,
        });
        message.success(`System role "${values.label}" updated.`);
      } else if (editing) {
        await api.put(`/roles/${editing.id}`, { label: values.label, description: values.description });
        message.success(`Role "${values.label}" updated.`);
      } else {
        await api.post('/roles', values);
        message.success(`Role "${values.label}" created.`);
      }
      setModalOpen(false);
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to save role.');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (role) => {
    try {
      await api.delete(`/roles/${role.id}`);
      message.success(`Role "${role.label}" deleted.`);
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to delete role.');
    }
  };

  // ─── render ───────────────────────────────────────────────────────────────
  const isSystemModal = editing?.isSystem;
  const isEditModal   = !!editing;

  return (
    <div>
      <style>{DASH_CSS}</style>
      {/* Header */}
      <Space align="start" style={{ marginBottom: 20 }}>
        <KeyOutlined style={{ fontSize: 24, color: '#1677ff', marginTop: 3 }} />
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>Role Management</Typography.Title>
          <Typography.Text type="secondary">
            View and configure system roles; create custom roles to assign to users
          </Typography.Text>
        </div>
      </Space>

      {/* ── System Roles ─────────────────────────────────────────────────── */}
      <Typography.Text
        type="secondary"
        style={{ display: 'block', marginBottom: 12, fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase' }}
      >
        System Roles
      </Typography.Text>
      <Alert
        type="info"
        showIcon
        message="System role names and core permissions are built-in and cannot be removed. You can edit the display label and description."
        style={{ marginBottom: 16 }}
      />
      <Row gutter={[16, 16]} style={{ marginBottom: 32 }}>
        {(systemRoles.length ? systemRoles : SYSTEM_ROLE_NAMES.map(n => ({ name: n, label: n, description: '' }))).map((r, ri) => {
          const meta = SYSTEM_ROLE_META[r.name] || { color: 'default', capabilities: [] };
          return (
            <Col xs={24} sm={12} xl={6} key={r.name}>
              <Card
                size="small"
                className="dashcard"
                style={{ height: '100%', border: '1px solid #f0f0f0', animationDelay: `${ri * 50}ms` }}
                bodyStyle={{ padding: '16px' }}
                actions={[
                  <Tooltip title="Edit label / description" key="edit">
                    <Button type="text" icon={<EditOutlined />} size="small" onClick={() => openEditSystem(r)}>
                      Edit
                    </Button>
                  </Tooltip>,
                ]}
              >
                <Space style={{ marginBottom: 8 }}>
                  <LockOutlined style={{ color: '#aaa' }} />
                  <Tag color={meta.color} style={{ margin: 0, fontWeight: 600 }}>{r.label}</Tag>
                  <Tag style={{ margin: 0, fontSize: 10, fontFamily: 'monospace' }}>{r.name}</Tag>
                </Space>
                <Typography.Text
                  type="secondary"
                  style={{ display: 'block', fontSize: 12, marginBottom: 10, lineHeight: 1.5, minHeight: 36 }}
                >
                  {r.description || <em>No description set</em>}
                </Typography.Text>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {meta.capabilities.map((c) => (
                    <Tag key={c} color="default" style={{ fontSize: 11, margin: 0 }}>{c}</Tag>
                  ))}
                </div>
              </Card>
            </Col>
          );
        })}
      </Row>

      {/* ── Custom Roles ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <Typography.Text
          type="secondary"
          style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase' }}
        >
          Custom Roles{' '}
          <Badge count={customRoles.length} showZero style={{ backgroundColor: '#1677ff' }} />
        </Typography.Text>
        <Button type="primary" icon={<PlusOutlined />} size="small" onClick={openCreate}>
          Add Role
        </Button>
      </div>

      {customRoles.length === 0 && !loading ? (
        <Card bodyStyle={{ padding: 40, textAlign: 'center' }}>
          <TeamOutlined style={{ fontSize: 32, color: '#d9d9d9', display: 'block', marginBottom: 8 }} />
          <Typography.Text type="secondary">
            No custom roles yet. Click <strong>Add Role</strong> to create one.
          </Typography.Text>
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {customRoles.map((r, ri) => (
            <Col xs={24} sm={12} xl={8} key={r.id}>
              <Card
                size="small"
                className="dashcard"
                style={{ border: '1px solid #e6f4ff', animationDelay: `${ri * 50}ms` }}
                bodyStyle={{ padding: '16px' }}
                actions={[
                  <Tooltip title="Edit label / description" key="edit">
                    <Button type="text" icon={<EditOutlined />} size="small" onClick={() => openEditCustom(r)}>
                      Edit
                    </Button>
                  </Tooltip>,
                  <Popconfirm
                    key="del"
                    title={`Delete role "${r.label}"?`}
                    description={
                      r.user_count > 0
                        ? `${r.user_count} user(s) still have this role — reassign them first.`
                        : 'This role will be permanently removed.'
                    }
                    onConfirm={() => r.user_count === 0 && onDelete(r)}
                    okButtonProps={{ disabled: r.user_count > 0, danger: true }}
                    okText="Delete"
                  >
                    <Button type="text" danger icon={<DeleteOutlined />} size="small">
                      Delete
                    </Button>
                  </Popconfirm>,
                ]}
              >
                <Space style={{ marginBottom: 6 }}>
                  <Tag color="geekblue" style={{ margin: 0, fontFamily: 'monospace', fontSize: 12 }}>
                    {r.name}
                  </Tag>
                  {r.user_count > 0 && (
                    <Tag icon={<TeamOutlined />} color="green" style={{ margin: 0 }}>
                      {r.user_count} user{r.user_count !== 1 ? 's' : ''}
                    </Tag>
                  )}
                </Space>
                <Typography.Text strong style={{ display: 'block', fontSize: 14, marginBottom: 4 }}>
                  {r.label}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12, lineHeight: 1.5 }}>
                  {r.description || <em>No description</em>}
                </Typography.Text>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {/* ── Modal (create / edit custom / edit system) ─────────────────── */}
      <Modal
        open={modalOpen}
        title={
          <Space>
            <KeyOutlined />
            {!isEditModal
              ? 'Create New Role'
              : isSystemModal
                ? `Edit System Role: ${editing.name}`
                : `Edit Role: ${editing.label}`}
          </Space>
        }
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        okText={!isEditModal ? 'Create Role' : 'Save'}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={onSubmit} style={{ marginTop: 16 }}>
          <Form.Item
            name="label"
            label="Display Name"
            rules={[{ required: true, message: 'Display name is required' }]}
            extra="Shown in dropdowns and role badges."
          >
            <Input placeholder="e.g. IT Manager" onChange={handleLabelChange} />
          </Form.Item>

          {/* Slug field: only shown for custom role create/edit, hidden for system roles */}
          {!isSystemModal && (
            <Form.Item
              name="name"
              label="Role ID (slug)"
              rules={[
                { required: true, message: 'Role ID is required' },
                { pattern: /^[a-z0-9_]+$/, message: 'Only lowercase letters, digits and underscores' },
              ]}
              extra={isEditModal ? 'Role ID cannot be changed after creation.' : 'Auto-generated from display name. Used internally.'}
            >
              <Input
                placeholder="e.g. it_manager"
                disabled={isEditModal}
                style={{ fontFamily: 'monospace' }}
              />
            </Form.Item>
          )}

          <Form.Item name="description" label="Description">
            <Input.TextArea
              rows={3}
              placeholder="Describe what this role can do…"
              maxLength={300}
              showCount
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
