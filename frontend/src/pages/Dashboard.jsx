import { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Table, Tag, Spin, Alert, Typography } from 'antd';
import { DatabaseOutlined, WarningOutlined, SafetyOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { Pie, Column } from '@ant-design/plots';
import api from '../api/client';
import { useAppTheme } from '../context/ThemeContext.jsx';

export default function Dashboard() {
  const { mode } = useAppTheme() || { mode: 'light' };
  const isDark = mode === 'dark';
  const axisColor = isDark ? '#d9d9d9' : '#595959';
  const labelColor = isDark ? '#f0f0f0' : '#262626';
  const chartTheme = isDark ? 'classicDark' : 'classic';
  const labelStyle = { fill: labelColor, fontWeight: 500 };
  const axisStyle = {
    label: { style: { fill: axisColor } },
    title: { style: { fill: axisColor } },
    line: { style: { stroke: isDark ? '#434343' : '#d9d9d9' } },
    tickLine: { style: { stroke: isDark ? '#434343' : '#d9d9d9' } },
  };
  const legendStyle = { itemName: { style: { fill: labelColor } } };

  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/dashboard/summary').then(r => setData(r.data)).catch(e => setErr(e.response?.data?.error || 'Failed'));
  }, []);

  if (err) return <Alert type="error" message={err} />;
  if (!data) return <Spin />;

  const eolCount = (data.byEolStatus || []).filter(x => x.key === 'EOL').reduce((s, x) => s + x.value, 0);

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>Infrastructure Overview</Typography.Title>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card className="card-stat"><Statistic title="Total Assets" value={data.total} prefix={<DatabaseOutlined />} /></Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="card-stat"><Statistic title="EOL Assets" value={eolCount} valueStyle={{ color: '#cf1322' }} prefix={<WarningOutlined />} /></Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="card-stat"><Statistic title="Missing Security Tools" value={data.missingSecurityTools} valueStyle={{ color: '#d48806' }} prefix={<SafetyOutlined />} /></Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="card-stat"><Statistic title="Locations" value={(data.byLocation || []).length} prefix={<ClockCircleOutlined />} /></Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title="Assets by OS Type">
            <Pie data={data.byOsType} angleField="value" colorField="key" radius={0.85}
              theme={chartTheme}
              label={{ text: 'value', position: 'outside', style: labelStyle }}
              legend={{ position: 'bottom', ...legendStyle }}
              height={260} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Assets by Server Status">
            <Column data={data.byServerStatus} xField="key" yField="value" height={260}
              theme={chartTheme}
              axis={{ x: axisStyle, y: axisStyle }}
              label={{ position: 'top', style: labelStyle }} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Assets by Location">
            <Column data={data.byLocation} xField="key" yField="value" height={260}
              theme={chartTheme}
              axis={{ x: axisStyle, y: axisStyle }}
              label={{ position: 'top', style: labelStyle }} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="EOL Status">
            <Pie data={data.byEolStatus} angleField="value" colorField="key" radius={0.85}
              theme={chartTheme}
              label={{ text: 'value', position: 'outside', style: labelStyle }}
              legend={{ position: 'bottom', ...legendStyle }}
              height={260} />
          </Card>
        </Col>
      </Row>

      <Card title="Recent Assets" style={{ marginTop: 16 }}>
        <Table
          rowKey="id"
          dataSource={data.recentAssets}
          pagination={false}
          size="small"
          columns={[
            { title: 'VM Name', dataIndex: 'vm_name' },
            { title: 'IP', dataIndex: 'ip_address' },
            { title: 'OS', dataIndex: 'os_type' },
            { title: 'Status', dataIndex: 'server_status', render: v => v && <Tag color={v === 'Active' ? 'green' : 'orange'}>{v}</Tag> },
            { title: 'Location', dataIndex: 'location' },
            { title: 'Created', dataIndex: 'created_at', render: v => new Date(v).toLocaleString() },
          ]}
        />
      </Card>
    </div>
  );
}
