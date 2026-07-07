import { useState } from 'react';
import { Typography, Tabs, Card } from 'antd';
import {
  DashboardOutlined, UnorderedListOutlined, CloudServerOutlined,
  SwapOutlined, CameraOutlined, HddOutlined, WarningOutlined,
  AimOutlined, UploadOutlined, FormOutlined, DiffOutlined,
} from '@ant-design/icons';
import VMDashboard    from './components/VMDashboard.jsx';
import VMList         from './components/VMList.jsx';
import VMHosts        from './components/VMHosts.jsx';
import VMDrift        from './components/VMDrift.jsx';
import VMSnapshots    from './components/VMSnapshots.jsx';
import VMESXiTopology from './components/VMESXiTopology.jsx';
import VMStale        from './components/VMStale.jsx';
import VMMacLookup    from './components/VMMacLookup.jsx';
import VMMacUpload    from './components/VMMacUpload.jsx';
import VMAssetEditor  from './components/VMAssetEditor.jsx';
import VMReconcile    from './components/VMReconcile.jsx';

const { Title } = Typography;

export default function VMwareDiscovery() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [dashKey, setDashKey]     = useState(0);

  const tabs = [
    {
      key: 'dashboard',
      label: <span><DashboardOutlined /> Dashboard</span>,
      children: <VMDashboard key={dashKey} />,
    },
    {
      key: 'vms',
      label: <span><UnorderedListOutlined /> All VMs</span>,
      children: <VMList />,
    },
    {
      key: 'hosts',
      label: <span><CloudServerOutlined /> Hosts &amp; Credentials</span>,
      children: <VMHosts onDiscoveryStarted={() => setDashKey(k => k + 1)} />,
    },
    {
      key: 'drift',
      label: <span><SwapOutlined /> Change Detection</span>,
      children: <VMDrift />,
    },
    {
      key: 'snapshots',
      label: <span><CameraOutlined /> Snapshots</span>,
      children: <VMSnapshots />,
    },
    {
      key: 'esxi-topology',
      label: <span><HddOutlined /> ESXi Topology</span>,
      children: <VMESXiTopology />,
    },
    {
      key: 'stale',
      label: <span><WarningOutlined /> Stale VMs</span>,
      children: <VMStale />,
    },
    {
      key: 'reconcile',
      label: <span><DiffOutlined /> Reconcile</span>,
      children: <VMReconcile />,
    },
    {
      key: 'mac-lookup',
      label: <span><AimOutlined /> MAC Lookup</span>,
      children: <VMMacLookup />,
    },
    {
      key: 'mac-upload',
      label: <span><UploadOutlined /> Upload Mapping</span>,
      children: <VMMacUpload />,
    },
    {
      key: 'asset-editor',
      label: <span><FormOutlined /> Asset Edit</span>,
      children: <VMAssetEditor />,
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>VMware Discovery</Title>
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
