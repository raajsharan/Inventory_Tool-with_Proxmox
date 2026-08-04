import { useState } from 'react';
import { Typography, Tabs, Card } from 'antd';
import {
  DashboardOutlined, UnorderedListOutlined, CloudServerOutlined,
  SwapOutlined, CameraOutlined, WarningOutlined, AimOutlined,
} from '@ant-design/icons';
import HVDashboard from './components/HVDashboard.jsx';
import HVList      from './components/HVList.jsx';
import HVHosts     from './components/HVHosts.jsx';
import HVDrift     from './components/HVDrift.jsx';
import HVSnapshots from './components/HVSnapshots.jsx';
import HVStale     from './components/HVStale.jsx';
import HVMacLookup from './components/HVMacLookup.jsx';

const { Title } = Typography;

export default function HyperVDiscovery() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [dashKey,   setDashKey]   = useState(0);

  const tabs = [
    {
      key:      'dashboard',
      label:    <span><DashboardOutlined /> Dashboard</span>,
      children: <HVDashboard key={dashKey} />,
    },
    {
      key:      'vms',
      label:    <span><UnorderedListOutlined /> All VMs</span>,
      children: <HVList />,
    },
    {
      key:      'hosts',
      label:    <span><CloudServerOutlined /> Hosts &amp; Credentials</span>,
      children: <HVHosts onDiscoveryStarted={() => setDashKey(k => k + 1)} />,
    },
    {
      key:      'drift',
      label:    <span><SwapOutlined /> Change Detection</span>,
      children: <HVDrift />,
    },
    {
      key:      'snapshots',
      label:    <span><CameraOutlined /> Snapshots</span>,
      children: <HVSnapshots />,
    },
    {
      key:      'stale',
      label:    <span><WarningOutlined /> Stale VMs</span>,
      children: <HVStale />,
    },
    {
      key:      'mac-lookup',
      label:    <span><AimOutlined /> MAC Lookup</span>,
      children: <HVMacLookup />,
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>Microsoft Hyper-V Discovery</Title>
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
