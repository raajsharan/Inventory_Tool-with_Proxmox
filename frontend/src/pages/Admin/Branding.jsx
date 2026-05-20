import { useEffect, useRef, useState } from 'react';
import {
  Card, Row, Col, Input, Button, Space, Typography, App, Upload, Alert, Tooltip, Form,
} from 'antd';
import {
  BgColorsOutlined, EyeOutlined, TagOutlined, UploadOutlined, DeleteOutlined,
  SaveOutlined, BankOutlined,
} from '@ant-design/icons';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';

const LOGO_MAX_BYTES = 1.5 * 1024 * 1024;

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

export default function AdminBranding() {
  const { message } = App.useApp();
  const { branding, refreshBranding, user } = useAuth();
  const [form, setForm] = useState({
    tool_name: '', company_name: '', tagline: 'Infrastructure', footer_html: '', logo_data_url: '',
  });
  const [saving, setSaving] = useState(false);
  const [logoName, setLogoName] = useState('');
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    api.get('/branding').then(r => {
      setForm({
        tool_name: r.data.tool_name || '',
        company_name: r.data.company_name || '',
        tagline: r.data.tagline || 'Infrastructure',
        footer_html: r.data.footer_html || '',
        logo_data_url: r.data.logo_data_url || '',
      });
      initialized.current = true;
    }).catch(() => {});
  }, []);

  async function onSave() {
    setSaving(true);
    try {
      await api.put('/branding', form);
      await refreshBranding();
      message.success('Branding saved. Reload to apply sidebar & login changes.');
    } catch (e) {
      message.error(e.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  }

  async function onLogoUpload(file) {
    if (file.size > LOGO_MAX_BYTES) {
      message.error('Logo must be under 1.5 MB');
      return false;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setForm(f => ({ ...f, logo_data_url: dataUrl }));
      setLogoName(file.name);
      message.success('Logo loaded — click Save Changes to persist');
    } catch {
      message.error('Failed to read file');
    }
    return false;
  }

  function onRemoveLogo() {
    setForm(f => ({ ...f, logo_data_url: '' }));
    setLogoName('');
  }

  const currentYear = new Date().getFullYear();
  const previewFooter = form.footer_html
    || `© ${currentYear} ${form.tool_name || 'Tool'}. All rights reserved.`;

  return (
    <Card
      title={
        <Space>
          <BgColorsOutlined style={{ color: '#1677ff' }} />
          <Typography.Title level={4} style={{ margin: 0 }}>Branding & Customization</Typography.Title>
        </Space>
      }
    >
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card type="inner" title="Application Settings">
            <Alert
              type="info"
              icon={<TagOutlined />}
              showIcon
              message={<strong>Tool Name <Typography.Text type="secondary" style={{ fontWeight: 400 }}>(appears everywhere)</Typography.Text></strong>}
              description={
                <>
                  <Input
                    value={form.tool_name}
                    onChange={e => setForm(f => ({ ...f, tool_name: e.target.value }))}
                    placeholder="e.g. Sys Spec"
                    size="large"
                    style={{ marginTop: 8 }}
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
                    Appears in: sidebar logo · browser tab title · login page · page footer
                  </Typography.Text>
                </>
              }
              style={{ marginBottom: 16 }}
            />

            <Form layout="vertical">
              <Form.Item label="Company Name" extra="Shown on the login page subtitle">
                <Input
                  value={form.company_name}
                  onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))}
                  placeholder="e.g. Netbrain Technologies"
                />
              </Form.Item>

              <Form.Item label="Tagline" extra="Small label under the logo in the live preview (e.g. Infrastructure, IT, Operations)">
                <Input
                  value={form.tagline}
                  onChange={e => setForm(f => ({ ...f, tagline: e.target.value }))}
                  placeholder="Infrastructure"
                />
              </Form.Item>

              <Form.Item label="Footer Text" extra="HTML allowed. Use {year} and {tool} placeholders.">
                <Input.TextArea
                  rows={2}
                  value={form.footer_html}
                  onChange={e => setForm(f => ({ ...f, footer_html: e.target.value }))}
                  placeholder="© 2026 Sys Spec. All rights reserved. | Developed by Sharansakthi – Senior System Engineer"
                />
              </Form.Item>

              <Form.Item label="Company Logo">
                <div style={{
                  border: '1px dashed #d1d5db', borderRadius: 8, padding: 12,
                  display: 'flex', gap: 12, alignItems: 'center',
                }}>
                  <div style={{
                    width: 64, height: 64, borderRadius: 6,
                    background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    overflow: 'hidden',
                  }}>
                    {form.logo_data_url
                      ? <img alt="logo" src={form.logo_data_url} style={{ maxWidth: '100%', maxHeight: '100%' }} />
                      : <BankOutlined style={{ fontSize: 28, color: '#94a3b8' }} />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div><strong>{logoName || (form.logo_data_url ? 'Current logo' : 'No logo set')}</strong></div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Click replace to upload a new file
                    </Typography.Text>
                    <div style={{ marginTop: 8 }}>
                      <Space>
                        <Upload
                          accept="image/*"
                          maxCount={1}
                          beforeUpload={onLogoUpload}
                          showUploadList={false}
                        >
                          <Button icon={<UploadOutlined />}>Replace</Button>
                        </Upload>
                        {form.logo_data_url && (
                          <Button danger icon={<DeleteOutlined />} onClick={onRemoveLogo}>
                            Remove
                          </Button>
                        )}
                      </Space>
                    </div>
                  </div>
                </div>
              </Form.Item>

              <Button
                type="primary"
                icon={<SaveOutlined />}
                size="large"
                loading={saving}
                onClick={onSave}
              >
                Save Changes
              </Button>
            </Form>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card type="inner" title={<Space><EyeOutlined /><span>Live Preview</span></Space>}>
            <div style={{
              background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 60%, #0f172a 100%)',
              borderRadius: 8, padding: 0, color: 'white', overflow: 'hidden',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: 'rgba(0,0,0,0.35)' }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 6, background: 'white',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                }}>
                  {form.logo_data_url
                    ? <img alt="logo" src={form.logo_data_url} style={{ maxWidth: '100%', maxHeight: '100%' }} />
                    : <BankOutlined style={{ color: '#1677ff' }} />}
                </div>
                <strong>{form.tool_name || 'Tool Name'}</strong>
              </div>

              <div style={{ padding: '40px 16px', textAlign: 'center' }}>
                <div style={{
                  width: 100, height: 100, borderRadius: 18, background: 'white',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                }}>
                  {form.logo_data_url
                    ? <img alt="logo" src={form.logo_data_url} style={{ maxWidth: '80%', maxHeight: '80%' }} />
                    : <BankOutlined style={{ fontSize: 48, color: '#1677ff' }} />}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 16 }}>
                  {form.tool_name || 'Tool Name'}
                </div>
                <div style={{ color: '#cbd5e1', marginTop: 4 }}>
                  {form.company_name || 'Company name'} · {form.tagline || 'Infrastructure'}
                </div>
              </div>

              <div style={{
                background: 'rgba(0,0,0,0.45)', borderTop: '1px solid rgba(255,255,255,0.05)',
                padding: '10px 16px', fontSize: 12, color: '#94a3b8', textAlign: 'center',
              }}>
                <span dangerouslySetInnerHTML={{
                  __html: previewFooter
                    .replace(/\{year\}/g, currentYear)
                    .replace(/\{tool\}/g, form.tool_name || 'Tool')
                }} />
              </div>
            </div>

            <Alert
              type="info"
              showIcon
              style={{ marginTop: 16 }}
              message="The tool name updates instantly in the browser tab on save. The sidebar and login page update after a browser reload."
            />
          </Card>
        </Col>
      </Row>
    </Card>
  );
}
