import { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Table, Spin, Empty, Tag } from 'antd';
import {
  PlayCircleOutlined, PauseCircleOutlined, StopOutlined,
  LaptopOutlined, ContainerOutlined,
} from '@ant-design/icons';
import api from '../../../api/client';

export default function PVEDashboard() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/proxmox/dashboard')
      .then(r => setData(r.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  if (!data)   return <Empty description="No data" style={{ marginTop: 80 }} />;

  const { stats, byNode, byHost, byOS } = data;

  const nodeColumns = [
    { title: 'Host',    dataIndex: 'host',    key: 'host',    ellipsis: true },
    { title: 'Node',    dataIndex: 'node',    key: 'node',    ellipsis: true },
    { title: 'Total',   dataIndex: 'total',   key: 'total',   width: 80 },
    { title: 'Running', dataIndex: 'running', key: 'running', width: 90, render: n => <Tag color="success">{n}</Tag> },
    { title: 'Stopped', dataIndex: 'stopped', key: 'stopped', width: 90, render: n => <Tag color="default">{n}</Tag> },
    { title: 'QEMU',    dataIndex: 'qemu',    key: 'qemu',    width: 80 },
    { title: 'LXC',     dataIndex: 'lxc',     key: 'lxc',     width: 80 },
  ];

  const osColumns = [
    { title: 'OS Type', dataIndex: 'os',    key: 'os',    ellipsis: true },
    { title: 'Count',   dataIndex: 'count', key: 'count', width: 90 },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="Total" value={stats.total} />
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
              title="QEMU VMs"
              value={stats.qemu}
              prefix={<LaptopOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="LXC Containers"
              value={stats.lxc}
              prefix={<ContainerOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={16}>
          <Card size="small" title="By Node">
            <Table
              size="small"
              rowKey={r => `${r.host}||${r.node}`}
              dataSource={byNode}
              columns={nodeColumns}
              pagination={false}
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card size="small" title="OS Breakdown">
            <Table
              size="small"
              rowKey="os"
              dataSource={byOS}
              columns={osColumns}
              pagination={false}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
