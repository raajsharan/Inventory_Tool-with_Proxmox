import { useEffect, useState } from 'react';
import { Card, Table, Tag, Collapse, Typography, Spin, Empty, Space, Badge, Alert } from 'antd';
import { PlusOutlined, MinusOutlined, SwapOutlined } from '@ant-design/icons';
import { Column } from '@ant-design/plots';
import api from '../../../api/client';

const { Text } = Typography;

const HISTORY_COLORS = { Added: '#52c41a', Removed: '#ff4d4f', Changed: '#fa8c16' };

function DriftHistoryChart() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/vmware/drift/history', { params: { days: 7 } })
      .then(r => setHistory(r.data.history || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (!history.length) return null;

  const chartData = history.flatMap(h => ([
    { date: h.date, type: 'Added',   value: h.added },
    { date: h.date, type: 'Removed', value: h.removed },
    { date: h.date, type: 'Changed', value: h.changed },
  ]));
  const hasAnyChange = history.some(h => h.added || h.removed || h.changed);

  return (
    <Card
      size="small"
      title="Change Detection — Last 7 Days"
      style={{ marginBottom: 16 }}
    >
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

function powerTag(state) {
  if (state === 'poweredOn')  return <Tag color="success">On</Tag>;
  if (state === 'poweredOff') return <Tag color="default">Off</Tag>;
  return <Tag>{state || '—'}</Tag>;
}

const addedCols = [
  { title: 'VM Name', dataIndex: 'name', key: 'name' },
  { title: 'IPs', dataIndex: 'ips', key: 'ips', render: v => (v || []).filter(i => i !== 'Not Available').join(', ') || '—' },
  { title: 'Power', dataIndex: 'power_state', key: 'power_state', render: powerTag },
  { title: 'ESXi Host', dataIndex: 'esxi_host_name', key: 'esxi_host_name' },
];

const changedCols = [
  { title: 'VM Name', dataIndex: 'name', key: 'name' },
  {
    title: 'Power', key: 'power',
    render: (_, r) => (
      <Space>
        {powerTag(r.prev_power_state)} <SwapOutlined /> {powerTag(r.power_state)}
      </Space>
    ),
  },
  {
    title: 'IPs', key: 'ips',
    render: (_, r) => {
      const prev = (r.prev_ips || []).filter(i => i !== 'Not Available').join(', ') || '—';
      const curr = (r.ips  || []).filter(i => i !== 'Not Available').join(', ') || '—';
      if (prev === curr) return <Text type="secondary">{curr}</Text>;
      return <Space><Text delete type="danger">{prev}</Text><Text type="success">{curr}</Text></Space>;
    },
  },
];

export default function VMDrift() {
  const [drift, setDrift] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/vmware/drift')
      .then(r => setDrift(r.data.drift || []))
      .catch(e => setError(e?.response?.data?.error || e.message || 'Failed to load change detection.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  if (error) return <Alert type="error" showIcon message="Couldn't load change detection" description={error} style={{ margin: 24 }} />;

  const noDrift = drift.every(d => !d.summary.added && !d.summary.removed && !d.summary.changed);

  if (!drift.length || noDrift) {
    return (
      <div>
        <DriftHistoryChart />
        <Empty description="No changes detected. At least two successful discoveries per host are required." style={{ marginTop: 40 }} />
      </div>
    );
  }

  const items = drift
    .filter(d => d.summary.added || d.summary.removed || d.summary.changed)
    .map((d, i) => ({
      key: String(i),
      label: (
        <Space>
          <Text strong>{d.host}</Text>
          {d.summary.added   > 0 && <Badge count={`+${d.summary.added}`}   color="green" />}
          {d.summary.removed > 0 && <Badge count={`-${d.summary.removed}`} color="red" />}
          {d.summary.changed > 0 && <Badge count={`~${d.summary.changed}`} color="orange" />}
        </Space>
      ),
      children: (
        <Space direction="vertical" style={{ width: '100%' }}>
          {d.added.length > 0 && (
            <Card
              size="small"
              title={<Space><PlusOutlined style={{ color: '#52c41a' }} /><Text>Added ({d.added.length})</Text></Space>}
            >
              <Table size="small" rowKey="id" dataSource={d.added} columns={addedCols} pagination={false} scroll={{ x: 'max-content' }} />
            </Card>
          )}
          {d.removed.length > 0 && (
            <Card
              size="small"
              title={<Space><MinusOutlined style={{ color: '#ff4d4f' }} /><Text>Removed ({d.removed.length})</Text></Space>}
            >
              <Table size="small" rowKey="id" dataSource={d.removed} columns={addedCols} pagination={false} scroll={{ x: 'max-content' }} />
            </Card>
          )}
          {d.changed.length > 0 && (
            <Card
              size="small"
              title={<Space><SwapOutlined style={{ color: '#fa8c16' }} /><Text>Changed ({d.changed.length})</Text></Space>}
            >
              <Table size="small" rowKey="id" dataSource={d.changed} columns={changedCols} pagination={false} scroll={{ x: 'max-content' }} />
            </Card>
          )}
        </Space>
      ),
    }));

  return (
    <div>
      <DriftHistoryChart />
      <Collapse items={items} defaultActiveKey={[]} />
    </div>
  );
}
