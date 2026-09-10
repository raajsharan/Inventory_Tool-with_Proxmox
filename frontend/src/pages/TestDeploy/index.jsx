import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert, App, Badge, Button, Card, Col, Input, Modal, Progress, Row, Select, Space, Spin,
  Statistic, Table, Tag, Tooltip, Typography,
} from 'antd';
import {
  CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled,
  FileSearchOutlined, InfoCircleOutlined, PlayCircleOutlined, QuestionCircleOutlined, ReloadOutlined,
  RocketOutlined, SearchOutlined, SettingOutlined, ThunderboltOutlined,
  WarningFilled, WindowsOutlined,
} from '@ant-design/icons';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';
import { DASH_CSS, StatCard } from '../../components/DashboardStatCard.jsx';

const SOURCE_COLOR = {
  'MSL Assets':       'blue',
  'Beijing Assets':   'purple',
  'Ext. Assets':      'cyan',
  'Physical Servers': 'orange',
};
const ALL_SOURCES = ['MSL Assets', 'Beijing Assets', 'Ext. Assets', 'Physical Servers'];

// Same service-status vocabulary Software Status uses for this exact agent.
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

const isWindows = (t) => /windows/i.test(t || '');
const complianceColor = (p) => p >= 90 ? '#52c41a' : p >= 70 ? '#faad14' : '#ff4d4f';
const vmKey = (v) => `${v.source}||${v.ip_address}`;

function TerminalBox({ children }) {
  return (
    <pre style={{
      background: '#1a1a2e', color: '#e0e0e0', borderRadius: 6,
      padding: '10px 14px', fontSize: 12, lineHeight: 1.6, margin: 0,
      maxHeight: 320, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    }}>
      {children}
    </pre>
  );
}

function pollRunUntilDone(id) {
  return new Promise((resolve, reject) => {
    const check = async () => {
      try {
        const { data } = await api.get(`/test-deploy/runs/${id}`);
        if (data.status === 'running') setTimeout(check, 3000);
        else resolve(data);
      } catch (e) { reject(e); }
    };
    check();
  });
}

export default function TestDeploy() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const isAdmin = ['admin', 'superadmin'].includes(user?.role);

  const [assets, setAssets]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [defaultConfig, setDefaultConfig] = useState({});
  const [locConfigMap, setLocConfigMap]   = useState({});
  const [expanded, setExpanded] = useState([]);

  const [verifyMap, setVerifyMap]   = useState({});
  const [installMap, setInstallMap] = useState({});
  const [verifyDetail, setVerifyDetail]   = useState({ open: false, vm: null, result: null });
  const [installDetail, setInstallDetail] = useState({ open: false, vm: null, result: null });

  const [filterLocations, setFilterLocations] = useState([]);
  const [filterStatus, setFilterStatus]       = useState('all');
  const [filterSources, setFilterSources]     = useState([]);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [assetsRes, cfgRes, locsRes] = await Promise.allSettled([
        api.get('/test-deploy/assets'),
        api.get('/test-deploy/config'),
        api.get('/test-deploy/locations'),
      ]);
      if (assetsRes.status === 'fulfilled') {
        setAssets(assetsRes.value.data.assets || []);
      } else {
        setAssets([]);
        message.error(assetsRes.reason?.response?.data?.error || 'Failed to load assets');
      }
      setDefaultConfig(cfgRes.status === 'fulfilled' ? (cfgRes.value.data || {}) : {});

      if (locsRes.status === 'fulfilled') {
        const cfgs = await Promise.allSettled((locsRes.value.data.locations || []).map(l =>
          api.get('/test-deploy/config', { params: { location: l.location, merged: true } })
            .then(r => [l.location, r.data])
        ));
        const map = {};
        for (const c of cfgs) if (c.status === 'fulfilled') map[c.value[0]] = c.value[1];
        setLocConfigMap(map);
      } else {
        setLocConfigMap({});
      }
    } finally { setLoading(false); }
  }, []); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  const patchMap = (setMap, key, patch) => setMap(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  const cfgFor = (vm) => (vm?.location && locConfigMap[vm.location]) || defaultConfig;
  const configReady = (vm) => {
    const cfg = cfgFor(vm);
    const win = isWindows(vm?.os_type);
    return !!((win ? cfg.windows_share_path : cfg.linux_share_path) && (win ? cfg.windows_installer_file : cfg.linux_installer_file));
  };

  // ── verify: proves the file transfer will succeed, without installing ────
  const runVerify = useCallback(async (vm) => {
    const key = vmKey(vm);
    patchMap(setVerifyMap, key, { state: 'loading', result: null });
    try {
      const { data: r } = await api.post('/test-deploy/verify', { source: vm.source, ip_address: vm.ip_address });
      patchMap(setVerifyMap, key, { state: 'done', result: r });
    } catch (e) {
      patchMap(setVerifyMap, key, { state: 'done', result: { connected: false, error: e.response?.data?.error || e.message } });
    }
  }, []); // eslint-disable-line

  // ── install (deploy) ───────────────────────────────────────────────────────
  const runInstall = useCallback(async (vm) => {
    const key = vmKey(vm);
    patchMap(setInstallMap, key, { state: 'loading', result: null });
    try {
      const { data } = await api.post('/test-deploy/runs', { targets: [{ source: vm.source, ip_address: vm.ip_address }] });
      const run = await pollRunUntilDone(data.id);
      const target = (run.targets || [])[0];
      const result = {
        connected: true, success: target?.status === 'success',
        status: target?.status || run.status, output: run.output,
      };
      patchMap(setInstallMap, key, { state: 'done', result });
      setInstallDetail({ open: true, vm, result });
    } catch (e) {
      const result = { connected: false, error: e.response?.data?.error || e.message };
      patchMap(setInstallMap, key, { state: 'done', result });
      setInstallDetail({ open: true, vm, result });
    }
  }, []); // eslint-disable-line

  // ── filtered / grouped data ──────────────────────────────────────────────
  const locationOptions = useMemo(
    () => [...new Set(assets.map(a => a.location))].sort().map(l => ({ label: l, value: l })),
    [assets],
  );

  const filteredLocations = useMemo(() => {
    const byLocation = new Map();
    for (const a of assets) {
      if (filterLocations.length && !filterLocations.includes(a.location)) continue;
      if (filterStatus === 'installed'     && !a.me_installed) continue;
      if (filterStatus === 'not_installed' && a.me_installed)  continue;
      if (filterSources.length && !filterSources.includes(a.source)) continue;
      if (search) {
        const q = search.toLowerCase();
        if (![a.vm_name, a.os_hostname, a.ip_address, a.os_type].some(f => (f || '').toLowerCase().includes(q))) continue;
      }
      if (!byLocation.has(a.location)) byLocation.set(a.location, []);
      byLocation.get(a.location).push(a);
    }
    return [...byLocation.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([location, vms]) => {
      const installed     = vms.filter(v =>  v.me_installed).length;
      const not_installed = vms.filter(v => !v.me_installed).length;
      const total          = vms.length;
      const compliance_pct = total ? Math.round((installed / total) * 1000) / 10 : 0;
      return { location, vms, total, installed, not_installed, compliance_pct };
    });
  }, [assets, filterLocations, filterStatus, filterSources, search]);

  const overall = useMemo(() => {
    const o = filteredLocations.reduce(
      (a, r) => { a.total += r.total; a.installed += r.installed; a.not_installed += r.not_installed; return a; },
      { total: 0, installed: 0, not_installed: 0 },
    );
    o.compliance_pct = o.total ? Math.round((o.installed / o.total) * 1000) / 10 : 0;
    return o;
  }, [filteredLocations]);

  const hasFilters = filterLocations.length || filterStatus !== 'all' || filterSources.length || search;

  // ── VM row columns ────────────────────────────────────────────────────────
  const vmColumns = [
    { title: 'VM Name',  dataIndex: 'vm_name',    width: 160, render: v => v || '—' },
    { title: 'Hostname', dataIndex: 'os_hostname', width: 160, render: v => v || '—' },
    { title: 'IP Address', dataIndex: 'ip_address', width: 135, render: v => <Typography.Text code style={{ fontSize: 12 }}>{v || '—'}</Typography.Text> },
    {
      title: 'OS', dataIndex: 'os_type', width: 130,
      render: t => (
        <Tag icon={isWindows(t) ? <WindowsOutlined /> : null} color={isWindows(t) ? 'blue' : 'default'}>
          {t || 'Unknown'}
        </Tag>
      ),
    },
    { title: 'Source', dataIndex: 'source', width: 130, render: v => <Tag color={SOURCE_COLOR[v] || 'default'}>{v}</Tag> },
    {
      title: 'Record', dataIndex: 'me_installed', width: 115, align: 'center',
      render: v => v
        ? <Tag icon={<CheckCircleFilled />} color="success">Installed</Tag>
        : <Tag icon={<CloseCircleFilled />} color="error">Not Installed</Tag>,
    },
    {
      title: (
        <Space>
          Verify
          <Tooltip title="Checks ping, host OS/version, whether the ME Agent is already installed/running, and whether the installer copy from the network share will succeed">
            <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
          </Tooltip>
        </Space>
      ),
      width: 420,
      render: (_, vm) => {
        const vs = verifyMap[vmKey(vm)] || { state: 'idle' };
        const r  = vs.result;
        if (vs.state === 'loading') return <Spin size="small" />;
        if (vs.state === 'done' && r) {
          const pingOk     = !!r.ping?.reachable;
          const transferOk = r.connected && r.success;
          const agent      = r.agent;
          const sm         = agent?.connected ? (SVC_META[agent.service?.status] || SVC_META.unknown) : null;
          return (
            <Space wrap size={4}>
              <Tooltip title={pingOk ? `Reachable${r.ping.time_ms != null ? ` · ${r.ping.time_ms} ms` : ''}` : 'No ping response'}>
                <Tag color={pingOk ? 'success' : 'error'} icon={pingOk ? <CheckCircleFilled /> : <ExclamationCircleFilled />}>
                  {pingOk ? 'Ping OK' : 'No ping'}
                </Tag>
              </Tooltip>
              <Tooltip title={r.hostInfo || 'Could not determine OS/version'}>
                <Tag color={r.hostInfo ? 'blue' : 'default'} icon={r.hostInfo ? <CheckCircleFilled /> : <QuestionCircleOutlined />}>
                  {r.hostInfo ? r.hostInfo.split('::')[0] : 'OS unknown'}
                </Tag>
              </Tooltip>
              <Tooltip title={agent?.connected ? `Service: ${sm.label}` : (agent?.error || 'Could not check the agent')}>
                <Tag color={sm ? sm.color : 'warning'} icon={sm ? sm.icon : <ExclamationCircleFilled />}>
                  {sm ? `Agent: ${sm.label}` : 'Agent check failed'}
                </Tag>
              </Tooltip>
              <Tooltip title={r.error || (transferOk ? 'File transfer succeeded' : 'File transfer failed')}>
                <Tag color={transferOk ? 'success' : 'error'} icon={transferOk ? <CheckCircleFilled /> : <ExclamationCircleFilled />}>
                  {transferOk ? 'Transfer OK' : 'Transfer failed'}
                </Tag>
              </Tooltip>
              <Button size="small" type="link" style={{ padding: 0 }} onClick={() => setVerifyDetail({ open: true, vm, result: r })}>Details</Button>
              <Button size="small" icon={<ReloadOutlined />} onClick={() => runVerify(vm)} />
            </Space>
          );
        }
        return <Button size="small" icon={<ThunderboltOutlined />} onClick={() => runVerify(vm)}>Verify</Button>;
      },
    },
    ...(isAdmin ? [{
      title: 'Deploy', width: 160,
      render: (_, vm) => {
        const key = vmKey(vm);
        const is  = installMap[key] || { state: 'idle' };
        const ok  = configReady(vm);
        if (is.state === 'loading') return <Space size={4}><Spin size="small" /><Typography.Text type="secondary" style={{ fontSize: 11 }}>Deploying…</Typography.Text></Space>;
        if (is.state === 'done' && is.result) {
          const success = is.result.connected && is.result.success;
          return (
            <Space size={4} wrap>
              <Tag color={success ? 'success' : 'warning'}>{success ? 'Done' : is.result.connected ? 'Check output' : 'Failed'}</Tag>
              <Button size="small" type="link" style={{ padding: 0 }} onClick={() => setInstallDetail({ open: true, vm, result: is.result })}>Output</Button>
              <Button size="small" icon={<ReloadOutlined />} onClick={() => runInstall(vm)} />
            </Space>
          );
        }
        return (
          <Tooltip title={!ok ? 'No installer configured for this location — see Test Deploy Config' : undefined}>
            <Button size="small" type="primary" icon={<RocketOutlined />} disabled={!ok} onClick={() => runInstall(vm)}>
              Deploy
            </Button>
          </Tooltip>
        );
      },
    }] : []),
  ];

  // ── location summary columns ─────────────────────────────────────────────
  const locColumns = [
    {
      title: 'Location', dataIndex: 'location', width: 220,
      render: (v, r) => (
        <Space>
          <Typography.Text strong>{v}</Typography.Text>
          {r.not_installed > 0 && (
            <Tooltip title={`${r.not_installed} VM(s) need ME Agent`}>
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
          <Progress percent={pct} size="small" strokeColor={complianceColor(pct)} style={{ width: 120, marginBottom: 0 }} format={() => null} />
          <Typography.Text strong style={{ color: complianceColor(pct), minWidth: 44 }}>{pct}%</Typography.Text>
          {r.not_installed > 0 && <Badge count={r.not_installed} color="#ff4d4f" />}
        </Space>
      ),
    },
    {
      title: '', width: 300, align: 'right',
      render: (_, r) => {
        const verifying  = r.vms.some(v => (verifyMap[vmKey(v)] || {}).state === 'loading');
        const installing = r.vms.some(v => (installMap[vmKey(v)] || {}).state === 'loading');
        const pendingV    = r.vms.filter(v => (verifyMap[vmKey(v)] || {}).state !== 'done').length;
        const notInst     = r.vms.filter(v => !v.me_installed);
        const pendingI    = notInst.filter(v => (installMap[vmKey(v)] || {}).state !== 'done').length;
        const anyNoCmd     = notInst.some(v => !configReady(v));

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
                <Button size="small" type="primary" icon={<RocketOutlined />} loading={installing}
                  disabled={notInst.length === 0}
                  onClick={async () => {
                    setExpanded(p => p.includes(r.location) ? p : [...p, r.location]);
                    for (const v of notInst) await runInstall(v);
                  }}>
                  Deploy Missing ({pendingI})
                </Button>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <style>{DASH_CSS}</style>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <Space align="start">
          <RocketOutlined style={{ fontSize: 24, color: '#1677ff', marginTop: 3 }} />
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>Test Deploy</Typography.Title>
            <Typography.Text type="secondary">ME Agent — verify &amp; deploy via Ansible, credentials from the asset record</Typography.Text>
          </div>
        </Space>
        {isAdmin && (
          <Link to="/admin/test-deploy-config">
            <Tooltip title="Configure the installer share path & install command"><Button icon={<SettingOutlined />}>Config</Button></Tooltip>
          </Link>
        )}
      </div>

      <Row gutter={16} style={{ marginBottom: 20 }}>
        <Col xs={12} sm={6}>
          <StatCard index={0} title="Total Active VMs" value={overall.total} icon={<RocketOutlined />} color="#1677ff" bg="rgba(22,119,255,0.12)" />
        </Col>
        <Col xs={12} sm={6}>
          <StatCard index={1} title="ME Installed" value={overall.installed} icon={<CheckCircleFilled />} color="#52c41a" bg="rgba(82,196,26,0.12)" />
        </Col>
        <Col xs={12} sm={6}>
          <StatCard index={2} title="Not Installed" value={overall.not_installed}
            icon={<CloseCircleFilled />} color={overall.not_installed > 0 ? '#ff4d4f' : '#8c8c8c'}
            bg={overall.not_installed > 0 ? 'rgba(255,77,79,0.12)' : 'rgba(140,140,140,0.14)'} />
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" className="dashcard" style={{ animationDelay: '120ms' }} bodyStyle={{ padding: '12px 16px' }}>
            <Statistic title="Overall Compliance" value={overall.compliance_pct} suffix="%" valueStyle={{ fontSize: 26, color: complianceColor(overall.compliance_pct) }} />
            <Progress percent={overall.compliance_pct} strokeColor={complianceColor(overall.compliance_pct)} showInfo={false} size="small" style={{ marginTop: 4 }} />
          </Card>
        </Col>
      </Row>

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
              options={ALL_SOURCES.map(s => ({ label: s, value: s }))} value={filterSources} onChange={setFilterSources} maxTagCount="responsive" />
          </Col>
          <Col xs={24} sm={8} md={6}>
            <Input prefix={<SearchOutlined />} placeholder="VM / hostname / IP / OS" allowClear value={search} onChange={e => setSearch(e.target.value)} />
          </Col>
          <Col xs={24} sm={4} md={4} style={{ display: 'flex', gap: 8 }}>
            {hasFilters && <Button onClick={() => { setFilterLocations([]); setFilterStatus('all'); setFilterSources([]); setSearch(''); }}>Clear</Button>}
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Refresh</Button>
          </Col>
        </Row>
      </Card>

      <Table
        rowKey="location" loading={loading} dataSource={filteredLocations}
        columns={locColumns} pagination={false} size="middle"
        expandable={{
          expandedRowKeys: expanded,
          onExpand: (open, r) => setExpanded(p => open ? [...p, r.location] : p.filter(k => k !== r.location)),
          expandedRowRender: (r) => (
            <Table
              rowKey={vmKey} dataSource={r.vms} columns={vmColumns}
              pagination={r.vms.length > 50 ? { pageSize: 50, size: 'small' } : false}
              size="small" style={{ margin: '0 0 8px 0' }} scroll={{ x: 'max-content' }}
              rowClassName={v => !v.me_installed ? 'row-warning' : ''}
            />
          ),
        }}
        footer={() => (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {filteredLocations.length} location{filteredLocations.length !== 1 ? 's' : ''} · {overall.total} VMs
          </Typography.Text>
        )}
      />

      <Modal
        open={verifyDetail.open}
        title={<Space><FileSearchOutlined />Verify — {verifyDetail.vm?.vm_name || verifyDetail.vm?.ip_address}</Space>}
        onCancel={() => setVerifyDetail({ open: false, vm: null, result: null })}
        footer={[
          <Button key="rv" icon={<ReloadOutlined />} onClick={() => { setVerifyDetail(s => ({ ...s, open: false })); runVerify(verifyDetail.vm); }}>Re-verify</Button>,
          <Button key="cl" type="primary" onClick={() => setVerifyDetail({ open: false, vm: null, result: null })}>Close</Button>,
        ]}
        width={680} destroyOnClose
      >
        {verifyDetail.result && <VerifyResultDetail result={verifyDetail.result} />}
      </Modal>

      <Modal
        open={installDetail.open}
        title={<Space><RocketOutlined />Deploy Output — {installDetail.vm?.vm_name || installDetail.vm?.ip_address}</Space>}
        onCancel={() => setInstallDetail({ open: false, vm: null, result: null })}
        footer={[
          <Button key="ver" icon={<ThunderboltOutlined />} onClick={() => { setInstallDetail(s => ({ ...s, open: false })); runVerify(installDetail.vm); }}>Verify Now</Button>,
          <Button key="cl" type="primary" onClick={() => setInstallDetail({ open: false, vm: null, result: null })}>Close</Button>,
        ]}
        width={720} destroyOnClose
      >
        {installDetail.result && <RunOutputDetail result={installDetail.result} />}
      </Modal>

      <style>{`
        .row-warning td { background: #fff2f0 !important; }
        .row-warning:hover td { background: #ffe7e4 !important; }
        body[data-theme="dark"] .row-warning td { background: rgba(255,77,79,0.14) !important; }
        body[data-theme="dark"] .row-warning:hover td { background: rgba(255,77,79,0.22) !important; }
      `}</style>
    </div>
  );
}

// Four independent checks, each its own success/failure — a failed ping,
// an undetermined OS, or an unreachable agent check never hides the others.
function VerifyResultDetail({ result }) {
  const pingOk      = !!result.ping?.reachable;
  const hasHostInfo = !!result.hostInfo;
  const transferOk  = result.connected && result.success;

  const rows = [
    {
      label: 'Ping', ok: pingOk,
      detail: pingOk ? `Reachable${result.ping.time_ms != null ? ` · ${result.ping.time_ms} ms` : ''}` : 'No ping response',
    },
    {
      label: 'Host details', ok: hasHostInfo,
      detail: hasHostInfo ? result.hostInfo : 'Could not determine OS/version',
    },
    {
      label: 'File transfer', ok: transferOk,
      detail: transferOk ? 'Installer copy from the network share succeeded' : (result.error || 'Installer copy failed'),
    },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      {rows.map(row => (
        <Alert
          key={row.label}
          type={row.ok ? 'success' : 'error'}
          showIcon
          message={<Space><Typography.Text strong>{row.label}</Typography.Text><Tag color={row.ok ? 'success' : 'error'}>{row.ok ? 'Success' : 'Failure'}</Tag></Space>}
          description={row.detail}
        />
      ))}

      {result.agent && <AgentCheckDetail agent={result.agent} />}

      {result.output && (
        <>
          <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>Ansible output</Typography.Text>
          <TerminalBox>{result.output}</TerminalBox>
        </>
      )}
    </Space>
  );
}

// Is the ME Agent itself already installed and running — same Service +
// Binary check Software Status runs, over WinRM (Windows) or SSH (Linux).
function AgentCheckDetail({ agent }) {
  const win = agent.platform === 'windows';

  if (!agent.connected) {
    return <Alert type="error" showIcon message="ME Agent check — could not connect" description={agent.error} />;
  }

  if (agent.restricted_shell) {
    return (
      <Alert
        type="warning" showIcon
        message="ME Agent check — connected, but can't run it"
        description={`This account has a restricted shell, so the check command never ran. ${agent.restricted_reason || ''}`}
      />
    );
  }

  const svc  = agent.service || {};
  const file = agent.file || {};
  const sm   = SVC_META[svc.status] || SVC_META.unknown;

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>ME Agent check</Typography.Text>
      <Row gutter={16}>
        <Col span={12}>
          <Card size="small" title={<Space><PlayCircleOutlined />Service</Space>}>
            <Tag color={sm.color} icon={sm.icon} style={{ fontSize: 13, padding: '2px 10px' }}>{sm.label}</Tag>
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: 6, fontSize: 11, wordBreak: 'break-all' }}>
              {svc.name}
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
              {file.path}
            </Typography.Text>
          </Card>
        </Col>
      </Row>
      <Alert type={agent.installed ? 'success' : 'warning'} showIcon
        message={agent.installed ? 'ManageEngine Agent is installed.' : 'ManageEngine Agent is not installed.'} />
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

function RunOutputDetail({ result }) {
  if (!result.connected) {
    return <Alert type="error" showIcon message="Could not run" description={result.error} />;
  }
  const success = result.success;
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Tag color={success ? 'success' : 'warning'} icon={success ? <CheckCircleFilled /> : <QuestionCircleOutlined />}>
        {success ? 'Succeeded' : 'Check output below'}
      </Tag>
      {result.output && (
        <>
          <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>Ansible output</Typography.Text>
          <TerminalBox>{result.output}</TerminalBox>
        </>
      )}
    </Space>
  );
}
