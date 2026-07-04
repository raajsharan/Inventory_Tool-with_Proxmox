import { useEffect, useState } from 'react';
import {
  Alert, Button, Card, Checkbox, Col, Descriptions, Divider, Form, Input,
  InputNumber, Modal, Radio, Row, Space, Spin, Tag, Tooltip, Typography, Segmented,
} from 'antd';
import {
  CheckCircleFilled, CloseCircleFilled, ClearOutlined, CloudOutlined,
  DeleteOutlined, FileTextOutlined, FolderOpenOutlined, InfoCircleOutlined,
  SaveOutlined, SettingOutlined, ThunderboltOutlined, WindowsOutlined,
} from '@ant-design/icons';
import api from '../../api/client';

const { Title, Text, Paragraph } = Typography;

const ACCENT = '#fa8c16';

const LINUX_FILE_PLACEHOLDER   = '/opt/installers/NessusAgent.rpm';
const WINDOWS_FILE_PLACEHOLDER = 'D:\\Installers\\NessusAgent-10.x.x.msi';
const WINDOWS_PSEXEC_PLACEHOLDER = 'C:\\Tools\\PsExec64.exe';
const LINUX_CMD_PLACEHOLDER    = 'rpm -ivh {installer}';

const DEFAULT_CURL_CMD =
  `curl -H 'X-Key: <YOUR-KEY>' ` +
  `'https://sensor.cloud.tenable.com/install/agent?name='\${HOSTNAME}'&groups=Servers' | bash`;

const WIN_CMD_HINTS = {
  ssh:    { placeholder: 'msiexec /i {installer} /quiet /norestart' },
  winrm:  { placeholder: "Start-Process msiexec -ArgumentList '/i {installer} /quiet /norestart' -Wait" },
  psexec: { placeholder: 'msiexec /i {installer} /quiet /norestart' },
  wmi:    { placeholder: 'msiexec /i {installer} /quiet /norestart' },
  auto:   { placeholder: 'msiexec /i {installer} /quiet /norestart' },
};

export default function NessusInstallConfig() {
  const [form]                          = Form.useForm();
  const [config,      setConfig]        = useState(null);
  const [loading,     setLoading]       = useState(true);
  const [saving,      setSaving]        = useState(false);
  const [logModal,    setLogModal]      = useState(false);
  const [logLines,    setLogLines]      = useState([]);
  const [logLoading,  setLogLoading]    = useState(false);
  const winMethod   = Form.useWatch('windows_method',      form) || 'auto';
  const linuxMethod = Form.useWatch('linux_install_method', form) || 'file';

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/nessus-status/install-config');
      setConfig(data);
      form.setFieldsValue(data);
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  const save = async (vals) => {
    setSaving(true);
    try {
      const { data } = await api.put('/nessus-status/install-config', vals);
      setConfig(data);
      form.setFieldsValue(data);
    } catch {}
    finally { setSaving(false); }
  };

  const openLog = async () => {
    setLogLoading(true);
    setLogModal(true);
    try {
      const { data } = await api.get('/nessus-status/install-log');
      setLogLines(data.lines || []);
    } catch { setLogLines([]); }
    finally { setLogLoading(false); }
  };

  const clearLog = () => {
    Modal.confirm({
      title: 'Clear Nessus deployment log?',
      content: 'This will erase all lines in the log file.',
      okText: 'Clear Log',
      okButtonProps: { danger: true },
      onOk: async () => {
        await api.delete('/nessus-status/install-log');
        setLogLines([]);
      },
    });
  };

  if (loading) return <Spin style={{ display: 'block', marginTop: 80 }} />;

  return (
    <div style={{ maxWidth: 860 }}>
      <Space align="start" style={{ marginBottom: 24 }}>
        <ThunderboltOutlined style={{ fontSize: 22, color: ACCENT, marginTop: 4 }} />
        <div>
          <Title level={4} style={{ margin: 0 }}>Nessus Agent — Install Configuration</Title>
          <Text type="secondary">
            Configure local installer files and remote commands for Tenable Nessus Agent deployment
          </Text>
        </div>
      </Space>

      <Alert
        type="info" showIcon style={{ marginBottom: 24 }}
        message="How installation works"
        description={
          <ol style={{ margin: '6px 0 0 0', paddingLeft: 20 }}>
            <li>The installer file is uploaded from <strong>this server</strong> to the target VM via SFTP / Copy.</li>
            <li>The install command is then executed on the remote VM.</li>
            <li>Use <code>{'{installer}'}</code> in the command — it is replaced with the remote file path.</li>
          </ol>
        }
      />

      <Form form={form} layout="vertical" onFinish={save}>
        <Row gutter={24}>
          {/* Linux */}
          <Col xs={24} xl={12}>
            <Card
              title={<Space><Tag color="default">Linux</Tag><Text strong>nessusagent</Text></Space>}
              style={{ marginBottom: 16 }}
            >
              {/* Install method toggle */}
              <Form.Item name="linux_install_method" initialValue="file" style={{ marginBottom: 16 }}>
                <Segmented
                  options={[
                    { label: <Space><FolderOpenOutlined />File Upload</Space>, value: 'file' },
                    { label: <Space><CloudOutlined />Curl (cloud)</Space>,      value: 'curl' },
                  ]}
                />
              </Form.Item>

              {/* ── Curl mode ─────────────────────────────────────────────── */}
              {linuxMethod === 'curl' && (
                <>
                  <Alert
                    type="success" showIcon icon={<CloudOutlined />}
                    style={{ marginBottom: 14 }}
                    message="Cloud install via curl"
                    description={
                      <Text style={{ fontSize: 12 }}>
                        The agent downloads and installs directly from <strong>sensor.cloud.tenable.com</strong>.
                        If <code>curl</code> is not installed on the target VM, it will be installed automatically
                        (apt-get / yum / dnf).
                      </Text>
                    }
                  />
                  <Form.Item
                    name="linux_cmd"
                    label={
                      <Space>
                        curl install command
                        <Tag style={{ marginLeft: 4 }}>runs on remote VM</Tag>
                        <Tooltip title="Replace <YOUR-KEY> with your Tenable cloud X-Key. The ${HOSTNAME} variable is expanded on the remote VM.">
                          <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
                        </Tooltip>
                      </Space>
                    }
                    extra={
                      <Space direction="vertical" size={2} style={{ marginTop: 4 }}>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          Auto-installs <code>curl</code> if missing before running this command
                        </Text>
                        <Button
                          size="small" type="link" style={{ padding: 0, height: 'auto', fontSize: 11 }}
                          onClick={() => form.setFieldValue('linux_cmd', DEFAULT_CURL_CMD)}
                        >
                          Reset to default template
                        </Button>
                      </Space>
                    }
                  >
                    <Input.TextArea
                      rows={4}
                      placeholder={DEFAULT_CURL_CMD}
                      style={{ fontFamily: 'monospace', fontSize: 11 }}
                    />
                  </Form.Item>

                  <Alert
                    type="warning" showIcon style={{ marginBottom: 12 }}
                    message={
                      <Text style={{ fontSize: 12 }}>
                        Replace <code>{'<YOUR-KEY>'}</code> with your Tenable.io X-Key and update <code>groups=</code> as needed.
                        The X-Key is found in Tenable.io → Sensors → Nessus Agents → Get Linking Key.
                      </Text>
                    }
                  />
                </>
              )}

              {/* ── File upload mode ──────────────────────────────────────── */}
              {linuxMethod === 'file' && (
                <>
                  <Form.Item
                    name="linux_file_path"
                    label={
                      <Space>
                        Installer file path
                        <Tooltip title="Full path to the Nessus Agent package (.rpm / .deb) on this server">
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
                    <Input prefix={<FolderOpenOutlined />} placeholder={LINUX_FILE_PLACEHOLDER}
                      style={{ fontFamily: 'monospace' }} />
                  </Form.Item>

                  <Form.Item
                    name="linux_cmd"
                    label={<Space>Install command<Tag style={{ marginLeft: 4 }}>runs on remote VM</Tag></Space>}
                    extra={<Text type="secondary" style={{ fontSize: 11 }}><code>{'{installer}'}</code> = uploaded file path</Text>}
                  >
                    <Input.TextArea rows={3} placeholder={LINUX_CMD_PLACEHOLDER}
                      style={{ fontFamily: 'monospace', fontSize: 12 }} />
                  </Form.Item>
                </>
              )}

              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="Service">
                  <Text code style={{ fontSize: 11 }}>nessusagent</Text>
                </Descriptions.Item>
                <Descriptions.Item label="Binary">
                  <Text code style={{ fontSize: 11 }}>/opt/nessus_agent/sbin/nessus-agent</Text>
                </Descriptions.Item>
                {linuxMethod === 'file' && (
                  <Descriptions.Item label="Remote upload dir">
                    <Text code style={{ fontSize: 11 }}>/tmp</Text>
                  </Descriptions.Item>
                )}
                {linuxMethod === 'curl' && (
                  <Descriptions.Item label="curl auto-install">
                    <Tag color="green">apt-get / yum / dnf</Tag>
                  </Descriptions.Item>
                )}
              </Descriptions>
            </Card>
          </Col>

          {/* Windows */}
          <Col xs={24} xl={12}>
            <Card
              title={<Space><Tag color="orange" icon={<WindowsOutlined />}>Windows</Tag><Text strong>Tenable Nessus Agent</Text></Space>}
              style={{ marginBottom: 16 }}
            >
              {/* Transport method */}
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

              {(winMethod === 'psexec' || winMethod === 'auto') && (
                <Form.Item
                  name="windows_psexec_path"
                  label={
                    <Space>
                      PsExec64.exe path <Text type="secondary" style={{ fontSize: 11 }}>(on this server)</Text>
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

              <Form.Item
                name="windows_file_path"
                label={
                  <Space>
                    Installer file path <Text type="secondary" style={{ fontSize: 11 }}>(on this server)</Text>
                    {config?.windows_file_exists != null && (
                      config.windows_file_exists
                        ? <Tag color="success" icon={<CheckCircleFilled />}>found</Tag>
                        : <Tag color="error"   icon={<CloseCircleFilled />}>not found</Tag>
                    )}
                  </Space>
                }
              >
                <Input prefix={<FolderOpenOutlined />} placeholder={WINDOWS_FILE_PLACEHOLDER}
                  style={{ fontFamily: 'monospace' }} />
              </Form.Item>

              <Form.Item
                name="windows_cmd"
                label={<Space>Install command<Tag style={{ marginLeft: 4 }}>runs on remote VM</Tag></Space>}
                extra={<Text type="secondary" style={{ fontSize: 11 }}>Use <code>{'{installer}'}</code> — replaced with the remote file path.</Text>}
              >
                <Input.TextArea rows={3}
                  placeholder={WIN_CMD_HINTS[winMethod]?.placeholder || 'msiexec /i {installer} /quiet /norestart'}
                  style={{ fontFamily: 'monospace', fontSize: 12 }} />
              </Form.Item>

              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="Service">
                  <Text code style={{ fontSize: 11 }}>Tenable Nessus Agent</Text>
                </Descriptions.Item>
                <Descriptions.Item label="Binary">
                  <Text code style={{ fontSize: 11 }}>C:\Program Files\Tenable\Nessus Agent\nessus-service.exe</Text>
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </Col>
        </Row>

        {/* Nessus linking config */}
        <Card
          title={<Space><SettingOutlined />Nessus Manager / Linking Settings</Space>}
          style={{ marginBottom: 16 }}
          size="small"
          extra={<Text type="secondary" style={{ fontSize: 11 }}>Optional — used to auto-link agents after install via <code>nessuscli agent link</code></Text>}
        >
          <Row gutter={16}>
            <Col xs={24} sm={10}>
              <Form.Item name="nessus_server" label="Nessus Manager host / IP">
                <Input placeholder="nessus.company.com" style={{ fontFamily: 'monospace' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={4}>
              <Form.Item name="nessus_port" label="Port" initialValue={8834}>
                <InputNumber min={1} max={65535} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={10}>
              <Form.Item name="nessus_groups" label="Agent Groups (comma-separated)">
                <Input placeholder="Linux Servers, Windows Servers" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="nessus_key" label="Linking Key"
            extra={<Text type="secondary" style={{ fontSize: 11 }}>Found in Nessus Manager → Settings → Linked Agents → Get Linking Key</Text>}>
            <Input.Password placeholder="••••••••••••••••" style={{ fontFamily: 'monospace' }} />
          </Form.Item>
          <Alert type="info" showIcon style={{ marginTop: 4 }}
            message={
              <Text style={{ fontSize: 12 }}>
                If a linking key is configured, append to your install command:&nbsp;
                <code>nessuscli agent link --key=KEY --host=HOST --port=PORT --groups=GROUPS</code>
              </Text>
            }
          />
        </Card>

        {/* Deployment options */}
        <Card
          title={<Space><SettingOutlined />Deployment Options</Space>}
          style={{ marginBottom: 20 }}
          size="small"
        >
          <Row gutter={24} align="middle">
            <Col xs={24} md={12}>
              <Form.Item name="skip_if_installed" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Checkbox>
                  <Space>
                    <strong>Skip if Nessus Agent already installed</strong>
                    <Tooltip title="Before deploying, SSH into the VM and check if the nessusagent service is running. If already installed, deployment is skipped.">
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
                    {config?.log_file_exists === true  && <Tag color="success" icon={<CheckCircleFilled />}>exists</Tag>}
                    {config?.log_file_exists === false && <Tag color="warning" icon={<CloseCircleFilled />}>will create</Tag>}
                  </Space>
                }
                style={{ marginBottom: 0 }}
              >
                <Input prefix={<FileTextOutlined />}
                  placeholder="C:\Users\Administrator\.nessus_agent_deployer\deploy.log"
                  style={{ fontFamily: 'monospace', fontSize: 12 }} />
              </Form.Item>
            </Col>
          </Row>
          {config?.log_file_path && (
            <Row style={{ marginTop: 12 }} gutter={8}>
              <Col><Button icon={<FileTextOutlined />} onClick={openLog} size="small">Open Log File</Button></Col>
              <Col><Button icon={<ClearOutlined />} onClick={clearLog} size="small" danger>Clear Log</Button></Col>
              <Col flex="1">
                <Text type="secondary" style={{ fontSize: 11, lineHeight: '24px' }}>{config.log_file_path}</Text>
              </Col>
            </Row>
          )}
        </Card>

        <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 16 }}>
          <strong>Auto</strong> tries WinRM → WMI → PsExec → SSH in order (45 s each).
          &nbsp;<strong>WMI</strong> uses Win32_Process.Create — async, verify separately.
          &nbsp;<strong>PsExec</strong> copies the installer via SMB (port 445).
          &nbsp;<strong>SSH</strong> uploads via SFTP + exec.
        </Paragraph>

        <Space>
          <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving} size="large"
            style={{ background: ACCENT, borderColor: ACCENT }}>
            Save Configuration
          </Button>
          <Button onClick={load} disabled={saving}>Reset</Button>
        </Space>
      </Form>

      {/* Log viewer modal */}
      <Modal
        title={
          <Space>
            <FileTextOutlined />
            Nessus Deployment Log
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
              return <div key={i} style={{ color, lineHeight: '1.7' }}>{line}</div>;
            })}
          </div>
        )}
      </Modal>
    </div>
  );
}
