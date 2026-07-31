import { useEffect, useState } from 'react';
import {
  Table, Button, Modal, Form, Input, InputNumber, Switch, Select,
  Space, Tag, Popconfirm, message, Tooltip, Typography,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined,
  PlayCircleOutlined, CheckCircleOutlined, CloseCircleOutlined, ClusterOutlined,
} from '@ant-design/icons';
import api from '../../../api/client';
import { useAuth } from '../../../context/AuthContext.jsx';
import {
  DOT_CSS, HealthDot, deriveHealthColor, cpuChip, ramChip, diskChip, formatUptime,
} from '../../../components/HardwareStatChips.jsx';

const { Text } = Typography;
const { Option } = Select;

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

export default function PVEHosts({ onDiscoveryStarted }) {
  const { user } = useAuth();
  const isAdmin = ['admin', 'superadmin'].includes(user?.role);

  const [hosts,      setHosts]      = useState([]);
  const [nodesByHost, setNodesByHost] = useState({}); // host_id -> node[]
  const [loading,    setLoading]    = useState(false);
  const [modalOpen,  setModalOpen]  = useState(false);
  const [editing,    setEditing]    = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [testing,    setTesting]    = useState(false);
  const [form]                      = Form.useForm();
  const hostType = Form.useWatch('hostType', form);

  const load = () => {
    setLoading(true);
    api.get('/proxmox/hosts').then(r => setHosts(r.data)).finally(() => setLoading(false));
    api.get('/proxmox/nodes').then(r => {
      const map = {};
      for (const n of r.data.items || []) {
        if (!map[n.host_id]) map[n.host_id] = [];
        map[n.host_id].push(n);
      }
      setNodesByHost(map);
    }).catch(() => setNodesByHost({}));
  };

  useEffect(() => { load(); }, []);

  function openAdd() {
    setEditing(null);
    setTestResult(null);
    form.resetFields();
    form.setFieldsValue({ hostType: 've', realm: 'pam', port: 8006, verifySSL: false, intervalMinutes: 60, schedulerEnabled: false, runNow: false });
    setModalOpen(true);
  }

  function openEdit(h) {
    setEditing(h);
    setTestResult(null);
    form.setFieldsValue({
      host:             h.host,
      hostType:         h.host_type,
      username:         h.username,
      realm:            h.realm,
      tokenId:          h.token_id || '',
      port:             h.port,
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
        await api.put(`/proxmox/hosts/${editing.id}`, values);
      } else {
        await api.post('/proxmox/hosts', values);
      }
      message.success(editing ? 'Host updated' : 'Host added');
      setModalOpen(false);
      load();
      if (values.runNow && onDiscoveryStarted) onDiscoveryStarted();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to save host');
    }
  }

  async function handleDelete(id) {
    await api.delete(`/proxmox/hosts/${id}`);
    message.success('Host removed');
    load();
  }

  async function handleRunNow(h) {
    await api.post(`/proxmox/hosts/${h.id}/run`);
    message.info(`Discovery started for ${h.host}`);
    if (onDiscoveryStarted) onDiscoveryStarted();
    setTimeout(load, 2000);
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    const values = form.getFieldsValue();
    try {
      const r = await api.post(`/proxmox/hosts/${editing ? editing.id : 0}/test`, values);
      setTestResult(r.data);
    } catch (e) {
      setTestResult({ ok: false, error: e.response?.data?.error || e.message });
    } finally {
      setTesting(false);
    }
  }

  // A proxmox_hosts row can be a single PVE node or a PDM managing several —
  // only show hardware inline on the main row when there's exactly one node
  // to report on; otherwise leave it blank and expand for the per-node
  // breakdown (same convention as VMware's Hosts & Credentials tab).
  const soleNodeFor = (h) => {
    const nodes = nodesByHost[h.id] || [];
    return nodes.length === 1 ? nodes[0] : null;
  };

  const columns = [
    { title: 'Host',          dataIndex: 'host',              key: 'host',     ellipsis: true,
      render: (v, h) => <span><HealthDot color={deriveHealthColor(h)} />{v}</span> },
    {
      title: 'Type', dataIndex: 'host_type', key: 'host_type', width: 80,
      render: t => <Tag color={t === 'pdm' ? 'geekblue' : 'purple'}>{(t || 've').toUpperCase()}</Tag>,
    },
    { title: 'User',          dataIndex: 'username',          key: 'username', ellipsis: true,
      render: (u, h) => `${u}@${h.realm}` },
    { title: 'Port',          dataIndex: 'port',              key: 'port',     width: 70 },
    { title: 'Status',        key: 'status',                  width: 120,      render: (_, h) => statusTag(h) },
    { title: 'Last Run',      dataIndex: 'last_discovery_at', key: 'last_at',  ellipsis: true,
      render: v => v ? new Date(v).toLocaleString() : '—' },
    { title: 'VMs Found',     dataIndex: 'last_vm_count',     key: 'vm_count', width: 100, render: v => v ?? '—' },
    { title: 'Model', key: 'model', width: 150,
      render: (_, h) => soleNodeFor(h)?.cpu_model || <Text type="secondary">—</Text> },
    { title: 'CPU',  key: 'cpu',  width: 140, render: (_, h) => { const n = soleNodeFor(h); return n ? cpuChip(n) : <Text type="secondary">—</Text>; } },
    { title: 'RAM',  key: 'ram',  width: 150, render: (_, h) => { const n = soleNodeFor(h); return n ? ramChip(n) : <Text type="secondary">—</Text>; } },
    { title: 'Disk', key: 'disk', width: 150, render: (_, h) => { const n = soleNodeFor(h); return n ? diskChip(n) : <Text type="secondary">—</Text>; } },
    { title: 'Uptime', key: 'uptime', width: 110,
      render: (_, h) => { const n = soleNodeFor(h); return n ? formatUptime(n.uptime_seconds) : <Text type="secondary">—</Text>; } },
    { title: 'Scheduler',     dataIndex: 'scheduler_enabled', key: 'sched',    width: 100,
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
        expandable={{
          rowExpandable: (h) => (nodesByHost[h.id] || []).length > 1,
          expandedRowRender: (h) => (
            <Table
              size="small"
              rowKey="node"
              dataSource={nodesByHost[h.id] || []}
              pagination={false}
              scroll={{ x: 'max-content' }}
              sticky={{ offsetScroll: 0 }}
              columns={[
                {
                  title: <Space size={6}><ClusterOutlined />Node</Space>,
                  dataIndex: 'node',
                  render: (v, n) => (
                    <span>
                      <HealthDot color={n.status === 'online' ? '#52c41a' : '#8c8c8c'} />
                      <Text strong>{v}</Text>
                    </span>
                  ),
                },
                { title: 'IP', dataIndex: 'ip_address', width: 130, render: v => v || <Text type="secondary">—</Text> },
                { title: 'VMs', dataIndex: 'vm_count', width: 90, align: 'center' },
                { title: 'Model', dataIndex: 'cpu_model', width: 150, render: v => v || <Text type="secondary">—</Text> },
                { title: 'CPU',  key: 'cpu',  width: 140, render: (_, n) => cpuChip(n) },
                { title: 'RAM',  key: 'ram',  width: 150, render: (_, n) => ramChip(n) },
                { title: 'Disk', key: 'disk', width: 150, render: (_, n) => diskChip(n) },
                { title: 'Uptime', key: 'uptime', width: 110, render: (_, n) => formatUptime(n.uptime_seconds) },
              ]}
            />
          ),
        }}
      />

      <Modal
        open={modalOpen}
        title={editing ? `Edit — ${editing.host}` : 'Add Proxmox Host'}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        width={560}
        okText={editing ? 'Save' : 'Add'}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="hostType" label="Host Type" rules={[{ required: true }]}>
            <Select onChange={v => form.setFieldValue('port', v === 'pdm' ? 8007 : 8006)}>
              <Option value="ve">Proxmox VE</Option>
              <Option value="pdm">Proxmox Datacenter Manager (PDM)</Option>
            </Select>
          </Form.Item>

          <Form.Item name="host" label="Hostname / IP" rules={[{ required: true }]}>
            <Input placeholder="192.168.1.10 or pve.example.com" disabled={!!editing} />
          </Form.Item>

          <Form.Item name="username" label="Username" rules={[{ required: true }]}>
            <Input placeholder="root" />
          </Form.Item>

          <Form.Item name="realm" label="Realm" rules={[{ required: true }]}>
            <Select>
              <Option value="pam">PAM (Linux)</Option>
              <Option value="pve">PVE</Option>
              <Option value="ldap">LDAP</Option>
            </Select>
          </Form.Item>

          <Form.Item name="password" label={editing ? 'Password (leave blank to keep current)' : 'Password'}>
            <Input.Password placeholder="Password" autoComplete="new-password" />
          </Form.Item>

          <Form.Item
            label="API Token (optional — overrides password)"
            style={{ marginBottom: 0 }}
            extra="Format: user@realm!tokenid"
          >
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item name="tokenId" noStyle>
                <Input placeholder="Token ID (user@realm!tokenid)" style={{ width: '55%' }} />
              </Form.Item>
              <Form.Item name="tokenSecret" noStyle>
                <Input.Password placeholder="Token Secret" style={{ width: '45%' }} autoComplete="new-password" />
              </Form.Item>
            </Space.Compact>
          </Form.Item>

          <Form.Item name="port" label="Port" style={{ marginTop: 16 }}>
            <InputNumber min={1} max={65535} style={{ width: 120 }} />
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
                ? <Text type="success"><CheckCircleOutlined /> Connected — {testResult.vmCount} items found</Text>
                : <Text type="danger"><CloseCircleOutlined /> {testResult.error}</Text>
            )}
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
