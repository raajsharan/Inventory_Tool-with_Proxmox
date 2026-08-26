import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, App, AutoComplete, Badge, Button, Card, Col, Divider, Form, Input,
  Modal, Radio, Row, Select, Space, Switch, Table, Tabs, Tag, Tooltip, Typography,
} from 'antd';
import {
  AppstoreOutlined, CheckCircleFilled, ClockCircleOutlined, CloseCircleFilled, DesktopOutlined,
  ExclamationCircleFilled, KeyOutlined, LockOutlined, LoginOutlined,
  MobileOutlined, QuestionCircleOutlined, ReloadOutlined,
  SafetyCertificateOutlined, SettingOutlined, UserOutlined, WifiOutlined,
} from '@ant-design/icons';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';

const { Title, Text } = Typography;

// ── Endpoint status helpers ────────────────────────────────────────────────

const AGENT_STATUS = {
  0: { label: 'Online',  color: 'success', icon: <CheckCircleFilled style={{ color: '#52c41a' }} /> },
  1: { label: 'Offline', color: 'default', icon: <CloseCircleFilled style={{ color: '#d9d9d9' }} /> },
  2: { label: 'Unknown', color: 'warning', icon: <QuestionCircleOutlined style={{ color: '#faad14' }} /> },
};

const MANAGED_STATUS = {
  0: { label: 'Not Managed', color: 'error'   },
  1: { label: 'Managed',     color: 'success' },
};

// agent_install_status (documented on /som/computers as agent_install_status,
// on /inventory/scancomputers as installation_status): 21/22/23/24/29.
const INSTALL_STATUS = {
  21: { label: 'Yet to Install',       color: 'default' },
  22: { label: 'Installed',            color: 'success' },
  23: { label: 'Uninstalled',          color: 'default' },
  24: { label: 'Yet to Uninstall',     color: 'warning' },
  29: { label: 'Installation Failure', color: 'error'   },
};

function AgentStatusBadge({ status }) {
  const meta = AGENT_STATUS[status] ?? { label: 'Unknown', color: 'default', icon: <QuestionCircleOutlined /> };
  return <Badge status={meta.color} text={meta.label} />;
}

// "Staged" — hasn't checked in (last_sync) for longer than this, regardless
// of current live_status. Distinct dimension from Online/Offline/Unknown:
// a device can show Offline right now but have synced an hour ago, or show
// Offline and genuinely be stale for months. Adjust this threshold as needed.
const STALE_DAYS = 15;

function isStaged(agent) {
  if (!agent.last_sync || agent.last_sync === '—') return true;
  const d = new Date(agent.last_sync);
  if (isNaN(d)) return false;
  const diffDays = (Date.now() - d.getTime()) / 86400000;
  return diffDays > STALE_DAYS;
}

function ManagedTag({ status }) {
  const meta = MANAGED_STATUS[status] ?? { label: 'Unknown', color: 'default' };
  return <Tag color={meta.color} style={{ margin: 0 }}>{meta.label}</Tag>;
}

function InstallStatusTag({ status }) {
  const meta = INSTALL_STATUS[status] ?? { label: 'Not Reported', color: 'default' };
  return <Tag color={meta.color} style={{ margin: 0 }}>{meta.label}</Tag>;
}

// scan_status (documented on /inventory/scancomputers): -1/0/1/2. Distinct
// from agent_status (is the agent reachable now) and managed_status (is it
// installed) — this is "did the last inventory scan itself succeed".
const SCAN_STATUS = {
  '-1': { label: 'Not Done',     color: 'default' },
  0:    { label: 'Failed',       color: 'error'   },
  1:    { label: 'In Progress',  color: 'processing' },
  2:    { label: 'Success',      color: 'success' },
};

function ScanStatusTag({ status }) {
  const meta = SCAN_STATUS[status] ?? { label: 'Unknown', color: 'default' };
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

// ── OTP modal — shown when ME EC responds with OTP_Validation_Required ────

function OtpModal({ open, uniqueUserId, onSuccess, onCancel }) {
  const { message } = App.useApp();
  const [otp,       setOtp]       = useState('');
  const [loading,   setLoading]   = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) { setOtp(''); setTimeout(() => inputRef.current?.focus(), 100); }
  }, [open]);

  const handleSubmit = async () => {
    const code = otp.trim().replace(/\s/g, '');
    if (!code) { message.warning('Enter the 6-digit code from your authenticator app'); return; }
    setLoading(true);
    try {
      await api.post('/endpoint-central/login/otp', { unique_user_id: uniqueUserId, otp: code });
      message.success('Authenticated — session active');
      onSuccess();
    } catch (e) {
      message.error(e?.response?.data?.error || 'OTP validation failed — check the code and try again');
    } finally { setLoading(false); }
  };

  return (
    <Modal
      open={open}
      title={<><MobileOutlined /> Two-Factor Authentication</>}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel}>Cancel</Button>,
        <Button key="verify" type="primary" loading={loading} onClick={handleSubmit} icon={<LockOutlined />}>
          Verify Code
        </Button>,
      ]}
      width={380}
      destroyOnClose
    >
      <div style={{ textAlign: 'center', padding: '16px 0 8px' }}>
        <MobileOutlined style={{ fontSize: 36, color: '#1677ff', marginBottom: 12 }} />
        <div style={{ marginBottom: 8 }}>
          <Typography.Text>Open your authenticator app and enter the 6-digit code for</Typography.Text>
        </div>
        <div style={{ marginBottom: 20 }}>
          <Typography.Text strong>ManageEngine Endpoint Central</Typography.Text>
        </div>
        <Input
          ref={inputRef}
          value={otp}
          onChange={e => setOtp(e.target.value)}
          onPressEnter={handleSubmit}
          placeholder="000 000"
          maxLength={8}
          size="large"
          style={{ textAlign: 'center', fontSize: 24, letterSpacing: 6, fontWeight: 700, width: 200 }}
        />
        <div style={{ marginTop: 10 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Code refreshes every 30 seconds
          </Typography.Text>
        </div>
      </div>
    </Modal>
  );
}

// ── Config modal ───────────────────────────────────────────────────────────

function ConfigModal({ open, onClose, onSaved }) {
  const { message } = App.useApp();
  const [form]    = Form.useForm();
  const [testing,    setTesting]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [logging,    setLogging]    = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [checkingUrl,   setCheckingUrl]   = useState(false);
  const [urlCheckResult, setUrlCheckResult] = useState(null);
  const [authMode,   setAuthMode]   = useState('api_key');
  const [sessionActive, setSessionActive] = useState(false);
  const [otpOpen,       setOtpOpen]       = useState(false);
  const [uniqueUserId,  setUniqueUserId]  = useState('');

  useEffect(() => {
    if (!open) return;
    api.get('/endpoint-central/config').then(r => {
      const mode = r.data.auth_mode || 'api_key';
      setAuthMode(mode);
      setSessionActive(!!r.data.session_active);
      form.setFieldsValue({
        server_url:    r.data.server_url,
        customer_id:   r.data.customer_id || '1',
        api_key:       r.data.api_key,
        api_path:      r.data.api_path || '',
        verify_ssl:    r.data.verify_ssl,
        auth_mode:     mode,
        auth_username: r.data.auth_username || '',
        auth_password: '',
      });
      setTestResult(null);
      setUrlCheckResult(null);
    });
  }, [open, form]);

  const currentVals = () => form.getFieldsValue();

  const handleCheckUrl = async () => {
    const url = form.getFieldValue('server_url');
    if (!url) { message.warning('Enter the Server URL first'); return; }
    setCheckingUrl(true);
    setUrlCheckResult(null);
    try {
      const r = await api.post('/endpoint-central/check-url', {
        server_url: url,
        verify_ssl: form.getFieldValue('verify_ssl'),
      });
      setUrlCheckResult(r.data);
    } catch (e) {
      setUrlCheckResult({ reachable: false, error: e?.response?.data?.error || 'Request failed' });
    } finally { setCheckingUrl(false); }
  };

  const handleSave = async () => {
    try {
      const vals = await form.validateFields();
      if (vals.api_path && !vals.api_path.startsWith('/')) vals.api_path = '/' + vals.api_path;
      setSaving(true);
      await api.put('/endpoint-central/config', { ...vals, auth_mode: authMode });
      message.success('Configuration saved');
      onSaved();
      onClose();
    } catch (e) {
      if (e?.errorFields) return;
      message.error(e?.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  };

  const handleTest = async () => {
    const vals = currentVals();
    if (authMode === 'api_key' && !vals.server_url) {
      setTestResult({ success: false, error: 'Enter Server URL and API Key first' });
      return;
    }
    if (authMode === 'credentials' && !sessionActive) {
      setTestResult({ success: false, error: 'Log in first, then test the connection' });
      return;
    }
    if (vals.api_path && !vals.api_path.startsWith('/')) vals.api_path = '/' + vals.api_path;
    setTesting(true);
    setTestResult(null);
    try {
      // Save current config before testing — keep whatever API Path the admin
      // has set so Test Connection validates that selection first, rather
      // than discarding it in favour of auto-detection.
      await api.put('/endpoint-central/config', { ...vals, auth_mode: authMode });
      const r = await api.post('/endpoint-central/test');
      if (r.data.success && r.data.working_path && r.data.working_path !== vals.api_path) {
        // The configured path didn't work but a fallback did — reflect that.
        form.setFieldValue('api_path', r.data.working_path);
        await api.put('/endpoint-central/config', { ...vals, auth_mode: authMode, api_path: r.data.working_path });
      }
      setTestResult(r.data);
    } catch (e) {
      setTestResult({ success: false, error: e?.response?.data?.error || 'Request failed' });
    } finally { setTesting(false); }
  };

  const handleLogin = async () => {
    const vals = currentVals();
    if (!vals.server_url) { message.warning('Enter the Server URL first'); return; }
    if (!vals.auth_username) { message.warning('Enter your username'); return; }
    if (!vals.auth_password) { message.warning('Enter your password'); return; }

    setLogging(true);
    setTestResult(null);
    try {
      // Save base config (URL, customer ID, username, password, SSL) before logging in
      await api.put('/endpoint-central/config', {
        server_url:    vals.server_url,
        customer_id:   vals.customer_id || '1',
        verify_ssl:    vals.verify_ssl,
        auth_mode:     'credentials',
        auth_username: vals.auth_username,
        auth_password: vals.auth_password,
        api_path:      vals.api_path || '',
        api_key:       vals.api_key  || '',
      });

      const r = await api.post('/endpoint-central/login');

      if (r.data.otp_required) {
        setUniqueUserId(r.data.unique_user_id);
        setOtpOpen(true);
      } else {
        setSessionActive(true);
        setTestResult({ success: true, message: 'Logged in — session is now active' });
        onSaved();
      }
    } catch (e) {
      setTestResult({ success: false, error: e?.response?.data?.error || 'Login failed' });
    } finally { setLogging(false); }
  };

  const handleOtpSuccess = () => {
    setOtpOpen(false);
    setSessionActive(true);
    setTestResult({ success: true, message: 'Two-factor authentication complete — session is now active' });
    onSaved();
  };

  const apiKeyFields = (
    <>
      <Form.Item
        name="api_key"
        label={<><KeyOutlined /> API Key</>}
        rules={authMode === 'api_key' ? [{ required: true, message: 'API Key is required' }] : []}
        extra="Generate via Admin › API Explorer in the Endpoint Central console"
      >
        <Input.Password placeholder="Paste API key here" autoComplete="new-password" />
      </Form.Item>
    </>
  );

  const credentialFields = (
    <>
      {sessionActive ? (
        <Alert
          type="success"
          showIcon
          icon={<CheckCircleFilled />}
          message="Session active"
          description="You are logged in. API calls will use this session token. Re-login to refresh."
          style={{ marginBottom: 16 }}
        />
      ) : (
        <Alert
          type="warning"
          showIcon
          message="Not logged in"
          description="Enter your credentials below and click Login to authenticate."
          style={{ marginBottom: 16 }}
        />
      )}
      <Form.Item
        name="auth_username"
        label={<><UserOutlined /> Username</>}
        rules={authMode === 'credentials' ? [{ required: true, message: 'Username is required' }] : []}
      >
        <Input placeholder="admin" autoComplete="username" />
      </Form.Item>
      <Form.Item
        name="auth_password"
        label={<><LockOutlined /> Password</>}
        extra={sessionActive ? 'Leave blank to keep the stored password' : undefined}
        rules={authMode === 'credentials' && !sessionActive ? [{ required: true, message: 'Password is required' }] : []}
      >
        <Input.Password placeholder={sessionActive ? '(unchanged)' : 'Your password'} autoComplete="current-password" />
      </Form.Item>
      <Button
        type="primary"
        icon={<LoginOutlined />}
        loading={logging}
        onClick={handleLogin}
        block
        style={{ marginBottom: 8 }}
      >
        {sessionActive ? 'Re-Login (Refresh Session)' : 'Login'}
      </Button>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 16, textAlign: 'center' }}>
        If Two-Factor Authentication is enabled, you will be prompted for your authenticator code.
      </Typography.Text>
    </>
  );

  return (
    <>
      <Modal
        open={open}
        title={<><SettingOutlined /> ME Endpoint Central — Connection Settings</>}
        onCancel={onClose}
        footer={[
          <Button key="test" onClick={handleTest} loading={testing}>Test Connection</Button>,
          <Button key="cancel" onClick={onClose}>Cancel</Button>,
          <Button key="save" type="primary" loading={saving} onClick={handleSave}>Save</Button>,
        ]}
        width={540}
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

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '-8px 0 16px' }}>
            <Button size="small" icon={<WifiOutlined />} loading={checkingUrl} onClick={handleCheckUrl}>
              Check URL
            </Button>
            {urlCheckResult && (
              urlCheckResult.reachable
                ? <Tag color="success" icon={<CheckCircleFilled />}>Reachable (HTTP {urlCheckResult.status})</Tag>
                : <Tag color="error" icon={<CloseCircleFilled />}>Unreachable — {urlCheckResult.error}</Tag>
            )}
          </div>

          <Form.Item
            name="customer_id"
            label="Customer ID"
            extra="Leave as 1 for default MSP / single-tenant installations"
          >
            <Input placeholder="1" style={{ width: 120 }} />
          </Form.Item>

          <Divider orientation="left" orientationMargin={0} style={{ fontSize: 13, margin: '8px 0 16px' }}>
            Authentication Method
          </Divider>

          <Radio.Group
            value={authMode}
            onChange={e => { setAuthMode(e.target.value); setTestResult(null); }}
            style={{ marginBottom: 16, display: 'flex', gap: 12 }}
          >
            <Radio.Button value="api_key"     style={{ flex: 1, textAlign: 'center' }}>
              <KeyOutlined /> API Key
            </Radio.Button>
            <Radio.Button value="credentials" style={{ flex: 1, textAlign: 'center' }}>
              <UserOutlined /> Login with Credentials
            </Radio.Button>
          </Radio.Group>

          {authMode === 'api_key' ? apiKeyFields : credentialFields}

          <Divider orientation="left" orientationMargin={0} style={{ fontSize: 13, margin: '8px 0 16px' }}>
            Advanced
          </Divider>

          <Form.Item
            name="api_path"
            label="API Path"
            extra={
              <span>
                Leave blank to auto-detect. Recommended:{' '}
                <code>/api/1.4/inventory/scancomputers</code> — the only endpoint
                with confirmed field names for live/install status.
              </span>
            }
          >
            <AutoComplete
              allowClear
              placeholder="Auto-detect (tries known paths)"
              options={[
                { value: '/api/1.4/inventory/scancomputers',      label: '/api/1.4/inventory/scancomputers (recommended)' },
                { value: '/api/1.4/som/computers',                label: '/api/1.4/som/computers' },
                { value: '/api/1.4/inventory/computers',          label: '/api/1.4/inventory/computers' },
                { value: '/api/1.4/inventory/compdetailssummary', label: '/api/1.4/inventory/compdetailssummary' },
                { value: '/api/1.4/inventory/compdetailssummary?resid={resource_id}',
                  label: '/api/1.4/inventory/compdetailssummary?resid={resource_id} (single resource — needs a real resource_id, not for auto-detect)' },
                { value: '/api/1.4/inventory/software',           label: '/api/1.4/inventory/software' },
                { value: '/api/1.4/inventory/hardware',           label: '/api/1.4/inventory/hardware' },
                { value: '/api/1.4/inventory/allsummary',         label: '/api/1.4/inventory/allsummary' },
                { value: '/api/1.4/patch/allsystems',             label: '/api/1.4/patch/allsystems' },
                { value: '/api/1.4/patch/systems/allsystems',     label: '/api/1.4/patch/systems/allsystems' },
                { value: '/api/1.4/computers',                    label: '/api/1.4/computers (legacy)' },
                { value: '/dcapi/rd/computers',                   label: '/dcapi/rd/computers (legacy)' },
              ]}
              filterOption={(inputValue, option) =>
                option?.value?.toLowerCase().includes(inputValue.toLowerCase())
              }
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
                : testResult.success && testResult.sample_fields
                ? (
                  <div style={{ fontSize: 12, marginTop: 6 }}>
                    <div>
                      Live status field: {testResult.live_status_field
                        ? <code>{testResult.live_status_field} = {String(testResult.live_status_value)}</code>
                        : <span style={{ color: '#faad14' }}>not present in the response — Agent Status will show as Unknown until ME EC reports it</span>}
                    </div>
                    <div style={{ marginTop: 4, color: '#8c8c8c' }}>
                      Sample fields: {testResult.sample_fields.join(', ')}
                    </div>
                  </div>
                )
                : null
            }
          />
        )}
      </Modal>

      <OtpModal
        open={otpOpen}
        uniqueUserId={uniqueUserId}
        onSuccess={handleOtpSuccess}
        onCancel={() => setOtpOpen(false)}
      />
    </>
  );
}

// ── Summary cards ──────────────────────────────────────────────────────────

function SummaryCards({ agents }) {
  const total      = agents.length;
  const online     = agents.filter(a => a.agent_status === 0).length;
  const offline    = agents.filter(a => a.agent_status === 1).length;
  const unknown    = agents.filter(a => a.agent_status === 2).length;
  const notManaged = agents.filter(a => a.managed_status === 0).length;
  const staged     = agents.filter(isStaged).length;

  const cards = [
    { label: 'Total Endpoints', value: total,      color: undefined,  icon: <DesktopOutlined /> },
    { label: 'Online',          value: online,     color: '#52c41a',  icon: <WifiOutlined /> },
    { label: 'Offline',         value: offline,    color: '#8c8c8c',  icon: <CloseCircleFilled /> },
    { label: 'Unknown',         value: unknown,     color: '#faad14',  icon: <QuestionCircleOutlined /> },
    { label: 'Not Managed',     value: notManaged, color: '#ff4d4f',  icon: <ExclamationCircleFilled /> },
    { label: `Staged (${STALE_DAYS}+ days)`, value: staged, color: '#d4380d', icon: <ClockCircleOutlined /> },
  ];

  return (
    <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
      {cards.map(c => (
        <Col xs={12} sm={8} key={c.label}>
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

// ── Installation status summary cards ──────────────────────────────────────

function InstallSummaryCards({ agents }) {
  const total       = agents.length;
  const installed    = agents.filter(a => a.agent_install_status === 22).length;
  const yetToInstall = agents.filter(a => a.agent_install_status === 21).length;
  const uninstalled  = agents.filter(a => a.agent_install_status === 23 || a.agent_install_status === 24).length;
  const failed       = agents.filter(a => a.agent_install_status === 29).length;

  const cards = [
    { label: 'Total Endpoints',  value: total,        color: undefined,  icon: <DesktopOutlined /> },
    { label: 'Installed',        value: installed,    color: '#52c41a',  icon: <CheckCircleFilled /> },
    { label: 'Yet to Install',   value: yetToInstall, color: '#8c8c8c',  icon: <ClockCircleOutlined /> },
    { label: 'Uninstalled',      value: uninstalled,  color: '#faad14',  icon: <CloseCircleFilled /> },
    { label: 'Install Failure',  value: failed,       color: '#ff4d4f',  icon: <ExclamationCircleFilled /> },
  ];

  return (
    <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
      {cards.map(c => (
        <Col xs={12} sm={8} key={c.label}>
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
  const [scanFilter,   setScanFilter]   = useState(null);
  const [stagedFilt,   setStagedFilt]   = useState(null); // null | 'staged' | 'active'

  // Software filters
  const [swSearch,      setSwSearch]      = useState('');
  const [swTypeFilter,  setSwTypeFilter]  = useState(null);
  const [swUsageFilter, setSwUsageFilter] = useState(null);
  const [swCompliance,  setSwCompliance]  = useState(null);

  // Installation Status filters
  const [instSearch, setInstSearch] = useState('');
  const [instFilter,  setInstFilter]  = useState(null);

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
    if (scanFilter   !== null && a.scan_status !== scanFilter) return false;
    if (osFilter && osFamily(a.os_name) !== osFilter) return false;
    if (stagedFilt === 'staged' && !isStaged(a)) return false;
    if (stagedFilt === 'active' && isStaged(a)) return false;
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

  // ── Filtered installation status (reuses the same agents dataset) ──────
  const filteredInstall = agents.filter(a => {
    if (instFilter !== null && a.agent_install_status !== instFilter) return false;
    if (instSearch) {
      const q = instSearch.toLowerCase();
      if (!a.computer_name.toLowerCase().includes(q)
       && !a.ip_address.toLowerCase().includes(q)
       && !a.domain.toLowerCase().includes(q)) return false;
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
      title: 'Scan Status', dataIndex: 'scan_status', key: 'scan_status', width: 120,
      render: v => <ScanStatusTag status={v} />,
    },
    {
      title: 'IP Address', dataIndex: 'ip_address', key: 'ip_address', width: 140,
      render: v => <Text code style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: 'Logged On Users', dataIndex: 'logged_on_users', key: 'logged_on_users', width: 160, ellipsis: true,
      render: v => v === '—' ? <Text type="secondary">—</Text> : v,
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
      title: 'Service Pack', dataIndex: 'service_pack', key: 'service_pack', width: 140, ellipsis: true,
      render: v => v === '—' ? <Text type="secondary">—</Text> : v,
    },
    {
      title: 'OS Version', dataIndex: 'os_version', key: 'os_version', width: 120, ellipsis: true,
      render: v => v === '—' ? <Text type="secondary">—</Text> : <Text code style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: 'Agent Version', dataIndex: 'agent_version', key: 'agent_version', width: 130,
      render: v => v === '—' ? <Text type="secondary">—</Text> : <Text code style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: 'Last Sync', dataIndex: 'last_sync', key: 'last_sync', width: 160,
      render: (v, r) => {
        if (!v || v === '—') return <Tag color="error">Staged — never synced</Tag>;
        const d = new Date(v);
        if (isNaN(d)) return <Text type="secondary">{v}</Text>;
        const diffH = (Date.now() - d.getTime()) / 3600000;
        const fmt = d.toLocaleString();
        if (isStaged(r)) return <Tooltip title={`No sync in over ${STALE_DAYS} days`}><Tag color="error">{fmt}</Tag></Tooltip>;
        if (diffH > 72) return <Tooltip title={fmt}><Tag color="warning">{fmt}</Tag></Tooltip>;
        return <span>{fmt}</span>;
      },
    },
    {
      title: 'OS License Status', dataIndex: 'os_license_status', key: 'os_license_status', width: 150, ellipsis: true,
      render: v => v === '—' ? <Text type="secondary">—</Text> : v,
    },
    {
      title: 'Office / Location', dataIndex: 'office', key: 'office', width: 160, ellipsis: true,
      render: v => v === '—' ? <Text type="secondary">—</Text> : v,
    },
    {
      title: 'Assigned To', dataIndex: 'assigned_to', key: 'assigned_to', width: 160, ellipsis: true,
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

  // ── Installation Status columns ────────────────────────────────────────
  const installColumns = [
    {
      title: 'Computer Name', dataIndex: 'computer_name', key: 'computer_name',
      fixed: 'left', width: 200, ellipsis: true,
      render: v => <Text strong style={{ fontSize: 13 }}>{v}</Text>,
    },
    {
      title: 'IP Address', dataIndex: 'ip_address', key: 'ip_address', width: 140,
      render: v => <Text code style={{ fontSize: 12 }}>{v}</Text>,
    },
    { title: 'Domain', dataIndex: 'domain', key: 'domain', width: 160, ellipsis: true },
    {
      title: 'Install Status', dataIndex: 'agent_install_status', key: 'agent_install_status', width: 170,
      render: v => <InstallStatusTag status={v} />,
    },
    {
      title: 'Agent Status', dataIndex: 'agent_status', key: 'agent_status', width: 120,
      render: v => <AgentStatusBadge status={v} />,
    },
    {
      title: 'Scan Status', dataIndex: 'scan_status', key: 'scan_status', width: 120,
      render: v => <ScanStatusTag status={v} />,
    },
    {
      title: 'Last Sync', dataIndex: 'last_sync', key: 'last_sync', width: 160,
      render: v => {
        if (!v || v === '—') return <Text type="secondary">—</Text>;
        const d = new Date(v);
        if (isNaN(d)) return <Text type="secondary">{v}</Text>;
        return <span>{d.toLocaleString()}</span>;
      },
    },
  ];

  const notConfiguredAlert = !configured && !loading && (
    <Alert
      type="info"
      showIcon
      message="Endpoint Central is not configured"
      description={
        isAdmin
          ? 'Click "Configure" to enter the server URL and either an API key or your login credentials.'
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
                    <> — <a onClick={() => setConfigOpen(true)} style={{ cursor: 'pointer' }}>open settings</a> to update the connection details, regenerate the API key, or re-login.</>
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
                      { value: 2, label: 'Unknown' },
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
                    allowClear placeholder="Scan Status"
                    style={{ width: 150 }}
                    value={scanFilter}
                    onChange={v => setScanFilter(v ?? null)}
                    options={[
                      { value: 2,  label: 'Success'     },
                      { value: 1,  label: 'In Progress' },
                      { value: 0,  label: 'Failed'      },
                      { value: -1, label: 'Not Done'    },
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
                  <Select
                    allowClear placeholder="Staged"
                    style={{ width: 150 }}
                    value={stagedFilt}
                    onChange={v => setStagedFilt(v ?? null)}
                    options={[
                      { value: 'staged', label: `Staged (${STALE_DAYS}+ days)` },
                      { value: 'active', label: 'Active' },
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
      key: 'install-status',
      label: <span><ClockCircleOutlined /> Installation Status</span>,
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
                    <> — <a onClick={() => setConfigOpen(true)} style={{ cursor: 'pointer' }}>open settings</a> to update the connection details, regenerate the API key, or re-login.</>
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
              <InstallSummaryCards agents={agents} />
              <Card size="small" style={{ marginBottom: 12 }}>
                <Space wrap>
                  <Input.Search
                    placeholder="Search name / IP / domain…"
                    allowClear
                    style={{ width: 280 }}
                    value={instSearch}
                    onChange={e => setInstSearch(e.target.value)}
                  />
                  <Select
                    allowClear placeholder="Install Status"
                    style={{ width: 190 }}
                    value={instFilter}
                    onChange={v => setInstFilter(v ?? null)}
                    options={[
                      { value: 22, label: 'Installed'            },
                      { value: 21, label: 'Yet to Install'       },
                      { value: 23, label: 'Uninstalled'          },
                      { value: 24, label: 'Yet to Uninstall'     },
                      { value: 29, label: 'Installation Failure' },
                    ]}
                  />
                  <Button
                    icon={<ReloadOutlined />}
                    loading={loading}
                    onClick={load}
                  >
                    Refresh
                  </Button>
                </Space>
              </Card>
              <div style={{ marginBottom: 6 }}>
                <Text type="secondary">
                  Showing {filteredInstall.length} of {agents.length} endpoints
                </Text>
              </div>
              <Table
                rowKey={(r, i) => r.resource_id ?? `${r.computer_name}-${i}`}
                size="small"
                loading={loading}
                dataSource={filteredInstall}
                columns={installColumns}
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
