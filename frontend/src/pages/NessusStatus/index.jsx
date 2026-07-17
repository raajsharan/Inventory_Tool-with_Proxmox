import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert, App, Badge, Button, Card, Col, Form, Input,
  InputNumber, Modal, Progress, Row, Select, Space, Spin, Statistic,
  Table, Tag, Tooltip, Typography,
} from 'antd';
import {
  CheckCircleFilled, CloseCircleFilled, CloudDownloadOutlined,
  ExclamationCircleFilled, FileSearchOutlined, InfoCircleOutlined,
  PlayCircleOutlined, QuestionCircleOutlined, ReloadOutlined,
  SafetyCertificateOutlined, SearchOutlined, SettingOutlined,
  ThunderboltOutlined, WarningFilled, WindowsOutlined,
} from '@ant-design/icons';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';

// ── constants ─────────────────────────────────────────────────────────────────
const WIN_METHOD_OPTIONS = [
  { value: 'auto',    label: 'Auto',   description: 'Try WinRM → WMI → PsExec → SSH until one succeeds' },
  { value: 'winrm',  label: 'WinRM',  description: 'PowerShell Remoting via Invoke-Command' },
  { value: 'wmi',    label: 'WMI',    description: 'Win32_Process.Create via WMI (async)' },
  { value: 'psexec', label: 'PsExec', description: 'Sysinternals PsExec remote execution' },
  { value: 'ssh',    label: 'SSH',    description: 'OpenSSH — SFTP upload + exec' },
];

const WIN_METHOD_COLORS = {
  auto: 'purple', winrm: 'geekblue', wmi: 'volcano', psexec: 'orange', ssh: 'blue', ssh_bash: 'cyan',
};

const SOURCE_COLOR = {
  'MSL Assets':       'blue',
  'Beijing Assets':   'purple',
  'Ext. Assets':      'cyan',
  'Physical Servers': 'orange',
};
const ALL_SOURCES = ['MSL Assets', 'Beijing Assets', 'Ext. Assets', 'Physical Servers'];

const SVC_META = {
  running:    { color: 'success',    label: 'Running',   icon: <CheckCircleFilled /> },
  exited:     { color: 'warning',    label: 'Exited',    icon: <ExclamationCircleFilled /> },
  inactive:   { color: 'default',    label: 'Inactive',  icon: <CloseCircleFilled /> },
  stopped:    { color: 'default',    label: 'Stopped',   icon: <CloseCircleFilled /> },
  paused:     { color: 'warning',    label: 'Paused',    icon: <ExclamationCircleFilled /> },
  activating: { color: 'processing', label: 'Starting…', icon: null },
  stopping:   { color: 'processing', label: 'Stopping…', icon: null },
  failed:     { color: 'error',      label: 'Failed',    icon: <CloseCircleFilled /> },
  not_found:  { color: 'default',    label: 'Not Found', icon: <QuestionCircleOutlined /> },
  unknown:    { color: 'default',    label: 'Unknown',   icon: <QuestionCircleOutlined /> },
};

const OS_META = {
  windows: {
    serviceName: 'Tenable Nessus Agent',
    binaryPath:  'C:\\Program Files\\Tenable\\Nessus Agent\\nessus-service.exe',
  },
  linux: {
    serviceName: 'nessusagent',
    binaryPath:  '/opt/nessus_agent/sbin/nessus-agent',
  },
};

const ACCENT       = '#fa8c16';      // orange accent for Nessus
const isWindows    = (t) => /windows/i.test(t || '');
const getOsMeta    = (t) => isWindows(t) ? OS_META.windows : OS_META.linux;
const compColor    = (p) => p >= 90 ? '#52c41a' : p >= 70 ? '#faad14' : '#ff4d4f';
const vmKey        = (v) => `${v.ip_address}||${v.source}`;

// ── component ─────────────────────────────────────────────────────────────────
export default function NessusStatus() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const isAdmin  = ['admin', 'superadmin'].includes(user?.role);

  const [data,          setData]          = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [installConfig, setInstallConfig] = useState({});
  const [expanded,      setExpanded]      = useState([]);
  const [methodMap,     setMethodMap]     = useState({});

  const [verifyMap,     setVerifyMap]     = useState({});
  const [installMap,    setInstallMap]    = useState({});
  const [verifyDetail,  setVerifyDetail]  = useState({ open: false, vm: null, result: null });
  const [installDetail, setInstallDetail] = useState({ open: false, vm: null, result: null });

  const [filterLocations, setFilterLocations] = useState([]);
  const [filterStatus,    setFilterStatus]    = useState('all');
  const [filterSources,   setFilterSources]   = useState([]);
  const [search,          setSearch]          = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Load config separately — its failure must not blank the status data.
      const [statusRes, cfgRes] = await Promise.allSettled([
        api.get('/nessus-status'),
        api.get('/nessus-status/install-config'),
      ]);
      if (statusRes.status === 'fulfilled') {
        setData(statusRes.value.data);
      } else {
        setData(null);
        message.error(statusRes.reason?.response?.data?.error || 'Failed to load Nessus status');
      }
      setInstallConfig(cfgRes.status === 'fulfilled' ? (cfgRes.value.data || {}) : {});
    } finally { setLoading(false); }
  }, []); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  const patchMap = (setMap, key, patch) =>
    setMap(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const configReady = (vm) => {
    const win = isWindows(vm?.os_type);
    const fp  = win ? installConfig.windows_file_path : installConfig.linux_file_path;
    const cmd = win ? installConfig.windows_cmd       : installConfig.linux_cmd;
    return !!(fp || cmd);
  };

  // ── verify ───────────────────────────────────────────────────────────────────
  // Credentials come exclusively from the asset record — no manual entry.
  const missingCredsError = (vm, r) => {
    const what = !r.has_username ? 'username and password' : 'password';
    return `No stored ${what} for ${vm.vm_name || vm.ip_address} — update the asset record to enable this action.`;
  };

  const runVerify = useCallback(async (vm) => {
    const key = vmKey(vm);
    patchMap(setVerifyMap, key, { state: 'loading', result: null });
    try {
      const { data: r } = await api.post('/nessus-status/verify', {
        ip_address: vm.ip_address, source: vm.source, port: 22,
      });
      if (r.needs_credentials) {
        const err = missingCredsError(vm, r);
        message.warning(err);
        patchMap(setVerifyMap, key, { state: 'done', result: { connected: false, error: err } });
      } else {
        patchMap(setVerifyMap, key, { state: 'done', result: r });
      }
    } catch (e) {
      patchMap(setVerifyMap, key, {
        state: 'done',
        result: { connected: false, error: e.response?.data?.error || e.message },
      });
    }
  }, []); // eslint-disable-line

  // ── install ──────────────────────────────────────────────────────────────────
  // Credentials come exclusively from the asset record — no manual entry.
  const runInstall = useCallback(async (vm, overrides = {}) => {
    const key    = vmKey(vm);
    const win    = isWindows(vm.os_type);
    const method = overrides.method || methodMap[key] || installConfig.windows_method || 'auto';

    patchMap(setInstallMap, key, { state: 'loading', result: null, method });
    try {
      const { data: r } = await api.post('/nessus-status/install', {
        ip_address: vm.ip_address, source: vm.source, port: 22,
        windows_method_override: win ? method : undefined,
      });
      if (r.needs_credentials) {
        const err = missingCredsError(vm, r);
        message.warning(err);
        patchMap(setInstallMap, key, { state: 'done', result: { connected: false, error: err } });
      } else {
        patchMap(setInstallMap, key, { state: 'done', result: r });
        if (!r.skipped) setInstallDetail({ open: true, vm, result: r });
      }
    } catch (e) {
      const err = e.response?.data?.error || e.message;
      patchMap(setInstallMap, key, { state: 'done', result: { connected: false, error: err } });
      setInstallDetail({ open: true, vm, result: { connected: false, error: err } });
    }
  }, [methodMap, installConfig]); // eslint-disable-line

  // ── filtered data ─────────────────────────────────────────────────────────────
  const locationOptions = useMemo(
    () => (data?.locations || []).map(r => ({ label: r.location, value: r.location })),
    [data],
  );

  const filteredLocations = useMemo(() => {
    if (!data) return [];
    return data.locations
      .filter(r => !filterLocations.length || filterLocations.includes(r.location))
      .map(r => {
        const vms = (r.vms || []).filter(v => {
          if (filterStatus === 'installed'     && !v.nessus_installed) return false;
          if (filterStatus === 'not_installed' &&  v.nessus_installed) return false;
          if (filterSources.length && !filterSources.includes(v.source)) return false;
          if (search) {
            const q = search.toLowerCase();
            return [v.vm_name, v.os_hostname, v.ip_address, v.os_type]
              .some(f => (f || '').toLowerCase().includes(q));
          }
          return true;
        });
        const installed     = vms.filter(v =>  v.nessus_installed).length;
        const not_installed = vms.filter(v => !v.nessus_installed).length;
        const total         = vms.length;
        const compliance_pct = total ? Math.round((installed / total) * 1000) / 10 : 0;
        return { ...r, vms, total, installed, not_installed, compliance_pct };
      })
      .filter(r => r.total > 0);
  }, [data, filterLocations, filterStatus, filterSources, search]);

  const overall = useMemo(() => {
    const o = filteredLocations.reduce(
      (a, r) => { a.total += r.total; a.installed += r.installed; a.not_installed += r.not_installed; return a; },
      { total: 0, installed: 0, not_installed: 0 },
    );
    o.compliance_pct = o.total ? Math.round((o.installed / o.total) * 1000) / 10 : 0;
    return o;
  }, [filteredLocations]);

  const hasFilters = filterLocations.length || filterStatus !== 'all' || filterSources.length || search;

  // ── VM row columns ────────────────────────────────────────────────────────────
  const vmColumns = [
    { title: 'VM Name',  dataIndex: 'vm_name',    width: 160, render: v => v || '—' },
    { title: 'Hostname', dataIndex: 'os_hostname', width: 160, render: v => v || '—' },
    {
      title: 'IP Address', dataIndex: 'ip_address', width: 135,
      render: v => <Typography.Text code style={{ fontSize: 12 }}>{v || '—'}</Typography.Text>,
    },
    {
      title: 'OS', dataIndex: 'os_type', width: 130,
      render: t => (
        <Tooltip title={t || 'Unknown'}>
          <Tag icon={isWindows(t) ? <WindowsOutlined /> : null}
            color={isWindows(t) ? 'blue' : 'default'}
            style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {t || 'Unknown'}
          </Tag>
        </Tooltip>
      ),
    },
    { title: 'Source', dataIndex: 'source', width: 130,
      render: v => <Tag color={SOURCE_COLOR[v] || 'default'}>{v}</Tag> },
    {
      title: 'Record', dataIndex: 'nessus_installed', width: 115, align: 'center',
      render: v => v
        ? <Tag icon={<CheckCircleFilled />} color="success">Installed</Tag>
        : <Tag icon={<CloseCircleFilled />} color="error">Not Installed</Tag>,
    },
    {
      title: (
        <Space>
          Live Check
          <Tooltip title="SSH: checks nessusagent service status + binary file">
            <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
          </Tooltip>
        </Space>
      ),
      width: 260,
      render: (_, vm) => {
        const vs = verifyMap[vmKey(vm)] || { state: 'idle' };
        const r  = vs.result;
        if (vs.state === 'loading') return <Spin size="small" />;
        if (vs.state === 'done' && r) {
          if (!r.connected) return (
            <Space wrap size={4}>
              <Tag color="error" icon={<ExclamationCircleFilled />}>Unreachable</Tag>
              <Button size="small" icon={<ReloadOutlined />} onClick={() => runVerify(vm)} />
            </Space>
          );
          const svc  = r.service || {};
          const file = r.file   || {};
          const sm   = SVC_META[svc.status] || SVC_META.unknown;
          return (
            <Space wrap size={4}>
              <Tooltip title={`Service: ${svc.name || ''}`}>
                <Tag icon={<PlayCircleOutlined />} color={sm.color}>{sm.label}</Tag>
              </Tooltip>
              <Tooltip title={file.path || ''}>
                <Tag icon={<FileSearchOutlined />} color={file.exists ? 'success' : 'default'}>
                  {file.exists ? 'Binary ✓' : 'Binary ✗'}
                </Tag>
              </Tooltip>
              <Button size="small" type="link" style={{ padding: 0 }}
                onClick={() => setVerifyDetail({ open: true, vm, result: r })}>Details</Button>
              <Button size="small" icon={<ReloadOutlined />} onClick={() => runVerify(vm)} />
            </Space>
          );
        }
        return (
          <Button size="small" icon={<ThunderboltOutlined />} onClick={() => runVerify(vm)}>
            Verify
          </Button>
        );
      },
    },
    ...(isAdmin ? [{
      title: (
        <Space>
          Install
          <Tooltip title="Select method then click Install. 'Auto' tries every method until one succeeds.">
            <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
          </Tooltip>
        </Space>
      ),
      width: 230,
      render: (_, vm) => {
        const key    = vmKey(vm);
        const is     = installMap[key] || { state: 'idle' };
        const ok     = configReady(vm);
        const win    = isWindows(vm.os_type);
        const method = methodMap[key] || installConfig.windows_method || 'auto';

        if (is.state === 'loading') {
          const label = WIN_METHOD_OPTIONS.find(o => o.value === (is.method || method))?.label || method;
          return <Space size={4}><Spin size="small" /><Typography.Text type="secondary" style={{ fontSize: 11 }}>Installing via {label}…</Typography.Text></Space>;
        }

        if (is.state === 'done' && is.result) {
          if (is.result.skipped) {
            return (
              <Space size={4} wrap>
                <Tag color="blue">Skipped</Tag>
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>Already installed</Typography.Text>
                <Button size="small" icon={<ReloadOutlined />} onClick={() => runInstall(vm)} />
              </Space>
            );
          }
          const success    = is.result.connected && is.result.exitCode === 0;
          const usedMethod = is.result.succeeded_method || is.result.method || method;
          return (
            <Space size={4} wrap>
              <Tag color={success ? 'success' : 'warning'}>
                {success ? 'Done' : is.result.connected ? 'Check output' : 'Failed'}
              </Tag>
              {usedMethod && <Tag color={WIN_METHOD_COLORS[usedMethod] || 'default'} style={{ fontSize: 10 }}>{usedMethod}</Tag>}
              <Button size="small" type="link" style={{ padding: 0 }}
                onClick={() => setInstallDetail({ open: true, vm, result: is.result })}>Output</Button>
              <Button size="small" icon={<ReloadOutlined />} onClick={() => runInstall(vm)} />
            </Space>
          );
        }

        return (
          <Space.Compact size="small">
            {win && (
              <Select
                size="small" value={method}
                onChange={v => setMethodMap(prev => ({ ...prev, [key]: v }))}
                popupMatchSelectWidth={false} style={{ width: 88 }}
                options={WIN_METHOD_OPTIONS.map(o => ({
                  value: o.value,
                  label: <Tooltip title={o.description} placement="left"><span>{o.label}</span></Tooltip>,
                }))}
              />
            )}
            <Tooltip title={!ok ? 'No installer configured — go to Admin → Nessus Install Config' : undefined}>
              <Button
                size="small" type="primary" icon={<CloudDownloadOutlined />}
                style={ok ? { background: ACCENT, borderColor: ACCENT } : {}}
                disabled={!ok}
                onClick={() => runInstall(vm)}
              >
                {win ? 'Install' : 'Install (SSH)'}
              </Button>
            </Tooltip>
          </Space.Compact>
        );
      },
    }] : []),
  ];

  // ── location summary columns ──────────────────────────────────────────────────
  const locColumns = [
    {
      title: 'Location', dataIndex: 'location', width: 220,
      render: (v, r) => (
        <Space>
          <Typography.Text strong>{v}</Typography.Text>
          {r.not_installed > 0 && (
            <Tooltip title={`${r.not_installed} VM(s) need Nessus Agent`}>
              <WarningFilled style={{ color: '#faad14' }} />
            </Tooltip>
          )}
        </Space>
      ),
    },
    { title: 'Total',         dataIndex: 'total',         width: 90,  align: 'right', render: v => <strong>{v}</strong> },
    { title: 'Installed',     dataIndex: 'installed',     width: 90,  align: 'right', render: v => <span style={{ color: '#52c41a' }}>{v}</span> },
    { title: 'Not Installed', dataIndex: 'not_installed', width: 120, align: 'right', render: v => <span style={{ color: v > 0 ? '#ff4d4f' : '#8c8c8c' }}>{v}</span> },
    {
      title: 'Compliance', dataIndex: 'compliance_pct',
      render: (pct, r) => (
        <Space>
          <Progress percent={pct} size="small" strokeColor={compColor(pct)}
            style={{ width: 120, marginBottom: 0 }} format={() => null} />
          <Typography.Text strong style={{ color: compColor(pct), minWidth: 44 }}>{pct}%</Typography.Text>
          {r.not_installed > 0 && <Badge count={r.not_installed} color="#ff4d4f" />}
        </Space>
      ),
    },
    {
      title: '', width: 280, align: 'right',
      render: (_, r) => {
        const verifying  = r.vms.some(v => (verifyMap[vmKey(v)] || {}).state === 'loading');
        const installing = r.vms.some(v => (installMap[vmKey(v)] || {}).state === 'loading');
        const pendingV   = r.vms.filter(v => (verifyMap[vmKey(v)] || {}).state !== 'done').length;
        const notInst    = r.vms.filter(v => !v.nessus_installed);
        const pendingI   = notInst.filter(v => (installMap[vmKey(v)] || {}).state !== 'done').length;
        const anyNoCmd   = notInst.some(v => !configReady(v));

        return (
          <Space size={8}>
            <Button size="small" icon={<ThunderboltOutlined />} loading={verifying}
              onClick={async () => {
                setExpanded(p => p.includes(r.location) ? p : [...p, r.location]);
                for (const v of r.vms) await runVerify(v);
              }}>
              Verify All ({pendingV})
            </Button>
            {isAdmin && (
              <Tooltip title={anyNoCmd ? 'Some VMs have no installer configured' : undefined}>
                <Button size="small" type="primary" icon={<CloudDownloadOutlined />}
                  style={{ background: ACCENT, borderColor: ACCENT }}
                  loading={installing}
                  disabled={notInst.length === 0}
                  onClick={async () => {
                    setExpanded(p => p.includes(r.location) ? p : [...p, r.location]);
                    for (const v of notInst) await runInstall(v);
                  }}>
                  Install Missing ({pendingI})
                </Button>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
  ];

  // ── render ────────────────────────────────────────────────────────────────────
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <Space align="start">
          <SafetyCertificateOutlined style={{ fontSize: 24, color: ACCENT, marginTop: 3 }} />
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>Nessus Agent Status</Typography.Title>
            <Typography.Text type="secondary">
              Tenable Nessus Agent — verify &amp; install via SSH across Windows and Linux VMs
            </Typography.Text>
          </div>
        </Space>
        {isAdmin && (
          <Link to="/admin/nessus-install-config">
            <Button icon={<SettingOutlined />}>Install Configuration</Button>
          </Link>
        )}
      </div>

      {/* Summary cards */}
      <Row gutter={16} style={{ marginBottom: 20 }}>
        {[
          { title: 'Total Active VMs',  value: overall.total },
          { title: 'Nessus Installed',  value: overall.installed,     style: { color: '#52c41a' }, prefix: <CheckCircleFilled />, suffix: overall.total ? `/ ${overall.total}` : '' },
          { title: 'Not Installed',     value: overall.not_installed, style: { color: overall.not_installed > 0 ? '#ff4d4f' : '#8c8c8c' }, prefix: <CloseCircleFilled /> },
        ].map(s => (
          <Col xs={12} sm={6} key={s.title}>
            <Card size="small" bodyStyle={{ padding: '12px 16px' }}>
              <Statistic title={s.title} value={s.value} valueStyle={{ fontSize: 26, ...(s.style || {}) }}
                prefix={s.prefix} suffix={s.suffix} />
            </Card>
          </Col>
        ))}
        <Col xs={12} sm={6}>
          <Card size="small" bodyStyle={{ padding: '12px 16px' }}>
            <Statistic title="Overall Compliance" value={overall.compliance_pct} suffix="%"
              valueStyle={{ fontSize: 26, color: compColor(overall.compliance_pct) }} />
            <Progress percent={overall.compliance_pct} strokeColor={compColor(overall.compliance_pct)}
              showInfo={false} size="small" style={{ marginTop: 4 }} />
          </Card>
        </Col>
      </Row>

      {/* Filter bar */}
      <Card size="small" style={{ marginBottom: 16 }} bodyStyle={{ padding: '12px 16px' }}>
        <Row gutter={[12, 8]} align="middle">
          <Col xs={24} sm={7} md={5}>
            <Select mode="multiple" allowClear style={{ width: '100%' }} placeholder="Location"
              options={locationOptions} value={filterLocations} onChange={setFilterLocations} maxTagCount="responsive" />
          </Col>
          <Col xs={24} sm={5} md={4}>
            <Select style={{ width: '100%' }} value={filterStatus} onChange={setFilterStatus}
              options={[{ label: 'All', value: 'all' }, { label: 'Installed', value: 'installed' }, { label: 'Not Installed', value: 'not_installed' }]} />
          </Col>
          <Col xs={24} sm={7} md={5}>
            <Select mode="multiple" allowClear style={{ width: '100%' }} placeholder="Source"
              options={ALL_SOURCES.map(s => ({ label: s, value: s }))}
              value={filterSources} onChange={setFilterSources} maxTagCount="responsive" />
          </Col>
          <Col xs={24} sm={8} md={6}>
            <Input prefix={<SearchOutlined />} placeholder="VM / hostname / IP / OS"
              allowClear value={search} onChange={e => setSearch(e.target.value)} />
          </Col>
          <Col xs={24} sm={4} md={4} style={{ display: 'flex', gap: 8 }}>
            {hasFilters && <Button onClick={() => { setFilterLocations([]); setFilterStatus('all'); setFilterSources([]); setSearch(''); }}>Clear</Button>}
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Refresh</Button>
          </Col>
        </Row>
      </Card>

      {/* Main table */}
      <Table
        rowKey="location" loading={loading} dataSource={filteredLocations}
        columns={locColumns} pagination={false} size="middle"
        expandable={{
          expandedRowKeys: expanded,
          onExpand: (open, r) => setExpanded(p => open ? [...p, r.location] : p.filter(k => k !== r.location)),
          expandedRowRender: (r) => (
            <Table
              rowKey={v => `${v.ip_address}||${v.source}`}
              dataSource={r.vms} columns={vmColumns}
              pagination={r.vms.length > 50 ? { pageSize: 50, size: 'small' } : false}
              size="small" style={{ margin: '0 0 8px 0' }}
              rowClassName={v => !v.nessus_installed ? 'row-warning' : ''}
            />
          ),
        }}
        footer={() => (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {filteredLocations.length} location{filteredLocations.length !== 1 ? 's' : ''} · {overall.total} VMs · decommissioned excluded
          </Typography.Text>
        )}
      />

      {/* ── Verify detail modal ───────────────────────────────────────────── */}
      <Modal
        open={verifyDetail.open}
        title={<Space><FileSearchOutlined />Verify — {verifyDetail.vm?.vm_name || verifyDetail.vm?.ip_address}</Space>}
        onCancel={() => setVerifyDetail({ open: false, vm: null, result: null })}
        footer={[
          <Button key="rv" icon={<ReloadOutlined />}
            onClick={() => { setVerifyDetail(s => ({ ...s, open: false })); runVerify(verifyDetail.vm); }}>Re-verify</Button>,
          <Button key="cl" type="primary" style={{ background: ACCENT, borderColor: ACCENT }}
            onClick={() => setVerifyDetail({ open: false, vm: null, result: null })}>Close</Button>,
        ]}
        width={680} destroyOnClose
      >
        {verifyDetail.result && <VerifyDetail vm={verifyDetail.vm} result={verifyDetail.result} />}
      </Modal>

      {/* ── Install output modal ──────────────────────────────────────────── */}
      <Modal
        open={installDetail.open}
        title={<Space><CloudDownloadOutlined />Install Output — {installDetail.vm?.vm_name || installDetail.vm?.ip_address}</Space>}
        onCancel={() => setInstallDetail({ open: false, vm: null, result: null })}
        footer={[
          <Button key="ver" icon={<ThunderboltOutlined />}
            onClick={() => { setInstallDetail(s => ({ ...s, open: false })); runVerify(installDetail.vm); }}>
            Verify Now
          </Button>,
          <Button key="cl" type="primary" style={{ background: ACCENT, borderColor: ACCENT }}
            onClick={() => setInstallDetail({ open: false, vm: null, result: null })}>Close</Button>,
        ]}
        width={700} destroyOnClose
      >
        {installDetail.result && <InstallDetail vm={installDetail.vm} result={installDetail.result} />}
      </Modal>

      <style>{`
        .row-warning td { background: #fff7e6 !important; }
        .row-warning:hover td { background: #ffe7ba !important; }
        body[data-theme="dark"] .row-warning td { background: rgba(250,173,20,0.14) !important; }
        body[data-theme="dark"] .row-warning:hover td { background: rgba(250,173,20,0.22) !important; }
      `}</style>
    </div>
  );
}

// ── sub-components ────────────────────────────────────────────────────────────
function VerifyDetail({ vm, result }) {
  const svc    = result.service || {};
  const file   = result.file   || {};
  const sm     = SVC_META[svc.status] || SVC_META.unknown;
  const osMeta = getOsMeta(vm?.os_type || result.meta?.os_type);
  const win    = isWindows(vm?.os_type);

  const pingTag = result.ping ? (
    <Tag color={result.ping.reachable ? 'green' : 'red'}>
      Ping: {result.ping.reachable
        ? `reachable${result.ping.time_ms != null ? ` · ${result.ping.time_ms} ms` : ''}`
        : 'no response'}
    </Tag>
  ) : null;

  if (!result.connected) {
    return (
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        {pingTag && <Space>{pingTag}</Space>}
        <Alert type="error" showIcon message="Could not connect" description={result.error} />
      </Space>
    );
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Space>
        <Tag icon={win ? <WindowsOutlined /> : null} color={win ? 'blue' : 'default'}>
          {win ? 'Windows' : 'Linux'} verification
        </Tag>
        {pingTag}
        {result.meta?.credentials_source && <Tag>credentials: {result.meta.credentials_source}</Tag>}
      </Space>
      <Row gutter={16}>
        <Col span={12}>
          <Card size="small" title={<Space><PlayCircleOutlined />Service</Space>}>
            <Tag color={sm.color} icon={sm.icon} style={{ fontSize: 13, padding: '2px 10px' }}>{sm.label}</Tag>
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 11, wordBreak: 'break-all' }}>
              {osMeta.serviceName}
            </Typography.Text>
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title={<Space><FileSearchOutlined />Binary</Space>}>
            <Tag color={file.exists ? 'success' : 'default'}
              icon={file.exists ? <CheckCircleFilled /> : <CloseCircleFilled />}
              style={{ fontSize: 13, padding: '2px 10px' }}>
              {file.exists ? 'Found' : 'Not Found'}
            </Tag>
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 11, wordBreak: 'break-all' }}>
              {file.path || osMeta.binaryPath}
            </Typography.Text>
          </Card>
        </Col>
      </Row>
      <Alert type={result.installed ? 'success' : 'warning'} showIcon
        message={result.installed ? 'Nessus Agent is installed and running.' : 'Nessus Agent is not installed or not running.'} />
      {svc.output && (
        <>
          <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>
            {win ? 'PowerShell output' : 'systemctl output'}
          </Typography.Text>
          <TerminalBox>{svc.output}</TerminalBox>
        </>
      )}
    </Space>
  );
}

function InstallDetail({ vm, result }) {
  const win        = isWindows(vm?.os_type || result.platform);
  const success    = result.connected && result.exitCode === 0;
  const usedMethod = result.succeeded_method || result.method;

  if (!result.connected) {
    return (
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Alert type="error" showIcon message="Connection failed" description={result.error} />
        {result.tried && <TriedMethods tried={result.tried} />}
      </Space>
    );
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Space wrap>
        <Tag icon={win ? <WindowsOutlined /> : null} color={win ? 'blue' : 'default'}>
          {win ? 'Windows' : 'Linux'} install
        </Tag>
        {usedMethod && <Tag color={WIN_METHOD_COLORS[usedMethod] || 'default'}>{usedMethod}</Tag>}
        <Tag color={success ? 'success' : 'warning'}>Exit code: {result.exitCode ?? '—'}</Tag>
      </Space>
      {result.tried && <TriedMethods tried={result.tried} />}
      <Alert type={success ? 'success' : 'warning'} showIcon
        message={success
          ? 'Nessus Agent install completed. Click "Verify Now" to confirm the agent is running.'
          : 'Install command finished but may have had issues. Review the output below.'} />
      {result.command && (
        <>
          <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>Command</Typography.Text>
          <TerminalBox>{result.command}</TerminalBox>
        </>
      )}
      {result.output && (
        <>
          <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>Output</Typography.Text>
          <TerminalBox>{result.output}</TerminalBox>
        </>
      )}
    </Space>
  );
}

function TriedMethods({ tried }) {
  return (
    <Space wrap size={4}>
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>Methods tried:</Typography.Text>
      {tried.map((t, i) => {
        const ok    = t.connected && t.exitCode === 0;
        const color = ok ? 'success' : t.connected ? 'warning' : 'error';
        return (
          <Tooltip key={i} title={t.error || (ok ? 'Succeeded' : `Exit ${t.exitCode ?? 'no connection'}`)}>
            <Tag color={color} style={{ fontSize: 10 }}>{t.method} {ok ? '✓' : '✗'}</Tag>
          </Tooltip>
        );
      })}
    </Space>
  );
}

function TerminalBox({ children }) {
  return (
    <pre style={{
      background: '#1a1a2e', color: '#e0e0e0', borderRadius: 6,
      padding: '10px 14px', fontSize: 12, lineHeight: 1.6, margin: 0,
      overflowX: 'auto', maxHeight: 300, overflowY: 'auto',
      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    }}>
      {children}
    </pre>
  );
}
