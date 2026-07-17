import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert, App, Button, Card, Col, Row, Space, Statistic, Table, Tabs, Tag, Typography,
} from 'antd';
import {
  HeartOutlined, ReloadOutlined, WarningOutlined,
} from '@ant-design/icons';
import api from '../../api/client';

const { Text } = Typography;

const SOURCE_META = {
  assets:                { label: 'MSL Assets',      base: '/assets',         color: 'blue' },
  beijing_assets:        { label: 'Beijing',         base: '/beijing-assets', color: 'purple' },
  ext_assets:            { label: 'Ext. Assets',     base: '/ext-assets',     color: 'cyan' },
  physical_esxi_servers: { label: 'Physical / ESXi', base: '/physical-esxi',  color: 'orange' },
};

const srcTag = (s) => {
  const m = SOURCE_META[s] || SOURCE_META.assets;
  return <Tag color={m.color} style={{ fontSize: 10 }}>{m.label}</Tag>;
};
const recordLink = (r) => {
  const m = SOURCE_META[r.source] || SOURCE_META.assets;
  return <Link className="vm-name-link" to={`${m.base}/${r.id}`}>{r.vm_name || r.ip_address || r.id}</Link>;
};

export default function DataHealth() {
  const { message } = App.useApp();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data: d } = await api.get('/data-health');
      setData(d);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load data health report');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line

  const s = data?.summary || {};
  const gaps = data?.gaps || [];

  const gapTable = (flag, label) => (
    <Table
      size="small" rowKey={(r) => `${r.source}-${r.id}`}
      dataSource={gaps.filter(g => g[flag])}
      pagination={{ pageSize: 20 }}
      columns={[
        { title: 'Record', render: (_, r) => recordLink(r) },
        { title: 'IP Address', dataIndex: 'ip_address',
          render: v => v ? <Text style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{v}</Text> : '—' },
        { title: 'Inventory', dataIndex: 'source', width: 140, render: srcTag },
        { title: 'Missing', width: 220, render: (_, r) => (
          <Space size={4} wrap>
            {r.no_password  && <Tag color="red">password</Tag>}
            {r.no_username  && <Tag color="volcano">username</Tag>}
            {r.no_location  && <Tag color="gold">location</Tag>}
            {r.no_hosted_ip && <Tag color="default">hosted IP</Tag>}
          </Space>
        ) },
      ]}
      locale={{ emptyText: `No records missing ${label}.` }}
    />
  );

  const dupColumns = (keyField, keyTitle) => [
    { title: keyTitle, dataIndex: keyField, width: 220,
      render: v => <Text strong style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{v}</Text> },
    { title: 'Records sharing it', render: (_, row) => (
      <Space size={8} wrap>
        {(row.records || []).map(r => (
          <span key={`${r.source}-${r.id}`}>
            {recordLink({ ...r, vm_name: r.vm_name || r.ip_address })} {srcTag(r.source)}
          </span>
        ))}
      </Space>
    ) },
  ];

  return (
    <div>
      <Space align="start" style={{ marginBottom: 20 }}>
        <HeartOutlined style={{ fontSize: 24, color: '#1677ff', marginTop: 3 }} />
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>Data Health</Typography.Title>
          <Text type="secondary">
            The records behind the weekly report's gap numbers — fix them here, the report improves there.
          </Text>
        </div>
      </Space>

      <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
        {[
          { title: 'Duplicate IPs',    value: s.duplicate_ips,   danger: s.duplicate_ips > 0 },
          { title: 'Duplicate names',  value: s.duplicate_names, danger: s.duplicate_names > 0 },
          { title: 'Missing password', value: s.no_password },
          { title: 'Missing username', value: s.no_username },
          { title: 'Missing location', value: s.no_location },
          { title: 'Missing hosted IP', value: s.no_hosted_ip },
        ].map(c => (
          <Col xs={12} md={8} xl={4} key={c.title}>
            <Card size="small">
              <Statistic title={c.title} value={c.value ?? '—'} loading={loading}
                valueStyle={c.danger ? { color: '#cf1322' } : undefined}
                prefix={c.danger ? <WarningOutlined /> : null} />
            </Card>
          </Col>
        ))}
      </Row>

      {s.duplicate_ips > 0 && (
        <Alert type="warning" showIcon style={{ marginBottom: 16 }}
          message="Duplicate IPs block editing and cause import merges to pick the wrong record — resolve these first." />
      )}

      <Card
        size="small"
        extra={<Button icon={<ReloadOutlined />} size="small" onClick={load} loading={loading}>Refresh</Button>}
      >
        <Tabs
          items={[
            { key: 'dup-ip', label: `Duplicate IPs (${s.duplicate_ips ?? 0})`,
              children: <Table size="small" rowKey="ip_address" loading={loading}
                dataSource={data?.duplicate_ips || []} pagination={{ pageSize: 20 }}
                columns={dupColumns('ip_address', 'IP Address')}
                locale={{ emptyText: 'No duplicate IP addresses across inventories.' }} /> },
            { key: 'dup-name', label: `Duplicate names (${s.duplicate_names ?? 0})`,
              children: <Table size="small" rowKey="vm_name" loading={loading}
                dataSource={data?.duplicate_names || []} pagination={{ pageSize: 20 }}
                columns={dupColumns('vm_name', 'VM Name')}
                locale={{ emptyText: 'No duplicate VM names across inventories.' }} /> },
            { key: 'no-pw',  label: `Missing password (${s.no_password ?? 0})`,  children: gapTable('no_password', 'a password') },
            { key: 'no-user', label: `Missing username (${s.no_username ?? 0})`, children: gapTable('no_username', 'a username') },
            { key: 'no-loc', label: `Missing location (${s.no_location ?? 0})`,  children: gapTable('no_location', 'a location') },
            { key: 'no-hip', label: `Missing hosted IP (${s.no_hosted_ip ?? 0})`, children: gapTable('no_hosted_ip', 'a hosted IP') },
          ]}
        />
      </Card>
    </div>
  );
}
