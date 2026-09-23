import { useEffect, useState } from 'react';
import {
  Alert, App, Button, Card, Col, Form, Input, Row, Select, Space, Spin, Tag, Tooltip, Typography,
} from 'antd';
import {
  DeleteOutlined, EnvironmentOutlined, InfoCircleOutlined, SettingOutlined, WindowsOutlined,
} from '@ant-design/icons';
import api from '../../api/client';

const { Title, Text } = Typography;
const DEFAULT_SCOPE = '__default__';

export default function TestDeployConfig() {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [scope, setScope]         = useState(DEFAULT_SCOPE);
  const [locations, setLocations] = useState([]);

  const isLocationScope = scope !== DEFAULT_SCOPE;

  const loadLocations = async () => {
    try {
      const { data } = await api.get('/test-deploy/locations');
      setLocations(data.locations || []);
    } catch { setLocations([]); }
  };

  const load = async (scopeVal = scope) => {
    setLoading(true);
    try {
      const loc = scopeVal !== DEFAULT_SCOPE ? scopeVal : '';
      const { data } = await api.get('/test-deploy/config', { params: loc ? { location: loc } : {} });
      form.resetFields();
      form.setFieldsValue(data);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load Test Deploy configuration');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); loadLocations(); }, []); // eslint-disable-line

  const onScopeChange = (v) => { setScope(v); load(v); };

  const save = async (vals) => {
    setSaving(true);
    try {
      const payload = isLocationScope ? { ...vals, location: scope } : vals;
      const { data } = await api.put('/test-deploy/config', payload);
      form.setFieldsValue(data);
      message.success(isLocationScope ? `Saved Test Deploy config for "${scope}"` : 'Saved default Test Deploy config');
      loadLocations();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to save configuration');
    } finally { setSaving(false); }
  };

  const removeOverride = async () => {
    try {
      await api.delete('/test-deploy/config', { params: { location: scope } });
      message.success(`Removed "${scope}" configuration`);
      await loadLocations();
      onScopeChange(DEFAULT_SCOPE);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to remove configuration');
    }
  };

  if (loading) return <Spin style={{ display: 'block', marginTop: 80 }} />;

  return (
    <div style={{ maxWidth: 820 }}>
      <Space align="start" style={{ marginBottom: 24 }}>
        <SettingOutlined style={{ fontSize: 22, color: '#1677ff', marginTop: 4 }} />
        <div>
          <Title level={4} style={{ margin: 0 }}>Test Deploy Config</Title>
          <Text type="secondary">Per-location installer share path &amp; silent-install command for the ME Agent (Ansible pilot)</Text>
        </div>
      </Space>

      <Alert
        type="warning" showIcon style={{ marginBottom: 24 }}
        message="Install command is a placeholder"
        description="The playbook runs whatever's in the Install Command field below against the copied installer file. Until you fill in the real silent-install switches for your ME Agent installer here, it runs a placeholder switch and will fail."
      />

      <Card size="small" style={{ marginBottom: 20 }}>
        <Space wrap align="center">
          <EnvironmentOutlined style={{ color: '#1677ff' }} />
          <Text strong>Configuration for:</Text>
          <Select
            style={{ minWidth: 260 }}
            value={scope}
            onChange={onScopeChange}
            options={[
              { value: DEFAULT_SCOPE, label: 'Default (all locations)' },
              ...locations.map(l => ({
                value: l.location,
                label: (
                  <Space size={6}>
                    {l.location}
                    {l.has_override && <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>custom</Tag>}
                  </Space>
                ),
              })),
            ]}
          />
          {isLocationScope && !locations.find(l => l.location === scope)?.has_override && (
            <Tag color="default">no custom config yet — saves as new</Tag>
          )}
          {isLocationScope && locations.find(l => l.location === scope)?.has_override && (
            <Button size="small" danger icon={<DeleteOutlined />} onClick={removeOverride}>Remove override</Button>
          )}
        </Space>
        {isLocationScope && (
          <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
            Assets whose Location is <strong>{scope}</strong> deploy with these settings. Fields left empty inherit the Default configuration.
          </Text>
        )}
      </Card>

      <Form form={form} layout="vertical" onFinish={save}>
        <Row gutter={24}>
          <Col xs={24} xl={12}>
            <Card title={<Space><WindowsOutlined style={{ color: '#1677ff' }} /><Text strong>Windows</Text></Space>} style={{ marginBottom: 16 }}>
              <Form.Item
                name="windows_share_path"
                label={
                  <Space>
                    Installer directory (local path on this server)
                    <Tooltip title="A directory on THIS backend server (the Ansible control node) containing the Windows installer — win_copy reads it straight off local disk and pushes it to the target over WinRM. No network share needed.">
                      <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
                    </Tooltip>
                  </Space>
                }
                rules={[{
                  pattern: /^\/[^/]/,
                  message: 'Needs to be an absolute path on this server (e.g. /opt/inventory/installers/windows).',
                }]}
              >
                <Input placeholder="/opt/inventory/installers/windows" style={{ fontFamily: 'monospace' }} />
              </Form.Item>
              <Form.Item name="windows_installer_file" label="Installer filename">
                <Input placeholder="ME_UEMS_Agent.exe" style={{ fontFamily: 'monospace' }} />
              </Form.Item>
              <Form.Item
                name="windows_install_cmd"
                label={
                  <Space>
                    Install command
                    <Tooltip title={'For a .msi, runs as: msiexec /i "C:\\Temp\\<installer>" <this> — so put everything that follows the package path here, including the quiet switch (/qn) and any PROPERTY="value" pairs. For a .exe, runs as: & "C:\\Temp\\<installer>" <this>. Exit code 3010 (reboot required) counts as success.'}>
                      <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
                    </Tooltip>
                  </Space>
                }
              >
                <Input placeholder={'PROPERTY="value" /qn'} style={{ fontFamily: 'monospace' }} />
              </Form.Item>
            </Card>
          </Col>
          <Col xs={24} xl={12}>
            <Card title={<Tag color="default">Linux</Tag>} style={{ marginBottom: 16 }}>
              <Form.Item
                name="linux_share_path"
                label={
                  <Space>
                    Installer directory (local path on this server)
                    <Tooltip title="A directory on THIS backend server (the Ansible control node) containing the Linux installer (and serverinfo.json, if needed) — ansible.builtin.copy reads it straight off local disk and pushes it to the target over SSH. No CIFS mount needed.">
                      <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
                    </Tooltip>
                  </Space>
                }
                rules={[{
                  pattern: /^\/[^/]/,
                  message: 'Needs to be an absolute path on this server (e.g. /opt/inventory/installers/linux).',
                }]}
              >
                <Input placeholder="/opt/inventory/installers/linux" style={{ fontFamily: 'monospace' }} />
              </Form.Item>
              <Form.Item name="linux_installer_file" label="Installer filename">
                <Input placeholder="UEMS_LinuxAgent.bin" style={{ fontFamily: 'monospace' }} />
              </Form.Item>
              <Form.Item
                name="linux_serverinfo_file"
                label={
                  <Space>
                    serverinfo.json filename
                    <Tooltip title="The UEMS Linux agent installer needs this file copied alongside it, in the same local directory as the installer above. Leave blank if this location's installer doesn't need one.">
                      <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
                    </Tooltip>
                  </Space>
                }
              >
                <Input placeholder="serverinfo.json" style={{ fontFamily: 'monospace' }} />
              </Form.Item>
              <Form.Item
                name="linux_install_cmd"
                label={
                  <Space>
                    Install command (optional)
                    <Tooltip title="Runs as: installer_file <this> (with sudo). Confirmed: the UEMS Linux installer needs no flags at all — it auto-detects serverinfo.json alongside it and installs silently on its own, and doesn't support --long-options anyway. Leave this blank unless you have a specific reason to add switches.">
                      <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
                    </Tooltip>
                  </Space>
                }
              >
                <Input placeholder="(leave blank — no flags needed)" style={{ fontFamily: 'monospace' }} />
              </Form.Item>
            </Card>
          </Col>
        </Row>
        <Button type="primary" htmlType="submit" loading={saving}>
          Save {isLocationScope ? `"${scope}"` : 'Default'} Configuration
        </Button>
      </Form>
    </div>
  );
}
