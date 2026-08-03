import { useEffect, useState } from 'react';
import { Row, Col, Card, Table, Spin, Empty, Tag, Typography } from 'antd';
import {
  PlayCircleOutlined, StopOutlined, PauseCircleOutlined,
  LaptopOutlined, ClockCircleOutlined, WindowsOutlined, LinuxOutlined, DesktopOutlined,
} from '@ant-design/icons';
import api from '../../../api/client';
import { DASH_CSS, StatCard, MiniBar, SplitBar } from '../../../components/DashboardStatCard.jsx';

const { Text } = Typography;

function stateTag(s) {
  if (s === 'Running') return <Tag color="success">Running</Tag>;
  if (s === 'Stopped') return <Tag color="default">Stopped</Tag>;
  if (s === 'Paused')  return <Tag color="warning">Paused</Tag>;
  if (s === 'Saved')   return <Tag color="processing">Saved</Tag>;
  return <Tag>{s || '—'}</Tag>;
}

function osIcon(os) {
  const s = (os || '').toLowerCase();
  if (s.includes('win')) return { icon: <WindowsOutlined />, color: '#40a9ff' };
  if (s.includes('linux') || s.includes('centos') || s.includes('ubuntu') || s.includes('rhel') || s.includes('debian'))
    return { icon: <LinuxOutlined />, color: '#faad14' };
  return { icon: <DesktopOutlined />, color: '#8c8c8c' };
}

export default function HVDashboard() {
  const [data,    setData]    = useState(null);
  const [runs,    setRuns]    = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/hyperv/dashboard'),
      api.get('/hyperv/runs'),
    ]).then(([d, r]) => {
      setData(d.data);
      setRuns(r.data.slice(0, 10));
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  if (!data)   return <Empty description="No data" style={{ marginTop: 80 }} />;

  const { stats, byHost, byOS } = data;
  const maxOSCount = Math.max(1, ...byOS.map(o => o.count));

  const hostColumns = [
    { title: 'Host',    dataIndex: 'host',        key: 'host',    ellipsis: true },
    { title: 'Total',   dataIndex: 'total',       key: 'total',   width: 80 },
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
    { title: 'Running', dataIndex: 'running',     key: 'running', width: 90, render: n => <Tag icon={<PlayCircleOutlined />} color="success">{n}</Tag> },
    { title: 'Stopped', dataIndex: 'stopped',     key: 'stopped', width: 90, render: n => <Tag icon={<StopOutlined />} color="default">{n}</Tag> },
    { title: 'Paused',  dataIndex: 'paused',      key: 'paused',  width: 80 },
    { title: 'Saved',   dataIndex: 'saved',       key: 'saved',   width: 80 },
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

  const runColumns = [
    { title: 'Host',     dataIndex: 'host',       key: 'host',    ellipsis: true },
    {
      title: 'Status', dataIndex: 'status', key: 'status', width: 90,
      render: s => s === 'success' ? <Tag color="success">Success</Tag>
        : s === 'error' ? <Tag color="error">Failed</Tag>
        : <Tag color="processing">Running</Tag>,
    },
    { title: 'VMs Found', dataIndex: 'vm_count', key: 'vm_count', width: 100, render: v => v ?? '—' },
    { title: 'Started',   dataIndex: 'run_at', key: 'started', ellipsis: true,
      render: v => v ? new Date(v).toLocaleString() : '—' },
    { title: 'Error',     dataIndex: 'error_message', key: 'error', ellipsis: true, render: v => v || '—' },
  ];

  return (
    <div style={{ padding: 16 }}>
      <style>{DASH_CSS}</style>
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={8} md={4}>
          <StatCard index={0} title="Total VMs" value={stats.total}
            icon={<LaptopOutlined />} color="#1677ff" bg="rgba(22,119,255,0.12)" />
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
          <StatCard index={4} title="Saved" value={stats.saved}
            icon={<ClockCircleOutlined />} color="#1890ff" bg="rgba(24,144,255,0.12)" />
        </Col>
        <Col xs={12} sm={8} md={4}>
          <StatCard index={5} title="Hosts Monitored" value={byHost.length}
            icon={<DesktopOutlined />} color="#9254de" bg="rgba(146,84,222,0.12)" />
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={14}>
          <Card size="small" title="By Host" className="dashcard" style={{ animationDelay: '120ms' }}>
            <Table
              size="small"
              rowKey="host"
              dataSource={byHost}
              columns={hostColumns}
              pagination={false}
              rowClassName="dashcard-row"
              scroll={{ x: 'max-content' }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
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

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24}>
          <Card size="small" title="Recent Discovery Runs" className="dashcard" style={{ animationDelay: '200ms' }}>
            <Table
              size="small"
              rowKey="id"
              dataSource={runs}
              columns={runColumns}
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
