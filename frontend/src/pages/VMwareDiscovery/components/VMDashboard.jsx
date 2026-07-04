import { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Table, Tag, Spin, Empty } from 'antd';
import {
  PlayCircleOutlined, StopOutlined, PauseCircleOutlined,
  DesktopOutlined, ApartmentOutlined, AppstoreOutlined,
} from '@ant-design/icons';
import api from '../../../api/client';

export default function VMDashboard() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/vmware/dashboard')
      .then(r => setData(r.data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  if (!data)   return <Empty description="No data" style={{ marginTop: 80 }} />;

  const { stats, byHost, byOS } = data;

  const hostCols = [
    { title: 'vCenter / ESXi', dataIndex: 'host',       key: 'host',       ellipsis: true },
    { title: 'Total',          dataIndex: 'total',      key: 'total',      width: 80,
      sorter: (a, b) => b.total - a.total },
    { title: 'Powered On',     dataIndex: 'poweredOn',  key: 'poweredOn',  width: 110,
      render: n => <Tag color="success">{n}</Tag> },
    { title: 'Powered Off',    dataIndex: 'poweredOff', key: 'poweredOff', width: 110,
      render: n => <Tag color="default">{n}</Tag> },
    { title: 'Suspended',      dataIndex: 'suspended',  key: 'suspended',  width: 100,
      render: n => <Tag color="warning">{n ?? 0}</Tag> },
  ];

  const osCols = [
    { title: 'OS Type', dataIndex: 'os',    key: 'os',    ellipsis: true },
    { title: 'Count',   dataIndex: 'count', key: 'count', width: 90,
      sorter: (a, b) => b.count - a.count },
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
              title="Powered On"
              value={stats.poweredOn}
              prefix={<PlayCircleOutlined style={{ color: '#52c41a' }} />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="Powered Off"
              value={stats.poweredOff}
              prefix={<StopOutlined style={{ color: '#999' }} />}
              valueStyle={{ color: '#999' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="Suspended"
              value={stats.suspended}
              prefix={<PauseCircleOutlined style={{ color: '#faad14' }} />}
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="vCenter / ESXi Hosts"
              value={byHost.length}
              prefix={<ApartmentOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic
              title="OS Types"
              value={byOS.length}
              prefix={<AppstoreOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={16}>
          <Card size="small" title="By vCenter / ESXi Host">
            <Table
              size="small"
              rowKey="host"
              dataSource={byHost}
              columns={hostCols}
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
              columns={osCols}
              pagination={false}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
