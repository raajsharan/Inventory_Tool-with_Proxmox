import { useEffect, useState } from 'react';
import { Collapse, Table, Tag, Spin, Empty, Badge, Space, Typography, Alert } from 'antd';
import api from '../../../api/client';

const { Text } = Typography;

const nodeColumns = [
  { title: 'Node',    dataIndex: 'node',    key: 'node',    ellipsis: true },
  { title: 'Total',   dataIndex: 'total',   key: 'total',   width: 80 },
  { title: 'Running', dataIndex: 'running', key: 'running', width: 90, render: n => <Tag color="success">{n}</Tag> },
  { title: 'Stopped', dataIndex: 'stopped', key: 'stopped', width: 90, render: n => <Tag color="default">{n}</Tag> },
  { title: 'QEMU VMs',       dataIndex: 'qemu', key: 'qemu', width: 100 },
  { title: 'LXC Containers', dataIndex: 'lxc',  key: 'lxc',  width: 130 },
];

export default function PVENodeTopology() {
  const [data,    setData]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    api.get('/proxmox/node-topology')
      .then(r => setData(r.data))
      .catch(e => setError(e?.response?.data?.error || e.message || 'Failed to load node topology.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  if (error) return <Alert type="error" showIcon message="Couldn't load node topology" description={error} style={{ margin: 24 }} />;
  if (!data.length) return <Empty description="No topology data available — run a discovery first." style={{ marginTop: 60 }} />;

  const panels = data.map(entry => {
    const totalVMs = entry.nodes.reduce((s, n) => s + n.total, 0);
    return {
      key: entry.host,
      label: (
        <Space>
          <Text strong>{entry.host}</Text>
          <Badge count={entry.nodes.length} color="blue" title="Nodes" />
          <Text type="secondary">{totalVMs} guest{totalVMs !== 1 ? 's' : ''}</Text>
        </Space>
      ),
      children: (
        <Table
          size="small"
          rowKey="node"
          dataSource={entry.nodes}
          columns={nodeColumns}
          pagination={false}
          scroll={{ x: 'max-content' }}
          sticky={{ offsetScroll: 0 }}
        />
      ),
    };
  });

  return (
    <div style={{ padding: 16 }}>
      <Collapse items={panels} defaultActiveKey={[]} />
    </div>
  );
}
