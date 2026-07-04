import { useEffect, useState } from 'react';
import {
  Row, Col, Card, Statistic, Table, Tag, Spin, Space, Typography,
} from 'antd';
import {
  PlayCircleOutlined, StopOutlined, PauseCircleOutlined,
  ApartmentOutlined, ClusterOutlined,
} from '@ant-design/icons';
import api from '../api/client';

export default function InfrastructureDashboard() {
  const [vmware,  setVmware]  = useState(null);
  const [proxmox, setProxmox] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/vmware/dashboard').then(r => r.data).catch(() => null),
      api.get('/proxmox/dashboard').then(r => r.data).catch(() => null),
    ]).then(([vm, px]) => { setVmware(vm); setProxmox(px); setLoading(false); });
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

  const total   = vmTotal + pxTotal;
  const running = vmOn    + pxOn;
  const stopped = vmOff   + pxOff;
  const paused  = vmSusp  + pxPaused;

  // Merged OS breakdown
  const osMap = {};
  (vmware?.byOS  || []).forEach(o => { osMap[o.os] = (osMap[o.os] || 0) + o.count; });
  (proxmox?.byOS || []).forEach(o => { osMap[o.os] = (osMap[o.os] || 0) + o.count; });

  const osColumns = [
    { title: 'OS Type', dataIndex: 'os',    key: 'os',    ellipsis: true },
    { title: 'Count',   dataIndex: 'count', key: 'count', width: 90 },
  ];

  const vmHostCols = [
    { title: 'vCenter / ESXi', dataIndex: 'host',       key: 'host',       ellipsis: true },
    { title: 'Total',          dataIndex: 'total',      key: 'total',      width: 80 },
    { title: 'Powered On',     dataIndex: 'poweredOn',  key: 'poweredOn',  width: 110,
      render: n => <Tag color="success">{n}</Tag> },
    { title: 'Powered Off',    dataIndex: 'poweredOff', key: 'poweredOff', width: 110,
      render: n => <Tag color="default">{n}</Tag> },
    { title: 'Suspended',      dataIndex: 'suspended',  key: 'suspended',  width: 100,
      render: n => <Tag color="warning">{n ?? 0}</Tag> },
  ];

  const pxNodeCols = [
    { title: 'Host',    dataIndex: 'host',    key: 'host',    ellipsis: true },
    { title: 'Node',    dataIndex: 'node',    key: 'node',    ellipsis: true },
    { title: 'Total',   dataIndex: 'total',   key: 'total',   width: 70 },
    { title: 'Running', dataIndex: 'running', key: 'running', width: 90,
      render: n => <Tag color="success">{n}</Tag> },
    { title: 'Stopped', dataIndex: 'stopped', key: 'stopped', width: 90,
      render: n => <Tag color="default">{n}</Tag> },
    { title: 'QEMU',    dataIndex: 'qemu',    key: 'qemu',    width: 70 },
    { title: 'LXC',     dataIndex: 'lxc',     key: 'lxc',     width: 70 },
  ];

  return (
    <div style={{ padding: 16 }}>

      {/* Combined summary cards */}
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="Total" value={total} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="Running / On" value={running}
              prefix={<PlayCircleOutlined style={{ color: '#52c41a' }} />}
              valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="Stopped / Off" value={stopped}
              prefix={<StopOutlined style={{ color: '#999' }} />}
              valueStyle={{ color: '#999' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="Paused / Suspended" value={paused}
              prefix={<PauseCircleOutlined style={{ color: '#faad14' }} />}
              valueStyle={{ color: '#faad14' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="VMware VMs" value={vmTotal}
              prefix={<ApartmentOutlined style={{ color: '#1677ff' }} />}
              valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="Proxmox (QEMU+LXC)" value={pxTotal}
              prefix={<ClusterOutlined style={{ color: '#722ed1' }} />}
              valueStyle={{ color: '#722ed1' }} />
          </Card>
        </Col>
      </Row>

      {/* VMware vSphere details */}
      <Card
        size="small"
        style={{ marginTop: 20 }}
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
            <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
              <Col xs={12} sm={6}>
                <Card size="small">
                  <Statistic title="Total VMs" value={vmTotal} />
                </Card>
              </Col>
              <Col xs={12} sm={6}>
                <Card size="small">
                  <Statistic title="Powered On" value={vmOn}
                    prefix={<PlayCircleOutlined style={{ color: '#52c41a' }} />}
                    valueStyle={{ color: '#52c41a' }} />
                </Card>
              </Col>
              <Col xs={12} sm={6}>
                <Card size="small">
                  <Statistic title="Powered Off" value={vmOff}
                    prefix={<StopOutlined style={{ color: '#999' }} />}
                    valueStyle={{ color: '#999' }} />
                </Card>
              </Col>
              <Col xs={12} sm={6}>
                <Card size="small">
                  <Statistic title="Suspended" value={vmSusp}
                    prefix={<PauseCircleOutlined style={{ color: '#faad14' }} />}
                    valueStyle={{ color: '#faad14' }} />
                </Card>
              </Col>
            </Row>
            <Row gutter={[12, 12]}>
              <Col xs={24} lg={16}>
                <Card size="small" title="By vCenter / ESXi Host">
                  <Table size="small" rowKey="host" pagination={false}
                    dataSource={vmware.byHost || []} columns={vmHostCols} />
                </Card>
              </Col>
              <Col xs={24} lg={8}>
                <Card size="small" title="OS Breakdown">
                  <Table size="small" rowKey="os" pagination={false}
                    dataSource={vmware.byOS || []} columns={osColumns} />
                </Card>
              </Col>
            </Row>
          </>
        )}
      </Card>

      {/* Proxmox VE / PDM details */}
      <Card
        size="small"
        style={{ marginTop: 16 }}
        title={
          <Space>
            <ClusterOutlined style={{ color: '#722ed1', fontSize: 16 }} />
            <Typography.Text strong style={{ color: '#722ed1' }}>Proxmox VE / PDM</Typography.Text>
            {proxmox && (
              <Space size={4}>
                <Tag color="purple">{pxTotal} Total</Tag>
                <Tag color="default">QEMU: {pxQemu}</Tag>
                <Tag color="geekblue">LXC: {pxLxc}</Tag>
              </Space>
            )}
          </Space>
        }
      >
        {!proxmox ? (
          <Typography.Text type="secondary">No data — run a Proxmox discovery first.</Typography.Text>
        ) : (
          <>
            <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
              <Col xs={12} sm={4}>
                <Card size="small">
                  <Statistic title="Total" value={pxTotal} />
                </Card>
              </Col>
              <Col xs={12} sm={4}>
                <Card size="small">
                  <Statistic title="Running" value={pxOn}
                    prefix={<PlayCircleOutlined style={{ color: '#52c41a' }} />}
                    valueStyle={{ color: '#52c41a' }} />
                </Card>
              </Col>
              <Col xs={12} sm={4}>
                <Card size="small">
                  <Statistic title="Stopped" value={pxOff}
                    prefix={<StopOutlined style={{ color: '#999' }} />}
                    valueStyle={{ color: '#999' }} />
                </Card>
              </Col>
              <Col xs={12} sm={4}>
                <Card size="small">
                  <Statistic title="Paused" value={pxPaused}
                    prefix={<PauseCircleOutlined style={{ color: '#faad14' }} />}
                    valueStyle={{ color: '#faad14' }} />
                </Card>
              </Col>
              <Col xs={12} sm={4}>
                <Card size="small">
                  <Statistic title="QEMU VMs" value={pxQemu} />
                </Card>
              </Col>
              <Col xs={12} sm={4}>
                <Card size="small">
                  <Statistic title="LXC Containers" value={pxLxc} />
                </Card>
              </Col>
            </Row>
            <Row gutter={[12, 12]}>
              <Col xs={24} lg={16}>
                <Card size="small" title="By Node">
                  <Table size="small" rowKey={r => `${r.host}||${r.node}`} pagination={false}
                    dataSource={proxmox.byNode || []} columns={pxNodeCols} />
                </Card>
              </Col>
              <Col xs={24} lg={8}>
                <Card size="small" title="OS Breakdown">
                  <Table size="small" rowKey="os" pagination={false}
                    dataSource={proxmox.byOS || []} columns={osColumns} />
                </Card>
              </Col>
            </Row>
          </>
        )}
      </Card>

    </div>
  );
}
