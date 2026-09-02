import { useEffect, useState } from 'react';
import { Card, Col, Row, Segmented, Typography, Empty, Spin, Tag, Table, Progress, Avatar } from 'antd';
import {
  AlertOutlined, ClockCircleOutlined, DashboardOutlined, ArrowUpOutlined, ArrowDownOutlined,
} from '@ant-design/icons';
import { Column, Tiny } from '@ant-design/plots';
import api from '../../api/client';
import { DASH_CSS } from '../../components/DashboardStatCard.jsx';
import UtilizationThresholds from '../../components/UtilizationThresholds.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useAppTheme } from '../../context/ThemeContext.jsx';

const { Title, Text } = Typography;

// Matches AlertBell.jsx's INTEGRATION_META colors, so a platform reads the
// same everywhere in the app.
const PLATFORM_COLOR = { VMware: '#722ed1', Proxmox: '#2f54eb', 'Hyper-V': '#1677ff' };
const PLATFORMS = ['VMware', 'Proxmox', 'Hyper-V'];
const DISCOVERY_COLOR = '#fa8c16';
const UTIL_COLOR = '#f5222d';

const RANGE_OPTIONS = [
  { label: '7 days',  value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: 'All time', value: 0 },
];

function fmtDate(iso) {
  return iso ? String(iso).slice(0, 10) : iso;
}

// discovery-sourced alerts mean a poll couldn't reach the host's management
// API at all — ssh_ok is never true here (an alert only gets logged when the
// combined check decided "unreachable"), so it's always false or null
// (not applicable / no stored credentials to try).
function alertTypeLabel(r) {
  if (r.source === 'discovery') return 'Discovery Unreachable';
  return r.ssh_ok === false ? 'Ping + SSH Down' : 'Ping Failed';
}

function alertDetail(r, intervals) {
  if (r.source !== 'ping_monitor') return 'Failed while a discovery poll tried to reach this host’s management API.';
  const interval = intervals?.[r.platform] ?? 5;
  const downMins = interval * (r.fail_count || 1);
  const n = r.fail_count || 1;
  return `Checked every ${interval} min — failing ${n} consecutive check${n === 1 ? '' : 's'} (~${downMins} min down)`;
}

// null previousTotal (all-time range has no "previous period") -> no badge.
function pctChange(cur, prev) {
  if (prev === null || prev === undefined) return null;
  if (prev === 0) return cur > 0 ? 100 : 0;
  return Math.round(((cur - prev) / prev) * 100);
}

// More alerts than the prior period is the bad direction here (unlike a
// revenue dashboard), so the color/arrow semantics are intentionally
// inverted: up = red, down = green.
function ChangeBadge({ pct }) {
  if (pct === null) return <Tag>no prior period</Tag>;
  if (pct === 0) return <Tag>flat</Tag>;
  const up = pct > 0;
  return (
    <Tag color={up ? 'error' : 'success'}>
      {up ? <ArrowUpOutlined style={{ fontSize: 10 }} /> : <ArrowDownOutlined style={{ fontSize: 10 }} />} {Math.abs(pct)}%
    </Tag>
  );
}

function SparkCard({ title, color, total, previousTotal, byDate, index }) {
  const series = (byDate || []).map(d => d.count);
  const pct = pctChange(total, previousTotal);
  return (
    <Card size="small" className="dashcard" style={{ animationDelay: `${index * 60}ms` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</Text>
          <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.3, color }}>{(total ?? 0).toLocaleString()}</div>
        </div>
        <ChangeBadge pct={pct} />
      </div>
      <div style={{ marginTop: 8, height: 46 }}>
        {series.some(v => v > 0) ? (
          <Tiny.Area data={series} height={46} smooth autoFit color={color} />
        ) : (
          <div style={{ height: 46, borderRadius: 4, background: 'rgba(140,140,140,0.08)' }} />
        )}
      </div>
    </Card>
  );
}

function GaugeCard({ title, color, count, percent, sub1Label, sub1Value, sub2Label, sub2Value, index }) {
  return (
    <Card size="small" className="dashcard" style={{ animationDelay: `${index * 60}ms`, textAlign: 'center' }}>
      <Text strong>{title}</Text>
      <div style={{ margin: '12px 0' }}>
        <Progress
          type="circle"
          percent={percent}
          size={92}
          strokeColor={color}
          format={() => <span style={{ fontSize: 22, fontWeight: 700 }}>{(count ?? 0).toLocaleString()}</span>}
        />
      </div>
      <Row>
        <Col span={12} style={{ borderRight: '1px solid rgba(140,140,140,0.18)' }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{(sub1Value ?? 0).toLocaleString()}</div>
          <Text type="secondary" style={{ fontSize: 11 }}>{sub1Label}</Text>
        </Col>
        <Col span={12}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{(sub2Value ?? 0).toLocaleString()}</div>
          <Text type="secondary" style={{ fontSize: 11 }}>{sub2Label}</Text>
        </Col>
      </Row>
    </Card>
  );
}

function PlatformAvatar({ platform }) {
  return (
    <Avatar size={22} style={{ backgroundColor: PLATFORM_COLOR[platform] || '#999', fontSize: 11, marginRight: 8 }}>
      {platform?.[0]}
    </Avatar>
  );
}

const EMPTY = {
  total: 0, byDate: [], previousByDate: [], hasPreviousPeriod: true,
  platforms: { VMware: {}, Proxmox: {}, 'Hyper-V': {} },
  discovery: { total: 0, previousTotal: 0, byDate: [] },
};

export default function ConnectivityAlerts() {
  const { user } = useAuth();
  const isAdmin = ['admin', 'superadmin'].includes(user?.role);

  // @ant-design/plots defaults to dark text on a light background — on this
  // app's dark theme that renders axis/legend/label text nearly invisible
  // (as seen on the Alert Trend chart). Same fix already used by
  // Dashboard.jsx / VMDrift.jsx / PVEDrift.jsx / HVDrift.jsx: swap to G2's
  // dark theme and recolor axis/label/legend text explicitly.
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

  const [days, setDays]       = useState(30);
  const [loading, setLoading] = useState(true);
  const [data, setData]       = useState(EMPTY);

  const UTIL_EMPTY = { current: [], history: { total: 0, byDate: [], byPlatform: [] }, config: { cpu_threshold_pct: 85, memory_threshold_pct: 85, disk_threshold_pct: 85 } };
  const [utilLoading, setUtilLoading] = useState(true);
  const [util, setUtil]               = useState(UTIL_EMPTY);

  const LIST_EMPTY = { rows: [], total: 0, intervals: {} };
  const [listLoading, setListLoading] = useState(true);
  const [list, setList]               = useState(LIST_EMPTY);
  const [listPage, setListPage]       = useState(1);
  const [listPageSize, setListPageSize] = useState(20);

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

  useEffect(() => { setListPage(1); }, [days]);

  useEffect(() => {
    setListLoading(true);
    api.get('/connectivity-alerts/list', { params: { days, page: listPage, pageSize: listPageSize } })
      .then(r => setList(r.data))
      .catch(() => setList(LIST_EMPTY))
      .finally(() => setListLoading(false));
  }, [days, listPage, listPageSize]);

  const platformTotal = (p) => data.platforms[p]?.total ?? 0;
  const grandTotal = PLATFORMS.reduce((s, p) => s + platformTotal(p), 0) + (util.history.total || 0);
  const ringPct = (n) => grandTotal ? Math.round((n / grandTotal) * 100) : 0;

  // Two of a host's CPU/Memory/Disk breaching threshold at once, right now —
  // a rough "how bad" signal computed client-side from data already fetched
  // for the High Utilization table, no extra backend call needed.
  const criticalNow = util.current.filter(h => {
    const breaches = [
      h.cpu_pct    != null && h.cpu_pct    >= util.config.cpu_threshold_pct,
      h.memory_pct != null && h.memory_pct >= util.config.memory_threshold_pct,
      h.disk_pct   != null && h.disk_pct   >= util.config.disk_threshold_pct,
    ].filter(Boolean).length;
    return breaches >= 2;
  }).length;

  const trendRows = data.hasPreviousPeriod
    ? data.byDate.flatMap((d, i) => ([
        { day: fmtDate(d.date), series: 'This period', count: d.count },
        { day: fmtDate(d.date), series: 'Previous period', count: data.previousByDate[i]?.count ?? 0 },
      ]))
    : data.byDate.map(d => ({ day: fmtDate(d.date), series: 'Alerts', count: d.count }));

  const ALERT_COLUMNS = [
    {
      title: 'Time', dataIndex: 'created_at', key: 'created_at', width: 170,
      render: v => new Date(v).toLocaleString(),
    },
    {
      title: 'Host / IP', key: 'host',
      render: (_, r) => <span><PlatformAvatar platform={r.platform} />{r.host}</span>,
    },
    {
      title: 'Alert Type', key: 'type', width: 150,
      render: (_, r) => <Tag color={r.source === 'discovery' ? 'purple' : 'red'}>{alertTypeLabel(r)}</Tag>,
    },
    {
      title: 'Response', dataIndex: 'timed_out', key: 'timed_out', width: 120,
      render: v => v
        ? <Tag color="orange" icon={<ClockCircleOutlined />}>Timed Out</Tag>
        : <Tag color="default">Rejected</Tag>,
    },
    {
      title: 'Severity', dataIndex: 'severity', key: 'severity', width: 100,
      render: v => <Tag color={v === 'critical' ? 'error' : 'warning'}>{v === 'critical' ? 'Critical' : 'Warning'}</Tag>,
    },
    {
      title: 'Detail', key: 'detail',
      render: (_, r) => <Text type="secondary" style={{ fontSize: 12.5 }}>{alertDetail(r, list.intervals)}</Text>,
    },
  ];

  const UTIL_COLUMNS = [
    {
      title: 'Host', key: 'host',
      render: (_, r) => <span><PlatformAvatar platform={r.platform} />{r.host}</span>,
    },
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
      <style>{DASH_CSS}</style>
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

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
      ) : (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          {PLATFORMS.map((p, i) => (
            <Col key={p} xs={12} lg={6}>
              <SparkCard
                title={`${p} Alerts`}
                color={PLATFORM_COLOR[p]}
                total={platformTotal(p)}
                previousTotal={data.platforms[p]?.previousTotal}
                byDate={data.platforms[p]?.byDate}
                index={i}
              />
            </Col>
          ))}
          <Col xs={12} lg={6}>
            <SparkCard
              title="Discovery Failures"
              color={DISCOVERY_COLOR}
              total={data.discovery.total}
              previousTotal={data.discovery.previousTotal}
              byDate={data.discovery.byDate}
              index={3}
            />
          </Col>
        </Row>
      )}

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24}>
          <Card
            title="Alert Trend"
            extra={<Tag>{data.total.toLocaleString()} total</Tag>}
          >
            {loading ? (
              <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
            ) : trendRows.length === 0 ? (
              <Empty description="No connectivity alerts in this range" style={{ padding: '40px 0' }} />
            ) : (
              <Column
                data={trendRows}
                xField="day"
                yField="count"
                colorField="series"
                height={300}
                theme={chartTheme}
                scale={{ color: { range: data.hasPreviousPeriod ? ['#13c2c2', isDark ? '#595959' : '#d9d9d9'] : ['#13c2c2'] } }}
                legend={data.hasPreviousPeriod ? { color: { position: 'top', itemName: legendStyle.itemName } } : false}
                axis={{
                  y: { title: false, ...axisStyle },
                  x: { title: false, ...axisStyle },
                }}
                label={{ position: 'top', style: labelStyle }}
              />
            )}
          </Card>
        </Col>
      </Row>

      {utilLoading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
      ) : (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          {PLATFORMS.map((p, i) => (
            <Col key={p} xs={12} lg={6}>
              <GaugeCard
                title={p}
                color={PLATFORM_COLOR[p]}
                count={platformTotal(p)}
                percent={ringPct(platformTotal(p))}
                sub1Label="Ping Failed" sub1Value={data.platforms[p]?.pingFailed}
                sub2Label="Discovery Unreachable" sub2Value={data.platforms[p]?.discoveryUnreachable}
                index={i}
              />
            </Col>
          ))}
          <Col xs={12} lg={6}>
            <GaugeCard
              title="High Utilization"
              color={UTIL_COLOR}
              count={util.history.total}
              percent={ringPct(util.history.total)}
              sub1Label="Hosts Now" sub1Value={util.current.length}
              sub2Label="Critical (2+ metrics)" sub2Value={criticalNow}
              index={3}
            />
          </Col>
        </Row>
      )}

      {isAdmin && (
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={24}>
            <UtilizationThresholds />
          </Col>
        </Row>
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card
            title="Alert Details"
            extra={<Tag>{list.total.toLocaleString()} total</Tag>}
          >
            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              Every logged connectivity failure — host, alert type, and for ping/SSH-monitor alerts, how
              often that host is checked and how long it's been down.
            </Text>
            <Table
              rowKey={(r, i) => `${r.platform}-${r.host_id}-${r.created_at}-${i}`}
              dataSource={list.rows}
              columns={ALERT_COLUMNS}
              loading={listLoading}
              size="small"
              scroll={{ x: 'max-content' }}
              pagination={{
                current: listPage,
                pageSize: listPageSize,
                total: list.total,
                showSizeChanger: true,
                pageSizeOptions: [20, 50, 100],
                onChange: (p, ps) => { setListPage(p); setListPageSize(ps); },
              }}
              locale={{ emptyText: <Empty description="No connectivity alerts in this range" style={{ padding: '20px 0' }} /> }}
            />
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card
            title="High Utilization Hosts"
            extra={<Tag>CPU ≥ {util.config.cpu_threshold_pct}% · Mem ≥ {util.config.memory_threshold_pct}% · Disk ≥ {util.config.disk_threshold_pct}%</Tag>}
          >
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
            <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
              {util.history.total.toLocaleString()} high-utilization alert{util.history.total === 1 ? '' : 's'} logged in this range
            </Text>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
