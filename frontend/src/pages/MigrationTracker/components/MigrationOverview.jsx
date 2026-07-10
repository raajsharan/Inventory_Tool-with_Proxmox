import { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Progress, Table, Tag, Spin, Typography, theme } from 'antd';
import {
  CheckCircleOutlined, SyncOutlined, ClockCircleOutlined,
  DatabaseOutlined, ClusterOutlined,
} from '@ant-design/icons';
import api from '../../../api/client';

const { Text, Title } = Typography;

function pct(n, total) {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

export default function MigrationOverview({ projectId }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const { token } = theme.useToken();

  useEffect(() => {
    setLoading(true);
    api.get('/migration/overview', { params: projectId ? { project_id: projectId } : {} })
      .then(r => setData(r.data))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  if (!data)   return null;

  const { hosts, bomgar, security, standalone, totalVMs, migrated, remaining } = data;
  const migrPct = pct(migrated, totalVMs);

  const dcCols = [
    { title: 'Datacenter', dataIndex: 'datacenter', key: 'datacenter', render: v => v || <Text type="secondary">(none)</Text> },
    { title: 'Hosts', dataIndex: 'count', key: 'count', width: 80 },
  ];

  return (
    <div style={{ padding: '0 0 24px' }}>
      <Title level={5} style={{ marginBottom: 16 }}>Overall Migration Progress</Title>

      {/* ── Big progress bar ─────────────────────────────────────────────── */}
      <Card size="small" style={{ marginBottom: 20 }}>
        <Row gutter={24} align="middle">
          <Col flex="auto">
            <Progress
              percent={migrPct}
              strokeColor={{ '0%': '#1677ff', '100%': '#52c41a' }}
              format={() => `${migrated} / ${totalVMs} VMs migrated`}
              strokeWidth={16}
            />
          </Col>
          <Col>
            <Statistic title="Remaining" value={remaining} suffix="VMs"
              valueStyle={{ color: remaining ? token.colorWarning : token.colorSuccess }} />
          </Col>
        </Row>
      </Card>

      {/* ── Hosts summary ────────────────────────────────────────────────── */}
      <Title level={5} style={{ marginBottom: 12 }}>Hosts</Title>
      <Row gutter={12} style={{ marginBottom: 20 }}>
        {[
          { title: 'Total Hosts',         value: hosts.total_hosts,          icon: <DatabaseOutlined />,     color: undefined },
          { title: 'Fully Migrated',       value: hosts.fully_migrated,       icon: <CheckCircleOutlined />,  color: '#52c41a' },
          { title: 'Pending Vacate',       value: hosts.pending_vacate,       icon: <ClockCircleOutlined />,  color: '#fa8c16' },
          { title: 'VMs to Migrate',       value: hosts.total_vms_to_migrate, icon: <ClusterOutlined />,      color: undefined },
        ].map(s => (
          <Col key={s.title} xs={12} sm={6}>
            <Card size="small">
              <Statistic
                title={s.title}
                value={s.value ?? 0}
                prefix={s.icon}
                valueStyle={s.color ? { color: s.color } : {}}
              />
            </Card>
          </Col>
        ))}
      </Row>

      {/* ── VM breakdown by source ───────────────────────────────────────── */}
      <Title level={5} style={{ marginBottom: 12 }}>VMs by Source</Title>
      <Row gutter={12} style={{ marginBottom: 20 }}>
        {[
          { label: 'Bomgar VMs',     d: bomgar },
          { label: 'Security VMs',   d: security },
          { label: 'Standalone ESXi',d: standalone },
        ].map(({ label, d }) => (
          <Col key={label} xs={24} sm={8}>
            <Card size="small" title={label}>
              <Row gutter={8}>
                <Col span={12}>
                  <Statistic title="Total" value={d.total ?? 0} />
                </Col>
                <Col span={12}>
                  <Statistic
                    title="Migrated"
                    value={d.migrated ?? 0}
                    valueStyle={{ color: '#52c41a' }}
                    prefix={<CheckCircleOutlined />}
                  />
                </Col>
              </Row>
              <Progress
                percent={pct(d.migrated, d.total)}
                size="small"
                style={{ marginTop: 8 }}
                strokeColor="#52c41a"
              />
              <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {d.in_progress > 0 && (
                  <Tag color="processing" icon={<SyncOutlined spin />}>{d.in_progress} In Progress</Tag>
                )}
                {d.blocked > 0 && (
                  <Tag color="error">{d.blocked} Blocked</Tag>
                )}
                {d.pending > 0 && (
                  <Tag color="default">{d.pending - (d.blocked || 0)} Pending</Tag>
                )}
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* ── Hosts by datacenter ──────────────────────────────────────────── */}
      {hosts.by_datacenter?.length > 0 && (
        <>
          <Title level={5} style={{ marginBottom: 12 }}>Hosts by Datacenter</Title>
          <Table
            size="small"
            rowKey="datacenter"
            dataSource={hosts.by_datacenter}
            columns={dcCols}
            pagination={false}
            style={{ maxWidth: 400 }}
          />
        </>
      )}
    </div>
  );
}
