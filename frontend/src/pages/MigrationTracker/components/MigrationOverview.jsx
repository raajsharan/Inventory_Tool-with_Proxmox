import { useCallback, useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Progress, Table, Tag, Spin, Typography, theme, Popover, List, Button, Tooltip } from 'antd';
import {
  CheckCircleOutlined, SyncOutlined, ClockCircleOutlined,
  DatabaseOutlined, ClusterOutlined, StopOutlined, DeleteOutlined, ReloadOutlined,
} from '@ant-design/icons';
import api from '../../../api/client';

const { Text, Title } = Typography;

function pct(n, total) {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

export default function MigrationOverview({ projectId }) {
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { token } = theme.useToken();

  const load = useCallback((isRefresh) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    return api.get('/migration/overview', { params: projectId ? { project_id: projectId } : {} })
      .then(r => setData(r.data))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, [projectId]);

  useEffect(() => { load(false); }, [load]);

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={5} style={{ margin: 0 }}>Overall Migration Progress</Title>
        <Tooltip title="Reload the latest migration counts">
          <Button icon={<ReloadOutlined />} loading={refreshing} onClick={() => load(true)}>
            Refresh
          </Button>
        </Tooltip>
      </div>

      {/* ── Big progress bar ─────────────────────────────────────────────── */}
      <Card size="small" className="migration-card" style={{ marginBottom: 20 }}>
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
          { title: 'VMs to Migrate',       value: totalVMs,                   icon: <ClusterOutlined />,      color: undefined },
        ].map((s, si) => (
          <Col key={s.title} xs={12} sm={6}>
            <Card size="small" className="migration-card" style={{ animationDelay: `${si * 50}ms` }}>
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
        ].map(({ label, d }, li) => (
          <Col key={label} xs={24} sm={8}>
            <Card size="small" className="migration-card" style={{ animationDelay: `${li * 60}ms` }} title={label}>
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
                percent={pct((d.migrated ?? 0) + (d.cleaned_up ?? 0), d.total)}
                size="small"
                style={{ marginTop: 8 }}
                strokeColor="#52c41a"
                format={(percent) => <span style={{ fontSize: 24 }}>{percent}%</span>}
              />
              <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {d.not_started > 0 && (
                  <Tag color="default" icon={<ClockCircleOutlined />}>{d.not_started} Not Started</Tag>
                )}
                {d.awaiting_confirmation > 0 && (
                  <Tag color="warning" icon={<ClockCircleOutlined />}>{d.awaiting_confirmation} Awaiting</Tag>
                )}
                {d.in_progress > 0 && (
                  <Popover
                    title={<span><SyncOutlined spin style={{ color: '#1677ff', marginRight: 6 }} />In Progress VMs</span>}
                    content={
                      <List
                        size="small"
                        dataSource={d.in_progress_vms || []}
                        style={{ maxHeight: 260, overflowY: 'auto', minWidth: 200, maxWidth: 320 }}
                        renderItem={vm => (
                          <List.Item style={{ padding: '3px 0', fontSize: 12 }}>
                            <Text ellipsis style={{ maxWidth: 300 }}>{vm}</Text>
                          </List.Item>
                        )}
                      />
                    }
                    trigger="hover"
                    placement="bottomLeft"
                    getPopupContainer={() => document.body}
                  >
                    <Tag color="processing" icon={<SyncOutlined spin />} style={{ cursor: 'pointer' }}>
                      {d.in_progress} In Progress
                    </Tag>
                  </Popover>
                )}
                {d.cleaned_up > 0 && (
                  <Tag color="cyan" icon={<CheckCircleOutlined />}>{d.cleaned_up} Cleaned up</Tag>
                )}
                {d.to_be_deleted > 0 && (
                  <Tag color="orange" icon={<DeleteOutlined />}>{d.to_be_deleted} To be Deleted</Tag>
                )}
                {d.blocked > 0 && (
                  <Tag color="error" icon={<StopOutlined />}>{d.blocked} Blocked</Tag>
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
