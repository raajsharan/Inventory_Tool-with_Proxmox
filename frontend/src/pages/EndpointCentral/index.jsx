import { useCallback, useEffect, useState } from 'react';
import {
  Alert, App, Badge, Button, Card, Col, Descriptions, Form, Input,
  Modal, Row, Select, Space, Switch, Table, Tabs, Tag, Tooltip, Typography,
} from 'antd';
import {
  AppstoreOutlined, CheckCircleFilled, CloseCircleFilled, DesktopOutlined,
  ExclamationCircleFilled, QuestionCircleOutlined, ReloadOutlined,
  SafetyCertificateOutlined, SettingOutlined, WifiOutlined,
} from '@ant-design/icons';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';

const { Title, Text } = Typography;

// ── Endpoint status helpers ────────────────────────────────────────────────

const AGENT_STATUS = {
  0: { label: 'Online',  color: 'success', icon: <CheckCircleFilled style={{ color: '#52c41a' }} /> },
  1: { label: 'Offline', color: 'default', icon: <CloseCircleFilled style={{ color: '#d9d9d9' }} /> },
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

// ── Software status helpers ────────────────────────────────────────────────

const SW_TYPE = {
  1:  { label: 'Commercial',     color: 'blue'    },
  2:  { label: 'Non-commercial', color: 'green'   },
  0:  { label: 'Unidentified',   color: 'default' },
};

const USAGE_STATUS = {
  1: { label: 'Allowed',      color: 'success' },
  2: { label: 'Prohibited',   color: 'error'   },
  0: { label: 'Not Assigned', color: 'default' },
};

const COMPLIANCE_STATUS = {
  2:  { label: 'In Compliance',  color: 'success'  },
  1:  { label: 'Over Licensed',  color: 'warning'  },
  0:  { label: 'Under Licensed', color: 'error'    },
  3:  { label: 'Expired',        color: 'error'    },
  '-1': { label: 'N/A',          color: 'default'  },
};

function SwTypeTag({ value }) {
  const meta = SW_TYPE[value] ?? SW_TYPE[0];
  return <Tag color={meta.color} style={{ margin: 0 }}>{meta.label}</Tag>;
}

function UsageTag({ value }) {
  const meta = USAGE_STATUS[value] ?? USAGE_STATUS[0];
  return <Badge status={meta.color} text={meta.label} />;
}

function ComplianceTag({ value }) {
  const key  = value === -1 ? '-1' : value;
  const meta = COMPLIANCE_STATUS[key] ?? COMPLIANCE_STATUS['-1'];
  return <Tag color={meta.color} style={{ margin: 0 }}>{meta.label}</Tag>;
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
    if (vals.api_path && !vals.api_path.startsWith('/')) vals.api_path = '/' + vals.api_path;
    setTesting(true);
    setTestResult(null);
    try {
      await api.put('/endpoint-central/config', { ...vals, api_path: '' });
      const r = await api.post('/endpoint-central/test');
      if (r.data.success && r.data.working_path) {
        form.setFieldValue('api_path', r.data.working_path);
        await api.put('/endpoint-central/config', { ...vals, api_path: r.data.working_path });
      } else {
        await api.put('/endpoint-central/config', vals);
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
              Leave blank to auto-detect. Recommended:{' '}
              <code>/api/1.4/som/computers</code>
            </span>
          }
        >
          <Select
            allowClear
            placeholder="Auto-detect (tries known paths)"
            showSearch
            mode="combobox"
            options={[
              { value: '/api/1.4/som/computers',               label: '/api/1.4/som/computers (recommended)' },
              { value: '/api/1.4/inventory/computers',         label: '/api/1.4/inventory/computers' },
              { value: '/api/1.4/inventory/scancomputers',     label: '/api/1.4/inventory/scancomputers' },
              { value: '/api/1.4/inventory/compdetailssummary',label: '/api/1.4/inventory/compdetailssummary' },
              { value: '/api/1.4/patch/allsystems',            label: '/api/1.4/patch/allsystems' },
              { value: '/api/1.4/patch/systems/allsystems',    label: '/api/1.4/patch/systems/allsystems' },
              { value: '/api/1.4/computers',                   label: '/api/1.4/computers (legacy)' },
              { value: '/dcapi/rd/computers',                  label: '/dcapi/rd/computers (legacy)' },
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
          description={
            !testResult.success && testResult.detail
              ? (
                <pre style={{ fontSize: 11, marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 220, overflowY: 'auto', background: 'transparent', padding: 0 }}>
                  {testResult.detail}
                </pre>
              )
              : null
          }
        />
      )}
    </Modal>
  );
}

// ── Summary cards ──────────────────────────────────────────────────────────

function SummaryCards({ agents }) {
  const total      = agents.length;
  const online     = agents.filter(a => a.agent_status === 0).length;
  const offline    = agents.filter(a => a.agent_status === 1).length;
  const notManaged = agents.filter(a => a.managed_status === 0).length;

  const cards = [
    { label: 'Total Endpoints', value: total,      color: undefined,  icon: <DesktopOutlined /> },
    { label: 'Online',          value: online,     color: '#52c41a',  icon: <WifiOutlined /> },
    { label: 'Offline',         value: offline,    color: '#8c8c8c',  icon: <CloseCircleFilled /> },
    { label: 'Not Managed',     value: notManaged, color: '#ff4d4f',  icon: <ExclamationCircleFilled /> },
  ];

  return (
    <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
      {cards.map(c => (
        <Col xs={12} sm={6} key={c.label}>
          <Card size="small" styles={{ body: { padding: '10px 16px' } }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 22, color: c.color || '#1677ff' }}>{c.icon}</span>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, color: c.color, lineHeight: 1.2 }}>{c.value}</div>
                <div style={{ fontSize: 12, color: '#8c8c8c' }}>{c.label}</div>
              </div>
            </div>
          </Card>
        </Col>
      ))}
    </Row>
  );
}

// ── Software summary cards ─────────────────────────────────────────────────

function SoftwareSummaryCards({ software }) {
  const total       = software.length;
  const commercial  = software.filter(s => s.sw_type === 1).length;
  const prohibited  = software.filter(s => s.is_usage_prohibited === 2).length;
  const nonCompliant = software.filter(s => s.compliant_status === 0 || s.compliant_status === 3).length;

  const cards = [
    { label: 'Total Software',    value: total,        color: undefined,  icon: <AppstoreOutlined /> },
    { label: 'Commercial',        value: commercial,   color: '#1677ff',  icon: <SafetyCertificateOutlined /> },
    { label: 'Prohibited',        value: prohibited,   color: '#ff4d4f',  icon: <CloseCircleFilled /> },
    { label: 'Non-Compliant',     value: nonCompliant, color: '#fa8c16',  icon: <ExclamationCircleFilled /> },
  ];

  return (
    <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
      {cards.map(c => (
        <Col xs={12} sm={6} key={c.label}>
          <Card size="small" styles={{ body: { padding: '10px 16px' } }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 22, color: c.color || '#1677ff' }}>{c.icon}</span>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, color: c.color, lineHeight: 1.2 }}>{c.value}</div>
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

  // Endpoints tab
  const [agents,          setAgents]          = useState([]);
  const [loading,         setLoading]         = useState(false);
  const [configured,      setConfigured]      = useState(false);
  const [connectionError, setConnectionError] = useState(null); // 502: configured but can't reach ME EC
  const [configOpen,      setConfigOpen]      = useState(false);

  // Software tab
  const [software,         setSoftware]         = useState([]);
  const [swLoading,        setSwLoading]        = useState(false);
  const [swLoaded,         setSwLoaded]         = useState(false);
  const [swConnectionError,setSwConnectionError]= useState(null);
  const [activeTab,        setActiveTab]        = useState('endpoints');

  // Endpoint filters
  const [search,       setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState(null);
  const [osFilter,     setOsFilter]     = useState(null);
  const [managedFilt,  setManagedFilt]  = useState(null);

  // Software filters
  const [swSearch,      setSwSearch]      = useState('');
  const [swTypeFilter,  setSwTypeFilter]  = useState(null);
  const [swUsageFilter, setSwUsageFilter] = useState(null);
  const [swCompliance,  setSwCompliance]  = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setConnectionError(null);
    try {
      const r = await api.get('/endpoint-central');
      setAgents(r.data.agents || []);
      setConfigured(true);
    } catch (e) {
      const status = e?.response?.status;
      const errMsg = e?.response?.data?.error || '';
      if (status === 400) {
        // Not configured — no server URL / API key saved yet
        setConfigured(false);
        setAgents([]);
      } else if (status === 503) {
        // Backend schema not ready
        setConfigured(false);
        setAgents([]);
        message.warning('Backend schema not ready — please restart the backend server');
      } else if (status === 502) {
        // Configured but ME EC is unreachable or auth failed — show alert in-page
        setConfigured(true);
        setAgents([]);
        setConnectionError(errMsg || 'Could not connect to Endpoint Central — check the server URL and API key');
      } else {
        message.error(errMsg || 'Failed to load agents');
      }
    } finally { setLoading(false); }
  }, [message]);

  const loadSoftware = useCallback(async () => {
    setSwLoading(true);
    setSwConnectionError(null);
    try {
      const r = await api.get('/endpoint-central/software');
      setSoftware(r.data.software || []);
      setSwLoaded(true);
    } catch (e) {
      const status = e?.response?.status;
      const errMsg = e?.response?.data?.error || '';
      if (status === 400) {
        setSoftware([]);
        setSwLoaded(false);
      } else if (status === 503) {
        setSoftware([]);
        setSwLoaded(false);
        message.warning('Backend schema not ready — please restart the backend server');
      } else if (status === 502) {
        setSoftware([]);
        setSwConnectionError(errMsg || 'Could not retrieve software list from Endpoint Central — check the API key');
      } else {
        message.error(errMsg || 'Failed to load software list');
      }
    } finally { setSwLoading(false); }
  }, [message]);

  useEffect(() => { load(); }, [load]);

  // Load software when user switches to that tab (lazy load).
  // Skip if agents already got a connection error — same server, same failure.
  const handleTabChange = (key) => {
    setActiveTab(key);
    if (key === 'software' && !swLoaded && configured && !connectionError) {
      loadSoftware();
    }
  };

  // Reload both when config is saved — clear all error states first
  const handleConfigSaved = () => {
    setConnectionError(null);
    setSwConnectionError(null);
    setSwLoaded(false);
    load();
    if (activeTab === 'software') loadSoftware();
  };

  // ── Filtered endpoints ─────────────────────────────────────────────────
  const filteredAgents = agents.filter(a => {
    if (statusFilter !== null && a.agent_status !== statusFilter) return false;
    if (managedFilt  !== null && a.managed_status !== managedFilt) return false;
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

  // ── Filtered software ──────────────────────────────────────────────────
  const filteredSoftware = software.filter(s => {
    if (swTypeFilter   !== null && s.sw_type             !== swTypeFilter)   return false;
    if (swUsageFilter  !== null && s.is_usage_prohibited !== swUsageFilter)  return false;
    if (swCompliance   !== null && s.compliant_status    !== swCompliance)   return false;
    if (swSearch) {
      const q = swSearch.toLowerCase();
      if (!s.software_name.toLowerCase().includes(q)
       && !s.manufacturer.toLowerCase().includes(q)
       && !s.version.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // ── Endpoint columns ───────────────────────────────────────────────────
  const agentColumns = [
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
      title: 'OS', dataIndex: 'os_name', key: 'os_tag', width: 90,
      render: v => <OsTag osName={v} />,
    },
    {
      title: 'OS Name', dataIndex: 'os_name', key: 'os_name', width: 220, ellipsis: true,
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

  // ── Software columns ───────────────────────────────────────────────────
  const softwareColumns = [
    {
      title: 'Software Name', dataIndex: 'software_name', key: 'software_name',
      fixed: 'left', width: 240, ellipsis: true,
      render: v => <Text strong style={{ fontSize: 13 }}>{v}</Text>,
    },
    { title: 'Version',      dataIndex: 'version',      key: 'version',      width: 130, ellipsis: true,
      render: v => v === '—' ? <Text type="secondary">—</Text> : <Text code style={{ fontSize: 12 }}>{v}</Text>,
    },
    { title: 'Manufacturer', dataIndex: 'manufacturer', key: 'manufacturer', width: 200, ellipsis: true,
      render: v => v === '—' ? <Text type="secondary">—</Text> : v,
    },
    {
      title: 'License Type', dataIndex: 'sw_type', key: 'sw_type', width: 140,
      render: v => <SwTypeTag value={v} />,
    },
    {
      title: 'Usage', dataIndex: 'is_usage_prohibited', key: 'is_usage_prohibited', width: 130,
      render: v => <UsageTag value={v} />,
    },
    {
      title: 'Compliance', dataIndex: 'compliant_status', key: 'compliant_status', width: 140,
      render: v => <ComplianceTag value={v} />,
    },
    {
      title: 'Installed', dataIndex: 'installed_count', key: 'installed_count', width: 100, align: 'right',
      render: v => <Text>{v ?? 0}</Text>,
    },
    {
      title: 'Licensed', dataIndex: 'licensed_count', key: 'licensed_count', width: 100, align: 'right',
      render: v => (v == null || v === 0) ? <Text type="secondary">—</Text> : <Text>{v}</Text>,
    },
  ];

  const notConfiguredAlert = !configured && !loading && (
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
  );

  const tabItems = [
    {
      key: 'endpoints',
      label: <span><DesktopOutlined /> Endpoints</span>,
      children: (
        <>
          {configured && connectionError && (
            <Alert
              type="error"
              showIcon
              message="Could not reach Endpoint Central"
              description={
                <span>
                  {connectionError}
                  {isAdmin && (
                    <> — <a onClick={() => setConfigOpen(true)} style={{ cursor: 'pointer' }}>open settings</a> to update the connection details or regenerate the API key.</>
                  )}
                </span>
              }
              style={{ marginBottom: 16 }}
              action={
                <Button size="small" icon={<ReloadOutlined />} onClick={load}>Retry</Button>
              }
            />
          )}
          {configured && !connectionError && (
            <>
              <SummaryCards agents={agents} />
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
                  Showing {filteredAgents.length} of {agents.length} endpoints
                </Text>
              </div>
              <Table
                rowKey={(r, i) => r.resource_id ?? `${r.computer_name}-${i}`}
                size="small"
                loading={loading}
                dataSource={filteredAgents}
                columns={agentColumns}
                pagination={{ pageSize: PAGE_SIZE, showSizeChanger: true, showTotal: t => `${t} endpoints` }}
                scroll={{ x: 'max-content' }}
                sticky
              />
            </>
          )}
        </>
      ),
    },
    {
      key: 'software',
      label: <span><AppstoreOutlined /> Software Inventory</span>,
      children: (
        <>
          {/* Connection error — same root cause as agents tab (auth/network) */}
          {configured && (connectionError || swConnectionError) && (
            <Alert
              type="error"
              showIcon
              message="Could not reach Endpoint Central"
              description={
                <span>
                  {swConnectionError || connectionError}
                  {isAdmin && (
                    <> — <a onClick={() => setConfigOpen(true)} style={{ cursor: 'pointer' }}>open settings</a> to update credentials.</>
                  )}
                </span>
              }
              style={{ marginBottom: 16 }}
              action={
                <Button size="small" icon={<ReloadOutlined />} onClick={loadSoftware}>Retry</Button>
              }
            />
          )}
          {configured && !connectionError && !swConnectionError && (
            <>
              <SoftwareSummaryCards software={software} />
              <Card size="small" style={{ marginBottom: 12 }}>
                <Space wrap>
                  <Input.Search
                    placeholder="Search software name / manufacturer…"
                    allowClear
                    style={{ width: 300 }}
                    value={swSearch}
                    onChange={e => setSwSearch(e.target.value)}
                  />
                  <Select
                    allowClear placeholder="License Type"
                    style={{ width: 160 }}
                    value={swTypeFilter}
                    onChange={v => setSwTypeFilter(v ?? null)}
                    options={[
                      { value: 1, label: 'Commercial'     },
                      { value: 2, label: 'Non-commercial' },
                      { value: 0, label: 'Unidentified'   },
                    ]}
                  />
                  <Select
                    allowClear placeholder="Usage"
                    style={{ width: 150 }}
                    value={swUsageFilter}
                    onChange={v => setSwUsageFilter(v ?? null)}
                    options={[
                      { value: 1, label: 'Allowed'      },
                      { value: 2, label: 'Prohibited'   },
                      { value: 0, label: 'Not Assigned' },
                    ]}
                  />
                  <Select
                    allowClear placeholder="Compliance"
                    style={{ width: 170 }}
                    value={swCompliance}
                    onChange={v => setSwCompliance(v ?? null)}
                    options={[
                      { value:  2, label: 'In Compliance'  },
                      { value:  1, label: 'Over Licensed'  },
                      { value:  0, label: 'Under Licensed' },
                      { value:  3, label: 'Expired'        },
                      { value: -1, label: 'N/A'            },
                    ]}
                  />
                  <Button
                    icon={<ReloadOutlined />}
                    loading={swLoading}
                    onClick={loadSoftware}
                  >
                    Refresh
                  </Button>
                </Space>
              </Card>
              <div style={{ marginBottom: 6 }}>
                <Text type="secondary">
                  Showing {filteredSoftware.length} of {software.length} software titles
                </Text>
              </div>
              <Table
                rowKey={(r, i) => r.software_id ?? `${r.software_name}-${i}`}
                size="small"
                loading={swLoading}
                dataSource={filteredSoftware}
                columns={softwareColumns}
                pagination={{ pageSize: PAGE_SIZE, showSizeChanger: true, showTotal: t => `${t} titles` }}
                scroll={{ x: 'max-content' }}
                sticky
              />
            </>
          )}
        </>
      ),
    },
  ];

  return (
    <div style={{ padding: '16px 20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            <DesktopOutlined style={{ marginRight: 8, color: '#1677ff' }} />
            ME Endpoint Central
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            ManageEngine Endpoint Central — agent status and software inventory
          </Text>
        </div>
        <Space>
          {isAdmin && (
            <Button icon={<SettingOutlined />} onClick={() => setConfigOpen(true)}>
              Configure
            </Button>
          )}
          <Button
            icon={<ReloadOutlined />}
            loading={activeTab === 'endpoints' ? loading : swLoading}
            onClick={activeTab === 'endpoints' ? load : loadSoftware}
          >
            Refresh
          </Button>
        </Space>
      </div>

      {notConfiguredAlert}

      <Tabs
        activeKey={activeTab}
        onChange={handleTabChange}
        items={tabItems}
        destroyInactiveTabPane={false}
      />

      {isAdmin && (
        <ConfigModal
          open={configOpen}
          onClose={() => setConfigOpen(false)}
          onSaved={handleConfigSaved}
        />
      )}
    </div>
  );
}
