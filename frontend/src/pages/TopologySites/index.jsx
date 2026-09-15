import { Typography, Tabs, Card } from 'antd';
import { ApartmentOutlined, ClusterOutlined, WindowsOutlined } from '@ant-design/icons';
import VMwareTopologyTab  from './components/VMwareTopologyTab.jsx';
import ProxmoxTopologyTab from './components/ProxmoxTopologyTab.jsx';
import HyperVTopologyTab  from './components/HyperVTopologyTab.jsx';
import { TOPOLOGY_CSS } from './components/TopologyDiagram.jsx';

const { Title, Text } = Typography;

export default function TopologySites() {
  const tabs = [
    {
      key:      'vmware',
      label:    <span><ApartmentOutlined /> VMware</span>,
      children: <VMwareTopologyTab />,
    },
    {
      key:      'proxmox',
      label:    <span><ClusterOutlined /> Proxmox</span>,
      children: <ProxmoxTopologyTab />,
    },
    {
      key:      'hyperv',
      label:    <span><WindowsOutlined /> Hyper-V</span>,
      children: <HyperVTopologyTab />,
    },
  ];

  return (
    <div>
      <style>{TOPOLOGY_CSS}</style>
      <Title level={4} style={{ marginBottom: 4 }}>Topology of Sites</Title>
      <Text type="secondary">
        Live host-and-VM topology across VMware, Proxmox, and Hyper-V — grouped the same way each platform's own Discovery page groups it.
      </Text>
      <Card bodyStyle={{ padding: 0 }} style={{ marginTop: 16 }}>
        <Tabs
          items={tabs}
          tabBarStyle={{ paddingLeft: 16, paddingRight: 16, marginBottom: 0 }}
          style={{ minHeight: 400 }}
        />
      </Card>
    </div>
  );
}
