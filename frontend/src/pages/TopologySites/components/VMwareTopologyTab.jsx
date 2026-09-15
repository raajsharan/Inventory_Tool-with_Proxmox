import { useEffect, useState } from 'react';
import { Collapse, Spin, Empty, Alert, Tag, Space, Typography } from 'antd';
import { CloudServerOutlined } from '@ant-design/icons';
import api from '../../../api/client';
import TopologyDiagram from './TopologyDiagram.jsx';

const { Text } = Typography;

export default function VMwareTopologyTab() {
  const [topology, setTopology] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [denied, setDenied]     = useState(false);

  useEffect(() => {
    api.get('/vmware/esxi-topology')
      .then(r => setTopology(r.data.topology || []))
      .catch(e => {
        if (e?.response?.status === 403) setDenied(true);
        else setError(e?.response?.data?.error || e.message || 'Failed to load VMware topology.');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  if (denied) return <Alert type="warning" showIcon message="You don't have access to VMware Discovery data" style={{ margin: 24 }} />;
  if (error) return <Alert type="error" showIcon message="Couldn't load VMware topology" description={error} style={{ margin: 24 }} />;
  if (!topology.length) return <Empty description="No topology data. Run a VMware discovery first." style={{ marginTop: 80 }} />;

  const items = topology.map((group, i) => {
    const totalVMs = group.esxi_hosts.reduce((s, h) => s + h.vm_count, 0);
    const totalOn  = group.esxi_hosts.reduce((s, h) => s + h.powered_on, 0);
    return {
      key: String(i),
      label: (
        <Space>
          <CloudServerOutlined />
          <Text strong>{group.vcenter}</Text>
          <Tag>{group.esxi_hosts.length} ESXi hosts</Tag>
          <Tag color="blue">{totalVMs} VMs</Tag>
          <Tag color="success">{totalOn} on</Tag>
        </Space>
      ),
      children: (
        <TopologyDiagram
          tone="blue"
          root={{ label: group.vcenter, sublabel: 'vCenter' }}
          children={group.esxi_hosts.map(h => ({
            key: h.esxi_name,
            label: h.esxi_name,
            sublabel: h.esxi_ip !== 'Not Available' ? h.esxi_ip : undefined,
            badgeText: `${h.vm_count} VMs · ${h.powered_on} on · ${h.powered_off} off${h.suspended ? ` · ${h.suspended} susp.` : ''}`,
          }))}
        />
      ),
    };
  });

  return <Collapse items={items} defaultActiveKey={topology.length === 1 ? ['0'] : []} />;
}
