import { useEffect, useState } from 'react';
import { Card, Spin, Empty, Alert, Space, Tag, Typography } from 'antd';
import { WindowsOutlined } from '@ant-design/icons';
import api from '../../../api/client';
import TopologyDiagram from './TopologyDiagram.jsx';

const { Text } = Typography;

// Hyper-V has no vCenter/cluster tier — each host is standalone, so this tab
// renders one diagram with a synthetic "Hyper-V Hosts" root, unlike the
// VMware/Proxmox tabs which group real hosts under real per-vCenter/per-host
// Collapse panels.
export default function HyperVTopologyTab() {
  const [hosts, setHosts]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [denied, setDenied]   = useState(false);

  useEffect(() => {
    api.get('/hyperv/topology')
      .then(r => setHosts(r.data.topology || []))
      .catch(e => {
        if (e?.response?.status === 403) setDenied(true);
        else setError(e?.response?.data?.error || e.message || 'Failed to load Hyper-V topology.');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  if (denied) return <Alert type="warning" showIcon message="You don't have access to Hyper-V Discovery data" style={{ margin: 24 }} />;
  if (error) return <Alert type="error" showIcon message="Couldn't load Hyper-V topology" description={error} style={{ margin: 24 }} />;
  if (!hosts.length) return <Empty description="No topology data. Run a Hyper-V discovery first." style={{ marginTop: 80 }} />;

  const totalVMs = hosts.reduce((s, h) => s + h.vm_count, 0);
  const totalRunning = hosts.reduce((s, h) => s + h.running, 0);

  return (
    <Card
      size="small"
      title={
        <Space>
          <WindowsOutlined />
          <Text strong>Hyper-V Hosts</Text>
          <Tag>{hosts.length} host{hosts.length !== 1 ? 's' : ''}</Tag>
          <Tag color="purple">{totalVMs} VMs</Tag>
          <Tag color="success">{totalRunning} running</Tag>
        </Space>
      }
    >
      <TopologyDiagram
        tone="purple"
        root={{ label: 'Hyper-V Hosts', sublabel: `${hosts.length} standalone host${hosts.length !== 1 ? 's' : ''}` }}
        children={hosts.map(h => ({
          key: h.host,
          label: h.host,
          badgeText: `${h.vm_count} VMs · ${h.running} run · ${h.stopped} off${h.saved ? ` · ${h.saved} saved` : ''}${h.paused ? ` · ${h.paused} paused` : ''}`,
        }))}
      />
    </Card>
  );
}
