import { useEffect, useState } from 'react';
import { Table, Tag, Spin, Empty, Card, Tooltip, Alert } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import api from '../../../api/client';

const STALE_DAYS = 7;

function ageDays(oldest) {
  if (!oldest) return null;
  const m = oldest.match(/(\d{4}-\d{2}-\d{2})/);
  if (!m) return null;
  return Math.floor((Date.now() - new Date(m[1]).getTime()) / 86400000);
}

export default function VMSnapshots() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    api.get('/vmware/snapshots')
      .then(r => setRows(r.data.snapshots || []))
      .catch(e => setError(e?.response?.data?.error || e.message || 'Failed to load snapshots.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  if (error) return <Alert type="error" showIcon message="Couldn't load snapshots" description={error} style={{ margin: 24 }} />;
  if (!rows.length) return <Empty description="No VMs with snapshots found." style={{ marginTop: 80 }} />;

  const columns = [
    { title: 'VM Name', dataIndex: 'name', key: 'name', ellipsis: true },
    { title: 'vCenter / ESXi', dataIndex: 'source_host', key: 'source_host', ellipsis: true },
    { title: 'ESXi Host', dataIndex: 'esxi_host', key: 'esxi_host', ellipsis: true },
    {
      title: 'Power', dataIndex: 'power_state', key: 'power_state',
      render: v => v === 'poweredOn' ? <Tag color="success">On</Tag> : <Tag color="default">Off</Tag>,
    },
    {
      title: 'Snapshots', dataIndex: 'count', key: 'count',
      sorter: (a, b) => b.count - a.count,
      render: v => <Tag color={v > 3 ? 'red' : 'orange'}>{v}</Tag>,
    },
    {
      title: 'Oldest Snapshot', dataIndex: 'oldest', key: 'oldest',
      render: (v) => {
        const days = ageDays(v);
        if (days === null) return v || '—';
        const stale = days >= STALE_DAYS;
        return (
          <span>
            {stale && <Tooltip title={`${days} days old`}><WarningOutlined style={{ color: '#faad14', marginRight: 4 }} /></Tooltip>}
            {v}
            {days !== null && <Tag color={stale ? 'orange' : 'default'} style={{ marginLeft: 6 }}>{days}d</Tag>}
          </span>
        );
      },
    },
  ];

  return (
    <Card size="small" title={`${rows.length} VMs with Snapshots`}>
      <Table
        size="small"
        rowKey="name"
        dataSource={rows}
        columns={columns}
        scroll={{ x: 'max-content' }}
        sticky={{ offsetScroll: 0 }}
        pagination={{ pageSize: 50, showTotal: t => `${t} total` }}
      />
    </Card>
  );
}
