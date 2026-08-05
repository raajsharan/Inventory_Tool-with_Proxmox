import { useEffect, useState } from 'react';
import { Tabs, Table, Tag, Spin, Empty, Card, Badge, Alert } from 'antd';
import api from '../../../api/client';

function powerTag(state) {
  if (state === 'poweredOn')  return <Tag color="success">On</Tag>;
  if (state === 'poweredOff') return <Tag color="default">Off</Tag>;
  return <Tag>{state || '—'}</Tag>;
}

const baseCols = [
  { title: 'VM Name', dataIndex: 'name', key: 'name',
    render: v => <span style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{v}</span> },
  { title: 'vCenter / ESXi', dataIndex: 'source_host', key: 'source_host', ellipsis: true },
  { title: 'ESXi Host', dataIndex: 'esxi_host_name', key: 'esxi_host_name', ellipsis: true },
  { title: 'Power', dataIndex: 'power_state', key: 'power_state', render: powerTag },
  {
    title: 'IPs', dataIndex: 'ips', key: 'ips',
    render: v => Array.isArray(v) ? v.filter(i => i !== 'Not Available').join(', ') || '—' : '—',
  },
  { title: 'OS Version', dataIndex: 'os_version', key: 'os_version', ellipsis: true },
];

function VMTable({ vms, emptyText }) {
  if (!vms.length) return <Empty description={emptyText} style={{ margin: '40px 0' }} />;
  return (
    <Table
      size="small"
      rowKey="id"
      dataSource={vms}
      columns={baseCols}
      scroll={{ x: 'max-content' }}
      pagination={{ pageSize: 50, showTotal: t => `${t} total` }}
    />
  );
}

export default function VMStale() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    api.get('/vmware/stale')
      .then(r => setData(r.data))
      .catch(e => setError(e?.response?.data?.error || e.message || 'Failed to load stale VMs.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  if (error) return <Alert type="error" showIcon message="Couldn't load stale VMs" description={error} style={{ margin: 24 }} />;
  if (!data) return <Empty description="No data" style={{ marginTop: 80 }} />;

  const { removed, noNetwork, poweredOff } = data;

  const tabs = [
    {
      key: 'removed',
      label: <span>Removed Since Last Run <Badge count={removed.length} color={removed.length ? 'red' : 'default'} /></span>,
      children: <VMTable vms={removed} emptyText="No VMs were removed since the previous discovery." />,
    },
    {
      key: 'noNetwork',
      label: <span>Powered On, No IP <Badge count={noNetwork.length} color={noNetwork.length ? 'orange' : 'default'} /></span>,
      children: <VMTable vms={noNetwork} emptyText="All powered-on VMs have IP addresses." />,
    },
    {
      key: 'poweredOff',
      label: <span>Powered Off <Badge count={poweredOff.length} color="default" /></span>,
      children: <VMTable vms={poweredOff} emptyText="No powered-off VMs found." />,
    },
  ];

  return (
    <Card size="small" title="Stale &amp; Decommission Candidates">
      <Tabs items={tabs} />
    </Card>
  );
}
