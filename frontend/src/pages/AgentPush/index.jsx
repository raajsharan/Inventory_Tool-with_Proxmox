import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  App, Badge, Button, Card, Checkbox, Col, Input, Modal, Progress, Row, Select,
  Space, Spin, Table, Tabs, Tag, Tooltip, Typography,
} from 'antd';
import {
  CheckCircleFilled, CloseCircleFilled, ClockCircleFilled, MinusCircleFilled,
  ReloadOutlined, RocketOutlined, SearchOutlined, SettingOutlined, SyncOutlined,
  WarningFilled, WindowsOutlined,
} from '@ant-design/icons';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';
import { DASH_CSS, StatCard } from '../../components/DashboardStatCard.jsx';

const SOURCE_COLOR = { 'MSL Assets': 'blue', 'Ext. Assets': 'cyan' };
const ALL_SOURCES = ['MSL Assets', 'Ext. Assets'];

const JOB_STATUS_META = {
  pending:   { color: 'default',    label: 'Pending' },
  running:   { color: 'processing', label: 'Running' },
  completed: { color: 'success',    label: 'Completed' },
};
const TARGET_STATUS_META = {
  pending: { color: 'default',    label: 'Pending',   icon: <ClockCircleFilled /> },
  running: { color: 'processing', label: 'Running',   icon: <SyncOutlined spin /> },
  success: { color: 'success',    label: 'Success',   icon: <CheckCircleFilled /> },
  skipped: { color: 'blue',       label: 'Skipped',   icon: <MinusCircleFilled /> },
  failed:  { color: 'error',      label: 'Failed',    icon: <CloseCircleFilled /> },
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
      {children || '(no output yet)'}
    </pre>
  );
}

export default function AgentPush() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const isAdmin = ['admin', 'superadmin'].includes(user?.role);

  const [assets, setAssets]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [expanded, setExpanded] = useState([]);
  const [forceReinstall, setForceReinstall] = useState(false);
  const [deploying, setDeploying] = useState(false);

  const [filterLocations, setFilterLocations] = useState([]);
  const [filterSources, setFilterSources]     = useState([]);
  const [search, setSearch] = useState('');

  const [jobs, setJobs]     = useState([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [detail, setDetail] = useState({ open: false, jobId: null, job: null });
  const pollRef = useRef(null);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/agent-push/assets');
      setAssets(data.assets || []);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load assets');
    } finally { setLoading(false); }
  }, []); // eslint-disable-line

  const loadJobs = useCallback(async () => {
    setJobsLoading(true);
    try {
      const { data } = await api.get('/agent-push/jobs');
      setJobs(data.jobs || []);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load jobs');
    } finally { setJobsLoading(false); }
  }, []); // eslint-disable-line

  useEffect(() => { loadAssets(); loadJobs(); }, [loadAssets, loadJobs]);

  const openDetail = useCallback(async (jobId) => {
    setDetail({ open: true, jobId, job: null });
    try {
      const { data } = await api.get(`/agent-push/jobs/${jobId}`);
      setDetail({ open: true, jobId, job: data });
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load job');
    }
  }, []); // eslint-disable-line

  // Poll the open job's status every 3s while it's still in progress.
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!detail.open || !detail.jobId) return;

    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/agent-push/jobs/${detail.jobId}/status`);
        setDetail((prev) => {
          if (!prev.job || prev.jobId !== detail.jobId) return prev;
          const targetsById = new Map(data.targets.map((t) => [t.id, t]));
          return {
            ...prev,
            job: {
              ...prev.job,
              status: data.job_status,
              targets: prev.job.targets.map((t) => ({ ...t, ...targetsById.get(t.id) })),
            },
          };
        });
        if (data.job_status === 'completed') {
          clearInterval(pollRef.current);
          loadJobs();
        }
      } catch { /* a missed poll tick isn't worth surfacing */ }
    }, 3000);

    return () => clearInterval(pollRef.current);
  }, [detail.open, detail.jobId]); // eslint-disable-line

  const closeDetail = () => { setDetail({ open: false, jobId: null, job: null }); loadJobs(); };

  // ── filtered / grouped VM data ────────────────────────────────────────────
  const locationOptions = useMemo(
    () => [...new Set(assets.map((a) => a.location))].sort().map((l) => ({ label: l, value: l })),
    [assets],
  );

  const filteredLocations = useMemo(() => {
    const byLocation = new Map();
    for (const a of assets) {
      if (filterLocations.length && !filterLocations.includes(a.location)) continue;
      if (filterSources.length && !filterSources.includes(a.source)) continue;
      if (search) {
        const q = search.toLowerCase();
        if (![a.vm_name, a.os_hostname, a.ip_address, a.os_type].some((f) => (f || '').toLowerCase().includes(q))) continue;
      }
      if (!byLocation.has(a.location)) byLocation.set(a.location, []);
      byLocation.get(a.location).push(a);
    }
    return [...byLocation.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([location, vms]) => {
      const installed = vms.filter((v) => v.me_installed).length;
      const ready = vms.filter((v) => v.package_ready).length;
      return { location, vms, total: vms.length, installed, not_installed: vms.length - installed, ready };
    });
  }, [assets, filterLocations, filterSources, search]);

  const hasFilters = filterLocations.length || filterSources.length || search;

  const toggleSelected = (keys, checked) => {
    setSelected((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => checked ? next.add(k) : next.delete(k));
      return next;
    });
  };

  const deploySelected = async () => {
    const targets = assets.filter((a) => selected.has(vmKey(a))).map((a) => ({ source: a.source, ip_address: a.ip_address }));
    if (!targets.length) return;
    setDeploying(true);
    try {
      const { data } = await api.post('/agent-push/jobs', { targets, force_reinstall: forceReinstall });
      message.success(`Deployment #${data.id} started for ${data.targetCount} target(s).`);
      setSelected(new Set());
      loadJobs();
      openDetail(data.id);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to start deployment');
    } finally { setDeploying(false); }
  };

  const vmColumns = [
    {
      title: 'VM Name', dataIndex: 'vm_name', width: 160,
      render: (v, r) => (
        <Space size={4}>
          {v || '—'}
          {!r.package_ready && (
            <Tooltip title={`No Agent Push package configured for '${r.location}' (${isWindows(r.os_type) ? 'Windows' : 'Linux'})`}>
              <WarningFilled style={{ color: '#faad14' }} />
            </Tooltip>
          )}
        </Space>
      ),
    },
    { title: 'Hostname', dataIndex: 'os_hostname', width: 160, render: (v) => v || '—' },
    { title: 'IP Address', dataIndex: 'ip_address', width: 135, render: (v) => <Typography.Text code style={{ fontSize: 12 }}>{v || '—'}</Typography.Text> },
    {
      title: 'OS', dataIndex: 'os_type', width: 130,
      render: (t) => <Tag icon={isWindows(t) ? <WindowsOutlined /> : null} color={isWindows(t) ? 'blue' : 'default'}>{t || 'Unknown'}</Tag>,
    },
    { title: 'Source', dataIndex: 'source', width: 120, render: (v) => <Tag color={SOURCE_COLOR[v] || 'default'}>{v}</Tag> },
    {
      title: 'ME Agent', dataIndex: 'me_installed', width: 115, align: 'center',
      render: (v) => v
        ? <Tag icon={<CheckCircleFilled />} color="success">Installed</Tag>
        : <Tag icon={<CloseCircleFilled />} color="error">Not Installed</Tag>,
    },
  ];

  const locColumns = [
    {
      title: 'Location', dataIndex: 'location', width: 220,
      render: (v, r) => (
        <Space>
          <Typography.Text strong>{v}</Typography.Text>
          {r.ready < r.total && (
            <Tooltip title={`${r.total - r.ready} VM(s) have no Agent Push package configured for this location`}>
              <WarningFilled style={{ color: '#faad14' }} />
            </Tooltip>
          )}
        </Space>
      ),
    },
    { title: 'Total', dataIndex: 'total', width: 90, align: 'right', render: (v) => <strong>{v}</strong> },
    { title: 'Installed', dataIndex: 'installed', width: 100, align: 'right', render: (v) => <span style={{ color: '#52c41a' }}>{v}</span> },
    {
      title: 'Not Installed', dataIndex: 'not_installed', width: 120, align: 'right',
      render: (v, r) => (
        <Space>
          <span style={{ color: v > 0 ? '#ff4d4f' : '#8c8c8c' }}>{v}</span>
          {v > 0 && <Badge count={v} color="#ff4d4f" />}
        </Space>
      ),
    },
    {
      title: 'Compliance', dataIndex: 'installed',
      render: (_, r) => {
        const pct = r.total ? Math.round((r.installed / r.total) * 1000) / 10 : 0;
        return (
          <Space>
            <Progress percent={pct} size="small" strokeColor={complianceColor(pct)} style={{ width: 120, marginBottom: 0 }} format={() => null} />
            <Typography.Text strong style={{ color: complianceColor(pct), minWidth: 44 }}>{pct}%</Typography.Text>
          </Space>
        );
      },
    },
  ];

  const jobColumns = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    { title: 'Created', dataIndex: 'created_at', width: 170, render: (v) => v ? new Date(v).toLocaleString() : '—' },
    { title: 'Targets', dataIndex: 'target_count', width: 90, align: 'right' },
    {
      title: 'Status', dataIndex: 'status', width: 120,
      render: (s) => <Tag color={(JOB_STATUS_META[s] || {}).color}>{(JOB_STATUS_META[s] || {}).label || s}</Tag>,
    },
    { title: '', width: 100, render: (_, r) => <Button size="small" onClick={() => openDetail(r.id)}>View</Button> },
  ];

  return (
    <div>
      <style>{DASH_CSS}</style>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <Space align="start">
          <RocketOutlined style={{ fontSize: 24, color: '#1677ff', marginTop: 3 }} />
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>Agent Push</Typography.Title>
            <Typography.Text type="secondary">ME Agent — select VMs from Assets / Ext. Assets and deploy, credentials from the asset record</Typography.Text>
          </div>
        </Space>
        {isAdmin && (
          <Link to="/admin/agent-push-locations">
            <Tooltip title="Configure per-location installer packages"><Button icon={<SettingOutlined />}>Locations</Button></Tooltip>
          </Link>
        )}
      </div>

      <Tabs
        defaultActiveKey="deploy"
        items={[
          {
            key: 'deploy',
            label: 'Deploy',
            children: (
              <>
                <Row gutter={16} style={{ marginBottom: 20 }}>
                  <Col xs={12} sm={8}>
                    <StatCard index={0} title="Total VMs" value={assets.length} icon={<RocketOutlined />} color="#1677ff" bg="rgba(22,119,255,0.12)" />
                  </Col>
                  <Col xs={12} sm={8}>
                    <StatCard index={1} title="ME Installed" value={assets.filter((a) => a.me_installed).length} icon={<CheckCircleFilled />} color="#52c41a" bg="rgba(82,196,26,0.12)" />
                  </Col>
                  <Col xs={12} sm={8}>
                    <StatCard index={2} title="Selected" value={selected.size} icon={<RocketOutlined />} color="#faad14" bg="rgba(250,173,20,0.12)" />
                  </Col>
                </Row>

                <Card size="small" style={{ marginBottom: 16 }} bodyStyle={{ padding: '12px 16px' }} bordered>
                  <Row gutter={[12, 8]} align="middle">
                    <Col xs={24} sm={8} md={6}>
                      <Select mode="multiple" allowClear style={{ width: '100%' }} placeholder="Location"
                        options={locationOptions} value={filterLocations} onChange={setFilterLocations} maxTagCount="responsive" />
                    </Col>
                    <Col xs={24} sm={8} md={6}>
                      <Select mode="multiple" allowClear style={{ width: '100%' }} placeholder="Source"
                        options={ALL_SOURCES.map((s) => ({ label: s, value: s }))} value={filterSources} onChange={setFilterSources} maxTagCount="responsive" />
                    </Col>
                    <Col xs={24} sm={8} md={7}>
                      <Input prefix={<SearchOutlined />} placeholder="VM / hostname / IP / OS" allowClear value={search} onChange={(e) => setSearch(e.target.value)} />
                    </Col>
                    <Col xs={24} sm={24} md={5} style={{ display: 'flex', gap: 8 }}>
                      {hasFilters && <Button onClick={() => { setFilterLocations([]); setFilterSources([]); setSearch(''); }}>Clear</Button>}
                      <Button icon={<ReloadOutlined />} onClick={loadAssets} loading={loading}>Refresh</Button>
                    </Col>
                  </Row>
                </Card>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginBottom: 12 }}>
                  <Checkbox checked={forceReinstall} onChange={(e) => setForceReinstall(e.target.checked)}>
                    Force reinstall (skip already-installed check)
                  </Checkbox>
                  <Button type="primary" icon={<RocketOutlined />} disabled={!selected.size} loading={deploying} onClick={deploySelected}>
                    Deploy Selected ({selected.size})
                  </Button>
                </div>

                <Table
                  rowKey="location" loading={loading} dataSource={filteredLocations}
                  columns={locColumns} pagination={false} size="middle"
                  expandable={{
                    expandedRowKeys: expanded,
                    onExpand: (open, r) => setExpanded((p) => open ? [...p, r.location] : p.filter((k) => k !== r.location)),
                    expandedRowRender: (r) => (
                      <Table
                        rowKey={vmKey} dataSource={r.vms} columns={vmColumns}
                        pagination={r.vms.length > 50 ? { pageSize: 50, size: 'small' } : false}
                        size="small" style={{ margin: '0 0 8px 0' }} tableLayout="fixed"
                        rowSelection={{
                          selectedRowKeys: r.vms.map(vmKey).filter((k) => selected.has(k)),
                          onChange: (keys, rows) => {
                            const allKeys = r.vms.map(vmKey);
                            toggleSelected(allKeys, false);
                            toggleSelected(rows.map(vmKey), true);
                          },
                        }}
                      />
                    ),
                  }}
                  footer={() => (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {filteredLocations.length} location{filteredLocations.length !== 1 ? 's' : ''} · {assets.length} VMs
                    </Typography.Text>
                  )}
                />
              </>
            ),
          },
          {
            key: 'jobs',
            label: 'Jobs',
            children: (
              <>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                  <Button icon={<ReloadOutlined />} onClick={loadJobs} loading={jobsLoading}>Refresh</Button>
                </div>
                <Table rowKey="id" loading={jobsLoading} dataSource={jobs} columns={jobColumns} pagination={{ pageSize: 20 }} size="middle" />
              </>
            ),
          },
        ]}
      />

      <Modal
        open={detail.open}
        title={<Space><RocketOutlined />Deployment #{detail.jobId}</Space>}
        onCancel={closeDetail}
        footer={<Button type="primary" onClick={closeDetail}>Close</Button>}
        width={800}
        destroyOnClose
      >
        {!detail.job ? <Spin /> : <JobDetail job={detail.job} />}
      </Modal>
    </div>
  );
}

function JobDetail({ job }) {
  const [expanded, setExpanded] = useState([]);
  const meta = JOB_STATUS_META[job.status] || {};
  const counts = job.targets.reduce((acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {});

  const columns = [
    { title: 'VM', dataIndex: 'vm_name', width: 160, render: (v, r) => v || r.ip_address },
    { title: 'IP', dataIndex: 'ip_address', width: 140 },
    {
      title: 'Status', dataIndex: 'status', width: 130,
      render: (s) => {
        const m = TARGET_STATUS_META[s] || {};
        return <Tag color={m.color} icon={m.icon}>{m.label || s}</Tag>;
      },
    },
    {
      title: '', width: 100,
      render: (_, r) => (
        <Button size="small" type="link"
          onClick={() => setExpanded((p) => p.includes(r.id) ? p.filter((k) => k !== r.id) : [...p, r.id])}>
          {expanded.includes(r.id) ? 'Hide log' : 'View log'}
        </Button>
      ),
    },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Space wrap>
        <Tag color={meta.color}>{meta.label || job.status}</Tag>
        {Object.entries(counts).map(([s, n]) => (
          <Tag key={s} color={(TARGET_STATUS_META[s] || {}).color}>{(TARGET_STATUS_META[s] || {}).label || s}: {n}</Tag>
        ))}
      </Space>
      <Table
        rowKey="id" dataSource={job.targets} columns={columns} pagination={false} size="small"
        expandable={{
          expandedRowKeys: expanded,
          showExpandColumn: false,
          expandedRowRender: (r) => <TerminalBox>{r.log_output}</TerminalBox>,
        }}
      />
    </Space>
  );
}
