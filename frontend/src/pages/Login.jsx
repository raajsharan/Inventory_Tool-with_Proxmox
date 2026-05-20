import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Card, Form, Input, Button, Typography, Alert } from 'antd';
import { LockOutlined, MailOutlined, BankOutlined } from '@ant-design/icons';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const { login, loading, branding } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [error, setError] = useState('');
  const toolName    = branding?.tool_name    || 'Infrastructure Inventory';
  const companyName = branding?.company_name || '';
  const tagline     = branding?.tagline      || 'Infrastructure';
  const footerHtml  = (branding?.footer_html
    || `© ${new Date().getFullYear()} ${toolName}. All rights reserved.`)
      .replace(/\{year\}/g, new Date().getFullYear())
      .replace(/\{tool\}/g, toolName);

  async function onFinish(values) {
    setError('');
    try {
      await login(values.email, values.password);
      const to = loc.state?.from?.pathname || '/dashboard';
      nav(to, { replace: true });
    } catch (e) {
      setError(e.response?.data?.error || 'Login failed');
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #0f1e4d 0%, #1f3a8a 100%)'
    }}>
      <Card style={{ width: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 14, background: '#1677ff',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden', marginBottom: 12,
          }}>
            {branding?.logo_data_url
              ? <img alt="logo" src={branding.logo_data_url} style={{ maxWidth: '80%', maxHeight: '80%' }} />
              : <BankOutlined style={{ fontSize: 36, color: 'white' }} />}
          </div>
          <Typography.Title level={3} style={{ marginBottom: 4 }}>{toolName}</Typography.Title>
          <Typography.Text type="secondary">
            {companyName ? `${companyName} · ${tagline}` : tagline}
          </Typography.Text>
        </div>
        {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
        <Form layout="vertical" onFinish={onFinish} initialValues={{ email: 'admin@example.com' }}>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
            <Input prefix={<MailOutlined />} placeholder="you@example.com" size="large" />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="Password" size="large" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={loading} block size="large">
            Sign in
          </Button>
        </Form>
        <Typography.Paragraph type="secondary" style={{ marginTop: 24, fontSize: 12, textAlign: 'center' }}>
          Default admin (seeded): admin@example.com / Admin@123
        </Typography.Paragraph>
      </Card>
      <div style={{ position: 'fixed', bottom: 12, left: 0, right: 0, textAlign: 'center',
        color: 'rgba(255,255,255,0.75)', fontSize: 12 }}>
        <span dangerouslySetInnerHTML={{ __html: footerHtml }} />
      </div>
    </div>
  );
}
