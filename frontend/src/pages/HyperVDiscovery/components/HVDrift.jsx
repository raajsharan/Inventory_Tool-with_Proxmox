import { useEffect, useState } from 'react';
import { Collapse, Card, Table, Tag, Badge, Spin, Empty, Space, Typography, Alert } from 'antd';
import { PlusCircleOutlined, MinusCircleOutlined, SwapOutlined } from '@ant-design/icons';
import { Column } from '@ant-design/plots';
import api from '../../../api/client';

const { Text } = Typography;

const HISTORY_COLORS = { Added: '#52c41a', Removed: '#ff4d4f', Changed: '#fa8c16' };

function DriftHistoryChart() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/hyperv/drift/history', { params: { days: 7 } })
      .then(r => setHistory(r.data.history || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading || !history.length) return null;

  const chartData = history.flatMap(h => ([
    { date: h.date, type: 'Added',   value: h.added },
    { date: h.date, type: 'Removed', value: h.removed },
    { date: h.date, type: 'Changed', value: h.changed },
  ]));
  const hasAnyChange = history.some(h => h.added || h.removed || h.changed);

  return (
    <Card size="small" title="Change Detection — Last 7 Days" style={{ marginBottom: 16 }}>
      {!hasAnyChange && (
        <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          No changes detected across any host in the last 7 days.
        </Text>
      )}
      <Column
        data={chartData}
        xField="date"
        yField="value"
        colorField="type"
        height={240}
        scale={{ color: { range: Object.values(HISTORY_COLORS) } }}
        legend={{ color: { position: 'top' } }}
        axis={{ y: { title: false }, x: { title: false } }}
      />
    </Card>
  );
}

function stateTag(s) {
  if (s === 'Running') return <Tag color="success">Running</Tag>;
  if (s === 'Stopped') return <Tag color="default">Stopped</Tag>;
  if (s === 'Paused')  return <Tag color="warning">Paused</Tag>;
  if (s === 'Saved')   return <Tag color="processing">Saved</Tag>;
  return <Tag>{s || '—'}</Tag>;
}

const baseCols = [
  { title: 'Name',  dataIndex: 'name',        key: 'name',
    render: v => <span style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{v}</span> },
  { title: 'State', dataIndex: 'state',        key: 'state',  width: 100, render: stateTag },
  { title: 'IPs',   dataIndex: 'ips',          key: 'ips',
    render: v => Array.isArray(v) ? v.join(', ') || '—' : '—' },
  { title: 'OS',    dataIndex: 'os_type',      key: 'os',     ellipsis: true, render: v => v || '—' },
  { title: 'Host',  dataIndex: 'source_host',  key: 'host',   ellipsis: true },
];

const changedCols = [
  ...baseCols,
  { title: 'Previous State', key: 'prev_state', width: 130,
    render: (_, r) => r.prev_state ? stateTag(r.prev_state) : '—' },
  { title: 'Previous IPs', key: 'prev_ips',
    render: (_, r) => Array.isArray(r.prev_ips) ? r.prev_ips.join(', ') || '—' : '—' },
];

function DriftSection({ title, icon, color, data, columns, emptyText }) {
  if (!data.length) return (
    <div style={{ padding: '12px 0', color: '#999' }}>{emptyText}</div>
  );
  return (
    <Card
      size="small"
      title={<Space>{icon}<Text>{title}</Text><Badge count={data.length} color={color} /></Space>}
      style={{ marginBottom: 12 }}
    >
      <Table size="small" rowKey="id" dataSource={data} columns={columns} pagination={false} scroll={{ x: 'max-content' }} sticky={{ offsetScroll: 0 }} />
    </Card>
  );
}

export default function HVDrift() {
  const [data,    setData]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    api.get('/hyperv/drift/activity', { params: { days: 7 } })
      .then(r => setData(r.data.activity || []))
      .catch(e => setError(e?.response?.data?.error || e.message || 'Failed to load change detection.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  if (error) return <Alert type="error" showIcon message="Couldn't load change detection" description={error} style={{ margin: 24 }} />;
  if (!data.length) return (
    <div>
      <DriftHistoryChart />
      <Empty description="No changes detected in the last 7 days. At least two successful discoveries per host are required." style={{ marginTop: 40 }} />
    </div>
  );

  const panels = data.map((d, i) => ({
    key:   String(i),
    label: (
      <Space>
        <Text strong>{d.host}</Text>
        <Badge count={d.summary.added}   color="green"  title="Added" />
        <Badge count={d.summary.removed} color="red"    title="Removed" />
        <Badge count={d.summary.changed} color="orange" title="Changed" />
        <Text type="secondary" style={{ fontSize: 12 }}>
          as of {new Date(d.current_at).toLocaleString()}
        </Text>
      </Space>
    ),
    children: (
      <div style={{ padding: '8px 0' }}>
        <DriftSection
          title="Added" icon={<PlusCircleOutlined style={{ color: '#52c41a' }} />}
          color="green" data={d.added} columns={baseCols}
          emptyText="No new VMs in this run."
        />
        <DriftSection
          title="Removed" icon={<MinusCircleOutlined style={{ color: '#ff4d4f' }} />}
          color="red" data={d.removed} columns={baseCols}
          emptyText="No VMs were removed."
        />
        <DriftSection
          title="Changed (state or IPs)" icon={<SwapOutlined style={{ color: '#fa8c16' }} />}
          color="orange" data={d.changed} columns={changedCols}
          emptyText="No changes detected."
        />
      </div>
    ),
  }));

  return (
    <div style={{ padding: 16 }}>
      <DriftHistoryChart />
      <Collapse items={panels} defaultActiveKey={[]} />
    </div>
  );
}
