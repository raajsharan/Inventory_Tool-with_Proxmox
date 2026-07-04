import { useEffect, useState } from 'react';
import { Card, Table, Button, Modal, Form, Input, Select, Switch, Space, Tag, App, Popconfirm, Typography } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';

const SYSTEM_ROLE_COLORS = {
  superadmin: 'purple', admin: 'red', asset_manager: 'blue', viewer: 'default',
};

export default function Users() {
  const { message } = App.useApp();
  const { user } = useAuth();
  const [data, setData] = useState([]);
  const [roleOptions, setRoleOptions] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();

  async function load() {
    const { data } = await api.get('/users');
    setData(data.items);
  }

  async function loadRoles() {
    try {
      const { data } = await api.get('/roles/options');
      setRoleOptions(data.options || []);
    } catch {
      // fallback: basic system roles
      setRoleOptions([
        { label: 'Admin', value: 'admin' },
        { label: 'Asset Manager', value: 'asset_manager' },
        { label: 'Viewer', value: 'viewer' },
      ]);
    }
  }

  useEffect(() => { load(); loadRoles(); }, []);

  // superadmin option is filtered out server-side for non-superadmins already,
  // but guard client-side too so the UI label stays consistent
  const availableRoles = user?.role === 'superadmin'
    ? roleOptions
    : roleOptions.filter(r => r.value !== 'superadmin');

  function openCreate() { setEditing(null); form.resetFields(); form.setFieldValue('isActive', true); setOpen(true); }
  function openEdit(u) {
    setEditing(u);
    form.setFieldsValue({ email: u.email, fullName: u.full_name, role: u.role, isActive: u.is_active });
    setOpen(true);
  }

  async function onSubmit(v) {
    try {
      if (editing) await api.put(`/users/${editing.id}`, v);
      else await api.post('/users', v);
      message.success('Saved');
      setOpen(false); load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed');
    }
  }

  async function onDelete(id) {
    await api.delete(`/users/${id}`);
    message.success('Deleted'); load();
  }

  const roleColor = (r) => SYSTEM_ROLE_COLORS[r] || 'geekblue';

  return (
    <Card
      title={<Typography.Title level={4} style={{ margin: 0 }}>User Management</Typography.Title>}
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Add User</Button>}
    >
      <Table
        rowKey="id"
        dataSource={data}
        columns={[
          { title: 'Email', dataIndex: 'email' },
          { title: 'Name', dataIndex: 'full_name' },
          {
            title: 'Role', dataIndex: 'role',
            render: r => {
              const opt = roleOptions.find(o => o.value === r);
              return <Tag color={roleColor(r)}>{opt?.label || r}</Tag>;
            },
          },
          { title: 'Active', dataIndex: 'is_active', render: v => v ? <Tag color="green">Yes</Tag> : <Tag>No</Tag> },
          { title: 'Last Login', dataIndex: 'last_login_at', render: v => v ? new Date(v).toLocaleString() : '—' },
          {
            title: 'Actions', width: 130, render: (_, r) => (
              <Space>
                <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
                <Popconfirm title="Delete user?" onConfirm={() => onDelete(r.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <Modal open={open} title={editing ? 'Edit User' : 'Add User'} onCancel={() => setOpen(false)} onOk={() => form.submit()} destroyOnClose>
        <Form form={form} layout="vertical" onFinish={onSubmit}>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}><Input disabled={!!editing} /></Form.Item>
          <Form.Item name="fullName" label="Full Name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="role" label="Role" rules={[{ required: true }]}>
            <Select options={availableRoles} />
          </Form.Item>
          <Form.Item
            name="password"
            label={editing ? 'New password (leave blank to keep)' : 'Password'}
            rules={editing ? [] : [{ required: true, min: 8 }]}
          >
            <Input.Password />
          </Form.Item>
          {editing && (
            <Form.Item name="isActive" label="Active" valuePropName="checked"><Switch /></Form.Item>
          )}
        </Form>
      </Modal>
    </Card>
  );
}
