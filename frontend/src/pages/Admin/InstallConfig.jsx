import { useEffect, useState } from 'react';
import {
  Alert, App, Button, Card, Checkbox, Col, Descriptions, Divider, Form, Input,
  InputNumber, Modal, Radio, Row, Select, Space, Spin, Tag, Tooltip, Typography,
} from 'antd';
import {
  CheckCircleFilled, CloseCircleFilled, CodeOutlined, ClearOutlined,
  DeleteOutlined, EnvironmentOutlined, FileTextOutlined, FolderOpenOutlined,
  InfoCircleOutlined, SaveOutlined, SettingOutlined, ThunderboltOutlined,
  WindowsOutlined,
} from '@ant-design/icons';
import api from '../../api/client';

const DEFAULT_SCOPE = '__default__';

const { Title, Text, Paragraph } = Typography;

const LINUX_BIN_PLACEHOLDER      = '/opt/installers/UEMS_LinuxAgent.bin';
const LINUX_SRVINFO_PLACEHOLDER  = '/opt/installers/serverinfo.json';
const WINDOWS_FILE_PLACEHOLDER    = 'D:\\Installers\\ManageEngine_UEMS_Agent.exe';
const WINDOWS_PSEXEC_PLACEHOLDER  = 'C:\\Tools\\PsExec64.exe';

const LINUX_CMD_PLACEHOLDER = `chmod +x {installer} && sudo {installer} --silent`;

const WIN_CMD_HINTS = {
  ssh:      { label: 'PowerShell / CMD command', placeholder: '{installer} /Silent' },
  ssh_bash: { label: 'Bash command',             placeholder: 'chmod +x {installer} && ./{installer} --silent' },
  winrm:    { label: 'PowerShell ScriptBlock',   placeholder: "& '{installer}' /Silent" },
  psexec:   { label: 'Remote command / args',    placeholder: '/Silent /NoRestart' },
};

const WIN_METHODS = [
  { value: 'ssh',      label: 'SSH',       icon: <CodeOutlined />,         desc: 'OpenSSH — SFTP upload then exec (PowerShell / CMD)' },
  { value: 'ssh_bash', label: 'Bash (SSH)',icon: <CodeOutlined />,         desc: 'SSH with bash shell — for VMs with Git Bash / WSL' },
  { value: 'winrm',   label: 'WinRM',      icon: <ThunderboltOutlined />,  desc: 'PowerShell Remoting — Invoke-Command via WS-Management' },
  { value: 'psexec',  label: 'PsExec',     icon: <ThunderboltOutlined />,  desc: 'Sysinternals PsExec — runs locally, executes on remote' },
];

export default function InstallConfig() {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const [config, setConfig]     = useState(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [logModal, setLogModal] = useState(false);
  const [logLines, setLogLines] = useState([]);
  const [logLoading, setLogLoading] = useState(false);
  const [scope, setScope]       = useState(DEFAULT_SCOPE);   // '__default__' or a location name
  const [locations, setLocations] = useState([]);            // [{location, has_override}]
  const winMethod = Form.useWatch('windows_method', form) || 'ssh';

  const isLocationScope = scope !== DEFAULT_SCOPE;

  const loadLocations = async () => {
    try {
      const { data } = await api.get('/software-status/install-config/locations');
      setLocations(data.locations || []);
    } catch { setLocations([]); }
  };

  const load = async (scopeVal = scope) => {
    setLoading(true);
    try {
      const loc = scopeVal !== DEFAULT_SCOPE ? scopeVal : '';
      const { data } = await api.get('/software-status/install-config', {
        params: loc ? { location: loc } : {},
      });
      setConfig(data);
      form.resetFields();
      form.setFieldsValue(data);
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { load(); loadLocations(); }, []); // eslint-disable-line

  const onScopeChange = (v) => {
    setScope(v);
    load(v);
  };

  const save = async (vals) => {
    setSaving(true);
    try {
      const payload = isLocationScope ? { ...vals, location: scope } : vals;
      const { data } = await api.put('/software-status/install-config', payload);
      setConfig(data);
      form.setFieldsValue(data);
      message.success(isLocationScope
        ? `Saved installer configuration for "${scope}"`
        : 'Saved default installer configuration');
      loadLocations();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to save configuration');
    }
    finally { setSaving(false); }
  };

  const removeOverride = () => {
    Modal.confirm({
      title: `Remove "${scope}" configuration?`,
      content: 'VMs in this location will fall back to the Default configuration.',
      okText: 'Remove',
      okButtonProps: { danger: true },
      onOk: async () => {
        await api.delete('/software-status/install-config', { params: { location: scope } });
        message.success(`Removed "${scope}" configuration`);
        loadLocations();
        onScopeChange(DEFAULT_SCOPE);
      },
    });
  };

  const openLog = async () => {
    setLogLoading(true);
    setLogModal(true);
    try {
      const { data } = await api.get('/software-status/install-log');
      setLogLines(data.lines || []);
    } catch { setLogLines([]); }
    finally { setLogLoading(false); }
  };

  const clearLog = () => {
    Modal.confirm({
      title: 'Clear deployment log?',
      content: 'This will erase all lines in the log file.',
      okText: 'Clear Log',
      okButtonProps: { danger: true },
      onOk: async () => {
        await api.delete('/software-status/install-log');
        setLogLines([]);
      },
    });
  };

  if (loading) return <Spin style={{ display: 'block', marginTop: 80 }} />;

  return (
    <div style={{ maxWidth: 820 }}>
      <Space align="start" style={{ marginBottom: 24 }}>
        <SettingOutlined style={{ fontSize: 22, color: '#1677ff', marginTop: 4 }} />
        <div>
          <Title level={4} style={{ margin: 0 }}>Install Configuration</Title>
          <Text type="secondary">
            Configure local installer files and remote commands for ManageEngine Agent deployment
          </Text>
        </div>
      </Space>

      <Alert
        type="info" showIcon style={{ marginBottom: 24 }}
        message="How installation works"
        description={
          <ol style={{ margin: '6px 0 0 0', paddingLeft: 20 }}>
            <li>The installer file is uploaded from <strong>this server</strong> to the target VM via SFTP.</li>
            <li>The install command is then executed on the remote VM via SSH.</li>
            <li>Use <code>{'{installer}'}</code> in the command — it is replaced with the remote uploaded file path.</li>
          </ol>
        }
      />

      {/* Per-location scope selector */}
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
          {isLocationScope && (
            <>
              {config?.exists === false && !locations.find(l => l.location === scope)?.has_override && (
                <Tag color="default">no custom config yet — saves as new</Tag>
              )}
              {locations.find(l => l.location === scope)?.has_override && (
                <Button size="small" danger icon={<DeleteOutlined />} onClick={removeOverride}>
                  Remove override
                </Button>
              )}
            </>
          )}
        </Space>
        {isLocationScope && (
          <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
            VMs whose Location is <strong>{scope}</strong> deploy with these installer files.
            Fields left empty inherit the Default configuration.
          </Text>
        )}
      </Card>

      <Form form={form} layout="vertical" onFinish={save}>
        <Row gutter={24}>
          {/* Linux */}
          <Col xs={24} xl={12}>
            <Card
              title={<Space><Tag color="default">Linux</Tag><Text strong>dcservice.service</Text></Space>}
              style={{ marginBottom: 16 }}
            >
              {/* Installer binary */}
              <Form.Item
                name="linux_file_path"
                label={
                  <Space>
                    <Text strong>1.</Text> Installer binary path
                    <Tooltip title="Full path to UEMS_LinuxAgent.bin on this server">
                      <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
                    </Tooltip>
                    {config?.linux_file_exists != null && (
                      config.linux_file_exists
                        ? <Tag color="success" icon={<CheckCircleFilled />}>found</Tag>
                        : <Tag color="error"   icon={<CloseCircleFilled />}>not found</Tag>
                    )}
                  </Space>
                }
              >
                <Input
                  prefix={<FolderOpenOutlined />}
                  placeholder={LINUX_BIN_PLACEHOLDER}
                  style={{ fontFamily: 'monospace' }}
                />
              </Form.Item>

              {/* serverinfo.json */}
              <Form.Item
                name="linux_serverinfo_path"
                label={
                  <Space>
                    <Text strong>2.</Text> serverinfo.json path
                    <Tooltip title="Full path to serverinfo.json on this server — copied alongside the installer">
                      <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
                    </Tooltip>
                    {config?.linux_serverinfo_exists != null && (
                      config.linux_serverinfo_exists
                        ? <Tag color="success" icon={<CheckCircleFilled />}>found</Tag>
                        : <Tag color="error"   icon={<CloseCircleFilled />}>not found</Tag>
                    )}
                  </Space>
                }
              >
                <Input
                  prefix={<FolderOpenOutlined />}
                  placeholder={LINUX_SRVINFO_PLACEHOLDER}
                  style={{ fontFamily: 'monospace' }}
                />
              </Form.Item>

              <Form.Item
                name="linux_cmd"
                label={
                  <Space>
                    Install command <Tag style={{ marginLeft: 4 }}>runs on remote VM</Tag>
                  </Space>
                }
                extra={
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    <code>{'{installer}'}</code> = uploaded .bin path &nbsp;·&nbsp;
                    <code>{'{serverinfo}'}</code> = uploaded serverinfo.json path
                  </Text>
                }
              >
                <Input.TextArea
                  rows={3}
                  placeholder={LINUX_CMD_PLACEHOLDER}
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                />
              </Form.Item>

              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="Service">
                  <Text code style={{ fontSize: 11 }}>dcservice.service</Text>
                </Descriptions.Item>
                <Descriptions.Item label="Binary">
                  <Text code style={{ fontSize: 11 }}>/usr/local/manageengine/uems_agent/bin/dcservice</Text>
                </Descriptions.Item>
                <Descriptions.Item label="Remote upload dir">
                  <Text code style={{ fontSize: 11 }}>/tmp</Text>
                  <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
                    (both files uploaded here)
                  </Text>
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </Col>

          {/* Windows */}
          <Col xs={24} xl={12}>
            <Card
              title={<Space><Tag color="blue" icon={<WindowsOutlined />}>Windows</Tag><Text strong>ManageEngine UEMS - Agent</Text></Space>}
              style={{ marginBottom: 16 }}
            >
              {/* Transport method — compact horizontal radio matching the UI reference */}
              <div style={{ border: '1px solid #d9d9d9', borderRadius: 6, padding: '10px 14px', marginBottom: 16, background: '#fafafa' }}>
                <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Windows transport settings
                </Text>
                <Form.Item name="windows_method" noStyle initialValue="auto">
                  <Radio.Group>
                    <Radio value="auto">Auto</Radio>
                    <Radio value="winrm">WinRM</Radio>
                    <Radio value="psexec">PsExec</Radio>
                    <Radio value="wmi">WMI</Radio>
                    <Radio value="ssh">SSH</Radio>
                  </Radio.Group>
                </Form.Item>
                <Row gutter={16} style={{ marginTop: 10 }}>
                  <Col span={12}>
                    <Form.Item name="windows_winrm_port" label="WinRM port" style={{ marginBottom: 0 }} initialValue={5985}>
                      <InputNumber min={1} max={65535} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="windows_smb_port" label="PsExec/SMB port" style={{ marginBottom: 0 }} initialValue={445}>
                      <InputNumber min={1} max={65535} style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                </Row>
                {winMethod === 'auto' && (
                  <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
                    Auto tries: WinRM → WMI → PsExec → SSH in order, stops at first success
                  </Text>
                )}
              </div>

              <Divider style={{ margin: '4px 0 14px' }} />

              {/* PsExec binary path */}
              {(winMethod === 'psexec' || winMethod === 'auto') && (
                <Form.Item
                  name="windows_psexec_path"
                  label={
                    <Space>
                      PsExec64.exe path
                      <Text type="secondary" style={{ fontSize: 11 }}>(on this server)</Text>
                      {config?.windows_psexec_exists != null && (
                        config.windows_psexec_exists
                          ? <Tag color="success" icon={<CheckCircleFilled />}>found</Tag>
                          : <Tag color="error"   icon={<CloseCircleFilled />}>not found</Tag>
                      )}
                    </Space>
                  }
                >
                  <Input prefix={<FolderOpenOutlined />} placeholder={WINDOWS_PSEXEC_PLACEHOLDER}
                    style={{ fontFamily: 'monospace' }} />
                </Form.Item>
              )}

              {/* Installer file path */}
              <Form.Item
                name="windows_file_path"
                label={
                  <Space>
                    Installer file path
                    <Text type="secondary" style={{ fontSize: 11 }}>(on this server)</Text>
                    {config?.windows_file_exists != null && (
                      config.windows_file_exists
                        ? <Tag color="success" icon={<CheckCircleFilled />}>found</Tag>
                        : <Tag color="error"   icon={<CloseCircleFilled />}>not found</Tag>
                    )}
                  </Space>
                }
                extra={
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {winMethod === 'winrm' && 'Copied via Copy-Item -ToSession'}
                    {winMethod === 'wmi'   && 'Copied via SMB/ADMIN$ share before WMI execution'}
                    {winMethod === 'psexec'&& 'Copied using PsExec -c flag'}
                    {(winMethod === 'ssh' || winMethod === 'ssh_bash') && 'Uploaded via SFTP to C:/Windows/Temp/'}
                    {winMethod === 'auto'  && 'Copied using whichever transport succeeds'}
                    {' — use '}<code>{'{installer}'}</code>{' in the command below'}
                  </Text>
                }
              >
                <Input prefix={<FolderOpenOutlined />} placeholder={WINDOWS_FILE_PLACEHOLDER}
                  style={{ fontFamily: 'monospace' }} />
              </Form.Item>

              {/* Command */}
              <Form.Item
                name="windows_cmd"
                label={
                  <Space>
                    {winMethod === 'wmi' ? 'WMI command (Win32_Process.Create)' : 'Install command'}
                    <Tag style={{ marginLeft: 4 }}>runs on remote VM</Tag>
                  </Space>
                }
                extra={
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    Use <code>{'{installer}'}</code> — replaced with the remote file path.
                    {winMethod === 'wmi' && ' Note: WMI starts the process async and cannot wait for its exit code.'}
                  </Text>
                }
              >
                <Input.TextArea
                  rows={3}
                  placeholder={WIN_CMD_HINTS[winMethod]?.placeholder || '{installer} /Silent'}
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                />
              </Form.Item>

              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="Service">
                  <Text code style={{ fontSize: 11 }}>ManageEngine UEMS - Agent</Text>
                </Descriptions.Item>
                <Descriptions.Item label="Binary">
                  <Text code style={{ fontSize: 11 }}>C:\Program Files (x86)\ManageEngine\UEMS_Agent\bin\dcagentservice.exe</Text>
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </Col>
        </Row>

        <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 16 }}>
          <strong>Auto</strong> tries WinRM → WMI → PsExec → SSH in order (45 s each), stopping at first success.
          &nbsp;<strong>WinRM</strong> (5985 HTTP / 5986 HTTPS) uses PowerShell Remoting.
          &nbsp;<strong>WMI</strong> uses Win32_Process.Create — async, verify separately.
          &nbsp;<strong>PsExec</strong> copies the installer with <code>-c</code> via SMB (port 445).
          &nbsp;<strong>SSH</strong> uploads via SFTP + exec.
        </Paragraph>

        {/* Deployment options — global only; locations inherit these */}
        <Card
          title={<Space><SettingOutlined />Deployment Options</Space>}
          style={{ marginBottom: 20, display: isLocationScope ? 'none' : undefined }}
          size="small"
        >
          <Row gutter={24} align="middle">
            <Col xs={24} md={12}>
              <Form.Item name="skip_if_installed" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Checkbox>
                  <Space>
                    <strong>Skip if agent already installed</strong>
                    <Tooltip title="Before deploying, SSH into the VM and check if the ManageEngine service is running. If already installed, deployment is skipped.">
                      <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
                    </Tooltip>
                  </Space>
                </Checkbox>
              </Form.Item>
              <Text type="secondary" style={{ fontSize: 11, paddingLeft: 24 }}>
                Runs a quick verify check before installing — skips VMs where agent is already running
              </Text>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="log_file_path"
                label={
                  <Space>
                    Log file path
                    <Tooltip title="Deployment results will be appended to this file on the server">
                      <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
                    </Tooltip>
                    {config?.log_file_exists === true && <Tag color="success" icon={<CheckCircleFilled />}>exists</Tag>}
                    {config?.log_file_exists === false && <Tag color="warning" icon={<CloseCircleFilled />}>will create</Tag>}
                  </Space>
                }
                style={{ marginBottom: 0 }}
              >
                <Input
                  prefix={<FileTextOutlined />}
                  placeholder="C:\Users\Administrator\.manageengine_agent_deployer\deploy.log"
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                />
              </Form.Item>
            </Col>
          </Row>
          {config?.log_file_path && (
            <Row style={{ marginTop: 12 }} gutter={8}>
              <Col>
                <Button icon={<FileTextOutlined />} onClick={openLog} size="small">
                  Open Log File
                </Button>
              </Col>
              <Col>
                <Button icon={<ClearOutlined />} onClick={clearLog} size="small" danger>
                  Clear Log
                </Button>
              </Col>
              <Col flex="1">
                <Text type="secondary" style={{ fontSize: 11, lineHeight: '24px' }}>
                  {config.log_file_path}
                </Text>
              </Col>
            </Row>
          )}
        </Card>

        <Space>
          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving} size="large">
            {isLocationScope ? `Save for "${scope}"` : 'Save Configuration'}
          </Button>
          <Button onClick={() => load()} disabled={saving}>
            Reset
          </Button>
        </Space>
      </Form>

      {/* Log viewer modal */}
      <Modal
        title={
          <Space>
            <FileTextOutlined />
            Deployment Log
            <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>{config?.log_file_path}</Text>
          </Space>
        }
        open={logModal}
        onCancel={() => setLogModal(false)}
        width={820}
        footer={[
          <Button key="clear" danger icon={<DeleteOutlined />} onClick={clearLog}>Clear Log</Button>,
          <Button key="close" onClick={() => setLogModal(false)}>Close</Button>,
        ]}
      >
        {logLoading ? (
          <Spin style={{ display: 'block', margin: '40px auto' }} />
        ) : logLines.length === 0 ? (
          <Text type="secondary">Log file is empty or not yet created.</Text>
        ) : (
          <div style={{
            background: '#1a1a2e', color: '#e0e0e0', fontFamily: 'monospace', fontSize: 12,
            padding: '12px 16px', borderRadius: 6, maxHeight: 480, overflowY: 'auto',
          }}>
            {logLines.map((line, i) => {
              const isSuccess = line.startsWith('[SUCCESS]');
              const isError   = line.startsWith('[ERROR]') || line.startsWith('[WARN]');
              const color     = isSuccess ? '#52c41a' : isError ? '#ff4d4f' : '#e0e0e0';
              return (
                <div key={i} style={{ color, lineHeight: '1.7' }}>{line}</div>
              );
            })}
          </div>
        )}
      </Modal>
    </div>
  );
}
