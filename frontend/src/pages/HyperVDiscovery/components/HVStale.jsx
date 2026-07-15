import { useEffect, useState } from 'react';
import { Tabs, Table, Tag, Spin, Empty, Card, Badge } from 'antd';
import api from '../../../api/client';

function stateTag(s) {
  if (s === 'Running') return <Tag color="success">Running</Tag>;
  if (s === 'Stopped') return <Tag color="default">Stopped</Tag>;
  if (s === 'Paused')  return <Tag color="warning">Paused</Tag>;
  if (s === 'Saved')   return <Tag color="processing">Saved</Tag>;
  return <Tag>{s || '—'}</Tag>;
}

const baseCols = [
  { title: 'Name',   dataIndex: 'name',        key: 'name',   ellipsis: true },
  { title: 'State',  dataIndex: 'state',        key: 'state',  width: 100, render: stateTag },
  { title: 'IPs',    dataIndex: 'ips',          key: 'ips',
    render: v => Array.isArray(v) ? v.join(', ') || '—' : '—' },
  { title: 'OS',     dataIndex: 'os_type',      key: 'os',     ellipsis: true, render: v => v || '—' },
  { title: 'Host',   dataIndex: 'source_host',  key: 'host',   ellipsis: true },
];

function HVTable({ vms, emptyText }) {
  if (!vms.length) return <Empty description={emptyText} style={{ margin: '40px 0' }} />;
  return (
    <Table
      size="small"
      rowKey="id"
      dataSource={vms}
      columns={baseCols}
      pagination={{ pageSize: 50, showTotal: t => `${t} total` }}
    />
  );
}

export default function HVStale() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/hyperv/stale').then(r => setData(r.data)).finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  if (!data)   return <Empty description="No data" style={{ marginTop: 80 }} />;

  const { removed, noNetwork, stopped, saved } = data;

  const tabs = [
    {
      key: 'removed',
      label: (
        <span>
          Removed Since Last Run{' '}
          <Badge count={removed.length} color={removed.length ? 'red' : 'default'} />
        </span>
      ),
      children: <HVTable vms={removed} emptyText="No VMs were removed since the previous run." />,
    },
    {
      key: 'noNetwork',
      label: (
        <span>
          Running, No IP{' '}
          <Badge count={noNetwork.length} color={noNetwork.length ? 'orange' : 'default'} />
        </span>
      ),
      children: <HVTable vms={noNetwork} emptyText="All running VMs have IP addresses." />,
    },
    {
      key: 'stopped',
      label: (
        <span>
          Stopped <Badge count={stopped.length} color="default" />
        </span>
      ),
      children: <HVTable vms={stopped} emptyText="No stopped VMs found." />,
    },
    {
      key: 'saved',
      label: (
        <span>
          Saved State <Badge count={saved.length} color={saved.length ? 'blue' : 'default'} />
        </span>
      ),
      children: <HVTable vms={saved} emptyText="No VMs in saved state." />,
    },
  ];

  return (
    <Card size="small" title="Stale &amp; Decommission Candidates" style={{ margin: 16 }}>
      <Tabs items={tabs} />
    </Card>
  );
}
