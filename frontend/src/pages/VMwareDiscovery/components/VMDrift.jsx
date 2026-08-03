import { useEffect, useState } from 'react';
import { Card, Table, Tag, Collapse, Typography, Spin, Empty, Space, Badge } from 'antd';
import { PlusOutlined, MinusOutlined, SwapOutlined } from '@ant-design/icons';
import api from '../../../api/client';

const { Text } = Typography;

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

  useEffect(() => {
    api.get('/vmware/drift')
      .then(r => setDrift(r.data.drift || []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} />;

  const noDrift = drift.every(d => !d.summary.added && !d.summary.removed && !d.summary.changed);

  if (!drift.length || noDrift) {
    return <Empty description="No changes detected. At least two successful discoveries per host are required." style={{ marginTop: 80 }} />;
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

  return <Collapse items={items} defaultActiveKey={[]} />;
}
