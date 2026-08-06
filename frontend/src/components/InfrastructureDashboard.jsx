import { useEffect, useState } from 'react';
import {
  Row, Col, Card, Table, Tag, Spin, Space, Typography,
} from 'antd';
import {
  PlayCircleOutlined, StopOutlined, PauseCircleOutlined,
  ApartmentOutlined, ClusterOutlined, WindowsOutlined, LinuxOutlined, DesktopOutlined,
  LaptopOutlined, ContainerOutlined,
} from '@ant-design/icons';
import api from '../api/client';
import { DASH_CSS, StatCard, StatGrid, MiniBar, SplitBar, ExpandableTableCard } from './DashboardStatCard.jsx';
import NewVMsWidget from './NewVMsWidget.jsx';

function osIcon(os) {
  const s = (os || '').toLowerCase();
  if (s.includes('win')) return { icon: <WindowsOutlined />, color: '#40a9ff' };
  if (s.includes('linux') || s.includes('centos') || s.includes('ubuntu') || s.includes('rhel') || s.includes('debian'))
    return { icon: <LinuxOutlined />, color: '#faad14' };
  return { icon: <DesktopOutlined />, color: '#8c8c8c' };
}

export default function InfrastructureDashboard() {
  const [vmware,  setVmware]  = useState(null);
  const [proxmox, setProxmox] = useState(null);
  const [hyperv,  setHyperv]  = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/vmware/dashboard').then(r => r.data).catch(() => null),
      api.get('/proxmox/dashboard').then(r => r.data).catch(() => null),
      api.get('/hyperv/dashboard').then(r => r.data).catch(() => null),
    ]).then(([vm, px, hv]) => { setVmware(vm); setProxmox(px); setHyperv(hv); setLoading(false); });
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} />;

  const vmTotal  = vmware?.stats?.total      ?? 0;
  const vmOn     = vmware?.stats?.poweredOn  ?? 0;
  const vmOff    = vmware?.stats?.poweredOff ?? 0;
  const vmSusp   = vmware?.stats?.suspended  ?? 0;
  const pxTotal  = proxmox?.stats?.total     ?? 0;
  const pxOn     = proxmox?.stats?.running   ?? 0;
  const pxOff    = proxmox?.stats?.stopped   ?? 0;
  const pxPaused = proxmox?.stats?.paused    ?? 0;
  const pxQemu   = proxmox?.stats?.qemu      ?? 0;
  const pxLxc    = proxmox?.stats?.lxc       ?? 0;
  const hvTotal  = hyperv?.stats?.total      ?? 0;
  const hvOn     = hyperv?.stats?.running    ?? 0;
  const hvOff    = hyperv?.stats?.stopped    ?? 0;
  const hvPaused = hyperv?.stats?.paused     ?? 0;
  const hvSaved  = hyperv?.stats?.saved      ?? 0;

  const total   = vmTotal + pxTotal + hvTotal;
  const running = vmOn    + pxOn    + hvOn;
  const stopped = vmOff   + pxOff   + hvOff;
  const paused  = vmSusp  + pxPaused + hvPaused + hvSaved;

  // Merged OS breakdown across all three integrations
  const osMap = {};
  (vmware?.byOS  || []).forEach(o => { osMap[o.os] = (osMap[o.os] || 0) + o.count; });
  (proxmox?.byOS || []).forEach(o => { osMap[o.os] = (osMap[o.os] || 0) + o.count; });
  (hyperv?.byOS  || []).forEach(o => { osMap[o.os] = (osMap[o.os] || 0) + o.count; });
  const mergedOS = Object.entries(osMap).map(([os, count]) => ({ os, count })).sort((a, b) => b.count - a.count);
  const maxMergedOS = Math.max(1, ...mergedOS.map(o => o.count));

  function osColumns(byOS) {
    const max = Math.max(1, ...byOS.map(o => o.count));
    return [
      {
        title: 'OS Type', dataIndex: 'os', key: 'os', ellipsis: true,
        render: v => {
          const meta = osIcon(v);
          return <span><span style={{ color: meta.color, marginRight: 8 }}>{meta.icon}</span>{v}</span>;
        },
      },
      {
        title: 'Count', dataIndex: 'count', key: 'count', width: 150,
        sorter: (a, b) => b.count - a.count,
        render: (v, r) => (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Typography.Text strong style={{ width: 32 }}>{v}</Typography.Text>
            <MiniBar count={v} max={max} color={osIcon(r.os).color} />
          </span>
        ),
      },
    ];
  }

  const vmHostCols = [
    { title: 'vCenter / ESXi', dataIndex: 'host',       key: 'host',       ellipsis: true },
    { title: 'Total',          dataIndex: 'total',      key: 'total',      width: 80 },
    {
      title: 'Split', key: 'split', width: 110,
      render: (_, r) => (
        <SplitBar total={r.total} segments={[
          { value: r.poweredOn,  color: '#52c41a' },
          { value: r.poweredOff, color: '#bfbfbf' },
          { value: r.suspended,  color: '#faad14' },
        ]} />
      ),
    },
    { title: 'Powered On',     dataIndex: 'poweredOn',  key: 'poweredOn',  width: 110,
      render: n => <Tag icon={<PlayCircleOutlined />} color="success">{n}</Tag> },
    { title: 'Powered Off',    dataIndex: 'poweredOff', key: 'poweredOff', width: 110,
      render: n => <Tag icon={<StopOutlined />} color="default">{n}</Tag> },
    { title: 'Suspended',      dataIndex: 'suspended',  key: 'suspended',  width: 100,
      render: n => <Tag icon={<PauseCircleOutlined />} color="warning">{n ?? 0}</Tag> },
  ];

  const pxNodeCols = [
    { title: 'Host',    dataIndex: 'host',    key: 'host',    ellipsis: true },
    { title: 'Node',    dataIndex: 'node',    key: 'node',    ellipsis: true },
    { title: 'Total',   dataIndex: 'total',   key: 'total',   width: 70 },
    {
      title: 'Split', key: 'split', width: 100,
      render: (_, r) => (
        <SplitBar total={r.total} segments={[
          { value: r.running, color: '#52c41a' },
          { value: r.stopped, color: '#bfbfbf' },
        ]} />
      ),
    },
    { title: 'Running', dataIndex: 'running', key: 'running', width: 90,
      render: n => <Tag icon={<PlayCircleOutlined />} color="success">{n}</Tag> },
    { title: 'Stopped', dataIndex: 'stopped', key: 'stopped', width: 90,
      render: n => <Tag icon={<StopOutlined />} color="default">{n}</Tag> },
    { title: 'QEMU',    dataIndex: 'qemu',    key: 'qemu',    width: 70,
      render: n => <span><LaptopOutlined style={{ color: '#722ed1', marginRight: 6 }} />{n}</span> },
    { title: 'LXC',     dataIndex: 'lxc',     key: 'lxc',     width: 70,
      render: n => <span><ContainerOutlined style={{ color: '#13c2c2', marginRight: 6 }} />{n}</span> },
  ];

  const hvHostCols = [
    { title: 'Host',    dataIndex: 'host',    key: 'host',    ellipsis: true },
    { title: 'Total',   dataIndex: 'total',   key: 'total',   width: 80 },
    {
      title: 'Split', key: 'split', width: 110,
      render: (_, r) => (
        <SplitBar total={r.total} segments={[
          { value: r.running, color: '#52c41a' },
          { value: r.stopped, color: '#bfbfbf' },
          { value: r.paused,  color: '#faad14' },
          { value: r.saved,   color: '#1890ff' },
        ]} />
      ),
    },
    { title: 'Running', dataIndex: 'running', key: 'running', width: 90,
      render: n => <Tag icon={<PlayCircleOutlined />} color="success">{n}</Tag> },
    { title: 'Stopped', dataIndex: 'stopped', key: 'stopped', width: 90,
      render: n => <Tag icon={<StopOutlined />} color="default">{n}</Tag> },
    { title: 'Paused',  dataIndex: 'paused',  key: 'paused',  width: 80 },
    { title: 'Saved',   dataIndex: 'saved',   key: 'saved',   width: 80 },
  ];

  return (
    <div style={{ padding: 16 }}>
      <style>{DASH_CSS}</style>

      <div style={{ marginBottom: 16 }}>
        <NewVMsWidget />
      </div>

      {/* Combined summary cards */}
      <StatGrid>
        <StatCard index={0} title="Total" value={total}
          icon={<ApartmentOutlined />} color="#1677ff" bg="rgba(22,119,255,0.12)" />
        <StatCard index={1} title="Running / On" value={running}
          icon={<PlayCircleOutlined />} color="#52c41a" bg="rgba(82,196,26,0.12)" />
        <StatCard index={2} title="Stopped / Off" value={stopped}
          icon={<StopOutlined />} color="#8c8c8c" bg="rgba(140,140,140,0.14)" />
        <StatCard index={3} title="Paused / Suspended" value={paused}
          icon={<PauseCircleOutlined />} color="#faad14" bg="rgba(250,173,20,0.12)" />
        <StatCard index={4} title="VMware VMs" value={vmTotal}
          icon={<ApartmentOutlined />} color="#1677ff" bg="rgba(22,119,255,0.12)" />
        <StatCard index={5} title="Proxmox (QEMU+LXC)" value={pxTotal}
          icon={<ClusterOutlined />} color="#722ed1" bg="rgba(114,46,209,0.12)" />
        <StatCard index={6} title="Hyper-V VMs" value={hvTotal}
          icon={<WindowsOutlined />} color="#13c2c2" bg="rgba(19,194,194,0.12)" />
      </StatGrid>

      {/* Merged OS breakdown across all three integrations */}
      {mergedOS.length > 0 && (
        <ExpandableTableCard title="OS Breakdown — All Integrations" style={{ marginTop: 16 }} index={1} defaultOpen={false}>
          <Table
            size="small" rowKey="os" pagination={false} rowClassName="dashcard-row"
            dataSource={mergedOS}
            columns={[
              {
                title: 'OS Type', dataIndex: 'os', key: 'os', ellipsis: true,
                render: v => {
                  const meta = osIcon(v);
                  return <span><span style={{ color: meta.color, marginRight: 8 }}>{meta.icon}</span>{v}</span>;
                },
              },
              {
                title: 'Count', dataIndex: 'count', key: 'count', width: 180,
                sorter: (a, b) => b.count - a.count,
                render: (v, r) => (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Typography.Text strong style={{ width: 32 }}>{v}</Typography.Text>
                    <MiniBar count={v} max={maxMergedOS} color={osIcon(r.os).color} width={160} />
                  </span>
                ),
              },
            ]}
          />
        </ExpandableTableCard>
      )}

      {/* VMware vSphere details */}
      <Card
        size="small"
        className="dashcard"
        style={{ marginTop: 16, animationDelay: '130ms' }}
        title={
          <Space>
            <ApartmentOutlined style={{ color: '#1677ff', fontSize: 16 }} />
            <Typography.Text strong style={{ color: '#1677ff' }}>VMware vSphere</Typography.Text>
            {vmware && <Tag color="blue">{vmTotal} VMs</Tag>}
          </Space>
        }
      >
        {!vmware ? (
          <Typography.Text type="secondary">No data — run a VMware discovery first.</Typography.Text>
        ) : (
          <>
            <StatGrid minWidth={160} gap={12} style={{ marginBottom: 14 }}>
              <StatCard index={0} title="Total VMs" value={vmTotal}
                icon={<ApartmentOutlined />} color="#1677ff" bg="rgba(22,119,255,0.12)" />
              <StatCard index={1} title="Powered On" value={vmOn}
                icon={<PlayCircleOutlined />} color="#52c41a" bg="rgba(82,196,26,0.12)" />
              <StatCard index={2} title="Powered Off" value={vmOff}
                icon={<StopOutlined />} color="#8c8c8c" bg="rgba(140,140,140,0.14)" />
              <StatCard index={3} title="Suspended" value={vmSusp}
                icon={<PauseCircleOutlined />} color="#faad14" bg="rgba(250,173,20,0.12)" />
            </StatGrid>
            <Row gutter={[12, 12]}>
              <Col xs={24} lg={16}>
                <ExpandableTableCard title="By vCenter / ESXi Host" defaultOpen={false}>
                  <Table size="small" rowKey="host" pagination={false} rowClassName="dashcard-row"
                    dataSource={vmware.byHost || []} columns={vmHostCols} />
                </ExpandableTableCard>
              </Col>
              <Col xs={24} lg={8}>
                <ExpandableTableCard title="OS Breakdown" index={1} defaultOpen={false}>
                  <Table size="small" rowKey="os" pagination={false} rowClassName="dashcard-row"
                    dataSource={vmware.byOS || []} columns={osColumns(vmware.byOS || [])} />
                </ExpandableTableCard>
              </Col>
            </Row>
          </>
        )}
      </Card>

      {/* Proxmox VE / PDM details */}
      <Card
        size="small"
        className="dashcard"
        style={{ marginTop: 16, animationDelay: '170ms' }}
        title={
          <Space>
            <ClusterOutlined style={{ color: '#722ed1', fontSize: 16 }} />
            <Typography.Text strong style={{ color: '#722ed1' }}>Proxmox VE / PDM</Typography.Text>
            {proxmox && (
              <Space size={4}>
                <Tag color="purple">{pxTotal} Total</Tag>
                <Tag icon={<LaptopOutlined />} color="default">QEMU: {pxQemu}</Tag>
                <Tag icon={<ContainerOutlined />} color="geekblue">LXC: {pxLxc}</Tag>
              </Space>
            )}
          </Space>
        }
      >
        {!proxmox ? (
          <Typography.Text type="secondary">No data — run a Proxmox discovery first.</Typography.Text>
        ) : (
          <>
            <StatGrid minWidth={150} gap={12} style={{ marginBottom: 14 }}>
              <StatCard index={0} title="Total" value={pxTotal}
                icon={<ClusterOutlined />} color="#722ed1" bg="rgba(114,46,209,0.12)" />
              <StatCard index={1} title="Running" value={pxOn}
                icon={<PlayCircleOutlined />} color="#52c41a" bg="rgba(82,196,26,0.12)" />
              <StatCard index={2} title="Stopped" value={pxOff}
                icon={<StopOutlined />} color="#8c8c8c" bg="rgba(140,140,140,0.14)" />
              <StatCard index={3} title="Paused" value={pxPaused}
                icon={<PauseCircleOutlined />} color="#faad14" bg="rgba(250,173,20,0.12)" />
              <StatCard index={4} title="QEMU VMs" value={pxQemu}
                icon={<LaptopOutlined />} color="#13c2c2" bg="rgba(19,194,194,0.12)" />
              <StatCard index={5} title="LXC Containers" value={pxLxc}
                icon={<ContainerOutlined />} color="#eb2f96" bg="rgba(235,47,150,0.12)" />
            </StatGrid>
            <Row gutter={[12, 12]}>
              <Col xs={24} lg={16}>
                <ExpandableTableCard title="By Node" defaultOpen={false}>
                  <Table size="small" rowKey={r => `${r.host}||${r.node}`} pagination={false} rowClassName="dashcard-row"
                    dataSource={proxmox.byNode || []} columns={pxNodeCols} />
                </ExpandableTableCard>
              </Col>
              <Col xs={24} lg={8}>
                <ExpandableTableCard title="OS Breakdown" index={1} defaultOpen={false}>
                  <Table size="small" rowKey="os" pagination={false} rowClassName="dashcard-row"
                    dataSource={proxmox.byOS || []} columns={osColumns(proxmox.byOS || [])} />
                </ExpandableTableCard>
              </Col>
            </Row>
          </>
        )}
      </Card>

      {/* Microsoft Hyper-V details */}
      <Card
        size="small"
        className="dashcard"
        style={{ marginTop: 16, animationDelay: '210ms' }}
        title={
          <Space>
            <WindowsOutlined style={{ color: '#13c2c2', fontSize: 16 }} />
            <Typography.Text strong style={{ color: '#13c2c2' }}>Microsoft Hyper-V</Typography.Text>
            {hyperv && <Tag color="cyan">{hvTotal} VMs</Tag>}
          </Space>
        }
      >
        {!hyperv ? (
          <Typography.Text type="secondary">No data — run a Hyper-V discovery first.</Typography.Text>
        ) : (
          <>
            <StatGrid minWidth={150} gap={12} style={{ marginBottom: 14 }}>
              <StatCard index={0} title="Total VMs" value={hvTotal}
                icon={<WindowsOutlined />} color="#13c2c2" bg="rgba(19,194,194,0.12)" />
              <StatCard index={1} title="Running" value={hvOn}
                icon={<PlayCircleOutlined />} color="#52c41a" bg="rgba(82,196,26,0.12)" />
              <StatCard index={2} title="Stopped" value={hvOff}
                icon={<StopOutlined />} color="#8c8c8c" bg="rgba(140,140,140,0.14)" />
              <StatCard index={3} title="Paused" value={hvPaused}
                icon={<PauseCircleOutlined />} color="#faad14" bg="rgba(250,173,20,0.12)" />
              <StatCard index={4} title="Saved" value={hvSaved}
                icon={<PauseCircleOutlined />} color="#1890ff" bg="rgba(24,144,255,0.12)" />
            </StatGrid>
            <Row gutter={[12, 12]}>
              <Col xs={24} lg={16}>
                <ExpandableTableCard title="By Host" defaultOpen={false}>
                  <Table size="small" rowKey="host" pagination={false} rowClassName="dashcard-row"
                    dataSource={hyperv.byHost || []} columns={hvHostCols} />
                </ExpandableTableCard>
              </Col>
              <Col xs={24} lg={8}>
                <ExpandableTableCard title="OS Breakdown" index={1} defaultOpen={false}>
                  <Table size="small" rowKey="os" pagination={false} rowClassName="dashcard-row"
                    dataSource={hyperv.byOS || []} columns={osColumns(hyperv.byOS || [])} />
                </ExpandableTableCard>
              </Col>
            </Row>
          </>
        )}
      </Card>

    </div>
  );
}
