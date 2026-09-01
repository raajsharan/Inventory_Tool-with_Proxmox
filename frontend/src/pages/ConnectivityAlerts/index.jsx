import { useEffect, useState } from 'react';
import { Card, Col, Row, Segmented, Typography, Empty, Spin, Tag, Space } from 'antd';
import { AlertOutlined } from '@ant-design/icons';
import { Column, Pie } from '@ant-design/plots';
import api from '../../api/client';

const { Title, Text } = Typography;

// Matches AlertBell.jsx's INTEGRATION_META colors, so a platform reads the
// same everywhere in the app.
const PLATFORM_COLOR = { VMware: '#722ed1', Proxmox: '#2f54eb', 'Hyper-V': '#1677ff' };
const PLATFORM_ORDER = ['VMware', 'Proxmox', 'Hyper-V'];

const RANGE_OPTIONS = [
  { label: '7 days',  value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: 'All time', value: 0 },
];

function fmtDate(iso) {
  return iso ? String(iso).slice(0, 10) : iso;
}

export default function ConnectivityAlerts() {
  const [days, setDays]       = useState(30);
  const [loading, setLoading] = useState(true);
  const [data, setData]       = useState({ byDate: [], byPlatform: [], total: 0 });

  useEffect(() => {
    setLoading(true);
    api.get('/connectivity-alerts/summary', { params: { days } })
      .then(r => setData(r.data))
      .catch(() => setData({ byDate: [], byPlatform: [], total: 0 }))
      .finally(() => setLoading(false));
  }, [days]);

  const dateData = data.byDate.map(r => ({ date: fmtDate(r.date), count: r.count }));
  const platformData = data.byPlatform
    .slice()
    .sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform));
  const platformColors = platformData.map(r => PLATFORM_COLOR[r.platform] || '#999');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            <AlertOutlined style={{ color: '#ff4d4f', marginRight: 8 }} />
            Connectivity Alerts
          </Title>
          <Text type="secondary">
            Ping / SSH connectivity failures raised by the host monitor across VMware, Proxmox, and Hyper-V.
          </Text>
        </div>
        <Segmented options={RANGE_OPTIONS} value={days} onChange={setDays} />
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card
            title="Alerts by Date"
            extra={<Tag>{data.total.toLocaleString()} total</Tag>}
          >
            {loading ? (
              <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
            ) : dateData.length === 0 ? (
              <Empty description="No connectivity alerts in this range" style={{ padding: '40px 0' }} />
            ) : (
              <Column
                data={dateData}
                xField="date"
                yField="count"
                height={340}
                label={{ position: 'top' }}
                color="#ff4d4f"
              />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card title="Alerts by Platform">
            {loading ? (
              <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
            ) : platformData.length === 0 ? (
              <Empty description="No connectivity alerts in this range" style={{ padding: '40px 0' }} />
            ) : (
              <>
                <Pie
                  data={platformData}
                  angleField="count"
                  colorField="platform"
                  color={platformColors}
                  radius={0.85}
                  height={280}
                  label={{ text: 'platform', position: 'outside' }}
                />
                <Space size={8} style={{ marginTop: 12 }} wrap>
                  {platformData.map(r => (
                    <Tag key={r.platform} color={PLATFORM_COLOR[r.platform]}>
                      {r.platform}: {r.count.toLocaleString()}
                    </Tag>
                  ))}
                </Space>
              </>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
