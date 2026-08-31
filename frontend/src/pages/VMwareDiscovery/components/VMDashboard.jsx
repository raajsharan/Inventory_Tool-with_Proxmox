import { useEffect, useState } from 'react';
import { Row, Col, Card, Table, Tag, Spin, Empty, Typography, Alert } from 'antd';
import {
  PlayCircleOutlined, StopOutlined, PauseCircleOutlined,
  ApartmentOutlined, AppstoreOutlined, WindowsOutlined, LinuxOutlined, DesktopOutlined,
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

export default function VMDashboard() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    api.get('/vmware/dashboard')
      .then(r => setData(r.data))
      .catch(e => setError(e?.response?.data?.error || e.message || 'Failed to load the dashboard.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  if (error) return <Alert type="error" showIcon message="Couldn't load the dashboard" description={error} style={{ margin: 24 }} />;
  if (!data)   return <Empty description="No data" style={{ marginTop: 80 }} />;

  const { stats, byHost, byOS } = data;
  const maxOSCount = Math.max(1, ...byOS.map(o => o.count));

  const hostCols = [
    { title: 'vCenter / ESXi', dataIndex: 'host',       key: 'host',       ellipsis: true },
    { title: 'Total',          dataIndex: 'total',      key: 'total',      width: 80,
      sorter: (a, b) => b.total - a.total },
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

  const osCols = [
    {
      title: 'OS Type', dataIndex: 'os', key: 'os', ellipsis: true,
      render: (v) => {
        const meta = osIcon(v);
        return (
          <span>
            <span style={{ color: meta.color, marginRight: 8 }}>{meta.icon}</span>
            {v}
          </span>
        );
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
          <StatCard index={1} title="Powered On" value={stats.poweredOn}
            icon={<PlayCircleOutlined />} color="#52c41a" bg="rgba(82,196,26,0.12)" />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <StatCard index={2} title="Powered Off" value={stats.poweredOff}
            icon={<StopOutlined />} color="#8c8c8c" bg="rgba(140,140,140,0.14)" />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <StatCard index={3} title="Suspended" value={stats.suspended}
            icon={<PauseCircleOutlined />} color="#faad14" bg="rgba(250,173,20,0.12)" />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <StatCard index={4} title="vCenter / ESXi Hosts" value={byHost.length}
            icon={<ApartmentOutlined />} color="#9254de" bg="rgba(146,84,222,0.12)" />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <StatCard index={5} title="OS Types" value={byOS.length}
            icon={<DesktopOutlined />} color="#13c2c2" bg="rgba(19,194,194,0.12)" />
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={16}>
          <Card size="small" title="By vCenter / ESXi Host" className="dashcard" style={{ animationDelay: '120ms' }}>
            <Table
              size="small"
              rowKey="host"
              dataSource={byHost}
              columns={hostCols}
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
              columns={osCols}
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
