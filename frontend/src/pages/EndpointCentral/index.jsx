import { useCallback, useEffect, useState } from 'react';
import {
  Alert, App, Badge, Button, Card, Col, Descriptions, Form, Input,
  Modal, Row, Select, Space, Switch, Table, Tag, Tooltip, Typography,
} from 'antd';
import {
  CheckCircleFilled, CloseCircleFilled, DesktopOutlined,
  ExclamationCircleFilled, QuestionCircleOutlined, ReloadOutlined,
  SettingOutlined, WifiOutlined,
} from '@ant-design/icons';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';

const { Title, Text } = Typography;

// ── Status helpers ─────────────────────────────────────────────────────────

const AGENT_STATUS = {
  0: { label: 'Online',   color: 'success', icon: <CheckCircleFilled style={{ color: '#52c41a' }} /> },
  1: { label: 'Offline',  color: 'default', icon: <CloseCircleFilled style={{ color: '#d9d9d9' }} /> },
};

const MANAGED_STATUS = {
  0: { label: 'Not Managed', color: 'error'   },
  1: { label: 'Managed',     color: 'success' },
};

function AgentStatusBadge({ status }) {
  const meta = AGENT_STATUS[status] ?? { label: 'Unknown', color: 'default', icon: <QuestionCircleOutlined /> };
  return <Badge status={meta.color} text={meta.label} />;
}

function ManagedTag({ status }) {
  const meta = MANAGED_STATUS[status] ?? { label: 'Unknown', color: 'default' };
  return <Tag color={meta.color} style={{ margin: 0 }}>{meta.label}</Tag>;
}

function OsTag({ osName }) {
  if (!osName || osName === '—') return <Text type="secondary">—</Text>;
  const lower = osName.toLowerCase();
  const isWin = lower.includes('windows');
  const isLin = lower.includes('linux') || lower.includes('ubuntu') || lower.includes('centos')
             || lower.includes('debian') || lower.includes('red hat') || lower.includes('suse');
  const color = isWin ? 'blue' : isLin ? 'green' : 'default';
  const label = isWin ? 'Windows' : isLin ? 'Linux' : 'Other';
  return (
    <Tooltip title={osName}>
      <Tag color={color} style={{ margin: 0 }}>{label}</Tag>
    </Tooltip>
  );
}

// ── Config modal ───────────────────────────────────────────────────────────

function ConfigModal({ open, onClose, onSaved }) {
  const { message } = App.useApp();
  const [form]    = Form.useForm();
  const [testing, setTesting] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    if (!open) return;
    api.get('/endpoint-central/config').then(r => {
      form.setFieldsValue({
        server_url:  r.data.server_url,
        customer_id: r.data.customer_id || '1',
        api_key:     r.data.api_key,
        api_path:    r.data.api_path || '',
        verify_ssl:  r.data.verify_ssl,
      });
      setTestResult(null);
    });
  }, [open, form]);

  const handleSave = async () => {
    try {
      const vals = await form.validateFields();
      // Normalise api_path: trim and ensure it starts with /
      if (vals.api_path && !vals.api_path.startsWith('/')) vals.api_path = '/' + vals.api_path;
      setSaving(true);
      await api.put('/endpoint-central/config', vals);
      message.success('Configuration saved');
      onSaved();
      onClose();
    } catch (e) {
      if (e?.errorFields) return;
      message.error(e?.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  };

  const handleTest = async () => {
    const vals = form.getFieldsValue();
    if (!vals.server_url || !vals.api_key) {
      setTestResult({ success: false, error: 'Enter Server URL and API Key first' });
      return;
    }
    // Normalise api_path before saving for the test
    if (vals.api_path && !vals.api_path.startsWith('/')) vals.api_path = '/' + vals.api_path;
    setTesting(true);
    setTestResult(null);
    try {
      await api.put('/endpoint-central/config', vals);
      const r = await api.post('/endpoint-central/test');
      // If test succeeded and auto-discovered a working path, fill it in
      if (r.data.success && r.data.working_path && !vals.api_path) {
        form.setFieldValue('api_path', r.data.working_path);
      }
      setTestResult(r.data);
    } catch (e) {
      setTestResult({ success: false, error: e?.response?.data?.error || 'Request failed' });
    } finally { setTesting(false); }
  };

  return (
    <Modal
      open={open}
      title={<><SettingOutlined /> ME Endpoint Central — Connection Settings</>}
      onCancel={onClose}
      footer={[
        <Button key="test" onClick={handleTest} loading={testing}>Test Connection</Button>,
        <Button key="cancel" onClick={onClose}>Cancel</Button>,
        <Button key="save" type="primary" loading={saving} onClick={handleSave}>Save</Button>,
      ]}
      width={520}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Form.Item
          name="server_url"
          label="Server URL"
          rules={[{ required: true, message: 'Server URL is required' }]}
          extra="e.g. https://meec.corp.local:8383"
        >
          <Input placeholder="https://your-me-ec-server:8383" autoComplete="off" />
        </Form.Item>

        <Form.Item
          name="customer_id"
          label="Customer ID"
          extra="Leave as 1 for default MSP / single-tenant installations"
        >
          <Input placeholder="1" style={{ width: 120 }} />
        </Form.Item>

        <Form.Item
          name="api_key"
          label="API Key"
          rules={[{ required: true, message: 'API Key is required' }]}
          extra="Generate via Admin › API Explorer in the Endpoint Central console"
        >
          <Input.Password placeholder="Paste API key here" autoComplete="new-password" />
        </Form.Item>

        <Form.Item
          name="api_path"
          label="API Path"
          extra={
            <span>
              Leave blank to auto-detect. Common paths:{' '}
              <code>/api/1.4/computers</code>,{' '}
              <code>/api/1.4/patch/allsystems</code>
            </span>
          }
        >
          <Select
            allowClear
            placeholder="Auto-detect (tries known paths)"
            showSearch
            mode="combobox"
            options={[
              { value: '/api/1.4/computers',              label: '/api/1.4/computers' },
              { value: '/api/1.4/patch/allsystems',       label: '/api/1.4/patch/allsystems' },
              { value: '/api/1.4/patch/systems/allsystems', label: '/api/1.4/patch/systems/allsystems' },
              { value: '/api/1.4/inventory/computers',    label: '/api/1.4/inventory/computers' },
              { value: '/dcapi/rd/computers',             label: '/dcapi/rd/computers' },
            ]}
            onClear={() => form.setFieldValue('api_path', '')}
          />
        </Form.Item>

        <Form.Item name="verify_ssl" label="Verify SSL Certificate" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>

      {testResult && (
        <Alert
          style={{ marginTop: 8 }}
          type={testResult.success ? 'success' : 'error'}
          showIcon
          message={testResult.success ? testResult.message : testResult.error}
        />
      )}
    </Modal>
  );
}

// ── Summary cards ──────────────────────────────────────────────────────────

function SummaryCards({ agents }) {
  const total       = agents.length;
  const online      = agents.filter(a => a.agent_status === 0).length;
  const offline     = agents.filter(a => a.agent_status === 1).length;
  const notManaged  = agents.filter(a => a.managed_status === 0).length;

  const cards = [
    { label: 'Total Endpoints', value: total,      color: undefined,   icon: <DesktopOutlined /> },
    { label: 'Online',          value: online,     color: '#52c41a',   icon: <WifiOutlined /> },
    { label: 'Offline',         value: offline,    color: '#8c8c8c',   icon: <CloseCircleFilled /> },
    { label: 'Not Managed',     value: notManaged, color: '#ff4d4f',   icon: <ExclamationCircleFilled /> },
  ];

  return (
    <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
      {cards.map(c => (
        <Col xs={12} sm={6} key={c.label}>
          <Card size="small" styles={{ body: { padding: '10px 16px' } }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 22, color: c.color || '#1677ff' }}>{c.icon}</span>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, color: c.color, lineHeight: 1.2 }}>
                  {c.value}
                </div>
                <div style={{ fontSize: 12, color: '#8c8c8c' }}>{c.label}</div>
              </div>
            </div>
          </Card>
        </Col>
      ))}
    </Row>
  );
}

// ── OS filter helper ───────────────────────────────────────────────────────

function osFamily(osName) {
  if (!osName || osName === '—') return 'Other';
  const s = osName.toLowerCase();
  if (s.includes('windows')) return 'Windows';
  if (s.includes('linux') || s.includes('ubuntu') || s.includes('centos')
   || s.includes('debian') || s.includes('red hat') || s.includes('suse')) return 'Linux';
  return 'Other';
}

// ── Main page ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export default function EndpointCentral() {
  const { user }    = useAuth();
  const { message } = App.useApp();
  const isAdmin     = ['admin', 'superadmin'].includes(user?.role);

  const [agents,     setAgents]     = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [configured, setConfigured] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  // Filters
  const [search,      setSearch]      = useState('');
  const [statusFilter,setStatusFilter]= useState(null);
  const [osFilter,    setOsFilter]    = useState(null);
  const [managedFilt, setManagedFilt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/endpoint-central');
      setAgents(r.data.agents || []);
      setConfigured(true);
    } catch (e) {
      const status = e?.response?.status;
      const errMsg = e?.response?.data?.error || '';
      // 400 = not configured; 503 = schema not ready — both mean "needs setup"
      if (status === 400 || status === 503) {
        setConfigured(false);
        setAgents([]);
        if (status === 503) message.warning('Backend schema not ready — please restart the backend server');
      } else {
        message.error(errMsg || 'Failed to load agents');
      }
    } finally { setLoading(false); }
  }, [message]);

  useEffect(() => { load(); }, [load]);

  const filtered = agents.filter(a => {
    if (statusFilter !== null && a.agent_status !== statusFilter) return false;
    if (managedFilt !== null && a.managed_status !== managedFilt) return false;
    if (osFilter && osFamily(a.os_name) !== osFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!a.computer_name.toLowerCase().includes(q)
       && !a.ip_address.toLowerCase().includes(q)
       && !a.domain.toLowerCase().includes(q)
       && !a.os_name.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const columns = [
    {
      title: 'Computer Name', dataIndex: 'computer_name', key: 'computer_name',
      fixed: 'left', width: 200, ellipsis: true,
      render: v => <Text strong style={{ fontSize: 13 }}>{v}</Text>,
    },
    {
      title: 'Agent Status', dataIndex: 'agent_status', key: 'agent_status', width: 120,
      render: v => <AgentStatusBadge status={v} />,
    },
    {
      title: 'Managed', dataIndex: 'managed_status', key: 'managed_status', width: 120,
      render: v => <ManagedTag status={v} />,
    },
    {
      title: 'IP Address', dataIndex: 'ip_address', key: 'ip_address', width: 140,
      render: v => <Text code style={{ fontSize: 12 }}>{v}</Text>,
    },
    { title: 'Domain',    dataIndex: 'domain',   key: 'domain',   width: 160, ellipsis: true },
    {
      title: 'OS', dataIndex: 'os_name', key: 'os_name', width: 90,
      render: v => <OsTag osName={v} />,
    },
    { title: 'OS Name', dataIndex: 'os_name', key: 'os_name_full', width: 220, ellipsis: true,
      render: v => v === '—' ? <Text type="secondary">—</Text> : v,
    },
    {
      title: 'Agent Version', dataIndex: 'agent_version', key: 'agent_version', width: 130,
      render: v => v === '—' ? <Text type="secondary">—</Text> : <Text code style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: 'Last Sync', dataIndex: 'last_sync', key: 'last_sync', width: 160,
      render: v => {
        if (!v || v === '—') return <Text type="secondary">—</Text>;
        const d = new Date(v);
        if (isNaN(d)) return <Text type="secondary">{v}</Text>;
        const diffH = (Date.now() - d.getTime()) / 3600000;
        const fmt = d.toLocaleString();
        if (diffH > 72) return <Tooltip title={fmt}><Tag color="warning">{fmt}</Tag></Tooltip>;
        return <span>{fmt}</span>;
      },
    },
    {
      title: 'Office / Location', dataIndex: 'office', key: 'office', width: 160, ellipsis: true,
      render: v => v === '—' ? <Text type="secondary">—</Text> : v,
    },
  ];

  return (
    <div style={{ padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            <DesktopOutlined style={{ marginRight: 8, color: '#1677ff' }} />
            ME Endpoint Central
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            ManageEngine Endpoint Central — agent status per device
          </Text>
        </div>
        <Space>
          {isAdmin && (
            <Button icon={<SettingOutlined />} onClick={() => setConfigOpen(true)}>
              Configure
            </Button>
          )}
          <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>
            Refresh
          </Button>
        </Space>
      </div>

      {!configured && !loading && (
        <Alert
          type="info"
          showIcon
          message="Endpoint Central is not configured"
          description={
            isAdmin
              ? 'Click "Configure" to enter the server URL and API key.'
              : 'Contact an administrator to configure the Endpoint Central connection.'
          }
          style={{ marginBottom: 16 }}
          action={
            isAdmin
              ? <Button size="small" type="primary" onClick={() => setConfigOpen(true)}>Configure</Button>
              : null
          }
        />
      )}

      {configured && (
        <>
          <SummaryCards agents={agents} />

          {/* Filter bar */}
          <Card size="small" style={{ marginBottom: 12 }}>
            <Space wrap>
              <Input.Search
                placeholder="Search name / IP / domain / OS…"
                allowClear
                style={{ width: 280 }}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <Select
                allowClear placeholder="Agent Status"
                style={{ width: 150 }}
                value={statusFilter}
                onChange={v => setStatusFilter(v ?? null)}
                options={[
                  { value: 0, label: 'Online'  },
                  { value: 1, label: 'Offline' },
                ]}
              />
              <Select
                allowClear placeholder="Managed Status"
                style={{ width: 160 }}
                value={managedFilt}
                onChange={v => setManagedFilt(v ?? null)}
                options={[
                  { value: 1, label: 'Managed'     },
                  { value: 0, label: 'Not Managed'  },
                ]}
              />
              <Select
                allowClear placeholder="OS Family"
                style={{ width: 130 }}
                value={osFilter}
                onChange={v => setOsFilter(v ?? null)}
                options={[
                  { value: 'Windows', label: 'Windows' },
                  { value: 'Linux',   label: 'Linux'   },
                  { value: 'Other',   label: 'Other'   },
                ]}
              />
            </Space>
          </Card>

          <div style={{ marginBottom: 6 }}>
            <Text type="secondary">
              Showing {filtered.length} of {agents.length} endpoints
            </Text>
          </div>

          <Table
            rowKey={(r, i) => r.resource_id ?? `${r.computer_name}-${i}`}
            size="small"
            loading={loading}
            dataSource={filtered}
            columns={columns}
            pagination={{
              pageSize: PAGE_SIZE,
              showSizeChanger: true,
              showTotal: t => `${t} endpoints`,
            }}
            scroll={{ x: 'max-content' }}
            sticky
          />
        </>
      )}

      {isAdmin && (
        <ConfigModal
          open={configOpen}
          onClose={() => setConfigOpen(false)}
          onSaved={load}
        />
      )}
    </div>
  );
}
