import { useEffect, useState } from 'react';
import { Card, Col, Row, Segmented, Typography, Empty, Spin, Tag, Space, Statistic, Table } from 'antd';
import { AlertOutlined, ClockCircleOutlined, DashboardOutlined } from '@ant-design/icons';
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
  const EMPTY = { byDate: [], byPlatform: [], total: 0, timedOut: { total: 0, byPlatform: [] } };
  const [data, setData]       = useState(EMPTY);

  const UTIL_EMPTY = { current: [], history: { total: 0, byDate: [], byPlatform: [] }, config: { cpu_threshold_pct: 85, memory_threshold_pct: 85, disk_threshold_pct: 85 } };
  const [utilLoading, setUtilLoading] = useState(true);
  const [util, setUtil]               = useState(UTIL_EMPTY);

  useEffect(() => {
    setLoading(true);
    api.get('/connectivity-alerts/summary', { params: { days } })
      .then(r => setData(r.data))
      .catch(() => setData(EMPTY))
      .finally(() => setLoading(false));

    setUtilLoading(true);
    api.get('/host-utilization/summary', { params: { days } })
      .then(r => setUtil(r.data))
      .catch(() => setUtil(UTIL_EMPTY))
      .finally(() => setUtilLoading(false));
  }, [days]);

  const sortByPlatform = (rows) => rows
    .slice()
    .sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform));

  const dateData = data.byDate.map(r => ({ date: fmtDate(r.date), count: r.count }));
  const platformData = sortByPlatform(data.byPlatform);
  const platformColors = platformData.map(r => PLATFORM_COLOR[r.platform] || '#999');
  const timedOutByPlatform = sortByPlatform(data.timedOut.byPlatform);
  const timedOutPct = data.total ? Math.round((data.timedOut.total / data.total) * 100) : 0;

  const utilHistoryByPlatform = sortByPlatform(util.history.byPlatform);

  const UTIL_COLUMNS = [
    {
      title: 'Platform', dataIndex: 'platform', key: 'platform', width: 100,
      render: v => <Tag color={PLATFORM_COLOR[v]}>{v}</Tag>,
    },
    { title: 'Host', dataIndex: 'host', key: 'host', ellipsis: true },
    {
      title: 'CPU', dataIndex: 'cpu_pct', key: 'cpu_pct', width: 90, align: 'right',
      render: v => v == null ? '—' : (
        <Text strong={v >= util.config.cpu_threshold_pct} type={v >= util.config.cpu_threshold_pct ? 'danger' : undefined}>
          {v}%
        </Text>
      ),
    },
    {
      title: 'Memory', dataIndex: 'memory_pct', key: 'memory_pct', width: 90, align: 'right',
      render: v => v == null ? '—' : (
        <Text strong={v >= util.config.memory_threshold_pct} type={v >= util.config.memory_threshold_pct ? 'danger' : undefined}>
          {v}%
        </Text>
      ),
    },
    {
      title: 'Disk', dataIndex: 'disk_pct', key: 'disk_pct', width: 90, align: 'right',
      render: v => v == null ? '—' : (
        <Text strong={v >= util.config.disk_threshold_pct} type={v >= util.config.disk_threshold_pct ? 'danger' : undefined}>
          {v}%
        </Text>
      ),
    },
    { title: 'Assigned User', dataIndex: 'assigned_user', key: 'assigned_user', render: v => v || '—' },
    { title: 'Department', dataIndex: 'department', key: 'department', render: v => v || '—' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            <AlertOutlined style={{ color: '#ff4d4f', marginRight: 8 }} />
            Connectivity Alerts
          </Title>
          <Text type="secondary">
            Connectivity failures across VMware, Proxmox, and Hyper-V — the ping/SSH host monitor, and
            discovery runs that couldn't reach a host's management API at all.
          </Text>
        </div>
        <Segmented options={RANGE_OPTIONS} value={days} onChange={setDays} />
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24}>
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
                height={300}
                label={{ position: 'top' }}
                color="#ff4d4f"
              />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12}>
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
                  height={260}
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

        <Col xs={24} lg={12}>
          <Card title="Timed Out Reaching">
            {loading ? (
              <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
            ) : data.total === 0 ? (
              <Empty description="No connectivity alerts in this range" style={{ padding: '40px 0' }} />
            ) : (
              <>
                <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                  Alerts where the host never responded at all within the check's timeout window
                  (as opposed to actively refusing the connection or rejecting the login).
                </Text>
                <Space size={40} wrap>
                  <Statistic
                    title="Timed out"
                    value={data.timedOut.total}
                    prefix={<ClockCircleOutlined />}
                    valueStyle={{ color: '#fa8c16' }}
                  />
                  <Statistic
                    title="Of all alerts"
                    value={timedOutPct}
                    suffix="%"
                  />
                </Space>
                {timedOutByPlatform.length > 0 && (
                  <Space size={8} style={{ marginTop: 20 }} wrap>
                    {timedOutByPlatform.map(r => (
                      <Tag key={r.platform} color={PLATFORM_COLOR[r.platform]}>
                        {r.platform}: {r.count.toLocaleString()}
                      </Tag>
                    ))}
                  </Space>
                )}
              </>
            )}
          </Card>
        </Col>

        <Col xs={24}>
          <Card
            title="High Utilization"
            extra={<Tag>CPU ≥ {util.config.cpu_threshold_pct}% · Memory ≥ {util.config.memory_threshold_pct}% · Disk ≥ {util.config.disk_threshold_pct}%</Tag>}
          >
            {utilLoading ? (
              <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
            ) : (
              <>
                <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                  Hosts currently over threshold, right now — Assigned User / Department come from Physical &amp; ESXi Servers where a matching IP exists.
                </Text>
                {util.current.length === 0 ? (
                  <Empty
                    image={<DashboardOutlined style={{ fontSize: 32, color: '#52c41a' }} />}
                    description="No hosts currently over threshold"
                    style={{ padding: '24px 0' }}
                  />
                ) : (
                  <Table
                    rowKey={(r, i) => `${r.platform}-${r.host}-${i}`}
                    dataSource={util.current}
                    columns={UTIL_COLUMNS}
                    pagination={false}
                    size="small"
                    scroll={{ x: 'max-content' }}
                  />
                )}
                <Space size={16} style={{ marginTop: 16 }} wrap>
                  <Text type="secondary">
                    {util.history.total.toLocaleString()} high-utilization alert{util.history.total === 1 ? '' : 's'} logged in this range
                  </Text>
                  {utilHistoryByPlatform.map(r => (
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
