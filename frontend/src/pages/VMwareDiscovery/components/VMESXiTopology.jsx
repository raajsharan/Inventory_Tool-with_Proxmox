import { useEffect, useState } from 'react';
import { Card, Collapse, Table, Tag, Spin, Empty, Row, Col, Statistic, Alert } from 'antd';
import { HddOutlined, CloudServerOutlined } from '@ant-design/icons';
import api from '../../../api/client';

export default function VMESXiTopology() {
  const [topology, setTopology] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  useEffect(() => {
    api.get('/vmware/esxi-topology')
      .then(r => setTopology(r.data.topology || []))
      .catch(e => setError(e?.response?.data?.error || e.message || 'Failed to load ESXi topology.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  if (error) return <Alert type="error" showIcon message="Couldn't load ESXi topology" description={error} style={{ margin: 24 }} />;
  if (!topology.length) return <Empty description="No topology data. Run a discovery first." style={{ marginTop: 80 }} />;

  const esxiCols = [
    { title: 'ESXi Host', dataIndex: 'esxi_name', key: 'esxi_name' },
    { title: 'Management IP', dataIndex: 'esxi_ip', key: 'esxi_ip' },
    {
      title: 'Total VMs', dataIndex: 'vm_count', key: 'vm_count',
      sorter: (a, b) => b.vm_count - a.vm_count,
    },
    {
      title: 'Powered On', dataIndex: 'powered_on', key: 'powered_on',
      render: n => <Tag color="success">{n}</Tag>,
    },
    {
      title: 'Powered Off', dataIndex: 'powered_off', key: 'powered_off',
      render: n => <Tag color="default">{n}</Tag>,
    },
    {
      title: 'Suspended', dataIndex: 'suspended', key: 'suspended',
      render: n => n > 0 ? <Tag color="warning">{n}</Tag> : '—',
    },
  ];

  const items = topology.map((group, i) => {
    const totalVMs  = group.esxi_hosts.reduce((s, h) => s + h.vm_count, 0);
    const totalOn   = group.esxi_hosts.reduce((s, h) => s + h.powered_on, 0);
    return {
      key: String(i),
      label: (
        <span>
          <CloudServerOutlined style={{ marginRight: 8 }} />
          <strong>{group.vcenter}</strong>
          <Tag style={{ marginLeft: 12 }}>{group.esxi_hosts.length} ESXi hosts</Tag>
          <Tag color="blue">{totalVMs} VMs</Tag>
        </span>
      ),
      children: (
        <>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col>
              <Statistic title="ESXi Hosts" value={group.esxi_hosts.length} prefix={<HddOutlined />} />
            </Col>
            <Col>
              <Statistic title="Total VMs" value={totalVMs} />
            </Col>
            <Col>
              <Statistic title="Powered On" value={totalOn} valueStyle={{ color: '#52c41a' }} />
            </Col>
          </Row>
          <Table
            size="small"
            rowKey="esxi_name"
            dataSource={group.esxi_hosts}
            columns={esxiCols}
            pagination={false}
            scroll={{ x: 'max-content' }}
            sticky={{ offsetScroll: 0 }}
          />
        </>
      ),
    };
  });

  return (
    <Card size="small" title="ESXi Topology">
      <Collapse items={items} defaultActiveKey={[]} />
    </Card>
  );
}
