import { useEffect, useState } from 'react';
import { Row, Col, Card, Table, Spin, Empty, Tag, Typography, Alert } from 'antd';
import {
  PlayCircleOutlined, PauseCircleOutlined, StopOutlined, AppstoreOutlined,
  LaptopOutlined, ContainerOutlined, WindowsOutlined, LinuxOutlined, DesktopOutlined,
} from '@ant-design/icons';
import api from '../../../api/client';
import { DASH_CSS, StatCard, MiniBar, SplitBar } from '../../../components/DashboardStatCard.jsx';

const { Text } = Typography;

function osIcon(os) {
  const s = (os || '').toLowerCase();
  if (s.includes('win')) return { icon: <WindowsOutlined />, color: '#40a9ff' };
  if (s.includes('linux') || s.includes('centos') || s.includes('ubuntu') || s.includes('rhel') || s.includes('debian'))
    return { icon: <LinuxOutlined />, color: '#faad14' };
  return { icon: <DesktopOutlined />, color: '#8c8c8c' };
}

export default function PVEDashboard() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    api.get('/proxmox/dashboard')
      .then(r => setData(r.data))
      .catch(e => setError(e?.response?.data?.error || e.message || 'Failed to load the dashboard.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  if (error) return <Alert type="error" showIcon message="Couldn't load the dashboard" description={error} style={{ margin: 24 }} />;
  if (!data)   return <Empty description="No data" style={{ marginTop: 80 }} />;

  const { stats, byNode, byOS } = data;
  const maxOSCount = Math.max(1, ...byOS.map(o => o.count));

  const nodeColumns = [
    { title: 'Host',    dataIndex: 'host',    key: 'host',    ellipsis: true },
    { title: 'Node',    dataIndex: 'node',    key: 'node',    ellipsis: true },
    { title: 'Total',   dataIndex: 'total',   key: 'total',   width: 80 },
    {
      title: 'Split', key: 'split', width: 110,
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
    { title: 'QEMU',    dataIndex: 'qemu',    key: 'qemu',    width: 80,
      render: n => <span><LaptopOutlined style={{ color: '#722ed1', marginRight: 6 }} />{n}</span> },
    { title: 'LXC',     dataIndex: 'lxc',     key: 'lxc',     width: 80,
      render: n => <span><ContainerOutlined style={{ color: '#1890ff', marginRight: 6 }} />{n}</span> },
  ];

  const osColumns = [
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
          <Text strong style={{ width: 32 }}>{v}</Text>
          <MiniBar count={v} max={maxOSCount} color={osIcon(r.os).color} />
        </span>
      ),
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <style>{DASH_CSS}</style>
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={8} md={4}>
          <StatCard index={0} title="Total" value={stats.total}
            icon={<AppstoreOutlined />} color="#1677ff" bg="rgba(22,119,255,0.12)" />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <StatCard index={1} title="Running" value={stats.running}
            icon={<PlayCircleOutlined />} color="#52c41a" bg="rgba(82,196,26,0.12)" />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <StatCard index={2} title="Stopped" value={stats.stopped}
            icon={<StopOutlined />} color="#8c8c8c" bg="rgba(140,140,140,0.14)" />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <StatCard index={3} title="Paused" value={stats.paused}
            icon={<PauseCircleOutlined />} color="#faad14" bg="rgba(250,173,20,0.12)" />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <StatCard index={4} title="QEMU VMs" value={stats.qemu}
            icon={<LaptopOutlined />} color="#722ed1" bg="rgba(114,46,209,0.12)" />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <StatCard index={5} title="LXC Containers" value={stats.lxc}
            icon={<ContainerOutlined />} color="#13c2c2" bg="rgba(19,194,194,0.12)" />
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={16}>
          <Card size="small" title="By Node" className="dashcard" style={{ animationDelay: '120ms' }}>
            <Table
              size="small"
              rowKey={r => `${r.host}||${r.node}`}
              dataSource={byNode}
              columns={nodeColumns}
              pagination={false}
              rowClassName="dashcard-row"
              scroll={{ x: 'max-content' }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card size="small" title="OS Breakdown" className="dashcard" style={{ animationDelay: '160ms' }}>
            <Table
              size="small"
              rowKey="os"
              dataSource={byOS}
              columns={osColumns}
              pagination={false}
              rowClassName="dashcard-row"
              scroll={{ x: 'max-content' }}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
