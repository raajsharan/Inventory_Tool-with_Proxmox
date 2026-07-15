import { useEffect, useState } from 'react';
import { Table, Tag, Spin, Empty, Card, Tooltip } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import api from '../../../api/client';

function ageWarning(oldest) {
  if (!oldest || oldest === '—') return null;
  const d = new Date(oldest);
  if (isNaN(d)) return null;
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  return days >= 7
    ? <Tooltip title={`${days} days old`}><WarningOutlined style={{ color: '#faad14', marginLeft: 4 }} /></Tooltip>
    : null;
}

function stateTag(s) {
  if (s === 'Running') return <Tag color="success">Running</Tag>;
  if (s === 'Stopped') return <Tag color="default">Stopped</Tag>;
  if (s === 'Paused')  return <Tag color="warning">Paused</Tag>;
  return <Tag>{s || '—'}</Tag>;
}

const columns = [
  { title: 'Name',      dataIndex: 'name',           key: 'name',  ellipsis: true },
  { title: 'State',     dataIndex: 'state',           key: 'state', width: 100, render: stateTag },
  { title: 'Snapshots', dataIndex: 'snapshot_count',  key: 'count', width: 110,
    sorter: (a, b) => b.snapshot_count - a.snapshot_count },
  { title: 'Oldest',    dataIndex: 'oldest_snapshot', key: 'oldest', ellipsis: true,
    render: v => <span>{v || '—'}{ageWarning(v)}</span> },
  { title: 'Host',      dataIndex: 'source_host',     key: 'host',  ellipsis: true },
];

export default function HVSnapshots() {
  const [data,    setData]    = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/hyperv/snapshots').then(r => setData(r.data)).finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} />;

  return (
    <div style={{ padding: 16 }}>
      <Card size="small" title={`VMs with Snapshots (${data.length})`}>
        {data.length === 0
          ? <Empty description="No snapshots found." style={{ margin: '40px 0' }} />
          : (
            <Table
              size="small"
              rowKey="id"
              dataSource={data}
              columns={columns}
              pagination={{ pageSize: 50, showTotal: t => `${t} total` }}
            />
          )
        }
      </Card>
    </div>
  );
}
