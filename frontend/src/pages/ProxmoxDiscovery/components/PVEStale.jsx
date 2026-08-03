import { useEffect, useState } from 'react';
import { Tabs, Table, Tag, Spin, Empty, Card, Badge } from 'antd';
import api from '../../../api/client';

function typeTag(t) {
  return t === 'lxc' ? <Tag color="blue">LXC</Tag> : <Tag color="purple">QEMU</Tag>;
}

function statusTag(s) {
  if (s === 'running') return <Tag color="success">Running</Tag>;
  if (s === 'stopped') return <Tag color="default">Stopped</Tag>;
  return <Tag>{s || '—'}</Tag>;
}

const baseCols = [
  { title: 'VMID',    dataIndex: 'vmid',        key: 'vmid',    width: 80 },
  { title: 'Name',    dataIndex: 'name',         key: 'name',    ellipsis: true },
  { title: 'Type',    dataIndex: 'vm_type',      key: 'type',    width: 90,  render: typeTag },
  { title: 'Node',    dataIndex: 'node',         key: 'node',    ellipsis: true },
  { title: 'Status',  dataIndex: 'status',       key: 'status',  width: 100, render: statusTag },
  {
    title: 'IPs', dataIndex: 'ips', key: 'ips',
    render: v => Array.isArray(v) ? v.filter(i => i !== 'Not Available').join(', ') || '—' : '—',
  },
  { title: 'Source Host', dataIndex: 'source_host', key: 'source_host', ellipsis: true },
];

function PVETable({ vms, emptyText }) {
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

export default function PVEStale() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/proxmox/stale').then(r => setData(r.data)).finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  if (!data)   return <Empty description="No data" style={{ marginTop: 80 }} />;

  const { removed, noNetwork, stopped } = data;

  const tabs = [
    {
      key: 'removed',
      label: (
        <span>
          Removed Since Last Run{' '}
          <Badge count={removed.length} color={removed.length ? 'red' : 'default'} />
        </span>
      ),
      children: <PVETable vms={removed} emptyText="No VMs/containers were removed since the previous run." />,
    },
    {
      key: 'noNetwork',
      label: (
        <span>
          Running, No IP{' '}
          <Badge count={noNetwork.length} color={noNetwork.length ? 'orange' : 'default'} />
        </span>
      ),
      children: <PVETable vms={noNetwork} emptyText="All running guests have IP addresses." />,
    },
    {
      key: 'stopped',
      label: (
        <span>
          Stopped <Badge count={stopped.length} color="default" />
        </span>
      ),
      children: <PVETable vms={stopped} emptyText="No stopped VMs/containers found." />,
    },
  ];

  return (
    <Card size="small" title="Stale &amp; Decommission Candidates" style={{ margin: 16 }}>
      <Tabs items={tabs} />
    </Card>
  );
}
