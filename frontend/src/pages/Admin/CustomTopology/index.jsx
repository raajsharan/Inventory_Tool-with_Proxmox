import { Typography, Tabs, Card } from 'antd';
import { ApartmentOutlined, ClusterOutlined, WindowsOutlined } from '@ant-design/icons';
import CustomTopologyTab from './components/CustomTopologyTab.jsx';

const { Title, Text } = Typography;

export default function CustomTopologyAdmin() {
  const tabs = [
    {
      key:      'vmware',
      label:    <span><ApartmentOutlined /> VMware</span>,
      children: <CustomTopologyTab platform="vmware" />,
    },
    {
      key:      'proxmox',
      label:    <span><ClusterOutlined /> Proxmox</span>,
      children: <CustomTopologyTab platform="proxmox" />,
    },
    {
      key:      'hyperv',
      label:    <span><WindowsOutlined /> Hyper-V</span>,
      children: <CustomTopologyTab platform="hyperv" />,
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 4 }}>Custom Topology Builder</Title>
      <Text type="secondary">
        Manually design topology diagrams by hand, separate per platform — pick real vCenter/ESXi/Proxmox/Hyper-V records where relevant, or freeform Cluster/Generic nodes.
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
