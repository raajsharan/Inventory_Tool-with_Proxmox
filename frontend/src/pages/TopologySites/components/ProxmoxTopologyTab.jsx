import { useEffect, useState } from 'react';
import { Collapse, Spin, Empty, Alert, Tag, Space, Typography } from 'antd';
import { ClusterOutlined } from '@ant-design/icons';
import api from '../../../api/client';
import TopologyDiagram from './TopologyDiagram.jsx';

const { Text } = Typography;

export default function ProxmoxTopologyTab() {
  const [data, setData]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [denied, setDenied]   = useState(false);

  useEffect(() => {
    // Unlike VMware's /esxi-topology (which wraps its array in {topology:[...]}),
    // this endpoint returns the raw array directly.
    api.get('/proxmox/node-topology')
      .then(r => setData(Array.isArray(r.data) ? r.data : (r.data.topology || [])))
      .catch(e => {
        if (e?.response?.status === 403) setDenied(true);
        else setError(e?.response?.data?.error || e.message || 'Failed to load Proxmox topology.');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  if (denied) return <Alert type="warning" showIcon message="You don't have access to Proxmox Discovery data" style={{ margin: 24 }} />;
  if (error) return <Alert type="error" showIcon message="Couldn't load Proxmox topology" description={error} style={{ margin: 24 }} />;
  if (!data.length) return <Empty description="No topology data. Run a Proxmox discovery first." style={{ marginTop: 80 }} />;

  const items = data.map((entry, i) => {
    const totalVMs = entry.nodes.reduce((s, n) => s + n.total, 0);
    const totalRunning = entry.nodes.reduce((s, n) => s + n.running, 0);
    return {
      key: String(i),
      label: (
        <Space>
          <ClusterOutlined />
          <Text strong>{entry.host}</Text>
          <Tag>{entry.nodes.length} node{entry.nodes.length !== 1 ? 's' : ''}</Tag>
          <Tag color="orange">{totalVMs} guests</Tag>
          <Tag color="success">{totalRunning} running</Tag>
        </Space>
      ),
      children: (
        <TopologyDiagram
          tone="orange"
          root={{ label: entry.host, sublabel: 'Proxmox host' }}
          children={entry.nodes.map(n => ({
            key: n.node,
            label: n.node,
            badgeText: `${n.total} guests · ${n.running} run · ${n.qemu} VM · ${n.lxc} LXC`,
          }))}
        />
      ),
    };
  });

  return <Collapse items={items} defaultActiveKey={data.length === 1 ? ['0'] : []} />;
}
