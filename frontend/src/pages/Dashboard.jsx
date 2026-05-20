import { useEffect, useState } from 'react';
import {
  Row, Col, Card, Table, Tag, Spin, Alert, Typography, Tabs, Space, Statistic, Progress,
} from 'antd';
import {
  DatabaseOutlined, SafetyCertificateOutlined, ThunderboltOutlined,
  HddOutlined, DesktopOutlined, AppstoreOutlined, SafetyOutlined, BugOutlined,
  ToolOutlined, StopOutlined, TeamOutlined, WarningOutlined,
  ClockCircleOutlined, PauseCircleOutlined, CheckCircleOutlined, PoweroffOutlined,
  CloseCircleOutlined, BlockOutlined,
  BarChartOutlined, CalendarOutlined, FundOutlined, RiseOutlined,
} from '@ant-design/icons';
import { Pie, Column } from '@ant-design/plots';
import api from '../api/client';
import { useAppTheme } from '../context/ThemeContext.jsx';

function StatTile({ icon, value, label, color }) {
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
            {Number.isFinite(value) ? value.toLocaleString() : (value ?? '—')}
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

function ratioLine({ label, numerator, denominator, tone }) {
  const pct = denominator ? (numerator / denominator) * 100 : 0;
  const toneStyle = {
    blue:   { bg: 'rgba(22,119,255,0.08)',  fg: '#1d4ed8' },
    indigo: { bg: 'rgba(99,102,241,0.10)',  fg: '#4338ca' },
    green:  { bg: 'rgba(34,197,94,0.10)',   fg: '#15803d' },
  }[tone || 'blue'];
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

function ExecutiveOverview({ data }) {
  const h = data.headline || {};
  const a = data.assetInventory || {};
  const e = data.extendedInventory || {};
  const msl = data.mslCompliance || {};
  const ec  = data.extEndpointCompliance || {};

  return (
    <div>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
              <div>
                <Typography.Text type="secondary">Total Inventory</Typography.Text>
                <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.1 }}>
                  {(h.totalInventory ?? 0).toLocaleString()}
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
          <Card>
            <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
              <div>
                <Typography.Text type="secondary">Patching Compliance</Typography.Text>
                <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.1 }}>
                  {(h.patchingCompliancePct ?? 0).toFixed(1)}%
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
          <Card>
            <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
              <div>
                <Typography.Text type="secondary">Operational Readiness</Typography.Text>
                <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.1 }}>
                  {(h.operationalReadinessPct ?? 0).toFixed(2)}%
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
          <Card>
            <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
              <div>
                <Typography.Text type="secondary">Infrastructure Health Score</Typography.Text>
                <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.1, color: '#1677ff' }}>
                  {h.infrastructureHealthScore ?? 0}
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

      <div style={{ marginTop: 24 }}>
        <Space size={10} style={{ marginBottom: 12 }}>
          <div style={{ background: 'rgba(22,119,255,0.12)', color: '#1677ff',
            width: 36, height: 36, borderRadius: 8, display: 'flex',
            alignItems: 'center', justifyContent: 'center' }}>
            <BarChartOutlined />
          </div>
          <div>
            <Typography.Title level={5} style={{ margin: 0 }}>Asset Inventory Summary</Typography.Title>
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
      </div>

      <div style={{ marginTop: 24 }}>
        <Space size={10} style={{ marginBottom: 12 }}>
          <div style={{ background: 'rgba(67,56,202,0.16)', color: '#4338ca',
            width: 36, height: 36, borderRadius: 8, display: 'flex',
            alignItems: 'center', justifyContent: 'center' }}>
            <AppstoreOutlined />
          </div>
          <div>
            <Typography.Title level={5} style={{ margin: 0 }}>Extended Inventory Summary</Typography.Title>
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
      </div>

      <Card style={{ marginTop: 24 }}
        title={
          <Space>
            <div style={{ background: 'rgba(22,119,255,0.12)', color: '#1677ff',
              width: 36, height: 36, borderRadius: 8, display: 'flex',
              alignItems: 'center', justifyContent: 'center' }}>
              <RiseOutlined />
            </div>
            <div>
              <Typography.Title level={5} style={{ margin: 0 }}>Total Inventory MSL Compliance</Typography.Title>
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
        <Table
          size="small"
          rowKey="location"
          pagination={false}
          dataSource={msl.locations || []}
          columns={[
            { title: 'Location', dataIndex: 'location' },
            { title: 'Count', dataIndex: 'count', align: 'right', width: 120,
              render: v => <a style={{ fontWeight: 600 }}>{(v ?? 0).toLocaleString()}</a> },
          ]}
        />
      </Card>

      <Card style={{ marginTop: 16 }}
        title={
          <Space>
            <div style={{ background: 'rgba(67,56,202,0.16)', color: '#4338ca',
              width: 36, height: 36, borderRadius: 8, display: 'flex',
              alignItems: 'center', justifyContent: 'center' }}>
              <AppstoreOutlined />
            </div>
            <div>
              <Typography.Title level={5} style={{ margin: 0 }}>Ext. Endpoint Compliance</Typography.Title>
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
          <Col xs={24} md={12}><ExtChip label="ManageEngine Installed" value={ec.meInstalled}     tone="emerald" /></Col>
          <Col xs={24} md={12}><ExtChip label="ME Not Applicable"      value={ec.meNotApplicable} tone="gray" /></Col>
          <Col xs={24} md={12}><ExtChip label="Name Conflicts"         value={ec.nameConflicts}   tone="yellow" /></Col>
          <Col xs={24} md={12}><ExtChip label="Auto Patching"          value={ec.autoPatching}    tone="green" /></Col>
          <Col xs={24} md={12}><ExtChip label="Manual Patching"        value={ec.manualPatching}  tone="blue" /></Col>
        </Row>
      </Card>
    </div>
  );
}

function AssetInventoryTab({ data, isDark, axisStyle, labelStyle, legendStyle, chartTheme }) {
  return (
    <div>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="Assets by OS Type">
            <Pie data={data.charts?.byOsType || []} angleField="value" colorField="key" radius={0.85}
              theme={chartTheme}
              label={{ text: 'value', position: 'outside', style: labelStyle }}
              legend={{ position: 'bottom', ...legendStyle }}
              height={260} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Assets by Server Status">
            <Column data={data.charts?.byServerStatus || []} xField="key" yField="value" height={260}
              theme={chartTheme}
              axis={{ x: axisStyle, y: axisStyle }}
              label={{ position: 'top', style: labelStyle }} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Assets by Location">
            <Column data={data.charts?.byLocation || []} xField="key" yField="value" height={260}
              theme={chartTheme}
              axis={{ x: axisStyle, y: axisStyle }}
              label={{ position: 'top', style: labelStyle }} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="EOL Status">
            <Pie data={data.charts?.byEolStatus || []} angleField="value" colorField="key" radius={0.85}
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
          size="small"
          dataSource={data.recentAssets || []}
          pagination={false}
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
      </Card>
    </div>
  );
}

function ExtendedInventoryTab({ data }) {
  const e = data.extendedInventory || {};
  const rows = [
    { metric: 'Total records',          value: e.total },
    { metric: 'Active',                 value: e.active },
    { metric: 'Inactive',               value: e.inactive },
    { metric: 'With ManageEngine',      value: e.meInstalled },
    { metric: 'With Tenable',           value: e.tenable },
  ];
  return (
    <Card title="Extended Inventory Breakdown">
      <Table
        rowKey="metric"
        size="small"
        pagination={false}
        dataSource={rows}
        columns={[
          { title: 'Metric', dataIndex: 'metric' },
          { title: 'Count',  dataIndex: 'value', align: 'right',
            render: v => <strong>{(v ?? 0).toLocaleString()}</strong> },
        ]}
      />
    </Card>
  );
}

function WeeklyReportTab({ data }) {
  const w = data.weekly || {};
  const delta = (w.addedThisWeek || 0) - (w.addedLastWeek || 0);
  const deltaPct = w.addedLastWeek ? Math.round((delta / w.addedLastWeek) * 100) : null;
  const compliance = Math.round((w.currentCompliancePct ?? 0) * 10) / 10;

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} md={8}>
        <Card>
          <Statistic
            title="Assets added this week"
            value={w.addedThisWeek ?? 0}
            prefix={<CalendarOutlined />}
          />
          <Typography.Text type="secondary">
            Previous 7 days: <strong>{w.addedLastWeek ?? 0}</strong>
            {deltaPct !== null && (
              <> · <span style={{ color: delta >= 0 ? '#389e0d' : '#cf1322' }}>
                {delta >= 0 ? '+' : ''}{deltaPct}%
              </span></>
            )}
          </Typography.Text>
        </Card>
      </Col>
      <Col xs={24} md={8}>
        <Card>
          <Statistic
            title="Patching Compliance"
            value={compliance}
            suffix="%"
            prefix={<SafetyCertificateOutlined />}
          />
          <Progress percent={Math.min(100, compliance)} showInfo={false} strokeColor="#16a34a" />
        </Card>
      </Col>
      <Col xs={24} md={8}>
        <Card>
          <Statistic
            title="Total managed"
            value={w.totalNow ?? 0}
            prefix={<DatabaseOutlined />}
          />
          <Typography.Text type="secondary">
            Compliant: <strong>{w.compliantNow ?? 0}</strong>
          </Typography.Text>
        </Card>
      </Col>
    </Row>
  );
}

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
    api.get('/dashboard/summary')
      .then(r => setData(r.data))
      .catch(e => setErr(e.response?.data?.error || 'Failed'));
  }, []);

  if (err) return <Alert type="error" message={err} />;
  if (!data) return <Spin />;

  return (
    <div>
      <Tabs
        defaultActiveKey="exec"
        items={[
          {
            key: 'exec', label: 'Executive Overview',
            children: <ExecutiveOverview data={data} />,
          },
          {
            key: 'asset', label: 'Asset Inventory',
            children: <AssetInventoryTab data={data} isDark={isDark} axisStyle={axisStyle}
                        labelStyle={labelStyle} legendStyle={legendStyle} chartTheme={chartTheme} />,
          },
          {
            key: 'ext', label: 'Extended Inventory',
            children: <ExtendedInventoryTab data={data} />,
          },
          {
            key: 'weekly', label: 'Weekly Report',
            children: <WeeklyReportTab data={data} />,
          },
        ]}
      />
    </div>
  );
}
