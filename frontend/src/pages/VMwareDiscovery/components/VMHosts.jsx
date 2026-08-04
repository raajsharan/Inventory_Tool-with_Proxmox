import { useEffect, useState } from 'react';
import {
  Table, Button, Modal, Form, Input, InputNumber, Switch, Space,
  Tag, App, Tooltip, Popconfirm, Card, Typography, Alert,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined,
  PlayCircleOutlined, ApiOutlined, CheckCircleOutlined, ClusterOutlined,
} from '@ant-design/icons';
import api from '../../../api/client';
import { useAuth } from '../../../context/AuthContext.jsx';
import {
  DOT_CSS, HealthDot, deriveHealthColor, cpuChip, ramChip, diskChip, formatUptime,
} from '../../../components/HardwareStatChips.jsx';

const { Text } = Typography;

function statusTag(host) {
  if (host.is_running) return <Tag color="processing">Running</Tag>;
  if (host.last_status === 'error') {
    return (
      <Tooltip title={host.last_error || 'Discovery failed'}>
        <Tag color="error" style={{ cursor: 'help' }}>Failed</Tag>
      </Tooltip>
    );
  }
  if (host.last_discovery_at) return <Tag color="success">Idle</Tag>;
  return <Tag color="default">Never Run</Tag>;
}

export default function VMHosts({ onDiscoveryStarted }) {
  const { user } = useAuth();
  const isAdmin = ['admin', 'superadmin'].includes(user?.role);
  const { message } = App.useApp();

  const [hosts, setHosts]       = useState([]);
  const [loading, setLoading]   = useState(false);
  const [modalOpen, setModal]   = useState(false);
  const [editing, setEditing]   = useState(null);
  const [testResult, setTest]   = useState({});
  const [testing, setTesting]   = useState({});
  const [topology, setTopology] = useState({});   // vcenter host → esxi_hosts[]
  const [error, setError]       = useState(null);
  const [form] = Form.useForm();

  const load = () => {
    setLoading(true);
    api.get('/vmware/hosts')
      .then(r => { setHosts(r.data.hosts || []); setError(null); })
      .catch(e => setError(e?.response?.data?.error || e.message || 'Failed to load hosts.'))
      .finally(() => setLoading(false));
    api.get('/vmware/esxi-topology').then(r => {
      const map = {};
      for (const t of r.data.topology || r.data || []) {
        if (t?.vcenter) map[t.vcenter] = t.esxi_hosts || [];
      }
      setTopology(map);
    }).catch(() => setTopology({}));
  };

  useEffect(() => { load(); }, []);

  function openAdd() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ port: 443, verifySSL: false, intervalMinutes: 60, schedulerEnabled: false });
    setModal(true);
  }

  function openEdit(record) {
    setEditing(record);
    form.setFieldsValue({
      host:             record.host,
      username:         record.username,
      password:         '',
      port:             record.port,
      verifySSL:        record.verify_ssl,
      intervalMinutes:  record.interval_minutes,
      schedulerEnabled: record.scheduler_enabled,
    });
    setModal(true);
  }

  async function onSave() {
    const values = await form.validateFields();
    try {
      if (editing) {
        await api.put(`/vmware/hosts/${editing.id}`, values);
        message.success(`Updated ${editing.host}`);
      } else {
        await api.post('/vmware/hosts', values);
        message.success(`Added ${values.host}`);
      }
      setModal(false);
      load();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to save');
    }
  }

  async function onDelete(id) {
    try {
      await api.delete(`/vmware/hosts/${id}`);
      message.success('Host removed');
      load();
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to delete');
    }
  }

  async function onRunNow(record) {
    try {
      await api.post(`/vmware/hosts/${record.id}/run`);
      message.success(`Discovery triggered for ${record.host}`);
      onDiscoveryStarted?.();
      setTimeout(load, 2000);
    } catch (err) {
      message.error(err.response?.data?.error || 'Failed to trigger');
    }
  }

  async function onTest(record) {
    setTesting(t => ({ ...t, [record.id]: true }));
    setTest(t => ({ ...t, [record.id]: null }));
    try {
      const r = await api.post(`/vmware/hosts/${record.id}/test`);
      setTest(t => ({ ...t, [record.id]: r.data }));
    } catch (err) {
      setTest(t => ({ ...t, [record.id]: { ok: false, error: err.response?.data?.error || 'Request failed' } }));
    } finally {
      setTesting(t => ({ ...t, [record.id]: false }));
    }
  }

  const columns = [
    { title: 'Host', dataIndex: 'host', key: 'host',
      render: (v, r) => <span><HealthDot color={deriveHealthColor(r)} />{v}</span> },
    { title: 'Username', dataIndex: 'username', key: 'username' },
    { title: 'Port', dataIndex: 'port', key: 'port', width: 70 },
    {
      title: 'Status', key: 'status',
      render: (_, r) => statusTag(r),
    },
    {
      title: 'Last Discovery', dataIndex: 'last_discovery_at', key: 'last_discovery_at',
      render: v => v ? new Date(v).toLocaleString() : '—',
    },
    {
      title: 'VM Count', dataIndex: 'last_vm_count', key: 'last_vm_count', width: 90,
      render: v => v ?? '—',
    },
    {
      title: 'Model', dataIndex: 'hardware_model', key: 'hardware_model', width: 150,
      render: v => v || <Text type="secondary">—</Text>,
    },
    { title: 'CPU',  key: 'cpu',  width: 140, render: (_, r) => cpuChip(r) },
    { title: 'RAM',  key: 'ram',  width: 150, render: (_, r) => ramChip(r) },
    { title: 'Disk', key: 'disk', width: 150, render: (_, r) => diskChip(r) },
    {
      title: 'ESXi Uptime', dataIndex: 'uptime_seconds', key: 'uptime_seconds', width: 110,
      render: v => formatUptime(v),
    },
    {
      title: 'Scheduler', key: 'sched',
      render: (_, r) => r.scheduler_enabled
        ? <Tag color="blue">Every {r.interval_minutes}m</Tag>
        : <Tag color="default">Off</Tag>,
    },
    isAdmin && {
      title: 'Test', key: 'test',
      render: (_, r) => (
        <Space size="small">
          <Button
            size="small"
            icon={<ApiOutlined />}
            loading={testing[r.id]}
            onClick={() => onTest(r)}
          >Test</Button>
          {testResult[r.id] && (
            testResult[r.id].ok
              ? <Tooltip title={`${testResult[r.id].vmCount} VMs`}><CheckCircleOutlined style={{ color: '#52c41a' }} /></Tooltip>
              : <Tooltip title={testResult[r.id].error}><Text type="danger" style={{ fontSize: 12 }}>Fail</Text></Tooltip>
          )}
        </Space>
      ),
    },
    isAdmin && {
      title: 'Actions', key: 'actions',
      render: (_, r) => (
        <Space>
          <Tooltip title="Run Discovery Now">
            <Button size="small" icon={<PlayCircleOutlined />} disabled={r.is_running} onClick={() => onRunNow(r)} />
          </Tooltip>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          <Popconfirm title="Delete this host?" onConfirm={() => onDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ].filter(Boolean);

  return (
    <Card
      size="small"
      title="vCenter / ESXi Hosts"
      extra={isAdmin && <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>Add Host</Button>}
    >
      <style>{DOT_CSS}</style>
      {error && <Alert type="error" showIcon message="Couldn't load hosts" description={error} style={{ marginBottom: 12 }} />}
      <Table
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={hosts}
        columns={columns}
        pagination={false}
        scroll={{ x: 'max-content' }}
        sticky={{ offsetScroll: 0 }}
        expandable={{
          rowExpandable: () => true,
          expandedRowRender: (r) => {
            const esxi = topology[r.host] || [];
            if (!esxi.length) {
              return (
                <Text type="secondary">
                  No ESXi placement data yet — run a discovery to populate the ESXi hosts under this vCenter.
                </Text>
              );
            }
            return (
              <Table
                size="small"
                rowKey={(h) => `${h.esxi_name}|${h.esxi_ip}`}
                dataSource={esxi}
                pagination={false}
                scroll={{ x: 'max-content' }}
                sticky={{ offsetScroll: 0 }}
                columns={[
                  {
                    title: <Space size={6}><ClusterOutlined />ESXi Host</Space>,
                    dataIndex: 'esxi_name',
                    render: (v, h) => (
                      <span>
                        <HealthDot color={h.cpu_cores != null ? '#52c41a' : '#8c8c8c'} />
                        <Text strong>{v}</Text>
                      </span>
                    ),
                  },
                  { title: 'VMs',        dataIndex: 'vm_count',    width: 90, align: 'center' },
                  { title: 'Powered On', dataIndex: 'powered_on',  width: 110, align: 'center',
                    render: v => <Tag color={v > 0 ? 'green' : 'default'}>{v}</Tag> },
                  { title: 'Powered Off', dataIndex: 'powered_off', width: 110, align: 'center',
                    render: v => <Tag color={v > 0 ? 'orange' : 'default'}>{v}</Tag> },
                  { title: 'Suspended',  dataIndex: 'suspended',   width: 100, align: 'center',
                    render: v => v > 0 ? <Tag color="gold">{v}</Tag> : <Text type="secondary">0</Text> },
                  { title: 'Model', dataIndex: 'hardware_model', width: 150,
                    render: v => v || <Text type="secondary">—</Text> },
                  { title: 'CPU',  key: 'cpu',  width: 140, render: (_, r) => cpuChip(r) },
                  { title: 'RAM',  key: 'ram',  width: 150, render: (_, r) => ramChip(r) },
                  { title: 'Disk', key: 'disk', width: 150, render: (_, r) => diskChip(r) },
                  { title: 'Uptime', dataIndex: 'uptime_seconds', width: 110,
                    render: v => formatUptime(v) },
                ]}
              />
            );
          },
        }}
      />

      <Modal
        title={editing ? `Edit ${editing.host}` : 'Add vCenter / ESXi Host'}
        open={modalOpen}
        onOk={onSave}
        onCancel={() => setModal(false)}
        okText="Save"
        width={520}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="host" label="Host / IP" rules={[{ required: true }]}>
            <Input placeholder="vcenter.corp.com" disabled={!!editing} />
          </Form.Item>
          <Form.Item name="username" label="Username" rules={[{ required: true }]}>
            <Input placeholder="administrator@vsphere.local" />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: !editing }]}>
            <Input.Password placeholder={editing ? 'Leave blank to keep current' : 'Password'} />
          </Form.Item>
          <Space style={{ width: '100%' }}>
            <Form.Item name="port" label="Port" style={{ width: 120 }}>
              <InputNumber min={1} max={65535} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="verifySSL" label="Verify SSL" valuePropName="checked" style={{ paddingTop: 24 }}>
              <Switch />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }}>
            <Form.Item name="intervalMinutes" label="Discovery Interval (minutes)" style={{ width: 220 }}>
              <InputNumber min={5} max={1440} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="schedulerEnabled" label="Auto Schedule" valuePropName="checked" style={{ paddingTop: 24 }}>
              <Switch />
            </Form.Item>
          </Space>
          <Form.Item name="runNow" label="Run discovery immediately" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
