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
  EnvironmentOutlined,
} from '@ant-design/icons';
import { Pie, Column, Bar } from '@ant-design/plots';
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

function DonutRing({ percent, color = '#22c55e', label, sub }) {
  const r = 38, c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, percent || 0));
  const offset = c - (pct / 100) * c;
  return (
    <div style={{ width: 110, textAlign: 'center', flexShrink: 0 }}>
      <svg width="110" height="110" viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="50" cy="50" r={r} stroke="rgba(0,0,0,0.08)" strokeWidth="10" fill="none" />
        <circle cx="50" cy="50" r={r} stroke={color} strokeWidth="10" fill="none"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
      </svg>
      <div style={{ marginTop: -82, fontSize: 22, fontWeight: 700 }}>{pct.toFixed(0)}%</div>
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
  return (
    <div style={{
      background: toneStyle.bg, color: toneStyle.fg,
      padding: '12px 16px', borderRadius: 8,
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>
        {(value ?? 0).toLocaleString()}
      </div>
      <div style={{ fontSize: 13 }}>{label}</div>
    </div>
  );
}

function AssetInventoryTab({ data, isDark, axisStyle, labelStyle, legendStyle, chartTheme }) {
  const as = data.assetInventoryActiveStatus || {};
  const ps = data.assetInventoryPatchingStatus || {};
  const vmLoc = data.vmCountByLocation || [];
  const activePct  = as.total ? (as.active / as.total) * 100 : 0;
  const patchedPct = ps.total ? ((ps.auto_patching + ps.manual_patching) / ps.total) * 100 : 0;
  const labelColor = isDark ? '#f0f0f0' : '#262626';

  const activeStatusCard = (
    <Card style={{ marginBottom: 16 }}
      title={
        <Space>
          <div style={{ background: 'rgba(22,119,255,0.12)', color: '#1677ff',
            width: 36, height: 36, borderRadius: 8, display: 'flex',
            alignItems: 'center', justifyContent: 'center' }}>
            <RiseOutlined />
          </div>
          <div>
            <Typography.Title level={5} style={{ margin: 0 }}>Asset Inventory Active Status</Typography.Title>
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
    <Card style={{ marginBottom: 16 }}
      title={
        <Space>
          <div style={{ background: 'rgba(22,119,255,0.12)', color: '#1677ff',
            width: 36, height: 36, borderRadius: 8, display: 'flex',
            alignItems: 'center', justifyContent: 'center' }}>
            <ThunderboltOutlined />
          </div>
          <div>
            <Typography.Title level={5} style={{ margin: 0 }}>Asset Inventory Patching Status</Typography.Title>
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
    <Card style={{ marginBottom: 16 }}
      title={
        <Space>
          <div style={{ background: 'rgba(22,119,255,0.12)', color: '#1677ff',
            width: 36, height: 36, borderRadius: 8, display: 'flex',
            alignItems: 'center', justifyContent: 'center' }}>
            <EnvironmentOutlined />
          </div>
          <div>
            <Typography.Title level={5} style={{ margin: 0 }}>VM Count by Location</Typography.Title>
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

      {activeStatusCard}
      {patchingStatusCard}
      {vmLocationCard}

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

      <div style={{ marginTop: 24 }}>
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
                <Typography.Title level={5} style={{ margin: 0 }}>Ext. Dept-wise Endpoint Distribution</Typography.Title>
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
      </div>
    </div>
  );
}

function PatchPill({ n, label, tone }) {
  const palette = {
    green:  { bg: 'rgba(34,197,94,0.10)',  fg: '#15803d' },
    blue:   { bg: 'rgba(59,130,246,0.10)', fg: '#1d4ed8' },
    yellow: { bg: 'rgba(234,179,8,0.18)',  fg: '#a16207' },
    purple: { bg: 'rgba(168,85,247,0.10)', fg: '#7e22ce' },
    red:    { bg: 'rgba(239,68,68,0.10)',  fg: '#b91c1c' },
    cyan:   { bg: 'rgba(6,182,212,0.10)',  fg: '#0e7490' },
    gray:   { bg: 'rgba(148,163,184,0.12)',fg: '#475569' },
    orange: { bg: 'rgba(249,115,22,0.10)', fg: '#c2410c' },
  }[tone || 'gray'];
  return (
    <div style={{
      background: palette.bg, color: palette.fg,
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
            <Col xs={12} md={8}><PatchPill n={data?.auto_patching}     label="Auto"               tone="green" /></Col>
            <Col xs={12} md={8}><PatchPill n={data?.manual_patching}   label="Manual"             tone="blue" /></Col>
            <Col xs={12} md={8}><PatchPill n={data?.exception}         label="Exception"          tone="yellow" /></Col>
            <Col xs={12} md={8}><PatchPill n={data?.beijing_it}        label="Beijing IT"         tone="purple" /></Col>
            <Col xs={12} md={8}><PatchPill n={data?.eol}               label="EOL - No Patches"   tone="red" /></Col>
            <Col xs={12} md={8}><PatchPill n={data?.pending}           label="Pending"            tone="cyan" /></Col>
            <Col xs={12} md={8}><PatchPill n={data?.on_hold}           label="On Hold"            tone="gray" /></Col>
            <Col xs={12} md={8}><PatchPill n={data?.alive_powered_off} label="Alive Powered Off"  tone="orange" /></Col>
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
    <Row gutter={16} style={{ padding: '16px 0', borderBottom: '1px solid var(--ant-color-border-secondary, #f0f0f0)' }}>
      <Col xs={24} md={4}>
        <Typography.Text strong>{label}</Typography.Text>
      </Col>
      <Col xs={24} md={20}>{children}</Col>
    </Row>
  );
}

function WeeklyBreakdownTable({ rows, groupLabel }) {
  // Each cell: link-coloured number when > 0, "-" when zero.
  const numCell = (v, color) => {
    const n = Number(v ?? 0);
    if (n === 0) return <span style={{ color: '#94a3b8' }}>-</span>;
    return <span style={{ color, fontWeight: 600 }}>{n.toLocaleString()}</span>;
  };
  const columns = [
    { title: `${groupLabel} \\ Patching Type`, dataIndex: 'bucket', fixed: 'left', width: 220,
      render: v => <strong>{v}</strong> },
    { title: 'Alive But Powered Off', dataIndex: 'alive_powered_off', width: 170, align: 'center', render: v => numCell(v, '#c2410c') },
    { title: 'Auto',                  dataIndex: 'auto_patching',     width: 90,  align: 'center', render: v => numCell(v, '#15803d') },
    { title: 'Beijing IT Team',       dataIndex: 'beijing_it',        width: 140, align: 'center', render: v => numCell(v, '#7e22ce') },
    { title: 'EOL - No Patches',      dataIndex: 'eol',               width: 140, align: 'center', render: v => numCell(v, '#b91c1c') },
    { title: 'Exception',             dataIndex: 'exception',         width: 110, align: 'center', render: v => numCell(v, '#a16207') },
    { title: 'Manual',                dataIndex: 'manual_patching',   width: 90,  align: 'center', render: v => numCell(v, '#1d4ed8') },
    { title: 'On Hold',               dataIndex: 'on_hold',           width: 90,  align: 'center', render: v => numCell(v, '#475569') },
    { title: 'Onboard Pending',       dataIndex: 'onboard_pending',   width: 140, align: 'center', render: v => numCell(v, '#0e7490') },
    { title: 'Total',                 dataIndex: 'total',             width: 90,  align: 'center',
      render: v => <strong>{Number(v ?? 0).toLocaleString()}</strong> },
    { title: 'Percentage',            dataIndex: 'pct',               width: 110, align: 'center',
      render: v => <strong>{(v ?? 0).toFixed(2)}%</strong> },
  ];

  // Percentage = (Total - Alive But Powered Off - EOL) / Total — the
  // fraction of records that are actively in scope for patching.
  const enriched = (rows || []).map(r => {
    const total = Number(r.total || 0);
    const inScope = total - Number(r.alive_powered_off || 0) - Number(r.eol || 0);
    return { ...r, pct: total ? (inScope / total) * 100 : 0 };
  });

  const sumKey = (key) => enriched.reduce((s, r) => s + Number(r[key] || 0), 0);
  const totalSum = sumKey('total');
  const inScopeSum = totalSum - sumKey('alive_powered_off') - sumKey('eol');
  const totalPct = totalSum ? (inScopeSum / totalSum) * 100 : 0;

  return (
    <Table
      rowKey="bucket"
      size="small"
      dataSource={enriched}
      columns={columns}
      pagination={false}
      scroll={{ x: 'max-content' }}
      summary={() => (
        <Table.Summary.Row style={{ background: 'rgba(22,119,255,0.06)', fontWeight: 700 }}>
          <Table.Summary.Cell index={0}><strong>Total</strong></Table.Summary.Cell>
          {['alive_powered_off','auto_patching','beijing_it','eol','exception','manual_patching','on_hold','onboard_pending'].map((k, i) => {
            const v = sumKey(k);
            return (
              <Table.Summary.Cell key={k} index={i + 1} align="center">
                {v === 0 ? <span style={{ color: '#94a3b8' }}>-</span> : <strong>{v.toLocaleString()}</strong>}
              </Table.Summary.Cell>
            );
          })}
          <Table.Summary.Cell index={9}  align="center"><strong>{totalSum.toLocaleString()}</strong></Table.Summary.Cell>
          <Table.Summary.Cell index={10} align="center"><strong>{totalPct.toFixed(2)}%</strong></Table.Summary.Cell>
        </Table.Summary.Row>
      )}
    />
  );
}

function WeeklyReportTab({ data, isDark }) {
  const msl = data.mslCompliance || {};
  const ec  = data.extEndpointCompliance || {};
  const vmGaps = data.weeklyVmGaps || {};
  const assetPatching = data.assetInventoryPatchingStatus || {};
  const extPatching   = data.extInventoryPatchingStatus || {};
  const locRows  = data.weeklyLocationPatching || [];
  const deptRows = data.weeklyDepartmentPatching || [];

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

  return (
    <div>
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        Last refreshed: {new Date().toLocaleString()}
      </Typography.Text>

      <Card bodyStyle={{ padding: '0 20px' }}>
        <WeeklyReportRow label="Asset Inventory">
          <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 8, textDecoration: 'underline' }}>
            MSL OVERALL ACTIVE COUNT STATUS
          </Typography.Title>
          <Typography.Paragraph style={{ marginBottom: 6 }}>
            <strong>Total Inventory MSL Compliance:</strong>
          </Typography.Paragraph>
          <Typography.Paragraph style={{ marginBottom: 4 }}>
            <strong>Asset Inventory Overall:</strong> {mslOverall.toLocaleString()} out of {mslOverallD.toLocaleString()} X 100 = <strong>{pct(mslOverall, mslOverallD)}%</strong>
          </Typography.Paragraph>
          <Typography.Paragraph style={{ marginBottom: 4 }}>
            <strong>Ext. Asset Inventory Overall:</strong> {extNum.toLocaleString()} out of {extDen.toLocaleString()} X 100 = <strong>{pct(extNum, extDen)}%</strong>
          </Typography.Paragraph>
          <Typography.Paragraph style={{ marginBottom: 16 }}>
            <strong>Asset + Ext Overall:</strong> {combNum.toLocaleString()} out of {combDen.toLocaleString()} X 100 = <strong>{pct(combNum, combDen)}%</strong>
          </Typography.Paragraph>

          <Typography.Paragraph style={{ marginBottom: 4 }}>
            <strong>Total Asset Inventory Count is {mslOverall.toLocaleString()}</strong>
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>From active inventory, pending/follow-ups:</Typography.Paragraph>
          <ul style={{ paddingLeft: 18, marginBottom: 4 }}>
            <li><strong>{(vmGaps.no_password ?? 0).toLocaleString()}</strong> assets do not have password info.</li>
            <li>Around <strong>{(vmGaps.no_hosted_ip ?? 0).toLocaleString()}</strong> active assets are missing hosted/hypervisor details.</li>
            <li><strong>{(vmGaps.name_conflicts ?? 0).toLocaleString()}</strong> endpoints currently have name conflicts from OS Hostname.</li>
            <li><strong>Follow-ups are in progress for pending info, name conflicts, and password issues.</strong></li>
          </ul>
        </WeeklyReportRow>

        <WeeklyReportRow label="Extended Inventory">
          <Typography.Paragraph style={{ marginBottom: 4 }}>
            <strong>Total {(ec.total ?? 0).toLocaleString()} endpoints</strong>
          </Typography.Paragraph>
          <Typography.Paragraph style={{ marginBottom: 4 }}>
            For <strong>{(ec.withPassword ?? 0).toLocaleString()}</strong> endpoints, password info is received.
          </Typography.Paragraph>
          <Typography.Paragraph strong style={{ color: '#1d4ed8', marginBottom: 12 }}>
            Compliance: {(ec.withPassword ?? 0).toLocaleString()} out of {(ec.total ?? 0).toLocaleString()} = {pct(ec.withPassword, ec.total)}%
          </Typography.Paragraph>
          <ul style={{ paddingLeft: 18, marginBottom: 0 }}>
            <li><strong>{(ec.autoPatching ?? 0).toLocaleString()}</strong> VMs have been added to auto patching.</li>
            <li><strong>{(ec.manualPatching ?? 0).toLocaleString()}</strong> VMs are marked as manual patching.</li>
            <li><strong>{(ec.meInstalled ?? 0).toLocaleString()}</strong> VMs have ME Agent installed.</li>
          </ul>
        </WeeklyReportRow>

        <WeeklyReportRow label="Patch Management Solution">
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
        </WeeklyReportRow>
      </Card>

      <div style={{ marginTop: 24 }}>
        <Typography.Text underline strong style={{ display: 'block', marginBottom: 8 }}>
          Location wise auto/Manual-patching status:
        </Typography.Text>
        <Card bodyStyle={{ padding: 0 }} className="weekly-breakdown-card">
          <WeeklyBreakdownTable rows={locRows} groupLabel="Location" />
        </Card>
      </div>

      <div style={{ marginTop: 24 }}>
        <Typography.Text underline strong style={{ display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          Departments Patching Onboarding Status:
        </Typography.Text>
        <Card bodyStyle={{ padding: 0 }} className="weekly-breakdown-card">
          <WeeklyBreakdownTable rows={deptRows} groupLabel="Department" />
        </Card>
      </div>
    </div>
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
            children: <WeeklyReportTab data={data} isDark={isDark} />,
          },
        ]}
      />
    </div>
  );
}
