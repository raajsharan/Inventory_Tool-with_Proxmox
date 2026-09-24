import { Typography, Tabs, Card } from 'antd';
import { ApartmentOutlined, ClusterOutlined, WindowsOutlined } from '@ant-design/icons';
import CustomDiagramTab from './components/CustomDiagramTab.jsx';
import { CUSTOM_TOPOLOGY_CSS } from '../Admin/CustomTopology/components/CustomTopologyTab.jsx';

const { Title, Text } = Typography;

export default function TopologySites() {
  const tabs = [
    {
      key:      'vmware',
      label:    <span><ApartmentOutlined /> VMware</span>,
      children: <CustomDiagramTab platform="vmware" />,
    },
    {
      key:      'proxmox',
      label:    <span><ClusterOutlined /> Proxmox</span>,
      children: <CustomDiagramTab platform="proxmox" />,
    },
    {
      key:      'hyperv',
      label:    <span><WindowsOutlined /> Hyper-V</span>,
      children: <CustomDiagramTab platform="hyperv" />,
    },
  ];

  return (
    <div>
      <style>{CUSTOM_TOPOLOGY_CSS}</style>
      <Title level={4} style={{ marginBottom: 4 }}>Topology of Sites</Title>
      <Text type="secondary">
        Site diagrams built on the Custom Topology Builder page, shown read-only and grouped by platform.
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
