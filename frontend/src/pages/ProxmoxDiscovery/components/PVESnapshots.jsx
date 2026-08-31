import { useEffect, useState } from 'react';
import { Table, Tag, Spin, Empty, Card, Tooltip, Alert } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import api from '../../../api/client';

function ageWarning(oldest) {
  if (!oldest || oldest === '—') return null;
  const d = new Date(oldest);
  if (isNaN(d)) return null;
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  return days >= 7 ? <Tooltip title={`${days} days old`}><WarningOutlined style={{ color: '#faad14', marginLeft: 4 }} /></Tooltip> : null;
}

const columns = [
  { title: 'VMID',    dataIndex: 'vmid',        key: 'vmid',     width: 80 },
  { title: 'Name',    dataIndex: 'name',         key: 'name',
    render: v => <span style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{v}</span> },
  {
    title: 'Type', dataIndex: 'vm_type', key: 'vm_type', width: 90,
    render: t => t === 'lxc' ? <Tag color="blue">LXC</Tag> : <Tag color="purple">QEMU</Tag>,
  },
  { title: 'Node',    dataIndex: 'node',         key: 'node',     ellipsis: true },
  {
    title: 'Status', dataIndex: 'status', key: 'status', width: 100,
    render: s => s === 'running' ? <Tag color="success">Running</Tag> : <Tag color="default">{s}</Tag>,
  },
  { title: 'Snapshots', dataIndex: 'count',  key: 'count',  width: 110, sorter: (a, b) => b.count - a.count },
  {
    title: 'Oldest', dataIndex: 'oldest', key: 'oldest', ellipsis: true,
    render: v => <span>{v}{ageWarning(v)}</span>,
  },
  { title: 'Source Host', dataIndex: 'source_host', key: 'source_host', ellipsis: true },
];

export default function PVESnapshots() {
  const [data,    setData]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    api.get('/proxmox/snapshots')
      .then(r => setData(r.data))
      .catch(e => setError(e?.response?.data?.error || e.message || 'Failed to load snapshots.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  if (error) return <Alert type="error" showIcon message="Couldn't load snapshots" description={error} style={{ margin: 24 }} />;

  return (
    <div style={{ padding: 16 }}>
      <Card size="small" title={`VMs / Containers with Snapshots (${data.length})`}>
        {data.length === 0
          ? <Empty description="No snapshots found." style={{ margin: '40px 0' }} />
          : (
            <Table
              size="small"
              rowKey={r => `${r.source_host}-${r.vmid}`}
              dataSource={data}
              columns={columns}
              scroll={{ x: 'max-content' }}
              sticky={{ offsetScroll: 0 }}
              pagination={{ pageSize: 50, showTotal: t => `${t} total` }}
            />
          )
        }
      </Card>
    </div>
  );
}
