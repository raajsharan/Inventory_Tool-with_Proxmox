import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  App, Button, Card, Col, Input, Modal, Row, Select, Space, Spin, Table, Tag, Tooltip, Typography,
} from 'antd';
import {
  CheckCircleFilled, CloseCircleFilled, CloudServerOutlined, InfoCircleOutlined,
  QuestionCircleOutlined, ReloadOutlined, RocketOutlined, SearchOutlined, SettingOutlined,
  SyncOutlined, WindowsOutlined,
} from '@ant-design/icons';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';

const { Title, Text } = Typography;

const SOURCE_COLOR = {
  'MSL Assets':       'blue',
  'Beijing Assets':   'purple',
  'Ext. Assets':      'cyan',
  'Physical Servers': 'orange',
};
const ALL_SOURCES = ['MSL Assets', 'Beijing Assets', 'Ext. Assets', 'Physical Servers'];
const isWindows = (t) => /windows/i.test(t || '');
const assetKey = (a) => `${a.source}||${a.ip_address}`;

const TARGET_STATUS = {
  pending: { color: 'default',    icon: <SyncOutlined spin />,       label: 'Pending' },
  success: { color: 'success',    icon: <CheckCircleFilled />,       label: 'Success' },
  failed:  { color: 'error',      icon: <CloseCircleFilled />,       label: 'Failed' },
  unknown: { color: 'warning',    icon: <QuestionCircleOutlined />,  label: 'Unknown' },
};

export default function TestDeploy() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const isAdmin = ['admin', 'superadmin'].includes(user?.role);

  const [assets, setAssets]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState([]);

  const [filterLocations, setFilterLocations] = useState([]);
  const [filterSources, setFilterSources]     = useState([]);
  const [search, setSearch] = useState('');

  const [run, setRun] = useState(null);           // current run detail (polled)
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/test-deploy/assets');
      setAssets(data.assets || []);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load assets');
    } finally { setLoading(false); }
  }, []); // eslint-disable-line

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => clearInterval(pollRef.current), []);

  const locationOptions = useMemo(
    () => [...new Set(assets.map(a => a.location))].sort().map(l => ({ label: l, value: l })),
    [assets],
  );

  const filtered = useMemo(() => assets.filter(a => {
    if (filterLocations.length && !filterLocations.includes(a.location)) return false;
    if (filterSources.length && !filterSources.includes(a.source)) return false;
    if (search) {
      const q = search.toLowerCase();
      return [a.vm_name, a.os_hostname, a.ip_address, a.os_type].some(f => (f || '').toLowerCase().includes(q));
    }
    return true;
  }), [assets, filterLocations, filterSources, search]);

  const hasFilters = filterLocations.length || filterSources.length || search;

  const pollRun = (id) => {
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/test-deploy/runs/${id}`);
        setRun(data);
        if (data.status !== 'running') clearInterval(pollRef.current);
      } catch {
        clearInterval(pollRef.current);
      }
    }, 3000);
  };

  const deploy = () => {
    const targets = filtered
      .filter(a => selectedKeys.includes(assetKey(a)))
      .map(a => ({ source: a.source, ip_address: a.ip_address }));
    if (!targets.length) return;

    Modal.confirm({
      title: `Deploy ME Agent to ${targets.length} asset(s)?`,
      content: 'Runs the Test Deploy Ansible playbook against the selected assets, using credentials already stored on their asset records.',
      okText: 'Deploy',
      onOk: async () => {
        setDeploying(true);
        try {
          const { data } = await api.post('/test-deploy/runs', { targets });
          setRun({ id: data.id, status: 'running', output: '', targets: [] });
          setRunModalOpen(true);
          pollRun(data.id);
        } catch (e) {
          message.error(e.response?.data?.error || 'Failed to start deployment');
        } finally { setDeploying(false); }
      },
    });
  };

  const columns = [
    { title: 'VM Name',  dataIndex: 'vm_name',    render: v => v || '—' },
    { title: 'Hostname', dataIndex: 'os_hostname', render: v => v || '—' },
    { title: 'IP Address', dataIndex: 'ip_address', render: v => <Text code style={{ fontSize: 12 }}>{v || '—'}</Text> },
    {
      title: 'OS', dataIndex: 'os_type',
      render: t => (
        <Tag icon={isWindows(t) ? <WindowsOutlined /> : null} color={isWindows(t) ? 'blue' : 'default'}>
          {t || 'Unknown'}
        </Tag>
      ),
    },
    { title: 'Location', dataIndex: 'location' },
    { title: 'Source', dataIndex: 'source', render: v => <Tag color={SOURCE_COLOR[v] || 'default'}>{v}</Tag> },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <Space align="start">
          <RocketOutlined style={{ fontSize: 24, color: '#1677ff', marginTop: 3 }} />
          <div>
            <Title level={4} style={{ margin: 0 }}>Test Deploy</Title>
            <Text type="secondary">ME Agent deployment pilot — Ansible, credentials from the asset record</Text>
          </div>
        </Space>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Refresh</Button>
          {isAdmin && (
            <Link to="/admin/test-deploy-config">
              <Tooltip title="Configure the installer share path & install command"><Button icon={<SettingOutlined />}>Config</Button></Tooltip>
            </Link>
          )}
        </Space>
      </div>

      <Card size="small" style={{ marginBottom: 16 }} bodyStyle={{ padding: '12px 16px' }}>
        <Row gutter={[12, 8]} align="middle">
          <Col xs={24} sm={7} md={6}>
            <Select mode="multiple" allowClear style={{ width: '100%' }} placeholder="Location"
              options={locationOptions} value={filterLocations} onChange={setFilterLocations} maxTagCount="responsive" />
          </Col>
          <Col xs={24} sm={7} md={6}>
            <Select mode="multiple" allowClear style={{ width: '100%' }} placeholder="Source"
              options={ALL_SOURCES.map(s => ({ label: s, value: s }))}
              value={filterSources} onChange={setFilterSources} maxTagCount="responsive" />
          </Col>
          <Col xs={24} sm={7} md={7}>
            <Input prefix={<SearchOutlined />} placeholder="VM / hostname / IP / OS"
              allowClear value={search} onChange={e => setSearch(e.target.value)} />
          </Col>
          <Col xs={24} sm={3} md={5} style={{ textAlign: 'right' }}>
            {hasFilters && <Button onClick={() => { setFilterLocations([]); setFilterSources([]); setSearch(''); }}>Clear</Button>}
          </Col>
        </Row>
      </Card>

      <Table
        rowKey={assetKey}
        loading={loading}
        dataSource={filtered}
        columns={columns}
        size="middle"
        pagination={{ pageSize: 25 }}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: setSelectedKeys,
          preserveSelectedRowKeys: true,
        }}
        footer={() => (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {filtered.length} asset{filtered.length !== 1 ? 's' : ''} · {selectedKeys.length} selected
            </Text>
            <Button type="primary" icon={<RocketOutlined />} loading={deploying}
              disabled={!selectedKeys.length} onClick={deploy}>
              Deploy Selected ({selectedKeys.length})
            </Button>
          </div>
        )}
      />

      <Modal
        open={runModalOpen}
        title={<Space><CloudServerOutlined />Deployment Run #{run?.id}</Space>}
        onCancel={() => setRunModalOpen(false)}
        footer={<Button type="primary" onClick={() => setRunModalOpen(false)}>Close</Button>}
        width={760}
      >
        {run && <RunDetail run={run} />}
      </Modal>
    </div>
  );
}

function RunDetail({ run }) {
  const running = run.status === 'running';
  const targetCols = [
    { title: 'VM Name',    dataIndex: 'vm_name',    render: v => v || '—' },
    { title: 'IP Address', dataIndex: 'ip_address', render: v => <Text code style={{ fontSize: 12 }}>{v}</Text> },
    { title: 'OS', dataIndex: 'os_type', render: t => isWindows(t) ? <Tag icon={<WindowsOutlined />} color="blue">Windows</Tag> : <Tag>Linux</Tag> },
    {
      title: 'Status', dataIndex: 'status',
      render: s => {
        const m = TARGET_STATUS[s] || TARGET_STATUS.unknown;
        return <Tag color={m.color} icon={m.icon}>{m.label}</Tag>;
      },
    },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Space>
        {running
          ? <Tag color="processing" icon={<SyncOutlined spin />}>Running</Tag>
          : <Tag color={run.status === 'completed' ? 'success' : 'error'}>{run.status}</Tag>}
        <Tooltip title="Refreshes automatically every few seconds while running">
          <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
        </Tooltip>
      </Space>

      {run.targets?.length > 0 && (
        <Table rowKey="ip_address" dataSource={run.targets} columns={targetCols} pagination={false} size="small" />
      )}

      {running && !run.output && <Spin size="small" />}

      {run.output && (
        <>
          <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>Ansible output</Text>
          <pre style={{
            background: '#1a1a2e', color: '#e0e0e0', borderRadius: 6,
            padding: '10px 14px', fontSize: 12, lineHeight: 1.6, margin: 0,
            maxHeight: 320, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {run.output}
          </pre>
        </>
      )}
    </Space>
  );
}
