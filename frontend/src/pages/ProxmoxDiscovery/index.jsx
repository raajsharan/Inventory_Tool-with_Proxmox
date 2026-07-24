import { useState } from 'react';
import { Typography, Tabs, Card } from 'antd';
import {
  DashboardOutlined, UnorderedListOutlined, CloudServerOutlined,
  SwapOutlined, CameraOutlined, ApartmentOutlined, WarningOutlined,
  ClusterOutlined,
} from '@ant-design/icons';
import PVEDashboard    from './components/PVEDashboard.jsx';
import PVEList         from './components/PVEList.jsx';
import PVENodesList    from './components/PVENodesList.jsx';
import PVEHosts        from './components/PVEHosts.jsx';
import PVEDrift        from './components/PVEDrift.jsx';
import PVESnapshots    from './components/PVESnapshots.jsx';
import PVENodeTopology from './components/PVENodeTopology.jsx';
import PVEStale        from './components/PVEStale.jsx';

const { Title } = Typography;

export default function ProxmoxDiscovery() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [dashKey,   setDashKey]   = useState(0);

  const tabs = [
    {
      key: 'dashboard',
      label: <span><DashboardOutlined /> Dashboard</span>,
      children: <PVEDashboard key={dashKey} />,
    },
    {
      key: 'vms',
      label: <span><UnorderedListOutlined /> VMs &amp; Containers</span>,
      children: <PVEList />,
    },
    {
      key: 'nodes',
      label: <span><ClusterOutlined /> Cluster Nodes</span>,
      children: <PVENodesList />,
    },
    {
      key: 'hosts',
      label: <span><CloudServerOutlined /> Hosts &amp; Credentials</span>,
      children: <PVEHosts onDiscoveryStarted={() => setDashKey(k => k + 1)} />,
    },
    {
      key: 'drift',
      label: <span><SwapOutlined /> Change Detection</span>,
      children: <PVEDrift />,
    },
    {
      key: 'snapshots',
      label: <span><CameraOutlined /> Snapshots</span>,
      children: <PVESnapshots />,
    },
    {
      key: 'topology',
      label: <span><ApartmentOutlined /> Node Topology</span>,
      children: <PVENodeTopology />,
    },
    {
      key: 'stale',
      label: <span><WarningOutlined /> Stale VMs</span>,
      children: <PVEStale />,
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>Proxmox Discovery</Title>
      <Card bodyStyle={{ padding: 0 }}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={tabs}
          tabBarStyle={{ paddingLeft: 16, paddingRight: 16, marginBottom: 0 }}
          style={{ minHeight: 400 }}
          destroyInactiveTabPane={false}
        />
      </Card>
    </div>
  );
}
