import { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Table, Spin, Empty, Tag } from 'antd';
import {
  PlayCircleOutlined, StopOutlined, PauseCircleOutlined,
  LaptopOutlined, ClockCircleOutlined,
} from '@ant-design/icons';
import api from '../../../api/client';

function stateTag(s) {
  if (s === 'Running') return <Tag color="success">Running</Tag>;
  if (s === 'Stopped') return <Tag color="default">Stopped</Tag>;
  if (s === 'Paused')  return <Tag color="warning">Paused</Tag>;
  if (s === 'Saved')   return <Tag color="processing">Saved</Tag>;
  return <Tag>{s || '—'}</Tag>;
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

  const hostColumns = [
    { title: 'Host',    dataIndex: 'source_host', key: 'host',    ellipsis: true },
    { title: 'Total',   dataIndex: 'total',       key: 'total',   width: 80 },
    { title: 'Running', dataIndex: 'running',     key: 'running', width: 90, render: n => <Tag color="success">{n}</Tag> },
    { title: 'Stopped', dataIndex: 'stopped',     key: 'stopped', width: 90, render: n => <Tag color="default">{n}</Tag> },
    { title: 'Paused',  dataIndex: 'paused',      key: 'paused',  width: 80 },
    { title: 'Saved',   dataIndex: 'saved',       key: 'saved',   width: 80 },
  ];

  const osColumns = [
    { title: 'OS Type', dataIndex: 'os_type', key: 'os',    ellipsis: true },
    { title: 'Count',   dataIndex: 'count',   key: 'count', width: 90 },
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
    { title: 'Started',   dataIndex: 'started_at', key: 'started', ellipsis: true,
      render: v => v ? new Date(v).toLocaleString() : '—' },
    { title: 'Error',     dataIndex: 'error',      key: 'error',   ellipsis: true, render: v => v || '—' },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="Total VMs" value={stats.total} prefix={<LaptopOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="Running"
              value={stats.running}
              prefix={<PlayCircleOutlined style={{ color: '#52c41a' }} />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="Stopped"
              value={stats.stopped}
              prefix={<StopOutlined style={{ color: '#999' }} />}
              valueStyle={{ color: '#999' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="Paused"
              value={stats.paused}
              prefix={<PauseCircleOutlined style={{ color: '#faad14' }} />}
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="Saved"
              value={stats.saved}
              prefix={<ClockCircleOutlined style={{ color: '#1890ff' }} />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="Hosts Monitored" value={stats.hosts} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={14}>
          <Card size="small" title="By Host">
            <Table
              size="small"
              rowKey="source_host"
              dataSource={byHost}
              columns={hostColumns}
              pagination={false}
            />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card size="small" title="OS Breakdown">
            <Table
              size="small"
              rowKey="os_type"
              dataSource={byOS}
              columns={osColumns}
              pagination={false}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24}>
          <Card size="small" title="Recent Discovery Runs">
            <Table
              size="small"
              rowKey="id"
              dataSource={runs}
              columns={runColumns}
              pagination={false}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
