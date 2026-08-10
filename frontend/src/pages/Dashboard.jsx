import { createContext, useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Row, Col, Card, Table, Tag, Spin, Alert, Typography, Tabs, Space, Statistic, Progress, Button,
  App, Input, Tooltip, Select, DatePicker, Badge,
} from 'antd';
import dayjs from 'dayjs';
import {
  DatabaseOutlined, SafetyCertificateOutlined, ThunderboltOutlined,
  HddOutlined, DesktopOutlined, AppstoreOutlined, SafetyOutlined, BugOutlined,
  ToolOutlined, StopOutlined, TeamOutlined, WarningOutlined,
  ClockCircleOutlined, PauseCircleOutlined, CheckCircleOutlined, PoweroffOutlined,
  CloseCircleOutlined, BlockOutlined,
  BarChartOutlined, CalendarOutlined, FundOutlined, RiseOutlined,
  EnvironmentOutlined, ApartmentOutlined, ClusterOutlined, PlayCircleOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { Pie, Column, Bar } from '@ant-design/plots';
import api from '../api/client';
import { useAppTheme } from '../context/ThemeContext.jsx';
import InfrastructureDashboard from '../components/InfrastructureDashboard.jsx';
import { DASH_CSS, useCountUp } from '../components/DashboardStatCard.jsx';
import {
  resolveTabs, resolveDefaultView, resolveDefaultTab, resolveWidget, customWidgetsFor,
  DASHBOARD_WIDGETS,
} from './Admin/dashboardRegistry.js';

// -- Widget gate + title override -------------------------------------------
const DashCfgCtx = createContext({ cfg: {} });

const widgetDefaultTitle = (tab, k) =>
  (DASHBOARD_WIDGETS[tab] || []).find(w => w.key === k)?.defaultTitle || k;

function Wgt({ tab, k, children }) {
  const { cfg } = useContext(DashCfgCtx);
  return resolveWidget(cfg, tab, k).visible ? children : null;
}

function WTitle({ tab, k, d }) {
  const { cfg } = useContext(DashCfgCtx);
  return resolveWidget(cfg, tab, k).title || d;
}



// -- User-created widgets ---------------------------------------------------
function CustomWidget({ w }) {
  const [data, setData] = useState(null);
  const [err, setErr]   = useState('');
  useEffect(() => {
    const params = { source: w.source || 'all' };
    if (w.type === 'stat') {
      if (w.filterField && w.filterValue) {
        params.filterField = w.filterField;
        params.filterValue = w.filterValue;
      }
    } else {
      params.groupBy = w.groupBy;
    }
    api.get('/dashboard/widget-data', { params })
      .then(r => setData(r.data))
      .catch(e => setErr(e.response?.data?.error || 'Failed to load widget'));
  }, [JSON.stringify(w)]); // eslint-disable-line

  if (err) return <Card title={w.title}><Alert type="error" message={err} /></Card>;
  if (!data) return <Card title={w.title}><Spin /></Card>;

  if (w.type === 'stat') {
    return (
      <Card>
        <Typography.Text type="secondary">{w.title}</Typography.Text>
        <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.15 }}>
          {(data.value ?? 0).toLocaleString()}
        </div>
        {w.filterField && w.filterValue && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {w.filterField.replace(/_/g, ' ')} = {w.filterValue}
          </Typography.Text>
        )}
      </Card>
    );
  }
  const rows = data.rows || [];
  if (w.type === 'pie') {
    return (
      <Card title={w.title}>
        <Pie data={rows} angleField="value" colorField="key" radius={0.85}
          label={{ text: 'value', position: 'outside' }}
          legend={{ position: 'bottom' }} height={260} />
      </Card>
    );
  }
  if (w.type === 'column') {
    return (
      <Card title={w.title}>
        <Column data={rows} xField="key" yField="value" height={260}
          label={{ position: 'top' }} />
      </Card>
    );
  }
  return (
    <Card title={w.title}>
      <Table size="small" rowKey="key" dataSource={rows} pagination={false}
        columns={[
          { title: 'Value', dataIndex: 'key' },
          { title: 'Count', dataIndex: 'value', align: 'right', width: 110,
            render: v => <strong>{(v ?? 0).toLocaleString()}</strong> },
        ]} />
    </Card>
  );
}

function CustomWidgets({ tab }) {
  const { cfg } = useContext(DashCfgCtx);
  const widgets = customWidgetsFor(cfg, tab);
  if (!widgets.length) return null;
  return (
    <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
      {widgets.map(w => (
        <Col key={w.id} xs={24} sm={w.type === 'stat' ? 12 : 24} lg={w.type === 'stat' ? 6 : 12}>
          {false ? (
            <div className="wgt-editable">
              <div className="wgt-tools">
                <Tooltip title="Remove this custom widget">
                  <Button size="small" danger onClick={() => {}} />
                </Tooltip>
              </div>
              <CustomWidget w={w} />
            </div>
          ) : <CustomWidget w={w} />}
        </Col>
      ))}
    </Row>
  );
}

function StatTile({ icon, value, label, color }) {
  const numeric = Number.isFinite(value);
  const animated = useCountUp(numeric ? value : 0);
  return (
    <Card size="small" className="stat-tile" bodyStyle={{ padding: 12 }}>
      <Space size={12} align="center" style={{ width: '100%' }}>
        <div
          className="stat-tile-icon"
          style={{
            width: 44, height: 44, borderRadius: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: color?.bg || 'rgba(22,119,255,0.12)',
            color: color?.fg || '#1677ff',
            fontSize: 20, flexShrink: 0,
          }}
        >
          {icon}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>
            {numeric ? animated.toLocaleString() : (value ?? '—')}
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>{label}</Typography.Text>
        </div>
      </Space>
    </Card>
  );
}

const C = {
  slate:  { bg: 'rgba(15,23,42,0.08)',  fg: '#0f172a' },
  blue:   { bg: 'rgba(22,119,255,0.12)', fg: '#1677ff' },
  cyan:   { bg: 'rgba(8,151,156,0.12)',  fg: '#08979c' },
  purple: { bg: 'rgba(114,46,209,0.12)', fg: '#722ed1' },
  red:    { bg: 'rgba(207,19,34,0.12)',  fg: '#cf1322' },
  green:  { bg: 'rgba(56,158,13,0.14)',  fg: '#389e0d' },
  yellow: { bg: 'rgba(212,136,6,0.18)',  fg: '#b45309' },
  amber:  { bg: 'rgba(255,140,0,0.16)',  fg: '#d46b08' },
  gray:   { bg: 'rgba(140,140,140,0.18)', fg: '#595959' },
  rose:   { bg: 'rgba(225,29,72,0.14)',  fg: '#be123c' },
  emerald:{ bg: 'rgba(16,185,129,0.16)', fg: '#059669' },
  indigo: { bg: 'rgba(67,56,202,0.16)',  fg: '#4338ca' },
};

function ratioLine({ label, numerator = 0, denominator = 0, tone }) {
  const pct = denominator ? (numerator / denominator) * 100 : 0;
  const TONES = {
    blue:   { bg: 'rgba(22,119,255,0.08)',  fg: '#1d4ed8' },
    indigo: { bg: 'rgba(99,102,241,0.10)',  fg: '#4338ca' },
    green:  { bg: 'rgba(34,197,94,0.10)',   fg: '#15803d' },
  };
  const toneStyle = TONES[tone] ?? TONES.blue;
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderRadius: 8,
        background: toneStyle.bg, color: toneStyle.fg, marginBottom: 8,
      }}
    >
      <span>{label}</span>
      <strong>{numerator.toLocaleString()} out of {denominator.toLocaleString()} = {pct.toFixed(2)}%</strong>
    </div>
  );
}

function ExtChip({ label, value, tone }) {
  const toneStyle = {
    green:  { bg: 'rgba(34,197,94,0.10)',   border: '#bbf7d0', fg: '#15803d' },
    gray:   { bg: 'rgba(148,163,184,0.10)', border: '#e2e8f0', fg: '#475569' },
    yellow: { bg: 'rgba(253,224,71,0.18)',  border: '#fde68a', fg: '#854d0e' },
    emerald:{ bg: 'rgba(16,185,129,0.10)',  border: '#bbf7d0', fg: '#047857' },
    blue:   { bg: 'rgba(59,130,246,0.10)',  border: '#bfdbfe', fg: '#1d4ed8' },
  }[tone || 'gray'];
  return (
    <div style={{
      padding: '10px 14px', borderRadius: 8,
      background: toneStyle.bg, border: `1px solid ${toneStyle.border}`,
      color: toneStyle.fg,
    }}>
      {label}: <strong>{(value ?? 0).toLocaleString()}</strong>
    </div>
  );
}

// Build the ordered, filtered, label-resolved chip list for the Ext. Endpoint Compliance card.
const EXT_CHIP_DEFS = [
  { key: 'meInstalled',     defaultLabel: 'ManageEngine Installed', tone: 'emerald' },
  { key: 'meNotApplicable', defaultLabel: 'ME Not Applicable',      tone: 'gray'    },
  { key: 'nameConflicts',   defaultLabel: 'Name Conflicts',         tone: 'yellow'  },
  { key: 'autoPatching',    defaultLabel: 'Auto Patching',          tone: 'green'   },
  { key: 'manualPatching',  defaultLabel: 'Manual Patching',        tone: 'blue'    },
];
function resolveExtChips(ec, extCfg = {}) {
  const hidden = extCfg.hidden_ext_chips ?? [];
  const labels = extCfg.ext_chip_labels   ?? {};
  return EXT_CHIP_DEFS
    .filter(c => !hidden.includes(c.key))
    .map(c => ({ ...c, label: labels[c.key] || c.defaultLabel, value: ec[c.key] }));
}

function ExecutiveOverview({ data, compCfg = {} }) {
  const h = data.headline || {};
  const a = data.assetInventory || {};
  const e = data.extendedInventory || {};
  const msl = data.mslCompliance || {};
  const ec  = data.extEndpointCompliance || {};

  const totalInventory = useCountUp(h.totalInventory ?? 0);
  const patchingCompliancePct = useCountUp((h.patchingCompliancePct ?? 0) * 10);
  const operationalReadinessPct = useCountUp((h.operationalReadinessPct ?? 0) * 100);
  const infrastructureHealthScore = useCountUp(h.infrastructureHealthScore ?? 0);

  return (
    <div>
      <style>{DASH_CSS}</style>
      <Wgt tab="exec" k="kpi_cards"><Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card className="dashcard" style={{ animationDelay: '0ms' }}>
            <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
              <div>
                <Typography.Text type="secondary">Total Inventory</Typography.Text>
                <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.1 }}>
                  {totalInventory.toLocaleString()}
                </div>
                <Typography.Text type="secondary">Assets under management</Typography.Text>
              </div>
              <div style={{ background: '#0f172a', color: 'white', padding: 10, borderRadius: 10 }}>
                <BlockOutlined style={{ fontSize: 22 }} />
              </div>
            </Space>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="dashcard" style={{ animationDelay: '60ms' }}>
            <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
              <div>
                <Typography.Text type="secondary">Patching Compliance</Typography.Text>
                <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.1 }}>
                  {(patchingCompliancePct / 10).toFixed(1)}%
                </div>
                <Typography.Text type="secondary">Current compliance level</Typography.Text>
              </div>
              <div style={{ background: '#0f172a', color: 'white', padding: 10, borderRadius: 10 }}>
                <SafetyCertificateOutlined style={{ fontSize: 22 }} />
              </div>
            </Space>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="dashcard" style={{ animationDelay: '120ms' }}>
            <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
              <div>
                <Typography.Text type="secondary">Operational Readiness</Typography.Text>
                <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.1 }}>
                  {(operationalReadinessPct / 100).toFixed(2)}%
                </div>
                <Typography.Text type="secondary">
                  {h.pendingActions ?? 0} {h.pendingActions === 1 ? 'asset' : 'assets'} pending actions
                </Typography.Text>
              </div>
              <div style={{ background: '#0f172a', color: 'white', padding: 10, borderRadius: 10 }}>
                <ThunderboltOutlined style={{ fontSize: 22 }} />
              </div>
            </Space>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="dashcard" style={{ animationDelay: '180ms' }}>
            <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
              <div>
                <Typography.Text type="secondary">Infrastructure Health Score</Typography.Text>
                <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.1, color: '#1677ff' }}>
                  {infrastructureHealthScore}
                </div>
                <Typography.Text type="secondary">Weighted from compliance and readiness</Typography.Text>
              </div>
              <div style={{ color: '#94a3b8', padding: 10 }}>
                <FundOutlined style={{ fontSize: 26 }} />
              </div>
            </Space>
          </Card>
        </Col>
      </Row></Wgt>

      <Wgt tab="exec" k="asset_summary"><div style={{ marginTop: 24 }}>
        <Space size={10} style={{ marginBottom: 12 }}>
          <div style={{ background: 'rgba(22,119,255,0.12)', color: '#1677ff',
            width: 36, height: 36, borderRadius: 8, display: 'flex',
            alignItems: 'center', justifyContent: 'center' }}>
            <BarChartOutlined />
          </div>
          <div>
            <Typography.Title level={5} style={{ margin: 0 }}><WTitle tab="exec" k="asset_summary" d="Asset Inventory Summary" /></Typography.Title>
            <Typography.Text type="secondary">Live counts across VM and Physical Server inventory</Typography.Text>
          </div>
        </Space>

        <div className="stat-grid-5">
          <StatTile icon={<DatabaseOutlined />}        value={a.totalAssets}     label="Total Assets"     color={C.slate} />
          <StatTile icon={<DesktopOutlined />}         value={a.virtualMachines} label="Virtual Machines" color={C.blue} />
          <StatTile icon={<HddOutlined />}             value={a.physicalServers} label="Physical Servers" color={C.cyan} />
          <StatTile icon={<AppstoreOutlined />}        value={a.manageEngine}    label="ManageEngine"     color={C.purple} />
          <StatTile icon={<BugOutlined />}             value={a.tenable}         label="Tenable"          color={C.red} />

          <StatTile icon={<ThunderboltOutlined />}     value={a.autoPatching}    label="Auto Patching"    color={C.green} />
          <StatTile icon={<ToolOutlined />}            value={a.manualPatching}  label="Manual Patching"  color={C.blue} />
          <StatTile icon={<WarningOutlined />}         value={a.exception}       label="Exception"        color={C.amber} />
          <StatTile icon={<TeamOutlined />}            value={a.beijingItTeam}   label="Beijing IT Team"  color={C.purple} />
          <StatTile icon={<StopOutlined />}            value={a.eolNoPatches}    label="EOL - No Patches" color={C.rose} />

          <StatTile icon={<ClockCircleOutlined />}     value={a.onboardPending}  label="Onboard Pending"  color={C.blue} />
          <StatTile icon={<PauseCircleOutlined />}     value={a.onHold}          label="On Hold"          color={C.gray} />
          <StatTile icon={<CheckCircleOutlined />}     value={a.alive}           label="Alive"            color={C.emerald} />
          <StatTile icon={<PoweroffOutlined />}        value={a.poweredOff}      label="Powered Off"      color={C.amber} />
          <StatTile icon={<CloseCircleOutlined />}     value={a.notAlive}        label="Not Alive"        color={C.rose} />
        </div>
      </div></Wgt>

      <Wgt tab="exec" k="ext_summary"><div style={{ marginTop: 24 }}>
        <Space size={10} style={{ marginBottom: 12 }}>
          <div style={{ background: 'rgba(67,56,202,0.16)', color: '#4338ca',
            width: 36, height: 36, borderRadius: 8, display: 'flex',
            alignItems: 'center', justifyContent: 'center' }}>
            <AppstoreOutlined />
          </div>
          <div>
            <Typography.Title level={5} style={{ margin: 0 }}><WTitle tab="exec" k="ext_summary" d="Extended Inventory Summary" /></Typography.Title>
            <Typography.Text type="secondary">Live counts from extended inventory</Typography.Text>
          </div>
        </Space>

        <div className="stat-grid-5">
          <StatTile icon={<AppstoreOutlined />}      value={e.total}       label="Ext. Total"        color={C.indigo} />
          <StatTile icon={<CheckCircleOutlined />}   value={e.active}      label="Ext. Active"       color={C.emerald} />
          <StatTile icon={<PoweroffOutlined />}      value={e.inactive}    label="Ext. Inactive"     color={C.gray} />
          <StatTile icon={<SafetyOutlined />}        value={e.meInstalled} label="Ext. ME Installed" color={C.emerald} />
          <StatTile icon={<SafetyCertificateOutlined />} value={e.tenable} label="Ext. Tenable"      color={C.cyan} />
        </div>
      </div></Wgt>

      <Row gutter={16} style={{ marginTop: 24 }}>
      <Col xs={24} lg={12}>
      <Wgt tab="exec" k="msl_compliance"><Card style={{ height: '100%' }}
        title={
          <Space>
            <div style={{ background: 'rgba(22,119,255,0.12)', color: '#1677ff',
              width: 36, height: 36, borderRadius: 8, display: 'flex',
              alignItems: 'center', justifyContent: 'center' }}>
              <RiseOutlined />
            </div>
            <div>
              <Typography.Title level={5} style={{ margin: 0 }}><WTitle tab="exec" k="msl_compliance" d="Total Inventory MSL Compliance" /></Typography.Title>
              <Typography.Text type="secondary">MSL includes VMs in Alive/Powered Off scope and excludes Decom/Not Applicable</Typography.Text>
            </div>
          </Space>
        }
      >
        {ratioLine({ label: 'MSL',                numerator: msl.mslNumerator ?? 0,      denominator: msl.mslDenominator ?? 0,      tone: 'blue' })}
        {ratioLine({ label: 'Extended Inventory', numerator: msl.extNumerator ?? 0,      denominator: msl.extDenominator ?? 0,      tone: 'indigo' })}
        {ratioLine({ label: 'MSL + E-INV',        numerator: msl.combinedNumerator ?? 0, denominator: msl.combinedDenominator ?? 0, tone: 'green' })}

        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 16, marginBottom: 8,
          textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 12, fontWeight: 600 }}>
          Location-wise count
        </Typography.Text>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
          {(msl.locations || []).map(loc => (
            <div key={loc.location} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '6px 12px', fontSize: 13,
              border: '1px solid var(--ant-color-border-secondary, #f0f0f0)', borderRadius: 6,
            }}>
              <Typography.Text>{loc.location}</Typography.Text>
              <Typography.Text strong style={{ color: '#1677ff' }}>{(loc.count ?? 0).toLocaleString()}</Typography.Text>
            </div>
          ))}
        </div>
      </Card></Wgt>
      </Col>

      <Col xs={24} lg={12}>
      <Wgt tab="exec" k="ext_compliance"><Card style={{ height: '100%' }}
        title={
          <Space>
            <div style={{ background: 'rgba(67,56,202,0.16)', color: '#4338ca',
              width: 36, height: 36, borderRadius: 8, display: 'flex',
              alignItems: 'center', justifyContent: 'center' }}>
              <AppstoreOutlined />
            </div>
            <div>
              <Typography.Title level={5} style={{ margin: 0 }}><WTitle tab="exec" k="ext_compliance" d="Ext. Endpoint Compliance" /></Typography.Title>
              <Typography.Text type="secondary">Password and agent compliance across extended inventory endpoints</Typography.Text>
            </div>
          </Space>
        }
      >
        <Typography.Paragraph style={{ marginBottom: 4 }}>
          Total <strong>{(ec.total ?? 0).toLocaleString()}</strong> endpoints
        </Typography.Paragraph>
        <Typography.Paragraph style={{ marginBottom: 4 }}>
          For <strong>{(ec.withPassword ?? 0).toLocaleString()}</strong> endpoints we received password info.
        </Typography.Paragraph>
        <Typography.Paragraph strong style={{ color: '#1d4ed8', marginBottom: 16 }}>
          Compliance: {(ec.withPassword ?? 0).toLocaleString()} out of {(ec.total ?? 0).toLocaleString()} ={' '}
          {(ec.total ? (ec.withPassword / ec.total) * 100 : 0).toFixed(2)}%
        </Typography.Paragraph>

        <Row gutter={[12, 12]}>
          {resolveExtChips(ec, compCfg.ext).map(c => (
            <Col xs={24} md={12} key={c.key}>
              <ExtChip label={c.label} value={c.value} tone={c.tone} />
            </Col>
          ))}
        </Row>

        <div style={{ marginTop: 20, maxWidth: 340 }}>
          <Typography.Text underline strong style={{ display: 'block', marginBottom: 8, color: '#1d4ed8' }}>
            Location-wise endpoint count:
          </Typography.Text>
          <Table
            rowKey="location"
            size="small"
            dataSource={ec.locationCount || []}
            pagination={false}
            tableLayout="fixed"
            locale={{ emptyText: 'No location data assigned in Extended Inventory' }}
            columns={[
              { title: 'Location', dataIndex: 'location' },
              { title: 'Count', dataIndex: 'count', align: 'right',
                render: v => <strong>{(v ?? 0).toLocaleString()}</strong> },
            ]}
            summary={(rows) => {
              if (!rows.length) return null;
              const grand = rows.reduce((s, r) => s + (r.count ?? 0), 0);
              return (
                <Table.Summary.Row style={{ fontWeight: 700 }}>
                  <Table.Summary.Cell index={0}><strong>Grand Total</strong></Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <strong>{grand.toLocaleString()}</strong>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              );
            }}
          />
        </div>
      </Card></Wgt>
      </Col>
      </Row>
    </div>
  );
}

function DonutRing({ percent, color = '#22c55e', label, sub }) {
  const r = 38, c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, percent || 0));
  const animatedPct = useCountUp(pct * 10) / 10;
  const offset = c - (animatedPct / 100) * c;
  return (
    <div style={{ width: 110, textAlign: 'center', flexShrink: 0 }}>
      <svg width="110" height="110" viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="50" cy="50" r={r} stroke="rgba(0,0,0,0.08)" strokeWidth="10" fill="none" />
        <circle cx="50" cy="50" r={r} stroke={color} strokeWidth="10" fill="none"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
      </svg>
      <div style={{ marginTop: -82, fontSize: 22, fontWeight: 700 }}>{animatedPct.toFixed(0)}%</div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 60 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function StatusBox({ value, label, tone }) {
  const toneStyle = {
    green:   { bg: 'rgba(34,197,94,0.10)',   fg: '#15803d' },
    orange:  { bg: 'rgba(249,115,22,0.10)',  fg: '#c2410c' },
    cyan:    { bg: 'rgba(6,182,212,0.10)',   fg: '#0891b2' },
    gray:    { bg: 'rgba(148,163,184,0.12)', fg: '#475569' },
    blue:    { bg: 'rgba(59,130,246,0.10)',  fg: '#1d4ed8' },
    yellow:  { bg: 'rgba(234,179,8,0.15)',   fg: '#a16207' },
    purple:  { bg: 'rgba(168,85,247,0.10)',  fg: '#7e22ce' },
    red:     { bg: 'rgba(239,68,68,0.10)',   fg: '#b91c1c' },
  }[tone || 'gray'];
  const animated = useCountUp(value ?? 0);
  return (
    <div className="dashcard" style={{
      background: toneStyle.bg, color: toneStyle.fg,
      padding: '12px 16px', borderRadius: 8,
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>
        {animated.toLocaleString()}
      </div>
      <div style={{ fontSize: 13 }}>{label}</div>
    </div>
  );
}

function AssetInventoryTab({ data, isDark, axisStyle, labelStyle, legendStyle, chartTheme }) {
  const h  = data.headline || {};
  const as = data.assetInventoryActiveStatus || {};
  const ps = data.assetInventoryPatchingStatus || {};
  const vmLoc = data.vmCountByLocation || [];
  const activePct  = as.total ? (as.active / as.total) * 100 : 0;
  const patchedPct = ps.total ? ((ps.auto_patching + ps.manual_patching) / ps.total) * 100 : 0;
  const labelColor = isDark ? '#f0f0f0' : '#262626';

  const totalInventory = useCountUp(h.totalInventory ?? 0);
  const patchingCompliancePct = useCountUp((h.patchingCompliancePct ?? 0) * 10);
  const operationalReadinessPct = useCountUp((h.operationalReadinessPct ?? 0) * 100);
  const infrastructureHealthScore = useCountUp(h.infrastructureHealthScore ?? 0);

  const kpiCards = (
    <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
      <Col xs={24} sm={12} lg={6}>
        <Card className="dashcard" style={{ animationDelay: '0ms' }}>
          <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
            <div>
              <Typography.Text type="secondary">Total Inventory</Typography.Text>
              <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.1 }}>
                {totalInventory.toLocaleString()}
              </div>
              <Typography.Text type="secondary">Assets under management</Typography.Text>
            </div>
            <div style={{ background: '#0f172a', color: 'white', padding: 10, borderRadius: 10 }}>
              <BlockOutlined style={{ fontSize: 22 }} />
            </div>
          </Space>
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={6}>
        <Card className="dashcard" style={{ animationDelay: '40ms' }}>
          <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
            <div>
              <Typography.Text type="secondary">Patching Compliance</Typography.Text>
              <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.1 }}>
                {(patchingCompliancePct / 10).toFixed(1)}%
              </div>
              <Typography.Text type="secondary">Current compliance level</Typography.Text>
            </div>
            <div style={{ background: '#0f172a', color: 'white', padding: 10, borderRadius: 10 }}>
              <SafetyCertificateOutlined style={{ fontSize: 22 }} />
            </div>
          </Space>
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={6}>
        <Card className="dashcard" style={{ animationDelay: '80ms' }}>
          <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
            <div>
              <Typography.Text type="secondary">Operational Readiness</Typography.Text>
              <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.1 }}>
                {(operationalReadinessPct / 100).toFixed(2)}%
              </div>
              <Typography.Text type="secondary">
                {h.pendingActions ?? 0} {h.pendingActions === 1 ? 'asset' : 'assets'} pending actions
              </Typography.Text>
            </div>
            <div style={{ background: '#0f172a', color: 'white', padding: 10, borderRadius: 10 }}>
              <ThunderboltOutlined style={{ fontSize: 22 }} />
            </div>
          </Space>
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={6}>
        <Card className="dashcard" style={{ animationDelay: '120ms' }}>
          <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
            <div>
              <Typography.Text type="secondary">Infrastructure Health Score</Typography.Text>
              <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.1, color: '#1677ff' }}>
                {infrastructureHealthScore}
              </div>
              <Typography.Text type="secondary">Weighted from compliance and readiness</Typography.Text>
            </div>
            <div style={{ color: '#94a3b8', padding: 10 }}>
              <FundOutlined style={{ fontSize: 26 }} />
            </div>
          </Space>
        </Card>
      </Col>
    </Row>
  );

  const activeStatusCard = (
    <Card className="dashcard" style={{ marginBottom: 16, animationDelay: '160ms' }}
      title={
        <Space>
          <div style={{ background: 'rgba(22,119,255,0.12)', color: '#1677ff',
            width: 36, height: 36, borderRadius: 8, display: 'flex',
            alignItems: 'center', justifyContent: 'center' }}>
            <RiseOutlined />
          </div>
          <div>
            <Typography.Title level={5} style={{ margin: 0 }}><WTitle tab="asset" k="active_status" d="Asset Inventory Active Status" /></Typography.Title>
            <Typography.Text type="secondary">VM and Physical Server records on Windows/Linux, based on patching type and excluding VMware</Typography.Text>
          </div>
        </Space>
      }
    >
      <Row gutter={16} align="middle">
        <Col xs={24} md={5} style={{ textAlign: 'center' }}>
          <DonutRing percent={activePct} color="#16a34a" label="Active"
            sub={`${(as.total ?? 0).toLocaleString()} total records`} />
        </Col>
        <Col xs={24} md={19}>
          <Row gutter={[12, 12]}>
            <Col xs={24} md={8}><StatusBox value={as.active}        label="Active"        tone="green" /></Col>
            <Col xs={24} md={8}><StatusBox value={as.non_active}    label="Non-Active"    tone="orange" /></Col>
            <Col xs={24} md={8}><StatusBox value={as.pending}       label="Pending"       tone="cyan" /></Col>
            <Col xs={24} md={8}><StatusBox value={as.on_hold}       label="On Hold"       tone="gray" /></Col>
            <Col xs={24} md={8}><StatusBox value={as.uncategorized} label="Uncategorized" tone="gray" /></Col>
            <Col xs={24} md={8}><StatusBox value={as.total}         label="Total"         tone="gray" /></Col>
          </Row>
        </Col>
      </Row>
    </Card>
  );

  const patchingStatusCard = (
    <Card className="dashcard" style={{ marginBottom: 16, animationDelay: '200ms' }}
      title={
        <Space>
          <div style={{ background: 'rgba(22,119,255,0.12)', color: '#1677ff',
            width: 36, height: 36, borderRadius: 8, display: 'flex',
            alignItems: 'center', justifyContent: 'center' }}>
            <ThunderboltOutlined />
          </div>
          <div>
            <Typography.Title level={5} style={{ margin: 0 }}><WTitle tab="asset" k="patching_status" d="Asset Inventory Patching Status" /></Typography.Title>
            <Typography.Text type="secondary">Patching type distribution across VM, Physical Server, and Bare Metal Server inventory</Typography.Text>
          </div>
        </Space>
      }
    >
      <Row gutter={16} align="middle">
        <Col xs={24} md={5} style={{ textAlign: 'center' }}>
          <DonutRing percent={patchedPct} color="#2563eb" label="Auto + Manual"
            sub={`${(ps.total ?? 0).toLocaleString()} total records`} />
        </Col>
        <Col xs={24} md={19}>
          <Row gutter={[12, 12]}>
            <Col xs={24} md={8}><StatusBox value={ps.auto_patching}     label="Auto"               tone="green" /></Col>
            <Col xs={24} md={8}><StatusBox value={ps.manual_patching}   label="Manual"             tone="blue" /></Col>
            <Col xs={24} md={8}><StatusBox value={ps.exception}         label="Exception"          tone="yellow" /></Col>
            <Col xs={24} md={8}><StatusBox value={ps.beijing_it}        label="Beijing IT"         tone="purple" /></Col>
            <Col xs={24} md={8}><StatusBox value={ps.eol}               label="EOL"                tone="red" /></Col>
            <Col xs={24} md={8}><StatusBox value={ps.pending}           label="Pending"            tone="cyan" /></Col>
            <Col xs={24} md={8}><StatusBox value={ps.on_hold}           label="On Hold"            tone="gray" /></Col>
            <Col xs={24} md={8}><StatusBox value={ps.alive_powered_off} label="Alive Powered Off"  tone="orange" /></Col>
          </Row>
        </Col>
      </Row>
    </Card>
  );

  const vmLocationCard = (
    <Card className="dashcard" style={{ marginBottom: 16, animationDelay: '240ms' }}
      title={
        <Space>
          <div style={{ background: 'rgba(22,119,255,0.12)', color: '#1677ff',
            width: 36, height: 36, borderRadius: 8, display: 'flex',
            alignItems: 'center', justifyContent: 'center' }}>
            <EnvironmentOutlined />
          </div>
          <div>
            <Typography.Title level={5} style={{ margin: 0 }}><WTitle tab="asset" k="vm_by_location" d="VM Count by Location" /></Typography.Title>
            <Typography.Text type="secondary">Live VM inventory grouped by location</Typography.Text>
          </div>
        </Space>
      }
    >
      {vmLoc.length > 0 && (
        <Bar
          data={vmLoc}
          xField="count"
          yField="location"
          theme={chartTheme}
          height={Math.max(220, vmLoc.length * 36)}
          colorField="location"
          color="#0d9488"
          label={{ style: { fill: labelColor } }}
          axis={{ x: axisStyle, y: axisStyle }}
          legend={false}
        />
      )}
      <Table
        size="small"
        rowKey="location"
        pagination={false}
        style={{ marginTop: 12 }}
        dataSource={vmLoc}
        columns={[
          { title: 'Location', dataIndex: 'location' },
          { title: 'Count', dataIndex: 'count', align: 'right', width: 120,
            render: v => <a style={{ fontWeight: 600 }}>{(v ?? 0).toLocaleString()}</a> },
        ]}
      />
    </Card>
  );

  return (
    <div>
      <style>{DASH_CSS}</style>

      <Wgt tab="asset" k="kpi_cards">{kpiCards}</Wgt>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}><Wgt tab="asset" k="os_chart">
          <Card className="dashcard" style={{ animationDelay: '0ms' }} title={<WTitle tab="asset" k="os_chart" d="Assets by OS Type" />}>
            <Pie data={data.charts?.byOsType || []} angleField="value" colorField="key" radius={0.85}
              theme={chartTheme}
              label={{ text: 'value', position: 'outside', style: labelStyle }}
              legend={{ position: 'bottom', ...legendStyle }}
              height={260} />
          </Card>
        </Wgt></Col>
        <Col xs={24} lg={12}><Wgt tab="asset" k="status_chart">
          <Card className="dashcard" style={{ animationDelay: '40ms' }} title={<WTitle tab="asset" k="status_chart" d="Assets by Server Status" />}>
            <Column data={data.charts?.byServerStatus || []} xField="key" yField="value" height={260}
              theme={chartTheme}
              axis={{ x: axisStyle, y: axisStyle }}
              label={{ position: 'top', style: labelStyle }} />
          </Card>
        </Wgt></Col>
        <Col xs={24} lg={12}><Wgt tab="asset" k="location_chart">
          <Card className="dashcard" style={{ animationDelay: '80ms' }} title={<WTitle tab="asset" k="location_chart" d="Assets by Location" />}>
            <Column data={data.charts?.byLocation || []} xField="key" yField="value" height={260}
              theme={chartTheme}
              axis={{ x: axisStyle, y: axisStyle }}
              label={{ position: 'top', style: labelStyle }} />
          </Card>
        </Wgt></Col>
        <Col xs={24} lg={12}><Wgt tab="asset" k="eol_chart">
          <Card className="dashcard" style={{ animationDelay: '120ms' }} title={<WTitle tab="asset" k="eol_chart" d="EOL Status" />}>
            <Pie data={data.charts?.byEolStatus || []} angleField="value" colorField="key" radius={0.85}
              theme={chartTheme}
              label={{ text: 'value', position: 'outside', style: labelStyle }}
              legend={{ position: 'bottom', ...legendStyle }}
              height={260} />
          </Card>
        </Wgt></Col>
      </Row>

      <Wgt tab="asset" k="active_status">{activeStatusCard}</Wgt>
      <Wgt tab="asset" k="patching_status">{patchingStatusCard}</Wgt>
      <Wgt tab="asset" k="vm_by_location">{vmLocationCard}</Wgt>

      <Wgt tab="asset" k="recent_assets"><Card className="dashcard" style={{ marginTop: 16, animationDelay: '280ms' }} title={<WTitle tab="asset" k="recent_assets" d="Recent Assets" />}>
        <Table
          rowKey="id"
          size="small"
          dataSource={data.recentAssets || []}
          pagination={false}
          rowClassName="dashcard-row"
          columns={[
            { title: 'VM Name', dataIndex: 'vm_name' },
            { title: 'IP', dataIndex: 'ip_address' },
            { title: 'OS', dataIndex: 'os_type' },
            { title: 'Status', dataIndex: 'server_status',
              render: v => v && <Tag color={v === 'Active' ? 'green' : 'orange'}>{v}</Tag> },
            { title: 'Location', dataIndex: 'location' },
            { title: 'Created', dataIndex: 'created_at', render: v => new Date(v).toLocaleString() },
          ]}
        />
      </Card></Wgt>
    </div>
  );
}

function ExtendedInventoryTab({ data, compCfg = {} }) {
  const h  = data.headline || {};
  const e  = data.extendedInventory || {};
  const ec = data.extEndpointCompliance || {};
  const depts = data.extDeptDistribution || [];

  const numCell = (color) => (v) => {
    const n = Number(v ?? 0);
    if (n === 0) return <Tag color="default">0</Tag>;
    return <Tag color={color}>{n.toLocaleString()}</Tag>;
  };

  const deptColumns = [
    { title: 'Department', dataIndex: 'department', fixed: 'left', width: 160,
      render: v => <strong>{v}</strong> },
    { title: 'Total',          dataIndex: 'total',          width: 80,  align: 'center', render: numCell('default') },
    { title: 'Active',         dataIndex: 'active',         width: 90,  align: 'center', render: numCell('green') },
    { title: 'Inactive',       dataIndex: 'inactive',       width: 90,  align: 'center', render: numCell('default') },
    { title: 'Decommissioned', dataIndex: 'decommissioned', width: 130, align: 'center', render: numCell('red') },
    { title: 'Maintenance',    dataIndex: 'maintenance',    width: 110, align: 'center', render: numCell('orange') },
    { title: 'Auto',           dataIndex: 'auto_patching',  width: 80,  align: 'center', render: numCell('green') },
    { title: 'Manual',         dataIndex: 'manual_patching',width: 80,  align: 'center', render: numCell('blue') },
    { title: 'Exception',      dataIndex: 'exception',      width: 100, align: 'center', render: numCell('orange') },
    { title: 'Beijing IT',     dataIndex: 'beijing_it',     width: 100, align: 'center', render: numCell('magenta') },
    { title: 'EOL',            dataIndex: 'eol',            width: 80,  align: 'center', render: numCell('red') },
    { title: 'Not Applicable', dataIndex: 'not_applicable', width: 130, align: 'center', render: numCell('default') },
    { title: 'Pending',        dataIndex: 'pending',        width: 90,  align: 'center', render: numCell('cyan') },
    { title: 'On Hold',        dataIndex: 'on_hold',        width: 90,  align: 'center', render: numCell('default') },
    { title: 'Alive',          dataIndex: 'alive',          width: 80,  align: 'center', render: numCell('green') },
    { title: 'Powered Off',    dataIndex: 'powered_off',    width: 110, align: 'center', render: numCell('orange') },
    { title: 'Not Alive',      dataIndex: 'not_alive',      width: 100, align: 'center', render: numCell('red') },
    { title: 'ME',             dataIndex: 'me',             width: 70,  align: 'center', render: numCell('purple') },
    { title: 'Tenable',        dataIndex: 'tenable',        width: 90,  align: 'center', render: numCell('cyan') },
  ];

  const totalInventory = useCountUp(h.totalInventory ?? 0);
  const patchingCompliancePct = useCountUp((h.patchingCompliancePct ?? 0) * 10);
  const operationalReadinessPct = useCountUp((h.operationalReadinessPct ?? 0) * 100);
  const infrastructureHealthScore = useCountUp(h.infrastructureHealthScore ?? 0);

  return (
    <div>
      <style>{DASH_CSS}</style>
      <Wgt tab="ext" k="kpi_cards"><Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card className="dashcard" style={{ animationDelay: '0ms' }}>
            <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
              <div>
                <Typography.Text type="secondary">Total Inventory</Typography.Text>
                <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.1 }}>
                  {totalInventory.toLocaleString()}
                </div>
                <Typography.Text type="secondary">Assets under management</Typography.Text>
              </div>
              <div style={{ background: '#0f172a', color: 'white', padding: 10, borderRadius: 10 }}>
                <BlockOutlined style={{ fontSize: 22 }} />
              </div>
            </Space>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="dashcard" style={{ animationDelay: '60ms' }}>
            <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
              <div>
                <Typography.Text type="secondary">Patching Compliance</Typography.Text>
                <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.1 }}>
                  {(patchingCompliancePct / 10).toFixed(1)}%
                </div>
                <Typography.Text type="secondary">Current compliance level</Typography.Text>
              </div>
              <div style={{ background: '#0f172a', color: 'white', padding: 10, borderRadius: 10 }}>
                <SafetyCertificateOutlined style={{ fontSize: 22 }} />
              </div>
            </Space>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="dashcard" style={{ animationDelay: '120ms' }}>
            <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
              <div>
                <Typography.Text type="secondary">Operational Readiness</Typography.Text>
                <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.1 }}>
                  {(operationalReadinessPct / 100).toFixed(2)}%
                </div>
                <Typography.Text type="secondary">
                  {h.pendingActions ?? 0} {h.pendingActions === 1 ? 'asset' : 'assets'} pending actions
                </Typography.Text>
              </div>
              <div style={{ background: '#0f172a', color: 'white', padding: 10, borderRadius: 10 }}>
                <ThunderboltOutlined style={{ fontSize: 22 }} />
              </div>
            </Space>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="dashcard" style={{ animationDelay: '180ms' }}>
            <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
              <div>
                <Typography.Text type="secondary">Infrastructure Health Score</Typography.Text>
                <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.1, color: '#1677ff' }}>
                  {infrastructureHealthScore}
                </div>
                <Typography.Text type="secondary">Weighted from compliance and readiness</Typography.Text>
              </div>
              <div style={{ color: '#94a3b8', padding: 10 }}>
                <FundOutlined style={{ fontSize: 26 }} />
              </div>
            </Space>
          </Card>
        </Col>
      </Row></Wgt>

      <Wgt tab="ext" k="ext_summary"><div style={{ marginTop: 24 }}>
        <Space size={10} style={{ marginBottom: 12 }}>
          <div style={{ background: 'rgba(67,56,202,0.16)', color: '#4338ca',
            width: 36, height: 36, borderRadius: 8, display: 'flex',
            alignItems: 'center', justifyContent: 'center' }}>
            <AppstoreOutlined />
          </div>
          <div>
            <Typography.Title level={5} style={{ margin: 0 }}><WTitle tab="ext" k="ext_summary" d="Extended Inventory Summary" /></Typography.Title>
            <Typography.Text type="secondary">Live counts from extended inventory</Typography.Text>
          </div>
        </Space>
        <div className="stat-grid-5">
          <StatTile icon={<AppstoreOutlined />}      value={e.total}       label="Ext. Total"        color={C.indigo} />
          <StatTile icon={<CheckCircleOutlined />}   value={e.active}      label="Ext. Active"       color={C.emerald} />
          <StatTile icon={<PoweroffOutlined />}      value={e.inactive}    label="Ext. Inactive"     color={C.gray} />
          <StatTile icon={<SafetyOutlined />}        value={e.meInstalled} label="Ext. ME Installed" color={C.emerald} />
          <StatTile icon={<SafetyCertificateOutlined />} value={e.tenable} label="Ext. Tenable"      color={C.cyan} />
        </div>
      </div></Wgt>

      <Wgt tab="ext" k="ext_compliance"><Card style={{ marginTop: 24 }}
        title={
          <Space>
            <div style={{ background: 'rgba(67,56,202,0.16)', color: '#4338ca',
              width: 36, height: 36, borderRadius: 8, display: 'flex',
              alignItems: 'center', justifyContent: 'center' }}>
              <AppstoreOutlined />
            </div>
            <div>
              <Typography.Title level={5} style={{ margin: 0 }}><WTitle tab="ext" k="ext_compliance" d="Ext. Endpoint Compliance" /></Typography.Title>
              <Typography.Text type="secondary">Password and agent compliance across extended inventory endpoints</Typography.Text>
            </div>
          </Space>
        }
      >
        <Typography.Paragraph style={{ marginBottom: 4 }}>
          Total <strong>{(ec.total ?? 0).toLocaleString()}</strong> endpoints
        </Typography.Paragraph>
        <Typography.Paragraph style={{ marginBottom: 4 }}>
          For <strong>{(ec.withPassword ?? 0).toLocaleString()}</strong> endpoints we received password info.
        </Typography.Paragraph>
        <Typography.Paragraph strong style={{ color: '#1d4ed8', marginBottom: 16 }}>
          Compliance: {(ec.withPassword ?? 0).toLocaleString()} out of {(ec.total ?? 0).toLocaleString()} ={' '}
          {(ec.total ? (ec.withPassword / ec.total) * 100 : 0).toFixed(2)}%
        </Typography.Paragraph>
        <Row gutter={[12, 12]}>
          {resolveExtChips(ec, compCfg.ext).map(c => (
            <Col xs={24} md={12} key={c.key}>
              <ExtChip label={c.label} value={c.value} tone={c.tone} />
            </Col>
          ))}
        </Row>

        <div style={{ marginTop: 20, maxWidth: 340 }}>
          <Typography.Text underline strong style={{ display: 'block', marginBottom: 8, color: '#1d4ed8' }}>
            Location-wise endpoint count:
          </Typography.Text>
          <Table
            rowKey="location"
            size="small"
            dataSource={ec.locationCount || []}
            pagination={false}
            tableLayout="fixed"
            locale={{ emptyText: 'No location data assigned in Extended Inventory' }}
            columns={[
              { title: 'Location', dataIndex: 'location' },
              { title: 'Count', dataIndex: 'count', align: 'right',
                render: v => <strong>{(v ?? 0).toLocaleString()}</strong> },
            ]}
            summary={(rows) => {
              if (!rows.length) return null;
              const grand = rows.reduce((s, r) => s + (r.count ?? 0), 0);
              return (
                <Table.Summary.Row style={{ fontWeight: 700 }}>
                  <Table.Summary.Cell index={0}><strong>Grand Total</strong></Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">
                    <strong>{grand.toLocaleString()}</strong>
                  </Table.Summary.Cell>
                </Table.Summary.Row>
              );
            }}
          />
        </div>
      </Card></Wgt>

      <Wgt tab="ext" k="dept_distribution"><div style={{ marginTop: 24 }}>
        <Space size={10} style={{ marginBottom: 12 }}>
          <div style={{ background: 'rgba(124,58,237,0.16)', color: '#7c3aed',
            width: 28, height: 28, borderRadius: 8, display: 'flex',
            alignItems: 'center', justifyContent: 'center' }}>
            <AppstoreOutlined />
          </div>
          <Typography.Text strong style={{ letterSpacing: 1, color: '#7c3aed', textTransform: 'uppercase' }}>
            Extended Inventory Analytics
          </Typography.Text>
        </Space>

        <Card
          title={
            <Space>
              <TeamOutlined style={{ color: '#7c3aed' }} />
              <div>
                <Typography.Title level={5} style={{ margin: 0 }}><WTitle tab="ext" k="dept_distribution" d="Ext. Dept-wise Endpoint Distribution" /></Typography.Title>
                <Typography.Text type="secondary">
                  Extended inventory assets by department with status, patching, agent, and server-state details.
                  Updated {new Date().toLocaleTimeString()}
                </Typography.Text>
              </div>
            </Space>
          }
        >
          <Table
            rowKey="department"
            size="small"
            dataSource={depts}
            columns={deptColumns}
            scroll={{ x: 'max-content' }}
            pagination={false}
            summary={(rows) => {
              if (!rows.length) return null;
              const sum = (k) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
              return (
                <Table.Summary.Row style={{ background: 'rgba(124,58,237,0.06)', fontWeight: 700 }}>
                  <Table.Summary.Cell index={0}><strong>Total</strong></Table.Summary.Cell>
                  {['total','active','inactive','decommissioned','maintenance','auto_patching','manual_patching',
                    'exception','beijing_it','eol','not_applicable','pending','on_hold','alive','powered_off',
                    'not_alive','me','tenable'].map((k, i) => (
                    <Table.Summary.Cell key={k} index={i + 1} align="center">
                      <strong>{sum(k).toLocaleString()}</strong>
                    </Table.Summary.Cell>
                  ))}
                </Table.Summary.Row>
              );
            }}
          />
        </Card>
      </div></Wgt>
    </div>
  );
}

function PatchPill({ n, label, tone, isDark }) {
  const palette = {
    green:  { bg: 'rgba(34,197,94,0.10)',  fg: '#15803d', dfg: '#4ade80' },
    blue:   { bg: 'rgba(59,130,246,0.10)', fg: '#1d4ed8', dfg: '#60a5fa' },
    yellow: { bg: 'rgba(234,179,8,0.18)',  fg: '#a16207', dfg: '#fbbf24' },
    purple: { bg: 'rgba(168,85,247,0.10)', fg: '#7e22ce', dfg: '#c084fc' },
    red:    { bg: 'rgba(239,68,68,0.10)',  fg: '#b91c1c', dfg: '#f87171' },
    cyan:   { bg: 'rgba(6,182,212,0.10)',  fg: '#0e7490', dfg: '#22d3ee' },
    gray:   { bg: 'rgba(148,163,184,0.12)',fg: '#475569', dfg: '#94a3b8' },
    orange: { bg: 'rgba(249,115,22,0.10)', fg: '#c2410c', dfg: '#fb923c' },
  }[tone || 'gray'];
  return (
    <div style={{
      background: palette.bg, color: isDark ? palette.dfg : palette.fg,
      borderRadius: 8, padding: '8px 12px',
    }}>
      <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1 }}>{(n ?? 0).toLocaleString()}</div>
      <div style={{ fontSize: 12 }}>{label}</div>
    </div>
  );
}

function PatchingStatusCard({ title, data, isDark }) {
  const auto = data?.auto_patching ?? 0;
  const manual = data?.manual_patching ?? 0;
  const totalExclNa = data?.total_excl_na ?? data?.total ?? 0;
  const pct = totalExclNa ? Math.round(((auto + manual) / totalExclNa) * 100) : 0;
  const overall = (data?.auto_patching ?? 0) + (data?.manual_patching ?? 0)
    + (data?.pending ?? 0) + (data?.on_hold ?? 0) + (data?.alive_powered_off ?? 0);
  const overallPct = totalExclNa ? ((overall / totalExclNa) * 100) : 0;

  return (
    <Card type="inner"
      title={
        <Space>
          <div style={{ background: 'rgba(22,119,255,0.12)', color: '#1677ff',
            width: 30, height: 30, borderRadius: 6, display: 'flex',
            alignItems: 'center', justifyContent: 'center' }}>
            <ThunderboltOutlined />
          </div>
          <div>
            <Typography.Title level={5} style={{ margin: 0 }}>{title}</Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>Patching type distribution</Typography.Text>
          </div>
        </Space>
      }
    >
      <Row gutter={16} align="middle">
        <Col xs={24} md={6} style={{ textAlign: 'center' }}>
          <DonutRing percent={pct} color="#2563eb" label="Auto + Manual"
            sub={`${totalExclNa.toLocaleString()} total records`} />
        </Col>
        <Col xs={24} md={18}>
          <Row gutter={[10, 10]}>
            <Col xs={12} md={8}><PatchPill n={data?.auto_patching}     label="Auto"               tone="green"  isDark={isDark} /></Col>
            <Col xs={12} md={8}><PatchPill n={data?.manual_patching}   label="Manual"             tone="blue"   isDark={isDark} /></Col>
            <Col xs={12} md={8}><PatchPill n={data?.exception}         label="Exception"          tone="yellow" isDark={isDark} /></Col>
            <Col xs={12} md={8}><PatchPill n={data?.beijing_it}        label="Beijing IT"         tone="purple" isDark={isDark} /></Col>
            <Col xs={12} md={8}><PatchPill n={data?.eol}               label="EOL - No Patches"   tone="red"    isDark={isDark} /></Col>
            <Col xs={12} md={8}><PatchPill n={data?.pending}           label="Pending"            tone="cyan"   isDark={isDark} /></Col>
            <Col xs={12} md={8}><PatchPill n={data?.on_hold}           label="On Hold"            tone="gray"   isDark={isDark} /></Col>
            <Col xs={12} md={8}><PatchPill n={data?.alive_powered_off} label="Alive Powered Off"  tone="orange" isDark={isDark} /></Col>
          </Row>
        </Col>
      </Row>
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 13 }}>
        <strong>Overall:</strong> {overall.toLocaleString()} / (Auto + Manual + Pending + On Hold + Alive Powered Off)
        = <strong>{overallPct.toFixed(2)}%</strong>
      </Typography.Paragraph>
    </Card>
  );
}

function WeeklyReportRow({ label, children }) {
  return (
    <Row gutter={16} style={{ padding: '16px 0', borderBottom: '1px solid var(--ant-color-border-secondary, #303030)' }}>
      <Col xs={24} md={4}>
        <Typography.Text strong>{label}</Typography.Text>
      </Col>
      <Col xs={24} md={20}>{children}</Col>
    </Row>
  );
}

// All possible patching-type columns; only those with at least one non-zero
// value across the rows are rendered, so the table adapts to the data.
const BREAKDOWN_METRICS = [
  { key: 'alive_powered_off', title: 'Alive But Powered Off' },
  { key: 'auto_patching',     title: 'Auto' },
  { key: 'beijing_it',        title: 'Beijing IT Team' },
  { key: 'eol',               title: 'EOL - No Patches' },
  { key: 'exception',         title: 'Exception' },
  { key: 'manual_patching',   title: 'Manual' },
  { key: 'on_hold',           title: 'On Hold' },
  { key: 'onboard_pending',   title: 'Onboard Pending' },
];

function WeeklyBreakdownTable({ rows, groupLabel, linkFor, isDark, hiddenColumns = [], pctExclude = ['alive_powered_off', 'eol'] }) {
  // Single accent colour + dimmed dash — same scheme as the Auto Patching
  // Group Count table (MEComplianceTable) for visual consistency across
  // Weekly Report breakdown tables.
  const accent   = isDark ? '#60a5fa' : '#1d4ed8';
  const dimColor = isDark ? '#555' : '#bbb';
  const numCell = (v) => {
    const n = Number(v ?? 0);
    if (n === 0) return <span style={{ color: dimColor }}>-</span>;
    return <span style={{ color: accent, fontWeight: 600 }}>{n.toLocaleString()}</span>;
  };

  // Percentage = (Total - out-of-scope types) / Total using pctExclude config.
  const enriched = (rows || []).map(r => {
    const total = Number(r.total || 0);
    const excluded = pctExclude.reduce((s, k) => s + Number(r[k] || 0), 0);
    const inScope = total - excluded;
    return { ...r, pct: total ? (inScope / total) * 100 : 0 };
  });

  const sumKey = (key) => enriched.reduce((s, r) => s + Number(r[key] || 0), 0);
  const totalSum = sumKey('total');
  const inScopeSum = totalSum - pctExclude.reduce((s, k) => s + sumKey(k), 0);
  const totalPct = totalSum ? (inScopeSum / totalSum) * 100 : 0;

  // Dynamic columns: drop any metric that is zero/empty for every row, then apply explicit hidden list.
  const activeMetrics = BREAKDOWN_METRICS.filter(m => sumKey(m.key) > 0 && !hiddenColumns.includes(m.key));
  const groupColW = 200;
  const numColW = 110;
  // Narrower, centered width instead of stretching full card width — scales
  // with however many metric columns are active for this data set.
  const tableMaxWidth = groupColW + (activeMetrics.length + 2) * numColW;

  const columns = [
    { title: `${groupLabel} \\ Patching Type`, dataIndex: 'bucket', width: groupColW,
      render: v => {
        const to = linkFor && v && v !== 'Unknown' ? linkFor(v) : null;
        return to
          ? <Link to={to} title={`Open ${v} in Asset Inventory`}><strong>{v}</strong></Link>
          : <strong>{v}</strong>;
      } },
    ...activeMetrics.map(m => ({
      title: m.title, dataIndex: m.key, align: 'center', width: numColW, render: numCell,
    })),
    { title: 'Total',      dataIndex: 'total', align: 'center', width: numColW,
      render: v => <strong>{Number(v ?? 0).toLocaleString()}</strong> },
    { title: 'Percentage', dataIndex: 'pct',   align: 'center', width: numColW,
      render: v => <strong>{(v ?? 0).toFixed(2)}%</strong> },
  ];

  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: tableMaxWidth }}>
        <Table
          rowKey="bucket"
          size="small"
          dataSource={enriched}
          columns={columns}
          pagination={false}
          tableLayout="fixed"
          summary={() => (
            <Table.Summary.Row style={{ fontWeight: 700 }}>
              <Table.Summary.Cell index={0}><strong>Total</strong></Table.Summary.Cell>
              {activeMetrics.map((m, i) => {
                const v = sumKey(m.key);
                return (
                  <Table.Summary.Cell key={m.key} index={i + 1} align="center">
                    {v === 0 ? <span style={{ color: dimColor }}>-</span> : <strong style={{ color: accent }}>{v.toLocaleString()}</strong>}
                  </Table.Summary.Cell>
                );
              })}
              <Table.Summary.Cell index={activeMetrics.length + 1} align="center"><strong>{totalSum.toLocaleString()}</strong></Table.Summary.Cell>
              <Table.Summary.Cell index={activeMetrics.length + 2} align="center"><strong>{totalPct.toFixed(2)}%</strong></Table.Summary.Cell>
            </Table.Summary.Row>
          )}
        />
      </div>
    </div>
  );
}

const ME_BUCKET_ORDER = [
  'Alive But Powered Off', 'Auto', 'Beijing IT Team',
  'EOL - No Patches', 'Exception', 'Manual', 'Not Applicable', 'On Hold', 'Onboard Pending', 'Other',
];

function MEComplianceTable({ rows, excludedBuckets = [], isDark }) {
  const sorted = [...rows].sort(
    (a, b) => ME_BUCKET_ORDER.indexOf(a.bucket) - ME_BUCKET_ORDER.indexOf(b.bucket),
  );
  const totalNo  = sorted.reduce((s, r) => s + (r.no_me  || 0), 0);
  const totalYes = sorted.reduce((s, r) => s + (r.yes_me || 0), 0);
  const totalAll = sorted.reduce((s, r) => s + (r.total  || 0), 0);

  const accent   = isDark ? '#60a5fa' : '#1d4ed8';
  const dimColor = isDark ? '#6b7280' : '#aaa';
  const dashEl   = (n) => n === 0
    ? <span style={{ color: isDark ? '#555' : '#bbb' }}>—</span>
    : <strong style={{ color: accent }}>{n.toLocaleString()}</strong>;

  const numColW = 110;
  const columns = [
    {
      title: 'PATCHING TYPE \\ MANAGEENGINE INSTALLED',
      dataIndex: 'bucket',
      render: (v) => {
        const excl = excludedBuckets.includes(v);
        return <span style={{ color: excl ? dimColor : undefined }}>{v}</span>;
      },
    },
    {
      title: 'NO',
      dataIndex: 'no_me',
      align: 'right',
      width: numColW,
      render: (v, r) => {
        const excl = excludedBuckets.includes(r.bucket);
        return excl ? <span style={{ color: dimColor }}>{dashEl(v)}</span> : dashEl(v);
      },
    },
    {
      title: 'YES',
      dataIndex: 'yes_me',
      align: 'right',
      width: numColW,
      render: (v, r) => {
        const excl = excludedBuckets.includes(r.bucket);
        return excl ? <span style={{ color: dimColor }}>{dashEl(v)}</span> : dashEl(v);
      },
    },
    {
      title: 'TOTAL',
      dataIndex: 'total',
      align: 'right',
      width: numColW,
      render: (v, r) => {
        const excl = excludedBuckets.includes(r.bucket);
        return <strong style={{ color: excl ? dimColor : undefined }}>{(v || 0).toLocaleString()}</strong>;
      },
    },
  ];

  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 700 }}>
        <Table
          rowKey="bucket"
          size="small"
          dataSource={sorted}
          columns={columns}
          pagination={false}
          rowClassName={(r) => excludedBuckets.includes(r.bucket) ? 'me-excl-row' : ''}
          summary={() => (
            <Table.Summary.Row style={{ fontWeight: 700 }}>
              <Table.Summary.Cell index={0}><strong>Total</strong></Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right">
                <strong style={{ color: accent }}>{totalNo.toLocaleString()}</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={2} align="right">
                <strong style={{ color: accent }}>{totalYes.toLocaleString()}</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={3} align="right">
                <strong>{totalAll.toLocaleString()}</strong>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          )}
        />
      </div>
    </div>
  );
}

function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function WeeklyReportTab({ data, isDark, compCfg = {} }) {
  const msl = data.mslCompliance || {};
  const ec  = data.extEndpointCompliance || {};
  const vmGaps = data.weeklyVmGaps || {};
  const assetPatching = data.assetInventoryPatchingStatus || {};
  const extPatching   = data.extInventoryPatchingStatus || {};
  const locRows  = data.weeklyLocationPatching || [];
  const deptRows = data.weeklyDepartmentPatching || [];
  const meMslRows = data.meMslBreakdown || [];
  const meExtRows = data.meExtBreakdown || [];

  const mslOverall  = msl.mslNumerator ?? 0;
  const mslOverallD = msl.mslDenominator ?? 0;
  const extNum  = msl.extNumerator ?? 0;
  const extDen  = msl.extDenominator ?? 0;
  const combNum = msl.combinedNumerator ?? 0;
  const combDen = msl.combinedDenominator ?? 0;
  const pct = (n, d) => d ? ((n / d) * 100).toFixed(2) : '0.00';

  const apTotal = (assetPatching.total_excl_na ?? assetPatching.total) ?? 0;
  const epTotal = (extPatching.total_excl_na   ?? extPatching.total)   ?? 0;
  const overallPatchN = (assetPatching.auto_patching ?? 0) + (assetPatching.manual_patching ?? 0)
                     + (extPatching.auto_patching ?? 0)   + (extPatching.manual_patching ?? 0);
  const overallPatchD = apTotal + epTotal;
  const overallPatchPct = overallPatchD ? ((overallPatchN / overallPatchD) * 100).toFixed(2) : '0.00';

  // Weekly config with fallbacks
  const MSL_EXCL       = compCfg.weekly?.me_msl_exclude_buckets
    ?? ['Beijing IT Team', 'Not Applicable', 'Alive But Powered Off', 'EOL - No Patches'];
  const EXT_EXCL       = compCfg.weekly?.me_ext_exclude_buckets
    ?? ['Beijing IT Team', 'Not Applicable', 'Alive But Powered Off', 'EOL - No Patches', 'Exception'];
  const MSL_FOOTNOTE   = compCfg.weekly?.me_msl_footnote   || '(*Excludes Bomgar & Beijing Team Managed count, esxi hosts and not applicable vms, powered off VMs EOL VMs)';
  const EXT_FOOTNOTE   = compCfg.weekly?.me_ext_footnote   || "(*Excludes ESXi hosts and not applicable vm's like appliances, Beijing IT managed, exceptions, EOL VMs)";
  const HIDDEN_COLS    = compCfg.weekly?.breakdown_hidden_columns    ?? [];
  const PCT_EXCL       = compCfg.weekly?.breakdown_pct_exclude       ?? ['alive_powered_off', 'eol'];
  const EXCL_LOCS      = compCfg.weekly?.breakdown_excluded_locations    ?? [];
  const EXCL_DEPTS     = compCfg.weekly?.breakdown_excluded_departments  ?? [];
  const REPORT_TITLE   = compCfg.weekly?.report_title    || 'Weekly Infrastructure Report';
  const REPORT_SUB     = compCfg.weekly?.report_subtitle || 'Patch & Agent Compliance';

  const filteredLocRows  = locRows.filter(r  => !EXCL_LOCS.includes(r.bucket));
  const filteredDeptRows = deptRows.filter(r => !EXCL_DEPTS.includes(r.bucket));

  const meMslIncl = meMslRows.filter((r) => !MSL_EXCL.includes(r.bucket));
  const meExtIncl = meExtRows.filter((r) => !EXT_EXCL.includes(r.bucket));
  // Extended Inventory ME compliance display — numerator uses the same
  // method as MSL (Yes-sum over buckets not in the exclude list, which for
  // Ext's default exclude list leaves exactly Auto + Manual + Other),
  // denominator is grand total No − grand total Yes. Kept separate from
  // meExtYes/meExtDen below, which still feed the combined MSL+Extended
  // banner above using their original (Yes/Total-based) definition.
  const extNumerator = meExtIncl.reduce((s, r) => s + (r.yes_me || 0), 0);
  const extGrandNo    = meExtRows.reduce((s, r) => s + (r.no_me  || 0), 0);
  const extGrandYes   = meExtRows.reduce((s, r) => s + (r.yes_me || 0), 0);
  const extComplianceDenom = extGrandNo - extGrandYes;
  const extCompliancePct = extComplianceDenom
    ? ((extNumerator / extComplianceDenom) * 100).toFixed(2)
    : '0.00';

  const meMslYes  = meMslIncl.reduce((s, r) => s + (r.yes_me || 0), 0);
  // Denominator is the grand-total "Yes" count across ALL patching-type
  // buckets (including excluded ones like EOL - No Patches), not the
  // included-only No+Yes total — matches the "Total" row's Yes column.
  const meMslDen  = meMslRows.reduce((s, r) => s + (r.yes_me || 0), 0);
  const meExtYes  = meExtIncl.reduce((s, r) => s + (r.yes_me || 0), 0);
  const meExtDen  = meExtIncl.reduce((s, r) => s + (r.total  || 0), 0);

  const now = new Date();

  return (
    <div>
      <Wgt tab="weekly" k="masthead">{/* ── Report masthead — the tab reads as a formal ops report ── */}
      <div className="wr-masthead">
        <div className="wr-masthead-top">
          <div>
            <span className="wr-eyebrow">{REPORT_TITLE}</span>
            <h2 className="wr-title">{REPORT_SUB}</h2>
          </div>
          <div className="wr-stamp">
            W{String(isoWeek(now)).padStart(2, '0')} · {now.getFullYear()}<br />
            Generated {now.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
        <div className="wr-figures">
          <Link to="/assets" className="wr-figure" title="Open Asset Inventory">
            <div className="wr-figure-value">{pct(mslOverall, mslOverallD)}<span className="wr-pct">%</span></div>
            <div className="wr-figure-label">MSL Compliance</div>
            <div className="wr-figure-detail">{mslOverall.toLocaleString()} / {mslOverallD.toLocaleString()}</div>
          </Link>
          <Link to="/ext-assets" className="wr-figure" title="Open Ext. Asset Inventory">
            <div className="wr-figure-value">{pct(extNum, extDen)}<span className="wr-pct">%</span></div>
            <div className="wr-figure-label">Ext. Compliance</div>
            <div className="wr-figure-detail">{extNum.toLocaleString()} / {extDen.toLocaleString()}</div>
          </Link>
          <div className="wr-figure">
            <div className="wr-figure-value">{pct(combNum, combDen)}<span className="wr-pct">%</span></div>
            <div className="wr-figure-label">Combined</div>
            <div className="wr-figure-detail">{combNum.toLocaleString()} / {combDen.toLocaleString()}</div>
          </div>
          <div className="wr-figure">
            <div className="wr-figure-value">{overallPatchPct}<span className="wr-pct">%</span></div>
            <div className="wr-figure-label">Patch Auto + Manual</div>
            <div className="wr-figure-detail">{overallPatchN.toLocaleString()} / {overallPatchD.toLocaleString()}</div>
          </div>
        </div>
      </div></Wgt>

      <Card bodyStyle={{ padding: '0 20px' }}>
        <Wgt tab="weekly" k="asset_inventory"><WeeklyReportRow label={<WTitle tab="weekly" k="asset_inventory" d="Asset Inventory" />}>
          <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 8, textDecoration: 'underline' }}>
            MSL OVERALL ACTIVE COUNT STATUS
          </Typography.Title>
          <Typography.Paragraph style={{ marginBottom: 6 }}><strong>Total Inventory Compliances:</strong></Typography.Paragraph>
          <Typography.Paragraph style={{ marginBottom: 16 }}>
            Overall Asset Inventory: <strong>{combNum.toLocaleString()}</strong> out of <strong>{combDen.toLocaleString()}</strong> X 100 = <strong>{pct(combNum, combDen)}%</strong>
          </Typography.Paragraph>

          <Typography.Paragraph style={{ marginBottom: 4 }}>
            Total Combined Inventory Count (Asset + Extended) is <strong>{combDen.toLocaleString()}</strong> (decommissioned excluded)
          </Typography.Paragraph>
          <Typography.Paragraph style={{ marginBottom: 4 }}>
            Total decommissioned (Asset + Extended): <strong>{((vmGaps.decommissioned ?? 0) + (ec.decommissioned ?? 0)).toLocaleString()}</strong>
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 4, marginTop: 8 }}>
            From active inventory, pending/follow-ups:
          </Typography.Paragraph>
          <ul style={{ paddingLeft: 18, marginBottom: 16 }}>
            <li><strong>{(vmGaps.no_password ?? 0).toLocaleString()}</strong> assets do not have password info.</li>
            <li>Around <strong>{(vmGaps.no_hosted_ip ?? 0).toLocaleString()}</strong> active assets are missing hosted/hypervisor details.</li>
            <li><strong>{(vmGaps.name_conflicts ?? 0).toLocaleString()}</strong> endpoints currently have name conflicts from OS Hostname.</li>
          </ul>

          {/* Location-wise count table — combined Asset Inventory + Ext. Assets */}
          <div className="weekly-breakdown-card" style={{ maxWidth: 320, marginTop: 12 }}>
            <Typography.Text underline strong style={{ display: 'block', marginBottom: 8, color: isDark ? '#60a5fa' : '#1d4ed8' }}>
              Location-wise count (Assets + Ext. Assets + Beijing Assets):
            </Typography.Text>
            <Table
              rowKey="location"
              size="small"
              dataSource={msl.assetExtLocations || []}
              pagination={false}
              tableLayout="fixed"
              locale={{ emptyText: 'No location data assigned' }}
              columns={[
                { title: 'Location', dataIndex: 'location' },
                { title: 'Count', dataIndex: 'count', align: 'right',
                  render: v => <strong>{(v ?? 0).toLocaleString()}</strong> },
              ]}
              summary={(rows) => {
                if (!rows.length) return null;
                const grand = rows.reduce((s, r) => s + (r.count ?? 0), 0);
                return (
                  <Table.Summary.Row style={{ fontWeight: 700 }}>
                    <Table.Summary.Cell index={0}><strong>Grand Total</strong></Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right"><strong>{grand.toLocaleString()}</strong></Table.Summary.Cell>
                  </Table.Summary.Row>
                );
              }}
            />
          </div>
        </WeeklyReportRow></Wgt>

        <Wgt tab="weekly" k="patch_management"><WeeklyReportRow label={<WTitle tab="weekly" k="patch_management" d="Patch Management Solution" />}>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={
              <span>
                <strong>Overall Patch Compliance (Auto + Manual):</strong>{' '}
                <strong>{overallPatchN.toLocaleString()}</strong> / <strong>{overallPatchD.toLocaleString()}</strong> ={' '}
                <strong>{overallPatchPct}%</strong>{' '}
                <Typography.Text type="secondary">(Not Applicable excluded)</Typography.Text>
              </span>
            }
          />
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <PatchingStatusCard title="Asset Inventory Patching Status" data={assetPatching} isDark={isDark} />
            </Col>
            <Col xs={24} lg={12}>
              <PatchingStatusCard title="Ext. Inventory Patching Status" data={extPatching} isDark={isDark} />
            </Col>
          </Row>
        </WeeklyReportRow></Wgt>
      </Card>

      <Wgt tab="weekly" k="location_patching"><div style={{ marginTop: 24 }}>
        <Typography.Text underline strong style={{ display: 'block', marginBottom: 8 }}>
          <WTitle tab="weekly" k="location_patching" d="Location wise auto/Manual-patching status:" />
        </Typography.Text>
        <Card bodyStyle={{ padding: 0 }} className="weekly-breakdown-card">
          <WeeklyBreakdownTable rows={filteredLocRows} groupLabel="Location" isDark={isDark}
            linkFor={(loc) => `/assets?loc=${encodeURIComponent(loc)}`}
            hiddenColumns={HIDDEN_COLS} pctExclude={PCT_EXCL} />
        </Card>
      </div></Wgt>

      <Wgt tab="weekly" k="department_patching"><div style={{ marginTop: 24 }}>
        <Typography.Text underline strong style={{ display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          <WTitle tab="weekly" k="department_patching" d="Departments Patching Onboarding Status:" />
        </Typography.Text>
        <Card bodyStyle={{ padding: 0 }} className="weekly-breakdown-card">
          <WeeklyBreakdownTable rows={filteredDeptRows} groupLabel="Department" isDark={isDark}
            linkFor={(dept) => `/assets?q=${encodeURIComponent(dept)}`}
            hiddenColumns={HIDDEN_COLS} pctExclude={PCT_EXCL} />
        </Card>
      </div></Wgt>

      {/* AUTO PATCHING GROUP COUNT STATUS */}
      <Wgt tab="weekly" k="me_compliance"><div style={{ marginTop: 32 }}>
        <Typography.Text underline strong style={{ display: 'block', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          <WTitle tab="weekly" k="me_compliance" d="Auto Patching Group Count Status" />{' '}
          <Typography.Text type="secondary" style={{ fontWeight: 400, textTransform: 'none', fontSize: 12 }}>
            (Includes the endpoints in staging state)
          </Typography.Text>
        </Typography.Text>

        {/* Overall combined ME compliance — MSL + Extended */}
        {(() => {
          const combinedYes = meMslYes + meExtYes;
          const combinedDen = meMslDen + meExtDen;
          const combinedPct = combinedDen ? ((combinedYes / combinedDen) * 100).toFixed(2) : '0.00';
          return (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 20 }}
              message={
                <span>
                  <strong>Overall ManageEngine Compliance (MSL + Extended Inventory):</strong>{' '}
                  <strong>{combinedYes.toLocaleString()}</strong>
                  {' / '}
                  <strong>{combinedDen.toLocaleString()}</strong>
                  {' × 100 = '}
                  <strong style={{ fontSize: 15 }}>{combinedPct}%</strong>
                  <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 10 }}>
                    (MSL: {meMslYes}/{meMslDen} · Extended: {meExtYes}/{meExtDen})
                  </Typography.Text>
                </span>
              }
            />
          );
        })()}

        <Card className="weekly-breakdown-card" bodyStyle={{ padding: 20 }} style={{ marginBottom: 20 }}>
          <Typography.Paragraph style={{ marginBottom: 12 }}>
            <Typography.Link underline strong>
              Manage Engine compliance with MSL
            </Typography.Link>{' '}
            → {meMslYes.toLocaleString()}/{meMslDen.toLocaleString()} x 100 ={' '}
            <strong>{meMslDen ? ((meMslYes / meMslDen) * 100).toFixed(2) : '0.00'}%</strong>{' '}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {MSL_FOOTNOTE}
            </Typography.Text>
          </Typography.Paragraph>
          <MEComplianceTable rows={meMslRows} excludedBuckets={MSL_EXCL} isDark={isDark} />
        </Card>

        <Card className="weekly-breakdown-card" bodyStyle={{ padding: 20 }}>
          <Typography.Paragraph style={{ marginBottom: 12 }}>
            <Typography.Link underline strong>
              Manage Engine compliance with Extended Inventory
            </Typography.Link>{' '}
            → {extNumerator.toLocaleString()}/{extComplianceDenom.toLocaleString()} x 100 ={' '}
            <strong>{extCompliancePct}%</strong>{' '}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {EXT_FOOTNOTE}
            </Typography.Text>
          </Typography.Paragraph>
          <MEComplianceTable rows={meExtRows} excludedBuckets={EXT_EXCL} isDark={isDark} />
        </Card>
      </div></Wgt>
    </div>
  );
}

// ---------------------------------------------------------------------------
// My Tasks — the logged-in user's own current recurring activity
// assignments (monthly + weekly rotation), computed server-side from the
// same rules as Recurring_Activity_Ready_Reckoner.md. Only the 3 team
// members named in that doc get anything back.
// ---------------------------------------------------------------------------

const TASK_STATUS_OPTS = [
  { value: 'not_started', label: 'Not Started', color: 'default' },
  { value: 'in_progress', label: 'In Progress',  color: 'processing' },
  { value: 'completed',   label: 'Completed',    color: 'success' },
];
const statusMeta = (v) => TASK_STATUS_OPTS.find(o => o.value === v) || TASK_STATUS_OPTS[0];

// Quick-glance status icon, top-right of each tile — same 3 states as the
// Status select below, just visible without reading the dropdown.
const STATUS_ICON = {
  not_started: { icon: <ClockCircleOutlined />, color: '#8c8c8c', title: 'Not Started' },
  in_progress: { icon: <SyncOutlined spin />,   color: '#1677ff', title: 'In Progress' },
  completed:   { icon: <CheckCircleOutlined />, color: '#52c41a', title: 'Completed' },
};

function TaskTile({ activity, nextPeriodLabel, index, onChange }) {
  const isShared = activity.type === 'shared';
  const color = isShared ? '#8c8c8c' : '#1677ff';
  const bg    = isShared ? 'rgba(140,140,140,0.12)' : 'rgba(22,119,255,0.12)';
  const meta  = statusMeta(activity.status);
  const statusIcon = STATUS_ICON[activity.status || 'not_started'];

  return (
    <div className="dashcard" style={{
      animationDelay: `${index * 60}ms`,
      border: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
      borderRadius: 10, padding: 16, height: '100%', position: 'relative',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <Tooltip title={statusIcon.title}>
        <span style={{ position: 'absolute', top: 12, right: 12, fontSize: 18, color: statusIcon.color, lineHeight: 1 }}>
          {statusIcon.icon}
        </span>
      </Tooltip>
      <Space align="start" style={{ paddingRight: 22 }}>
        <div style={{
          background: bg, color, width: 34, height: 34, borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          {isShared ? <TeamOutlined /> : <SyncOutlined />}
        </div>
        <Typography.Text strong style={{ fontSize: 14, lineHeight: 1.3 }}>{activity.label}</Typography.Text>
      </Space>

      <Space wrap size={[6, 6]}>
        <Tag color={isShared ? 'default' : 'blue'} style={{ margin: 0, fontWeight: 600 }}>
          {isShared ? 'Shared by all 3' : "It's yours this period"}
        </Tag>
        <Tag color={meta.color} style={{ margin: 0 }}>{meta.label}</Tag>
      </Space>

      <div>
        <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>Status</Typography.Text>
        <Select
          size="small"
          value={activity.status || 'not_started'}
          options={TASK_STATUS_OPTS}
          style={{ width: '100%' }}
          onChange={(v) => onChange({ status: v })}
        />
      </div>

      <Row gutter={8}>
        <Col span={12}>
          <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>Planned Date</Typography.Text>
          <DatePicker
            size="small"
            style={{ width: '100%' }}
            value={activity.plannedDate ? dayjs(activity.plannedDate) : null}
            onChange={(d) => onChange({ plannedDate: d ? d.format('YYYY-MM-DD') : null })}
          />
        </Col>
        <Col span={12}>
          <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 2 }}>Completed Date</Typography.Text>
          <DatePicker
            size="small"
            style={{ width: '100%' }}
            value={activity.completedDate ? dayjs(activity.completedDate) : null}
            onChange={(d) => onChange({ completedDate: d ? d.format('YYYY-MM-DD') : null })}
          />
        </Col>
      </Row>

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Next up: <strong>{activity.next}</strong> · {nextPeriodLabel}
      </Typography.Text>
    </div>
  );
}

function TaskSection({ icon, title, periodLabel, activities, nextPeriodLabel, onActivityChange }) {
  if (!activities.length) return null;
  return (
    <div style={{
      marginBottom: 24, padding: 16, borderRadius: 12,
      border: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
    }}>
      <Space align="center" style={{ marginBottom: 12 }}>
        <div style={{
          background: 'rgba(22,119,255,0.12)', color: '#1677ff',
          width: 32, height: 32, borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {icon}
        </div>
        <div>
          <Typography.Text strong style={{ fontSize: 15, display: 'block' }}>{title}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{periodLabel}</Typography.Text>
        </div>
      </Space>
      <Row gutter={[12, 12]}>
        {activities.map((a, i) => (
          <Col key={a.key} xs={24} sm={12} lg={8}>
            <TaskTile
              activity={a}
              nextPeriodLabel={nextPeriodLabel}
              index={i}
              onChange={(patch) => onActivityChange(a.key, patch)}
            />
          </Col>
        ))}
      </Row>
    </div>
  );
}

function MyTasksTab() {
  const { message } = App.useApp();
  const [tasks, setTasks] = useState(null);
  const [err, setErr] = useState('');

  function load() {
    api.get('/recurring-activities/my-tasks')
      .then(r => setTasks(r.data))
      .catch(e => setErr(e.response?.data?.error || 'Failed to load your tasks.'));
  }
  useEffect(() => { load(); }, []);

  // Applies the patch to local state immediately (so the control feels
  // instant) and persists it — reverts + surfaces an error if the save
  // fails (e.g. someone else is now assigned this task instead of you).
  function updateActivity(frequency, sectionPath, activityKey, patch) {
    const section = sectionPath.reduce((o, k) => o[k], tasks);
    const periodKey = section.periodKey;
    const prevActivity = section.activities.find(a => a.key === activityKey);
    if (!prevActivity) return;

    setTasks(t => {
      const next = structuredClone(t);
      const list = sectionPath.reduce((o, k) => o[k], next).activities;
      const idx = list.findIndex(a => a.key === activityKey);
      list[idx] = { ...list[idx], ...patch };
      return next;
    });

    api.put('/recurring-activities/status', { frequency, periodKey, activityKey, ...patch })
      .catch(e => {
        message.error(e.response?.data?.error || 'Failed to save — reverted');
        setTasks(t => {
          const next = structuredClone(t);
          const list = sectionPath.reduce((o, k) => o[k], next).activities;
          const idx = list.findIndex(a => a.key === activityKey);
          list[idx] = prevActivity;
          return next;
        });
      });
  }

  if (err) return <Alert type="error" message={err} showIcon />;
  if (!tasks) return <Spin />;

  if (!tasks.isTeamMember) {
    return (
      <Card>
        <Typography.Text type="secondary">
          You're not part of the recurring activity rotation tracked in Recurring_Activity_Ready_Reckoner.md.
        </Typography.Text>
      </Card>
    );
  }

  const total = tasks.monthly.current.activities.length + tasks.weekly.current.activities.length;

  return (
    <div>
      <style>{DASH_CSS}</style>
      <Typography.Paragraph type="secondary">
        {total
          ? `${total} recurring ${total === 1 ? 'activity is' : 'activities are'} yours this period.`
          : 'Your current recurring activity assignments, computed from the team rotation schedule.'}
      </Typography.Paragraph>

      {!total && (
        <Alert type="info" showIcon message="You have no recurring activities assigned for the current period." style={{ marginBottom: 16 }} />
      )}

      <TaskSection
        icon={<CalendarOutlined />}
        title="Last Month"
        periodLabel={tasks.monthly.period.last}
        activities={tasks.monthly.last.activities}
        nextPeriodLabel={tasks.monthly.period.current}
        onActivityChange={(key, patch) => updateActivity('monthly', ['monthly', 'last'], key, patch)}
      />

      <TaskSection
        icon={<CalendarOutlined />}
        title="Current Month"
        periodLabel={tasks.monthly.period.current}
        activities={tasks.monthly.current.activities}
        nextPeriodLabel={tasks.monthly.period.next}
        onActivityChange={(key, patch) => updateActivity('monthly', ['monthly', 'current'], key, patch)}
      />

      <TaskSection
        icon={<CalendarOutlined />}
        title="Current Week"
        periodLabel={tasks.weekly.period.current}
        activities={tasks.weekly.current.activities}
        nextPeriodLabel={tasks.weekly.period.next}
        onActivityChange={(key, patch) => updateActivity('weekly', ['weekly', 'current'], key, patch)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root Dashboard — toggle between Inventory and Infrastructure views
// ---------------------------------------------------------------------------

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

  const [view, setView] = useState(() => localStorage.getItem('dashView') || 'inventory');
  const [data, setData] = useState(null);
  const [err,  setErr]  = useState('');

  const [dashCfg, setDashCfg] = useState(null);
  const [compCfg, setCompCfg] = useState({});

  useEffect(() => {
    setData(null);
    setErr('');
    api.get('/dashboard/summary')
      .then(r => setData(r.data))
      .catch(e => setErr(e.response?.data?.error || 'Failed'));
    api.get('/dashboard/config')
      .then(r => {
        const cfg = r.data.config || {};
        setDashCfg(cfg);
        if (!localStorage.getItem('dashView')) setView(resolveDefaultView(cfg));
      })
      .catch(() => setDashCfg({}));
    api.get('/compliance-config')
      .then(r => setCompCfg(r.data.config || {}))
      .catch(() => setCompCfg({}));
  }, []); // eslint-disable-line

  function handleViewChange(v) {
    setView(v);
    localStorage.setItem('dashView', v);
  }

  const TAB_CONTENT = {
    exec:   (d) => <><ExecutiveOverview data={d} compCfg={compCfg} /><CustomWidgets tab="exec" /></>,
    asset:  (d) => <><AssetInventoryTab data={d} isDark={isDark} axisStyle={axisStyle}
                     labelStyle={labelStyle} legendStyle={legendStyle} chartTheme={chartTheme} /><CustomWidgets tab="asset" /></>,
    ext:    (d) => <><ExtendedInventoryTab data={d} compCfg={compCfg} /><CustomWidgets tab="ext" /></>,
    weekly: (d) => <WeeklyReportTab data={d} isDark={isDark} compCfg={compCfg} />,
    my_tasks: () => <MyTasksTab />,
  };
  const cfgTabs = resolveTabs(dashCfg || {}).filter(t => t.visible && TAB_CONTENT[t.key]);
  const tabItems = (cfgTabs.length ? cfgTabs : [{ key: 'exec', title: 'Executive Overview' }])
    .map(t => ({ key: t.key, label: t.title, children: data ? TAB_CONTENT[t.key](data) : null }));
  const defaultTab = resolveDefaultTab(dashCfg || {});

  return (
    <DashCfgCtx.Provider value={{ cfg: dashCfg || {} }}>
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <Space.Compact>
          <Button
            type={view === 'inventory' ? 'primary' : 'default'}
            icon={<DatabaseOutlined />}
            onClick={() => handleViewChange('inventory')}
          >
            Inventory Dashboard
          </Button>
          <Button
            type={view === 'infrastructure' ? 'primary' : 'default'}
            icon={<ApartmentOutlined />}
            onClick={() => handleViewChange('infrastructure')}
          >
            VMware &amp; Proxmox
          </Button>
        </Space.Compact>
      </div>

      {/* Infrastructure view */}
      {view === 'infrastructure' && <InfrastructureDashboard />}

      {/* Inventory view */}
      {view === 'inventory' && (
        <>
          {err  && <Alert type="error" message={err} />}
          {(!data || dashCfg === null) && !err && <Spin />}
          {data && dashCfg !== null && (
            <Tabs
              key={defaultTab}
              defaultActiveKey={defaultTab}
              items={tabItems}
            />
          )}
        </>
      )}
    </div>
    </DashCfgCtx.Provider>
  );
}
