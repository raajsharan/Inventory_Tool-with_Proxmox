import { useEffect, useState } from 'react';
import {
  Table, Button, Modal, Form, Input, InputNumber, Switch,
  Space, Tag, Popconfirm, message, Tooltip, Typography, Alert,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined,
  PlayCircleOutlined, CheckCircleOutlined, CloseCircleOutlined,
} from '@ant-design/icons';
import api from '../../../api/client';
import { useAuth } from '../../../context/AuthContext.jsx';
import {
  DOT_CSS, HealthDot, deriveHealthColor, cpuChip, ramChip, diskChip, formatUptime,
} from '../../../components/HardwareStatChips.jsx';

const { Text } = Typography;

function statusTag(h) {
  if (h.is_running) return <Tag color="processing">Running</Tag>;
  if (h.last_status === 'error') {
    return (
      <Tooltip title={h.last_error || 'Discovery failed'}>
        <Tag color="error" style={{ cursor: 'help' }}>Failed</Tag>
      </Tooltip>
    );
  }
  if (h.last_discovery_at) return <Tag color="success">Idle</Tag>;
  return <Tag color="default">Never run</Tag>;
}

export default function HVHosts({ onDiscoveryStarted }) {
  const { user } = useAuth();
  const isAdmin = ['admin', 'superadmin'].includes(user?.role);

  const [hosts,      setHosts]      = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [modalOpen,  setModalOpen]  = useState(false);
  const [editing,    setEditing]    = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [testing,    setTesting]    = useState(false);
  const [error,      setError]      = useState(null);
  const [form]                      = Form.useForm();

  const load = () => {
    setLoading(true);
    api.get('/hyperv/hosts')
      .then(r => { setHosts(r.data); setError(null); })
      .catch(e => setError(e?.response?.data?.error || e.message || 'Failed to load hosts.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  function openAdd() {
    setEditing(null);
    setTestResult(null);
    form.resetFields();
    form.setFieldsValue({ port: 5985, useSSL: false, verifySSL: false, intervalMinutes: 60, schedulerEnabled: false, runNow: false });
    setModalOpen(true);
  }

  function openEdit(h) {
    setEditing(h);
    setTestResult(null);
    form.setFieldsValue({
      host:             h.host,
      username:         h.username,
      port:             h.port,
      useSSL:           h.use_ssl,
      verifySSL:        h.verify_ssl,
      intervalMinutes:  h.interval_minutes,
      schedulerEnabled: h.scheduler_enabled,
    });
    setModalOpen(true);
  }

  async function handleSave() {
    const values = await form.validateFields();
    try {
      if (editing) {
        await api.put(`/hyperv/hosts/${editing.id}`, values);
      } else {
        await api.post('/hyperv/hosts', values);
      }
      message.success(editing ? 'Host updated' : 'Host added');
      setModalOpen(false);
      load();
      if (values.runNow) {
        if (onDiscoveryStarted) onDiscoveryStarted();
        setTimeout(load, 2000);
      }
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to save host');
    }
  }

  async function handleDelete(id) {
    await api.delete(`/hyperv/hosts/${id}`);
    message.success('Host removed');
    load();
  }

  async function handleRunNow(h) {
    await api.post(`/hyperv/hosts/${h.id}/run`);
    message.info(`Discovery started for ${h.host}`);
    if (onDiscoveryStarted) onDiscoveryStarted();
    setTimeout(load, 2000);
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    const values = form.getFieldsValue();
    try {
      const r = await api.post(`/hyperv/hosts/${editing ? editing.id : 0}/test`, values);
      setTestResult(r.data);
    } catch (e) {
      setTestResult({ ok: false, error: e.response?.data?.error || e.message });
    } finally {
      setTesting(false);
    }
  }

  const columns = [
    { title: 'Host',     dataIndex: 'host',              key: 'host',    ellipsis: true,
      render: (v, h) => <span><HealthDot color={deriveHealthColor(h)} />{v}</span> },
    { title: 'Username', dataIndex: 'username',          key: 'user',    ellipsis: true },
    { title: 'Port',     dataIndex: 'port',              key: 'port',    width: 70 },
    { title: 'SSL',      dataIndex: 'use_ssl',           key: 'ssl',     width: 60,
      render: v => v ? <Tag color="blue">Yes</Tag> : <Tag>No</Tag> },
    { title: 'Status',   key: 'status',                  width: 120,     render: (_, h) => statusTag(h) },
    { title: 'Last Run', key: 'last', ellipsis: true,
      // last_discovery_at only updates on success — fall back to
      // last_attempt_at so a failed run still shows when it was tried.
      render: (_, h) => {
        const t = h.last_discovery_at || h.last_attempt_at;
        return t ? new Date(t).toLocaleString() : '—';
      } },
    { title: 'VMs Found', dataIndex: 'last_vm_count',   key: 'vm_count', width: 100, render: v => v ?? '—' },
    { title: 'Model', dataIndex: 'hardware_model', key: 'hardware_model', width: 150,
      render: v => v || <Text type="secondary">—</Text> },
    { title: 'CPU',  key: 'cpu',  width: 140, render: (_, h) => cpuChip(h) },
    { title: 'RAM',  key: 'ram',  width: 150, render: (_, h) => ramChip(h) },
    { title: 'Disk', key: 'disk', width: 150, render: (_, h) => diskChip(h) },
    { title: 'Uptime', key: 'uptime', width: 110, render: (_, h) => formatUptime(h.uptime_seconds) },
    { title: 'Scheduler', dataIndex: 'scheduler_enabled', key: 'sched', width: 110,
      render: (v, h) => v ? <Tag color="blue">Every {h.interval_minutes}m</Tag> : <Tag>Off</Tag> },
    isAdmin && {
      title: 'Actions', key: 'actions', width: 160,
      render: (_, h) => (
        <Space>
          <Tooltip title="Edit"><Button size="small" icon={<EditOutlined />} onClick={() => openEdit(h)} /></Tooltip>
          <Tooltip title="Run Now">
            <Button size="small" icon={<PlayCircleOutlined />} onClick={() => handleRunNow(h)} disabled={h.is_running} />
          </Tooltip>
          <Popconfirm title="Remove this host?" onConfirm={() => handleDelete(h.id)} okText="Yes" cancelText="No">
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ].filter(Boolean);

  return (
    <div style={{ padding: 16 }}>
      <style>{DOT_CSS}</style>
      {error && <Alert type="error" showIcon message="Couldn't load hosts" description={error} style={{ marginBottom: 12 }} />}
      {isAdmin && (
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd} style={{ marginBottom: 12 }}>
          Add Host
        </Button>
      )}

      <Table
        size="small"
        loading={loading}
        rowKey="id"
        dataSource={hosts}
        columns={columns}
        pagination={false}
        scroll={{ x: 'max-content' }}
        sticky={{ offsetScroll: 0 }}
      />

      <Modal
        open={modalOpen}
        title={editing ? `Edit — ${editing.host}` : 'Add Hyper-V Host'}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        width={520}
        okText={editing ? 'Save' : 'Add'}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="host" label="Hostname / IP" rules={[{ required: true }]}>
            <Input placeholder="192.168.1.10 or hyperv-server.example.com" />
          </Form.Item>

          <Form.Item name="username" label="Username" rules={[{ required: true }]}
            extra="Domain: DOMAIN\user or user@domain.com; local: .\Administrator">
            <Input placeholder="DOMAIN\Administrator" />
          </Form.Item>

          <Form.Item name="password" label={editing ? 'Password (leave blank to keep current)' : 'Password'}>
            <Input.Password placeholder="Password" autoComplete="new-password" />
          </Form.Item>

          <Form.Item name="port" label="WinRM Port">
            <InputNumber min={1} max={65535} style={{ width: 120 }} />
          </Form.Item>

          <Form.Item name="useSSL" label="Use HTTPS (WinRM over SSL)" valuePropName="checked"
            extra="Toggling this updates the port between the standard 5985 (HTTP) / 5986 (HTTPS) — only if you haven't set a custom port.">
            <Switch onChange={(checked) => {
              // Only auto-adjust if the port is still at one of the two
              // standard WinRM values — never clobber a deliberately custom port.
              const currentPort = form.getFieldValue('port');
              if (currentPort === 5985 || currentPort === 5986) {
                form.setFieldValue('port', checked ? 5986 : 5985);
              }
            }} />
          </Form.Item>

          <Form.Item name="verifySSL" label="Verify SSL Certificate" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item name="schedulerEnabled" label="Enable Scheduler" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item name="intervalMinutes" label="Discovery Interval (minutes)">
            <InputNumber min={5} max={1440} style={{ width: 150 }} />
          </Form.Item>

          {!editing && (
            <Form.Item name="runNow" label="Run Discovery Immediately" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}

          <Space>
            <Button onClick={handleTest} loading={testing}>Test Connection</Button>
            {testResult && (
              testResult.ok
                ? <Text type="success"><CheckCircleOutlined /> Connected — WinRM reachable</Text>
                : <Text type="danger"><CloseCircleOutlined /> {testResult.error}</Text>
            )}
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
