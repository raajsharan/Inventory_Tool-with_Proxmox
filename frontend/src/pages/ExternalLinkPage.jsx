import { useEffect, useState } from 'react';
import { Typography, Button, Tooltip, Card, Form, Input, Space, Popconfirm, App } from 'antd';
import {
  GlobalOutlined, ExportOutlined, InfoCircleOutlined,
  CopyOutlined, EyeOutlined, EyeInvisibleOutlined,
} from '@ant-design/icons';
import api from '../api/client';

const { Title, Text } = Typography;

// Per-user saved login for one external-link nav page. Credentials are
// stored server-side (encrypted at rest) and only ever decrypted for their
// owner — the embedded site is a different origin, so the browser won't let
// us read/fill its form automatically; copy-to-clipboard is the reliable
// path into it.
function SavedLoginPanel({ linkKey }) {
  const { message } = App.useApp();
  const [cred, setCred] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [form] = Form.useForm();

  const load = () => {
    setLoading(true);
    api.get(`/external-link-credentials/${linkKey}`)
      .then(r => setCred(r.data?.username ? r.data : null))
      .catch(() => setCred(null))
      .finally(() => setLoading(false));
  };
  useEffect(load, [linkKey]); // eslint-disable-line

  const copy = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success(`${label} copied`);
    } catch {
      message.error('Could not copy to clipboard');
    }
  };

  const save = async (values) => {
    setSaving(true);
    try {
      const { data } = await api.put(`/external-link-credentials/${linkKey}`, values);
      setCred(data);
      setEditing(false);
      setShowPassword(false);
      message.success('Login saved');
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to save login');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await api.delete(`/external-link-credentials/${linkKey}`);
      setCred(null);
      message.success('Saved login removed');
    } catch {
      message.error('Failed to remove saved login');
    }
  };

  if (loading) return null;

  if (editing || !cred) {
    return (
      <Card size="small" style={{ marginBottom: 12, flexShrink: 0 }}>
        <Form form={form} layout="inline" onFinish={save}>
          <Form.Item name="username" rules={[{ required: true, message: 'Username required' }]}>
            <Input placeholder="Username" style={{ width: 200 }} autoComplete="off" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: 'Password required' }]}>
            <Input.Password placeholder="Password" style={{ width: 200 }} autoComplete="new-password" />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={saving}>Save login</Button>
              {cred && <Button onClick={() => setEditing(false)}>Cancel</Button>}
            </Space>
          </Form.Item>
        </Form>
      </Card>
    );
  }

  return (
    <Card size="small" style={{ marginBottom: 12, flexShrink: 0 }}>
      <Space size="large" wrap>
        <Space size={4}>
          <Text type="secondary">Username</Text>
          <Text strong>{cred.username}</Text>
          <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => copy(cred.username, 'Username')} />
        </Space>
        <Space size={4}>
          <Text type="secondary">Password</Text>
          <Text strong style={{ fontFamily: 'var(--font-mono)' }}>
            {showPassword ? cred.password : '••••••••'}
          </Text>
          <Button
            size="small" type="text"
            icon={showPassword ? <EyeInvisibleOutlined /> : <EyeOutlined />}
            onClick={() => setShowPassword(s => !s)}
          />
          <Button size="small" type="text" icon={<CopyOutlined />} onClick={() => copy(cred.password, 'Password')} />
        </Space>
        <Button size="small" onClick={() => { form.setFieldsValue(cred); setEditing(true); }}>Edit</Button>
        <Popconfirm title="Remove this saved login?" okText="Remove" okButtonProps={{ danger: true }} onConfirm={remove}>
          <Button size="small" danger>Remove</Button>
        </Popconfirm>
      </Space>
    </Card>
  );
}

export default function ExternalLinkPage({ title, url, linkKey }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 104px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Title level={4} style={{ margin: 0 }}>
            <GlobalOutlined style={{ marginRight: 8 }} />
            {title}
          </Title>
          <Tooltip title="If the page below stays blank, the site is refusing to be embedded — use “Open in new tab” instead.">
            <InfoCircleOutlined style={{ color: '#8c8c8c', fontSize: 15 }} />
          </Tooltip>
        </div>
        <Button icon={<ExportOutlined />} href={url} target="_blank" rel="noreferrer">
          Open in new tab
        </Button>
      </div>

      <SavedLoginPanel linkKey={linkKey} />

      <iframe
        title={title}
        src={url}
        style={{ flex: 1, width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}
      />
    </div>
  );
}
