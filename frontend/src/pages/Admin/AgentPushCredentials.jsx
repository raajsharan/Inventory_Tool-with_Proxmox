import { useEffect, useState } from 'react';
import {
  App, Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography,
} from 'antd';
import { DeleteOutlined, PlusOutlined, SafetyOutlined, WindowsOutlined } from '@ant-design/icons';
import api from '../../api/client';

const { Title, Text } = Typography;
const isWindows = (t) => t === 'windows';

export default function AgentPushCredentials() {
  const { message } = App.useApp();
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [addOpen, setAddOpen]   = useState(false);
  const [form] = Form.useForm();
  const osType = Form.useWatch('os_type', form);
  const authType = Form.useWatch('auth_type', form);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/agent-push/credentials');
      setProfiles(data.profiles || []);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load credential profiles');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  const create = async (vals) => {
    try {
      await api.post('/agent-push/credentials', vals);
      message.success(`Saved credential profile "${vals.name}".`);
      setAddOpen(false);
      form.resetFields();
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to save credential profile');
    }
  };

  const remove = async (p) => {
    try {
      await api.delete(`/agent-push/credentials/${p.id}`);
      message.success(`Deleted "${p.name}".`);
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to delete credential profile');
    }
  };

  const columns = [
    { title: 'Name', dataIndex: 'name', width: 200 },
    {
      title: 'OS', dataIndex: 'os_type', width: 110,
      render: (t) => <Tag icon={isWindows(t) ? <WindowsOutlined /> : null} color={isWindows(t) ? 'blue' : 'default'}>{t}</Tag>,
    },
    { title: 'Auth type', dataIndex: 'auth_type', width: 110 },
    { title: 'Domain', dataIndex: 'domain', width: 140, render: (v) => v || '—' },
    { title: 'Username', dataIndex: 'username', width: 160 },
    { title: 'Created', dataIndex: 'created_at', render: (v) => v ? new Date(v).toLocaleDateString() : '—' },
    {
      title: '', width: 60,
      render: (_, r) => (
        <Popconfirm title={`Delete "${r.name}"?`} onConfirm={() => remove(r)} okText="Delete" okType="danger">
          <Button size="small" danger icon={<DeleteOutlined />} type="text" />
        </Popconfirm>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 900 }}>
      <Space align="start" style={{ marginBottom: 20 }}>
        <SafetyOutlined style={{ fontSize: 22, color: '#1677ff', marginTop: 4 }} />
        <div>
          <Title level={4} style={{ margin: 0 }}>Agent Push Credential Profiles</Title>
          <Text type="secondary">Reusable admin/root credentials for Agent Push targets not yet in the asset inventory — encrypted at rest</Text>
        </div>
      </Space>

      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>Add Credential Profile</Button>
      </div>

      <Table rowKey="id" loading={loading} dataSource={profiles} columns={columns} pagination={false} size="middle" />

      <Modal open={addOpen} title="Add Credential Profile" onCancel={() => setAddOpen(false)} destroyOnClose
        footer={[
          <Button key="cancel" onClick={() => setAddOpen(false)}>Cancel</Button>,
          <Button key="submit" type="primary" onClick={() => form.submit()}>Save</Button>,
        ]}
      >
        <Form form={form} layout="vertical" onFinish={create} initialValues={{ os_type: 'windows', auth_type: 'domain' }}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}><Input placeholder="Domain Admin" /></Form.Item>
          <Form.Item name="os_type" label="OS" rules={[{ required: true }]}>
            <Select options={[{ value: 'windows', label: 'Windows' }, { value: 'linux', label: 'Linux' }]} />
          </Form.Item>
          <Form.Item name="auth_type" label="Auth type" rules={[{ required: true }]}>
            <Select options={isWindows(osType)
              ? [{ value: 'domain', label: 'Domain account' }, { value: 'local', label: 'Local account' }]
              : [{ value: 'linux', label: 'Linux account' }]} />
          </Form.Item>
          {isWindows(osType) && authType === 'domain' && (
            <Form.Item name="domain" label="Domain"><Input placeholder="BURLINGTON" /></Form.Item>
          )}
          <Form.Item name="username" label="Username" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true }]}><Input.Password /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
