import { useState, useEffect, useCallback } from 'react';
import {
  Card, Select, Button, Space, Typography, Row, Col, Checkbox,
  Tag, Spin, Alert, Divider, theme, Tabs, message, Table, Skeleton, Input,
} from 'antd';
import {
  SaveOutlined, ReloadOutlined, RiseOutlined, AppstoreOutlined,
  SafetyCertificateOutlined, EnvironmentOutlined, CalendarOutlined,
  BarChartOutlined, HddOutlined, FundOutlined, SyncOutlined,
} from '@ant-design/icons';
import api from '../../api/client';
import { useAppTheme } from '../../context/ThemeContext.jsx';

const { Title, Text, Paragraph } = Typography;

// ── Defaults (kept in sync with backend complianceConfigController.js) ───────
const DEFAULT_CONFIG = {
  msl: {
    include_asset_types:       ['VM', 'Bare Metal Server', 'Physical Server', 'Other'],
    include_server_statuses:   ['Alive', 'Alive But Powered Off', 'Need to check', 'Decommissioned'],
    exclude_eol_statuses:      ['Decom', 'Not Applicable'],
    include_password_statuses: ['Known'],
    pivot:                     'location',
  },
  ext: {
    exclude_item_statuses:        [],
    exclude_eol_statuses:         [],
    auto_patching_types:          ['Auto'],
    manual_patching_types:        ['Manual'],
    name_conflict_fields:         ['vm_name', 'os_hostname'],
    me_na_patching_types:         ['Exception', 'Beijing IT Team'],
    me_na_server_statuses:        ['Not Alive'],
    me_na_eol_statuses:           ['Decom', 'Not Applicable'],
    me_na_requires_not_installed: true,
    hidden_ext_chips:             [],
    ext_chip_labels:              {},
  },
  weekly: {
    me_msl_exclude_buckets:      ['Beijing IT Team', 'Not Applicable', 'Alive But Powered Off', 'EOL - No Patches'],
    me_ext_exclude_buckets:      ['Beijing IT Team', 'Not Applicable', 'Alive But Powered Off', 'EOL - No Patches', 'Exception'],
    me_msl_footnote:             '',
    me_ext_footnote:             '',
    breakdown_hidden_columns:    [],
    breakdown_pct_exclude:       ['alive_powered_off', 'eol'],
    breakdown_excluded_locations:    [],
    breakdown_excluded_departments:  [],
    report_title:    '',
    report_subtitle: '',
  },
};

const HINTS = {
  server_statuses:   ['Active', 'Inactive', 'Not Alive', 'Maintenance', 'Onboard Pending', 'On Hold', 'Not in Scope'],
  eol_statuses:      ['InSupport', 'EOL', 'Decom', 'Not Applicable', 'NA'],
  item_statuses:     ['Active', 'Inactive', 'Decommissioned', 'Maintenance'],
  patching_types:    ['Auto', 'Manual', 'Exception', 'Beijing IT Team', 'EOL - No Patches', 'Not Applicable', 'Onboard Pending', 'On Hold', 'Alive But Powered Off'],
  conflict_fields:   ['asset_name', 'ip_address'],
  asset_types:       ['VM', 'Bare Metal Server', 'Physical Server', 'Other', 'Network Device', 'Container'],
  password_statuses: ['Known', 'Unknown', 'Not Required'],
  me_buckets:        ['Auto', 'Manual', 'Exception', 'Beijing IT Team', 'EOL - No Patches', 'Not Applicable', 'Onboard Pending', 'On Hold', 'Alive But Powered Off'],
};

const PIVOT_OPTIONS = [
  { value: 'location',   label: 'Location' },
  { value: 'department', label: 'Department' },
  { value: 'asset_type', label: 'Asset Type' },
  { value: 'eol_status', label: 'EOL Status' },
];

const ME_BUCKET_ORDER = [
  'Alive But Powered Off', 'Auto', 'Beijing IT Team', 'EOL - No Patches',
  'Exception', 'Manual', 'Not Applicable', 'On Hold', 'Onboard Pending',
];

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard card rendering helpers (replicated from Dashboard.jsx exactly)
// ─────────────────────────────────────────────────────────────────────────────

function ratioLine({ label, numerator = 0, denominator = 0, tone }) {
  const pct = denominator ? (numerator / denominator) * 100 : 0;
  const TONES = {
    blue:   { bg: 'rgba(22,119,255,0.08)',  fg: '#1d4ed8' },
    indigo: { bg: 'rgba(99,102,241,0.10)',  fg: '#4338ca' },
    green:  { bg: 'rgba(34,197,94,0.10)',   fg: '#15803d' },
  };
  const toneStyle = TONES[tone] ?? TONES.blue;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '9px 12px', borderRadius: 8,
      background: toneStyle.bg, color: toneStyle.fg, marginBottom: 6,
    }}>
      <Text style={{ fontSize: 13, color: toneStyle.fg }}>{label}</Text>
      <strong style={{ fontFamily: 'monospace', fontSize: 13 }}>
        {numerator.toLocaleString()} / {denominator.toLocaleString()} = {pct.toFixed(2)}%
      </strong>
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
      padding: '8px 12px', borderRadius: 8, fontSize: 13,
      background: toneStyle.bg, border: `1px solid ${toneStyle.border}`,
      color: toneStyle.fg,
    }}>
      {label}: <strong>{(value ?? 0).toLocaleString()}</strong>
    </div>
  );
}

// Compact ME compliance table used in the live preview
function MePreviewTable({ rows, excludedBuckets, isDark }) {
  const { token } = theme.useToken();
  const accent   = isDark ? '#60a5fa' : '#1d4ed8';
  const dimColor = isDark ? '#555' : '#bbb';
  const sorted   = [...rows].sort(
    (a, b) => ME_BUCKET_ORDER.indexOf(a.bucket) - ME_BUCKET_ORDER.indexOf(b.bucket),
  );
  const inclRows = sorted.filter(r => !excludedBuckets.includes(r.bucket));
  const totalYes = inclRows.reduce((s, r) => s + (r.yes_me || 0), 0);
  const totalDen = inclRows.reduce((s, r) => s + (r.total  || 0), 0);
  const pct      = totalDen ? ((totalYes / totalDen) * 100).toFixed(2) : '0.00';

  const columns = [
    {
      title: 'Patching Type',
      dataIndex: 'bucket',
      render: (v) => {
        const excl = excludedBuckets.includes(v);
        return (
          <span style={{ color: excl ? dimColor : undefined, fontSize: 12 }}>
            {v}
            {excl && <Tag style={{ marginLeft: 6, fontSize: 10 }}>excluded</Tag>}
          </span>
        );
      },
    },
    { title: 'NO',    dataIndex: 'no_me',  align: 'right', width: 60,
      render: (v, r) => <span style={{ color: excludedBuckets.includes(r.bucket) ? dimColor : accent, fontSize: 12, fontWeight: 600 }}>{v ?? 0}</span> },
    { title: 'YES',   dataIndex: 'yes_me', align: 'right', width: 60,
      render: (v, r) => <span style={{ color: excludedBuckets.includes(r.bucket) ? dimColor : accent, fontSize: 12, fontWeight: 600 }}>{v ?? 0}</span> },
    { title: 'TOTAL', dataIndex: 'total',  align: 'right', width: 60,
      render: (v, r) => <span style={{ color: excludedBuckets.includes(r.bucket) ? dimColor : undefined, fontSize: 12, fontWeight: 600 }}>{v ?? 0}</span> },
  ];

  return (
    <div>
      <div style={{ marginBottom: 8, padding: '6px 10px', borderRadius: 6,
        background: isDark ? 'rgba(96,165,250,0.08)' : 'rgba(22,119,255,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 12, color: token.colorTextSecondary }}>
          ME Compliance ({inclRows.length} of {sorted.length} buckets)
        </Text>
        <Text style={{ fontSize: 15, fontWeight: 700, color: accent }}>
          {totalYes.toLocaleString()} / {totalDen.toLocaleString()} = {pct}%
        </Text>
      </div>
      <Table
        rowKey="bucket"
        size="small"
        dataSource={sorted}
        columns={columns}
        pagination={false}
        showHeader
        style={{ fontSize: 12 }}
        summary={() => (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0}><strong style={{ fontSize: 12 }}>Total (incl. only)</strong></Table.Summary.Cell>
            <Table.Summary.Cell index={1} />
            <Table.Summary.Cell index={2} align="right">
              <strong style={{ color: accent, fontSize: 12 }}>{totalYes.toLocaleString()}</strong>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={3} align="right">
              <strong style={{ fontSize: 12 }}>{totalDen.toLocaleString()}</strong>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        )}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PreviewPane — wraps a dashboard card replica shown above each config section
// ─────────────────────────────────────────────────────────────────────────────
function PreviewPane({ title, icon, iconColor, isLive = false, dashLoading = false, children }) {
  const { token } = theme.useToken();
  return (
    <div style={{ marginBottom: 4 }}>
      {/* Label row above the preview */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, paddingLeft: 2 }}>
        <Text style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: token.colorTextTertiary }}>
          Dashboard Preview
        </Text>
        {isLive
          ? <Tag icon={<SyncOutlined spin />} color="processing" style={{ fontSize: 10, lineHeight: '16px', padding: '0 5px' }}>Live — updates as you edit</Tag>
          : <Tag color="default" style={{ fontSize: 10, lineHeight: '16px', padding: '0 5px' }}>Current saved data · updates after Save</Tag>
        }
      </div>
      <Card
        size="small"
        style={{
          borderStyle: 'dashed',
          borderColor: isLive ? token.colorPrimary : token.colorBorderSecondary,
          marginBottom: 16,
          opacity: dashLoading ? 0.55 : 1,
          transition: 'opacity 0.2s',
        }}
        styles={{
          header: {
            background: token.colorFillQuaternary,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            padding: '8px 16px',
          },
          body: { padding: '12px 16px' },
        }}
        title={
          <Space size={8}>
            <div style={{
              background: `${iconColor}22`, color: iconColor,
              width: 28, height: 28, borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
            }}>
              {icon}
            </div>
            <Text style={{ fontSize: 13, fontWeight: 600 }}>{title}</Text>
          </Space>
        }
        extra={dashLoading && <Spin size="small" />}
      >
        {dashLoading
          ? <Skeleton active paragraph={{ rows: 3 }} title={false} />
          : children
        }
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Config form helpers
// ─────────────────────────────────────────────────────────────────────────────

function DrivesTag({ label, color = 'blue' }) {
  return (
    <Tag color={color} style={{ fontSize: 10, padding: '0 5px', marginLeft: 4, verticalAlign: 'middle' }}>
      → {label}
    </Tag>
  );
}

function TagField({ label, drives, hint, value = [], onChange, suggestions = [] }) {
  const { token } = theme.useToken();
  const available = suggestions.filter(s => !value.includes(s));
  return (
    <div style={{ marginBottom: 20 }}>
      <Text style={{ display: 'block', fontSize: 12, fontWeight: 600, color: token.colorTextSecondary, marginBottom: 6 }}>
        {label}
        {drives && drives.map((d, i) => <DrivesTag key={i} label={d.label} color={d.color || 'blue'} />)}
      </Text>
      <Select
        mode="tags"
        value={value}
        onChange={onChange}
        options={[...new Set([...value, ...suggestions])].map(o => ({ value: o, label: o }))}
        style={{ width: '100%' }}
        placeholder="Click a suggestion below or type and press Enter"
        tokenSeparators={[',']}
        allowClear
      />
      {hint && (
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>{hint}</Text>
      )}
      {available.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {available.map(v => (
            <Tag key={v} style={{ cursor: 'pointer', fontSize: 11, borderRadius: 4, margin: 0 }}
              onClick={() => onChange([...value, v])}>
              + {v}
            </Tag>
          ))}
        </div>
      )}
    </div>
  );
}

function CfgSection({ icon, iconColor, title, description, dashboardCard, children }) {
  const { token } = theme.useToken();
  return (
    <Card
      style={{ marginBottom: 32, borderRadius: 10 }}
      styles={{ header: { borderBottom: `1px solid ${token.colorBorderSecondary}`, padding: '12px 20px' } }}
      title={
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <Space>
            <span style={{ fontSize: 18, color: iconColor }}>{icon}</span>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Text strong style={{ fontSize: 14 }}>{title}</Text>
              </div>
              {description && <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>{description}</Text>}
            </div>
          </Space>
          {dashboardCard && (
            <Tag color="geekblue" style={{ fontSize: 11, cursor: 'default', marginTop: 2 }}>
              Dashboard card: {dashboardCard}
            </Tag>
          )}
        </div>
      }
    >
      {children}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Executive Overview
// ─────────────────────────────────────────────────────────────────────────────
function ExecOverviewTab({ cfg, setMsl, dashData, dashLoading }) {
  const { token } = theme.useToken();
  const msl = dashData?.mslCompliance || {};

  return (
    <>
      {/* ── Preview: Total Inventory MSL Compliance ── */}
      <PreviewPane
        title="Total Inventory MSL Compliance"
        icon={<RiseOutlined />}
        iconColor="#1677ff"
        dashLoading={dashLoading}
      >
        {ratioLine({ label: 'MSL',                numerator: msl.mslNumerator ?? 0,      denominator: msl.mslDenominator ?? 0,      tone: 'blue' })}
        {ratioLine({ label: 'Extended Inventory', numerator: msl.extNumerator ?? 0,      denominator: msl.extDenominator ?? 0,      tone: 'indigo' })}
        {ratioLine({ label: 'MSL + E-INV',        numerator: msl.combinedNumerator ?? 0, denominator: msl.combinedDenominator ?? 0, tone: 'green' })}
        {(msl.locations || []).length > 0 && (
          <>
            <Text type="secondary" style={{ display: 'block', marginTop: 12, marginBottom: 6, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>
              {PIVOT_OPTIONS.find(p => p.value === cfg.msl.pivot)?.label ?? 'Location'}-wise count
              <Tag color="green" style={{ marginLeft: 8, fontSize: 10 }}>pivot updates live</Tag>
            </Text>
            <Table
              size="small"
              rowKey="location"
              pagination={false}
              dataSource={(msl.locations || []).slice(0, 5)}
              columns={[
                { title: PIVOT_OPTIONS.find(p => p.value === cfg.msl.pivot)?.label ?? 'Location', dataIndex: 'location' },
                { title: 'Count', dataIndex: 'count', align: 'right', width: 100,
                  render: v => <strong>{(v ?? 0).toLocaleString()}</strong> },
              ]}
            />
          </>
        )}
      </PreviewPane>

      {/* ── Config: MSL Compliance Card ── */}
      <CfgSection
        icon={<RiseOutlined />} iconColor="#1677ff"
        title="MSL Compliance — Scope"
        description="Which assets enter the denominator and what counts as compliant"
        dashboardCard="Total Inventory MSL Compliance"
      >
        <Row gutter={32}>
          <Col xs={24} md={12}>
            <TagField
              label="Asset is in-scope when server_status is"
              drives={[{ label: 'MSL Denominator (D)', color: 'blue' }]}
              value={cfg.msl.include_server_statuses}
              onChange={v => setMsl('include_server_statuses', v)}
              suggestions={HINTS.server_statuses}
              hint="Matching assets form the denominator (D) in the MSL ratio."
            />
            <TagField
              label="Include these asset types"
              drives={[{ label: 'MSL Denominator (D)', color: 'blue' }]}
              value={cfg.msl.include_asset_types ?? DEFAULT_CONFIG.msl.include_asset_types}
              onChange={v => setMsl('include_asset_types', v)}
              suggestions={HINTS.asset_types}
              hint="Only assets with a matching asset_type are counted."
            />
          </Col>
          <Col xs={24} md={12}>
            <TagField
              label="Exclude asset when EOL status is"
              drives={[{ label: 'MSL Denominator (D)', color: 'blue' }]}
              value={cfg.msl.exclude_eol_statuses}
              onChange={v => setMsl('exclude_eol_statuses', v)}
              suggestions={HINTS.eol_statuses}
              hint="Assets with these EOL values are removed from the denominator."
            />
            <TagField
              label="Password counts as compliant when password_status is"
              drives={[{ label: 'MSL Numerator (N)', color: 'green' }]}
              value={cfg.msl.include_password_statuses ?? DEFAULT_CONFIG.msl.include_password_statuses}
              onChange={v => setMsl('include_password_statuses', v)}
              suggestions={HINTS.password_statuses}
              hint="Assets matching this status count as compliant (N in N/D)."
            />
          </Col>
        </Row>

        <Divider style={{ margin: '4px 0 18px' }} />

        <div style={{ maxWidth: 320 }}>
          <Text style={{ display: 'block', fontSize: 12, fontWeight: 600, color: token.colorTextSecondary, marginBottom: 6 }}>
            <EnvironmentOutlined style={{ marginRight: 6 }} />
            Location table grouped by
            <DrivesTag label="Location table rows (live)" color="green" />
          </Text>
          <Select
            value={cfg.msl.pivot}
            onChange={v => setMsl('pivot', v)}
            options={PIVOT_OPTIONS}
            style={{ width: '100%' }}
          />
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
            Changing this reflects immediately in the preview above.
          </Text>
        </div>
      </CfgSection>

      <Alert
        type="info"
        showIcon
        message={
          <span>
            <strong>Ext. Endpoint Compliance</strong> card config (total, Auto chip, Manual chip, ME N/A chip, Name Conflicts chip) is in the <strong>Extended Inventory</strong> tab — the same card also appears there.
          </span>
        }
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Asset Inventory
// ─────────────────────────────────────────────────────────────────────────────
function AssetInventoryTab({ cfg, setMsl, dashData, dashLoading }) {
  const { token } = theme.useToken();
  const msl = dashData?.mslCompliance || {};
  const patching = dashData?.assetInventoryPatchingStatus || {};
  const activeStatus = dashData?.assetInventoryActiveStatus || {};

  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 20 }}
        message="Asset Inventory charts inherit scope from the MSL Compliance card settings (Executive Overview tab)."
        description="server_status filter, asset type filter, and EOL exclusions set there determine which assets appear in every chart and count on this tab."
      />

      {/* ── Preview: Asset Inventory Active Status ── */}
      <PreviewPane
        title="Asset Inventory Active Status"
        icon={<BarChartOutlined />}
        iconColor="#0891b2"
        dashLoading={dashLoading}
      >
        <Row gutter={[12, 8]}>
          {[
            { label: 'Active',        value: activeStatus.active,       color: '#15803d' },
            { label: 'Non-Active',    value: activeStatus.non_active,   color: '#b91c1c' },
            { label: 'Pending',       value: activeStatus.pending,      color: '#a16207' },
            { label: 'On Hold',       value: activeStatus.on_hold,      color: '#475569' },
            { label: 'Uncategorized', value: activeStatus.uncategorized, color: '#6d28d9' },
          ].map(s => (
            <Col xs={12} md={8} key={s.label}>
              <div style={{ padding: '6px 10px', borderRadius: 6,
                background: token.colorFillQuaternary, border: `1px solid ${token.colorBorderSecondary}` }}>
                <Text type="secondary" style={{ fontSize: 11 }}>{s.label}</Text>
                <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>
                  {(s.value ?? 0).toLocaleString()}
                </div>
              </div>
            </Col>
          ))}
        </Row>
      </PreviewPane>

      {/* ── Preview: Asset Inventory Patching Status ── */}
      <PreviewPane
        title="Asset Inventory Patching Status"
        icon={<BarChartOutlined />}
        iconColor="#0891b2"
        dashLoading={dashLoading}
      >
        <Row gutter={[12, 8]}>
          {[
            { label: 'Auto Patching',   value: patching.auto_patching,   color: '#15803d' },
            { label: 'Manual Patching', value: patching.manual_patching,  color: '#1d4ed8' },
            { label: 'Exception',       value: patching.exception,        color: '#a16207' },
            { label: 'Beijing IT',      value: patching.beijing_it,       color: '#7e22ce' },
            { label: 'EOL',             value: patching.eol,              color: '#b91c1c' },
            { label: 'On Hold',         value: patching.on_hold,          color: '#475569' },
          ].map(s => (
            <Col xs={12} md={8} key={s.label}>
              <div style={{ padding: '6px 10px', borderRadius: 6,
                background: token.colorFillQuaternary, border: `1px solid ${token.colorBorderSecondary}` }}>
                <Text type="secondary" style={{ fontSize: 11 }}>{s.label}</Text>
                <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>
                  {(s.value ?? 0).toLocaleString()}
                </div>
              </div>
            </Col>
          ))}
        </Row>
      </PreviewPane>

      {/* ── Config: Breakdown Pivot ── */}
      <CfgSection
        icon={<BarChartOutlined />} iconColor="#0891b2"
        title="Breakdown Pivot"
        description="Grouping axis for location/department charts and the location-wise table in MSL card"
      >
        <div style={{ maxWidth: 320 }}>
          <Text style={{ display: 'block', fontSize: 12, fontWeight: 600, color: token.colorTextSecondary, marginBottom: 6 }}>
            <EnvironmentOutlined style={{ marginRight: 6 }} />
            Group breakdown tables by
            <DrivesTag label="VM Count by Location · Location table" color="green" />
          </Text>
          <Select
            value={cfg.msl.pivot}
            onChange={v => setMsl('pivot', v)}
            options={PIVOT_OPTIONS}
            style={{ width: '100%' }}
          />
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>
            Applies to VM Count by Location chart, MSL location table, and Weekly Report breakdown tables.
          </Text>
        </div>
      </CfgSection>

      {/* ── Read-only scope preview ── */}
      <CfgSection
        icon={<RiseOutlined />} iconColor="#94a3b8"
        title="Active MSL Scope (read-only)"
        description="Edit these in the Executive Overview tab"
      >
        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <Text style={{ fontSize: 12, fontWeight: 600, color: token.colorTextSecondary, display: 'block', marginBottom: 6 }}>
              In-scope server statuses
            </Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {(cfg.msl.include_server_statuses ?? []).map(s => <Tag key={s} color="blue" style={{ fontSize: 11 }}>{s}</Tag>)}
            </div>
          </Col>
          <Col xs={24} md={8}>
            <Text style={{ fontSize: 12, fontWeight: 600, color: token.colorTextSecondary, display: 'block', marginBottom: 6 }}>
              In-scope asset types
            </Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {(cfg.msl.include_asset_types ?? []).map(s => <Tag key={s} color="geekblue" style={{ fontSize: 11 }}>{s}</Tag>)}
            </div>
          </Col>
          <Col xs={24} md={8}>
            <Text style={{ fontSize: 12, fontWeight: 600, color: token.colorTextSecondary, display: 'block', marginBottom: 6 }}>
              Excluded EOL statuses
            </Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {(cfg.msl.exclude_eol_statuses ?? []).length
                ? cfg.msl.exclude_eol_statuses.map(s => <Tag key={s} color="red" style={{ fontSize: 11 }}>{s}</Tag>)
                : <Tag color="default" style={{ fontSize: 11 }}>none</Tag>}
            </div>
          </Col>
        </Row>
      </CfgSection>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Extended Inventory
// ─────────────────────────────────────────────────────────────────────────────
function ExtendedInventoryTab({ cfg, setExt, dashData, dashLoading }) {
  const ec = dashData?.extEndpointCompliance || {};

  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 20 }}
        message="These settings drive the Ext. Endpoint Compliance card on both the Extended Inventory tab and the Executive Overview tab."
      />

      {/* ── Preview: Ext. Endpoint Compliance ── */}
      <PreviewPane
        title="Ext. Endpoint Compliance"
        icon={<AppstoreOutlined />}
        iconColor="#4338ca"
        dashLoading={dashLoading}
      >
        <Paragraph style={{ marginBottom: 4, fontSize: 13 }}>
          Total <strong>{(ec.total ?? 0).toLocaleString()}</strong> endpoints
        </Paragraph>
        <Paragraph style={{ marginBottom: 4, fontSize: 13 }}>
          For <strong>{(ec.withPassword ?? 0).toLocaleString()}</strong> endpoints we received password info.
        </Paragraph>
        <Paragraph strong style={{ color: '#1d4ed8', marginBottom: 16, fontSize: 13 }}>
          Compliance: {(ec.withPassword ?? 0).toLocaleString()} out of {(ec.total ?? 0).toLocaleString()} ={' '}
          {(ec.total ? (ec.withPassword / ec.total) * 100 : 0).toFixed(2)}%
        </Paragraph>
        <Row gutter={[10, 10]}>
          <Col xs={24} md={12}><ExtChip label="ManageEngine Installed" value={ec.meInstalled}     tone="emerald" /></Col>
          <Col xs={24} md={12}><ExtChip label="ME Not Applicable"      value={ec.meNotApplicable} tone="gray" /></Col>
          <Col xs={24} md={12}><ExtChip label="Name Conflicts"         value={ec.nameConflicts}   tone="yellow" /></Col>
          <Col xs={24} md={12}><ExtChip label="Auto Patching"          value={ec.autoPatching}    tone="green" /></Col>
          <Col xs={24} md={12}><ExtChip label="Manual Patching"        value={ec.manualPatching}  tone="blue" /></Col>
        </Row>
      </PreviewPane>

      {/* ── Config: Scope ── */}
      <CfgSection
        icon={<HddOutlined />} iconColor="#16a34a"
        title="Scope — Total Endpoint Count"
        description="Which endpoints enter the denominator (Total X endpoints line)"
        dashboardCard="Ext. Endpoint Compliance"
      >
        <Row gutter={32}>
          <Col xs={24} md={12}>
            <TagField
              label="Exclude endpoint when server_status is"
              drives={[{ label: 'Total count (D)', color: 'blue' }]}
              value={cfg.ext.exclude_item_statuses}
              onChange={v => setExt('exclude_item_statuses', v)}
              suggestions={HINTS.item_statuses}
              hint="Endpoints with these statuses are removed from the total count."
            />
          </Col>
          <Col xs={24} md={12}>
            <TagField
              label="Exclude endpoint when EOL status is"
              drives={[{ label: 'Total count (D)', color: 'blue' }]}
              value={cfg.ext.exclude_eol_statuses ?? DEFAULT_CONFIG.ext.exclude_eol_statuses}
              onChange={v => setExt('exclude_eol_statuses', v)}
              suggestions={HINTS.eol_statuses}
              hint="Endpoints with these EOL values are excluded from the denominator."
            />
          </Col>
        </Row>
      </CfgSection>

      {/* ── Config: Patching chips ── */}
      <CfgSection
        icon={<AppstoreOutlined />} iconColor="#4338ca"
        title="Patching Type Chips"
        description="Which patching_type values map to the Auto, Manual chips"
        dashboardCard="Ext. Endpoint Compliance"
      >
        <Row gutter={32}>
          <Col xs={24} md={12}>
            <TagField
              label="Count as Auto Patching when patching_type is"
              drives={[{ label: 'Auto Patching chip', color: 'green' }]}
              value={cfg.ext.auto_patching_types}
              onChange={v => setExt('auto_patching_types', v)}
              suggestions={HINTS.patching_types.filter(s => !cfg.ext.auto_patching_types?.includes(s))}
            />
            <TagField
              label="Count as Manual Patching when patching_type is"
              drives={[{ label: 'Manual Patching chip', color: 'blue' }]}
              value={cfg.ext.manual_patching_types}
              onChange={v => setExt('manual_patching_types', v)}
              suggestions={HINTS.patching_types.filter(s => !cfg.ext.manual_patching_types?.includes(s))}
            />
          </Col>
          <Col xs={24} md={12}>
            <TagField
              label="Name Conflict detection — compare these fields across inventories"
              drives={[{ label: 'Name Conflicts chip', color: 'orange' }]}
              value={cfg.ext.name_conflict_fields}
              onChange={v => setExt('name_conflict_fields', v)}
              suggestions={HINTS.conflict_fields}
              hint="Only whitelisted: vm_name, os_hostname, asset_name, ip_address."
            />
          </Col>
        </Row>
      </CfgSection>

      {/* ── Config: ME Not Applicable ── */}
      <CfgSection
        icon={<SafetyCertificateOutlined />} iconColor="#7c3aed"
        title="ME Not Applicable Chip Rules"
        description="When should an endpoint be counted as 'ME Not Applicable' instead of non-compliant"
        dashboardCard="Ext. Endpoint Compliance"
      >
        <Row gutter={32}>
          <Col xs={24} md={8}>
            <TagField
              label="Patching types → ME N/A"
              drives={[{ label: 'ME N/A chip', color: 'purple' }]}
              value={cfg.ext.me_na_patching_types}
              onChange={v => setExt('me_na_patching_types', v)}
              suggestions={HINTS.patching_types.filter(s => !cfg.ext.me_na_patching_types?.includes(s))}
            />
          </Col>
          <Col xs={24} md={8}>
            <TagField
              label="Server statuses → ME N/A"
              drives={[{ label: 'ME N/A chip', color: 'purple' }]}
              value={cfg.ext.me_na_server_statuses}
              onChange={v => setExt('me_na_server_statuses', v)}
              suggestions={HINTS.server_statuses.filter(s => !cfg.ext.me_na_server_statuses?.includes(s))}
            />
          </Col>
          <Col xs={24} md={8}>
            <TagField
              label="EOL statuses → ME N/A"
              drives={[{ label: 'ME N/A chip', color: 'purple' }]}
              value={cfg.ext.me_na_eol_statuses}
              onChange={v => setExt('me_na_eol_statuses', v)}
              suggestions={HINTS.eol_statuses.filter(s => !cfg.ext.me_na_eol_statuses?.includes(s))}
            />
          </Col>
        </Row>
        <Checkbox
          checked={cfg.ext.me_na_requires_not_installed}
          onChange={e => setExt('me_na_requires_not_installed', e.target.checked)}
          style={{ marginTop: 4 }}
        >
          Only count as ME N/A when <Text code>ME Installed = false</Text>
        </Checkbox>
      </CfgSection>

      {/* ── Ext. Endpoint Compliance chip customisation ────────────── */}
      <CfgSection
        icon={<AppstoreOutlined />} iconColor="#4338ca"
        title="Ext. Endpoint Compliance — Chip Visibility & Labels"
        description="Show or hide individual stat chips and override their display labels on the Ext. Endpoint Compliance card"
        dashboardCard="Ext. Endpoint Compliance"
      >
        {/* Live chip preview */}
        <div style={{ marginBottom: 20 }}>
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
            Preview — reflects current label & visibility settings:
          </Text>
          <Row gutter={[8, 8]}>
            {[
              { key: 'meInstalled',     def: 'ManageEngine Installed', tone: 'emerald', value: dashData?.extEndpointCompliance?.meInstalled },
              { key: 'meNotApplicable', def: 'ME Not Applicable',      tone: 'gray',    value: dashData?.extEndpointCompliance?.meNotApplicable },
              { key: 'nameConflicts',   def: 'Name Conflicts',         tone: 'yellow',  value: dashData?.extEndpointCompliance?.nameConflicts },
              { key: 'autoPatching',    def: 'Auto Patching',          tone: 'green',   value: dashData?.extEndpointCompliance?.autoPatching },
              { key: 'manualPatching',  def: 'Manual Patching',        tone: 'blue',    value: dashData?.extEndpointCompliance?.manualPatching },
            ].filter(c => !(cfg.ext?.hidden_ext_chips ?? []).includes(c.key)).map(c => {
              const TONE = {
                emerald: { bg: 'rgba(34,197,94,0.10)',   border: '#bbf7d0', fg: '#15803d' },
                gray:    { bg: 'rgba(148,163,184,0.10)', border: '#cbd5e1', fg: '#475569' },
                yellow:  { bg: 'rgba(234,179,8,0.10)',   border: '#fef08a', fg: '#a16207' },
                green:   { bg: 'rgba(74,222,128,0.12)',  border: '#86efac', fg: '#15803d' },
                blue:    { bg: 'rgba(59,130,246,0.10)',  border: '#bfdbfe', fg: '#1d4ed8' },
              };
              const s = TONE[c.tone] || TONE.gray;
              const label = cfg.ext?.ext_chip_labels?.[c.key] || c.def;
              return (
                <Col xs={24} md={12} key={c.key}>
                  <div style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 8,
                    padding: '8px 14px', display: 'flex', justifyContent: 'space-between' }}>
                    <Text style={{ color: s.fg, fontSize: 13 }}>{label}:</Text>
                    <Text style={{ color: s.fg, fontWeight: 700, fontSize: 13 }}>
                      {dashLoading ? '…' : (c.value ?? 0).toLocaleString()}
                    </Text>
                  </div>
                </Col>
              );
            })}
          </Row>
        </div>

        <Row gutter={32}>
          {/* Visibility */}
          <Col xs={24} lg={10}>
            <Text style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
              Show chips
            </Text>
            {[
              { key: 'meInstalled',     label: 'ManageEngine Installed' },
              { key: 'meNotApplicable', label: 'ME Not Applicable' },
              { key: 'nameConflicts',   label: 'Name Conflicts' },
              { key: 'autoPatching',    label: 'Auto Patching' },
              { key: 'manualPatching',  label: 'Manual Patching' },
            ].map(c => {
              const hidden = (cfg.ext?.hidden_ext_chips ?? []).includes(c.key);
              return (
                <div key={c.key} style={{ marginBottom: 8 }}>
                  <Checkbox
                    checked={!hidden}
                    onChange={e => {
                      const cur = cfg.ext?.hidden_ext_chips ?? [];
                      setExt('hidden_ext_chips', e.target.checked
                        ? cur.filter(k => k !== c.key)
                        : [...cur, c.key]);
                    }}
                  >
                    <Text style={{ fontSize: 12 }}>{c.label}</Text>
                  </Checkbox>
                </div>
              );
            })}
          </Col>

          {/* Labels */}
          <Col xs={24} lg={14}>
            <Text style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
              Custom labels <Text type="secondary" style={{ fontWeight: 400, fontSize: 12 }}>(leave blank to use default)</Text>
            </Text>
            {[
              { key: 'meInstalled',     placeholder: 'ManageEngine Installed' },
              { key: 'meNotApplicable', placeholder: 'ME Not Applicable' },
              { key: 'nameConflicts',   placeholder: 'Name Conflicts' },
              { key: 'autoPatching',    placeholder: 'Auto Patching' },
              { key: 'manualPatching',  placeholder: 'Manual Patching' },
            ].map(c => (
              <div key={c.key} style={{ marginBottom: 8 }}>
                <Input
                  size="small"
                  placeholder={c.placeholder}
                  value={cfg.ext?.ext_chip_labels?.[c.key] ?? ''}
                  onChange={e => setExt('ext_chip_labels', {
                    ...(cfg.ext?.ext_chip_labels ?? {}),
                    [c.key]: e.target.value,
                  })}
                  allowClear
                  style={{ fontSize: 12 }}
                />
              </div>
            ))}
          </Col>
        </Row>
      </CfgSection>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared: compact patching breakdown table (location / department)
// ─────────────────────────────────────────────────────────────────────────────
const BREAKDOWN_COLS = [
  { key: 'auto_patching',     title: 'Auto',        color: '#15803d' },
  { key: 'manual_patching',   title: 'Manual',      color: '#1d4ed8' },
  { key: 'exception',         title: 'Exception',   color: '#a16207' },
  { key: 'beijing_it',        title: 'Beijing IT',  color: '#7e22ce' },
  { key: 'eol',               title: 'EOL',         color: '#b91c1c' },
  { key: 'on_hold',           title: 'On Hold',     color: '#475569' },
  { key: 'onboard_pending',   title: 'Pending',     color: '#0e7490' },
  { key: 'alive_powered_off', title: 'Pwrd Off',    color: '#c2410c' },
];

function BreakdownTablePreview({ rows, bucketLabel = 'Bucket' }) {
  const columns = [
    { title: bucketLabel, dataIndex: 'bucket', fixed: 'left', width: 130,
      render: v => <Text style={{ fontSize: 11, fontWeight: 600 }}>{v}</Text> },
    ...BREAKDOWN_COLS.map(c => ({
      title: <span style={{ color: c.color, fontSize: 11 }}>{c.title}</span>,
      dataIndex: c.key,
      align: 'right',
      width: 68,
      render: v => <span style={{ color: c.color, fontSize: 11, fontWeight: 600 }}>{v ?? 0}</span>,
    })),
    { title: <Text style={{ fontSize: 11, fontWeight: 700 }}>Total</Text>,
      dataIndex: 'total', align: 'right', width: 68,
      render: v => <Text style={{ fontSize: 11, fontWeight: 700 }}>{(v ?? 0).toLocaleString()}</Text> },
  ];
  return (
    <div style={{ overflowX: 'auto' }}>
      <Table
        rowKey="bucket"
        size="small"
        dataSource={rows}
        columns={columns}
        pagination={false}
        scroll={{ x: 'max-content' }}
        style={{ fontSize: 11 }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared: single patching status breakdown card (Asset or Ext)
// ─────────────────────────────────────────────────────────────────────────────
function PatchingStatusPreview({ title, data }) {
  const { token } = theme.useToken();
  const total = data?.total ?? 0;
  const items = [
    { label: 'Auto Patching',     value: data?.auto_patching,   color: '#15803d' },
    { label: 'Manual Patching',   value: data?.manual_patching,  color: '#1d4ed8' },
    { label: 'Exception',         value: data?.exception,        color: '#a16207' },
    { label: 'Beijing IT',        value: data?.beijing_it,       color: '#7e22ce' },
    { label: 'EOL - No Patches',  value: data?.eol,              color: '#b91c1c' },
    { label: 'On Hold',           value: data?.on_hold,          color: '#475569' },
    { label: 'Onboard Pending',   value: data?.pending,          color: '#0e7490' },
    { label: 'Alive Powered Off', value: data?.alive_powered_off,color: '#c2410c' },
  ];
  const autoN = (data?.auto_patching ?? 0) + (data?.manual_patching ?? 0);
  const autoD = data?.total_excl_na ?? total;
  const pct   = autoD ? ((autoN / autoD) * 100).toFixed(1) : '0.0';
  return (
    <div style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 8, padding: '10px 14px' }}>
      <Text style={{ fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 6 }}>{title}</Text>
      <Text style={{ fontSize: 13, fontWeight: 700, color: '#15803d' }}>{pct}%</Text>
      <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
        ({autoN.toLocaleString()} / {autoD.toLocaleString()} auto+manual)
      </Text>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {items.map(i => (
          <div key={i.label} style={{ fontSize: 11, color: i.color }}>
            {i.label}: <strong>{(i.value ?? 0).toLocaleString()}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Weekly Report
// ─────────────────────────────────────────────────────────────────────────────
function WeeklyReportTabContent({ cfg, setWeekly, dashData, dashLoading }) {
  const { isDark } = useAppTheme();
  const { token } = theme.useToken();

  const msl          = dashData?.mslCompliance              || {};
  const ec           = dashData?.extEndpointCompliance      || {};
  const vmGaps       = dashData?.weeklyVmGaps               || {};
  const assetPatch   = dashData?.assetInventoryPatchingStatus || {};
  const extPatch     = dashData?.extInventoryPatchingStatus  || {};
  const locRows      = dashData?.weeklyLocationPatching      || [];
  const deptRows     = dashData?.weeklyDepartmentPatching    || [];
  const mslRows      = dashData?.meMslBreakdown              || [];
  const extRows      = dashData?.meExtBreakdown              || [];

  const pct = (n, d) => d ? ((n / d) * 100).toFixed(2) : '0.00';

  // Masthead figures
  const apN = (assetPatch.auto_patching ?? 0) + (assetPatch.manual_patching ?? 0)
            + (extPatch.auto_patching   ?? 0) + (extPatch.manual_patching   ?? 0);
  const apD = (assetPatch.total_excl_na ?? assetPatch.total ?? 0)
            + (extPatch.total_excl_na   ?? extPatch.total   ?? 0);

  // ME tables — live-computed
  const MSL_EXCL = cfg.weekly?.me_msl_exclude_buckets ?? DEFAULT_CONFIG.weekly.me_msl_exclude_buckets;
  const EXT_EXCL = cfg.weekly?.me_ext_exclude_buckets ?? DEFAULT_CONFIG.weekly.me_ext_exclude_buckets;
  const mslIncl  = mslRows.filter(r => !MSL_EXCL.includes(r.bucket));
  const extIncl  = extRows.filter(r => !EXT_EXCL.includes(r.bucket));
  const mslYes   = mslIncl.reduce((s, r) => s + (r.yes_me || 0), 0);
  const mslDen   = mslIncl.reduce((s, r) => s + (r.total  || 0), 0);
  const extYes   = extIncl.reduce((s, r) => s + (r.yes_me || 0), 0);
  const extDen   = extIncl.reduce((s, r) => s + (r.total  || 0), 0);
  const combYes  = mslYes + extYes;
  const combDen  = mslDen + extDen;

  return (
    <>
      {/* ── 1. Masthead ─────────────────────────────────────────────── */}
      <PreviewPane
        title="Weekly Report Masthead — Patch & Agent Compliance"
        icon={<CalendarOutlined />}
        iconColor="#1677ff"
        dashLoading={dashLoading}
      >
        <Row gutter={[12, 12]}>
          {[
            { label: 'MSL Compliance',       n: msl.mslNumerator      ?? 0, d: msl.mslDenominator      ?? 0, color: '#1677ff' },
            { label: 'Ext. Compliance',       n: msl.extNumerator      ?? 0, d: msl.extDenominator      ?? 0, color: '#4338ca' },
            { label: 'Combined',             n: msl.combinedNumerator ?? 0, d: msl.combinedDenominator ?? 0, color: '#0891b2' },
            { label: 'Patch Auto + Manual',  n: apN,                        d: apD,                         color: '#15803d' },
          ].map(f => (
            <Col xs={12} md={6} key={f.label}>
              <div style={{ textAlign: 'center', padding: '10px 8px', borderRadius: 8,
                background: token.colorFillQuaternary, border: `1px solid ${token.colorBorderSecondary}` }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: f.color, fontFamily: 'monospace' }}>
                  {pct(f.n, f.d)}<span style={{ fontSize: 14 }}>%</span>
                </div>
                <Text type="secondary" style={{ fontSize: 11 }}>{f.label}</Text>
                <div style={{ fontSize: 11, color: token.colorTextTertiary }}>
                  {f.n.toLocaleString()} / {f.d.toLocaleString()}
                </div>
              </div>
            </Col>
          ))}
        </Row>
      </PreviewPane>
      <Alert type="default" showIcon={false} style={{ marginBottom: 24, fontSize: 12 }}
        message="Driven by: Executive Overview (MSL scope) · Extended Inventory (ext scope) settings" />

      {/* ── 2. Asset Inventory — MSL OVERALL ACTIVE COUNT STATUS ────── */}
      <PreviewPane
        title="Asset Inventory — MSL Overall Active Count Status"
        icon={<RiseOutlined />}
        iconColor="#1677ff"
        dashLoading={dashLoading}
      >
        {ratioLine({ label: 'MSL',                numerator: msl.mslNumerator      ?? 0, denominator: msl.mslDenominator      ?? 0, tone: 'blue'   })}
        {ratioLine({ label: 'Extended Inventory', numerator: msl.extNumerator      ?? 0, denominator: msl.extDenominator      ?? 0, tone: 'indigo' })}
        {ratioLine({ label: 'MSL + E-INV',        numerator: msl.combinedNumerator ?? 0, denominator: msl.combinedDenominator ?? 0, tone: 'green'  })}
        <Divider style={{ margin: '10px 0 8px' }} />
        <Text style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8 }}>
          VM Gaps
        </Text>
        <Row gutter={[12, 8]}>
          {[
            { label: 'Decommissioned',  value: vmGaps.decommissioned, color: '#b91c1c' },
            { label: 'No Password',     value: vmGaps.no_password,    color: '#a16207' },
            { label: 'No Hosted IP',    value: vmGaps.no_hosted_ip,   color: '#475569' },
            { label: 'Name Conflicts',  value: vmGaps.name_conflicts, color: '#7e22ce' },
          ].map(g => (
            <Col xs={12} md={6} key={g.label}>
              <div style={{ padding: '6px 10px', borderRadius: 6,
                background: token.colorFillQuaternary, border: `1px solid ${token.colorBorderSecondary}` }}>
                <Text type="secondary" style={{ fontSize: 11 }}>{g.label}</Text>
                <div style={{ fontSize: 18, fontWeight: 700, color: g.color }}>
                  {(g.value ?? 0).toLocaleString()}
                </div>
              </div>
            </Col>
          ))}
        </Row>
      </PreviewPane>
      <Alert type="default" showIcon={false} style={{ marginBottom: 24, fontSize: 12 }}
        message="Driven by: Executive Overview → MSL Compliance Card settings" />

      {/* ── 3. Extended Inventory ───────────────────────────────────── */}
      <PreviewPane
        title="Extended Inventory"
        icon={<HddOutlined />}
        iconColor="#4338ca"
        dashLoading={dashLoading}
      >
        <Row gutter={[12, 8]} style={{ marginBottom: 12 }}>
          {[
            { label: 'Total',           value: ec.total,           color: '#1d4ed8' },
            { label: 'Decommissioned',  value: ec.decommissioned,  color: '#b91c1c' },
            { label: 'With Password',   value: ec.withPassword,    color: '#15803d' },
            { label: 'Auto Patching',   value: ec.autoPatching,    color: '#047857' },
            { label: 'Manual Patching', value: ec.manualPatching,   color: '#1d4ed8' },
            { label: 'ME Installed',    value: ec.meInstalled,     color: '#0891b2' },
          ].map(s => (
            <Col xs={12} md={8} key={s.label}>
              <div style={{ padding: '6px 10px', borderRadius: 6,
                background: token.colorFillQuaternary, border: `1px solid ${token.colorBorderSecondary}` }}>
                <Text type="secondary" style={{ fontSize: 11 }}>{s.label}</Text>
                <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>
                  {(s.value ?? 0).toLocaleString()}
                </div>
              </div>
            </Col>
          ))}
        </Row>
        {(ec.locationCount || []).length > 0 && (
          <>
            <Text style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Location-wise endpoint count
            </Text>
            <Table
              rowKey="location"
              size="small"
              pagination={false}
              dataSource={ec.locationCount}
              columns={[
                { title: 'Location', dataIndex: 'location' },
                { title: 'Count', dataIndex: 'count', align: 'right', width: 80,
                  render: v => <strong>{(v ?? 0).toLocaleString()}</strong> },
              ]}
            />
          </>
        )}
      </PreviewPane>
      <Alert type="default" showIcon={false} style={{ marginBottom: 24, fontSize: 12 }}
        message="Driven by: Extended Inventory → Scope & Patching Chips settings" />

      {/* ── 4. Patch Management Solution ────────────────────────────── */}
      <PreviewPane
        title="Patch Management Solution"
        icon={<AppstoreOutlined />}
        iconColor="#7c3aed"
        dashLoading={dashLoading}
      >
        {/* Overall banner */}
        <div style={{ padding: '8px 14px', borderRadius: 8, marginBottom: 12,
          background: 'rgba(21,128,61,0.08)', border: '1px solid rgba(21,128,61,0.2)' }}>
          <Text style={{ fontSize: 13, color: '#15803d' }}>
            Overall Auto + Manual:{' '}
            <strong style={{ fontSize: 16 }}>{pct(apN, apD)}%</strong>
            <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>
              ({apN.toLocaleString()} / {apD.toLocaleString()})
            </Text>
          </Text>
        </div>
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <PatchingStatusPreview title="Asset Inventory Patching Status" data={assetPatch} />
          </Col>
          <Col xs={24} md={12}>
            <PatchingStatusPreview title="Ext. Inventory Patching Status" data={extPatch} />
          </Col>
        </Row>
      </PreviewPane>
      <Alert type="default" showIcon={false} style={{ marginBottom: 24, fontSize: 12 }}
        message="Driven by: Executive Overview (MSL scope) · Extended Inventory (ext scope) settings" />

      {/* ── 5. Location-wise Patching ────────────────────────────────── */}
      <PreviewPane
        title="Location-wise Auto / Manual Patching Status"
        icon={<EnvironmentOutlined />}
        iconColor="#0891b2"
        dashLoading={dashLoading}
      >
        {locRows.length > 0
          ? <BreakdownTablePreview rows={locRows} bucketLabel="Location" />
          : <Text type="secondary" style={{ fontSize: 12 }}>No data</Text>}
      </PreviewPane>
      <Alert type="default" showIcon={false} style={{ marginBottom: 24, fontSize: 12 }}
        message="Driven by: Asset Inventory → Breakdown Pivot setting" />

      {/* ── 6. Department Patching ───────────────────────────────────── */}
      <PreviewPane
        title="Departments Patching Onboarding Status"
        icon={<AppstoreOutlined />}
        iconColor="#7c3aed"
        dashLoading={dashLoading}
      >
        {deptRows.length > 0
          ? <BreakdownTablePreview rows={deptRows} bucketLabel="Department" />
          : <Text type="secondary" style={{ fontSize: 12 }}>No data</Text>}
      </PreviewPane>
      <Alert type="default" showIcon={false} style={{ marginBottom: 24, fontSize: 12 }}
        message="Driven by: Asset Inventory → Breakdown Pivot setting" />

      {/* ── 7. ME Compliance Tables (LIVE) ──────────────────────────── */}
      <PreviewPane
        title="Auto Patching Group Count Status — ME Compliance"
        icon={<SafetyCertificateOutlined />}
        iconColor="#0891b2"
        isLive
        dashLoading={dashLoading}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 14 }}
          message={
            <span>
              <strong>Overall ME Compliance (MSL + Extended):</strong>{' '}
              <strong>{combYes.toLocaleString()}</strong> / <strong>{combDen.toLocaleString()}</strong>
              {' × 100 = '}
              <strong style={{ fontSize: 15 }}>{pct(combYes, combDen)}%</strong>
              <Text type="secondary" style={{ fontSize: 12, marginLeft: 10 }}>
                (MSL: {mslYes}/{mslDen} · Extended: {extYes}/{extDen})
              </Text>
            </span>
          }
        />
        <Row gutter={16}>
          <Col xs={24} lg={12}>
            <Text strong style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
              ME compliance with MSL
            </Text>
            {mslRows.length > 0
              ? <MePreviewTable rows={mslRows} excludedBuckets={MSL_EXCL} isDark={isDark} />
              : <Text type="secondary" style={{ fontSize: 12 }}>No data</Text>}
          </Col>
          <Col xs={24} lg={12}>
            <Text strong style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
              ME compliance with Extended Inventory
            </Text>
            {extRows.length > 0
              ? <MePreviewTable rows={extRows} excludedBuckets={EXT_EXCL} isDark={isDark} />
              : <Text type="secondary" style={{ fontSize: 12 }}>No data</Text>}
          </Col>
        </Row>
      </PreviewPane>

      {/* ── Config: ME exclusion buckets + footnotes ──────────────────── */}
      <CfgSection
        icon={<SafetyCertificateOutlined />} iconColor="#0891b2"
        title="ManageEngine Compliance — Exclusion Buckets & Footnotes"
        description="Buckets excluded from the ME compliance % denominator; optional footnote text shown below each table"
        dashboardCard="Auto Patching Group Count Status"
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 20 }}
          message="Excluded buckets still appear as dimmed rows in the table — they're removed only from the % calculation, not hidden."
        />
        <Row gutter={32}>
          <Col xs={24} md={12}>
            <TagField
              label="Exclude from MSL ME compliance %"
              drives={[{ label: 'MSL ME % denominator', color: 'blue' }]}
              value={cfg.weekly?.me_msl_exclude_buckets ?? DEFAULT_CONFIG.weekly.me_msl_exclude_buckets}
              onChange={v => setWeekly('me_msl_exclude_buckets', v)}
              suggestions={HINTS.me_buckets.filter(s => !(cfg.weekly?.me_msl_exclude_buckets ?? []).includes(s))}
              hint="Affects: Manage Engine compliance with MSL table."
            />
          </Col>
          <Col xs={24} md={12}>
            <TagField
              label="Exclude from Extended ME compliance %"
              drives={[{ label: 'Extended ME % denominator', color: 'cyan' }]}
              value={cfg.weekly?.me_ext_exclude_buckets ?? DEFAULT_CONFIG.weekly.me_ext_exclude_buckets}
              onChange={v => setWeekly('me_ext_exclude_buckets', v)}
              suggestions={HINTS.me_buckets.filter(s => !(cfg.weekly?.me_ext_exclude_buckets ?? []).includes(s))}
              hint="Affects: Manage Engine compliance with Extended Inventory table."
            />
          </Col>
        </Row>
        <Divider style={{ margin: '16px 0 12px' }} />
        <Row gutter={32}>
          <Col xs={24} md={12}>
            <Text style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 13 }}>
              MSL ME table footnote
            </Text>
            <Input.TextArea
              rows={2}
              placeholder="(*Excludes Bomgar & Beijing Team Managed, ESXi hosts, N/A VMs, powered off, EOL VMs)"
              value={cfg.weekly?.me_msl_footnote ?? ''}
              onChange={e => setWeekly('me_msl_footnote', e.target.value)}
              style={{ fontSize: 12 }}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>
              Leave blank to use the default footnote text.
            </Text>
          </Col>
          <Col xs={24} md={12}>
            <Text style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 13 }}>
              Extended ME table footnote
            </Text>
            <Input.TextArea
              rows={2}
              placeholder="(*Excludes ESXi hosts, N/A VMs, Beijing IT managed, exceptions, EOL VMs)"
              value={cfg.weekly?.me_ext_footnote ?? ''}
              onChange={e => setWeekly('me_ext_footnote', e.target.value)}
              style={{ fontSize: 12 }}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>
              Leave blank to use the default footnote text.
            </Text>
          </Col>
        </Row>
      </CfgSection>

      {/* ── Config: Breakdown tables ──────────────────────────────────── */}
      <CfgSection
        icon={<EnvironmentOutlined />} iconColor="#0891b2"
        title="Breakdown Tables — Location & Department"
        description="Control which columns appear and how the in-scope percentage is calculated in the location and department tables"
        dashboardCard="Location-wise & Department Patching tables"
      >
        <Row gutter={32}>
          <Col xs={24} lg={12}>
            <Text style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: 13 }}>
              Hide columns (even if they have data)
            </Text>
            <Checkbox.Group
              value={cfg.weekly?.breakdown_hidden_columns ?? []}
              onChange={v => setWeekly('breakdown_hidden_columns', v)}
              style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 0' }}
            >
              {[
                { value: 'alive_powered_off', label: 'Alive But Powered Off' },
                { value: 'auto_patching',     label: 'Auto' },
                { value: 'beijing_it',        label: 'Beijing IT Team' },
                { value: 'eol',               label: 'EOL - No Patches' },
                { value: 'exception',         label: 'Exception' },
                { value: 'manual_patching',   label: 'Manual' },
                { value: 'on_hold',           label: 'On Hold' },
                { value: 'onboard_pending',   label: 'Onboard Pending' },
              ].map(o => (
                <Col xs={12} key={o.value}>
                  <Checkbox value={o.value}><Text style={{ fontSize: 12 }}>{o.label}</Text></Checkbox>
                </Col>
              ))}
            </Checkbox.Group>
            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>
              Columns that are all-zero are always hidden automatically regardless of this setting.
            </Text>
          </Col>
          <Col xs={24} lg={12}>
            <Text style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: 13 }}>
              Subtract from total when computing "Percentage" column
              <Tag color="purple" style={{ marginLeft: 8, fontSize: 11 }}>→ In-scope %</Tag>
            </Text>
            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
              Percentage = (Total − excluded types) ÷ Total. Checked items are treated as out-of-scope.
            </Text>
            <Checkbox.Group
              value={cfg.weekly?.breakdown_pct_exclude ?? DEFAULT_CONFIG.weekly.breakdown_pct_exclude}
              onChange={v => setWeekly('breakdown_pct_exclude', v)}
              style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 0' }}
            >
              {[
                { value: 'alive_powered_off', label: 'Alive But Powered Off' },
                { value: 'beijing_it',        label: 'Beijing IT Team' },
                { value: 'eol',               label: 'EOL - No Patches' },
                { value: 'exception',         label: 'Exception' },
                { value: 'on_hold',           label: 'On Hold' },
                { value: 'onboard_pending',   label: 'Onboard Pending' },
              ].map(o => (
                <Col xs={12} key={o.value}>
                  <Checkbox value={o.value}><Text style={{ fontSize: 12 }}>{o.label}</Text></Checkbox>
                </Col>
              ))}
            </Checkbox.Group>
          </Col>
        </Row>
        <Divider style={{ margin: '16px 0 12px' }} />
        <Row gutter={32}>
          <Col xs={24} md={12}>
            <TagField
              label="Exclude locations from location table"
              drives={[{ label: 'Location rows', color: 'cyan' }]}
              value={cfg.weekly?.breakdown_excluded_locations ?? []}
              onChange={v => setWeekly('breakdown_excluded_locations', v)}
              suggestions={[]}
              hint="Location names typed here are removed from the location breakdown table."
            />
          </Col>
          <Col xs={24} md={12}>
            <TagField
              label="Exclude departments from department table"
              drives={[{ label: 'Department rows', color: 'purple' }]}
              value={cfg.weekly?.breakdown_excluded_departments ?? []}
              onChange={v => setWeekly('breakdown_excluded_departments', v)}
              suggestions={[]}
              hint="Department names typed here are removed from the department breakdown table."
            />
          </Col>
        </Row>
      </CfgSection>

      {/* ── Config: Report header ─────────────────────────────────────── */}
      <CfgSection
        icon={<CalendarOutlined />} iconColor="#7c3aed"
        title="Report Header"
        description="Customise the title and subtitle shown at the top of the Weekly Report"
        dashboardCard="Weekly Report Masthead"
      >
        <Row gutter={32}>
          <Col xs={24} md={12}>
            <Text style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 13 }}>
              Report title
            </Text>
            <Input
              placeholder="Weekly Infrastructure Report"
              value={cfg.weekly?.report_title ?? ''}
              onChange={e => setWeekly('report_title', e.target.value)}
              allowClear
            />
            <Text type="secondary" style={{ fontSize: 11 }}>
              Leave blank to use the default title.
            </Text>
          </Col>
          <Col xs={24} md={12}>
            <Text style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 13 }}>
              Report subtitle
            </Text>
            <Input
              placeholder="Patch & Agent Compliance"
              value={cfg.weekly?.report_subtitle ?? ''}
              onChange={e => setWeekly('report_subtitle', e.target.value)}
              allowClear
            />
            <Text type="secondary" style={{ fontSize: 11 }}>
              Leave blank to use the default subtitle.
            </Text>
          </Col>
        </Row>
      </CfgSection>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
export default function ComplianceConfig() {
  const [cfg, setCfg]             = useState(DEFAULT_CONFIG);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [dashData, setDashData]   = useState(null);
  const [dashLoading, setDashLoading] = useState(true);

  const loadDash = useCallback(() => {
    setDashLoading(true);
    api.get('/dashboard/summary')
      .then(r => setDashData(r.data))
      .catch(() => {})
      .finally(() => setDashLoading(false));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/compliance-config')
      .then(r => { setCfg(r.data.config || DEFAULT_CONFIG); setUpdatedAt(r.data.updated_at); })
      .catch(() => setErr('Failed to load — using defaults'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); loadDash(); }, [load, loadDash]);

  const setMsl    = (k, v) => setCfg(c => ({ ...c, msl:    { ...c.msl,    [k]: v } }));
  const setExt    = (k, v) => setCfg(c => ({ ...c, ext:    { ...c.ext,    [k]: v } }));
  const setWeekly = (k, v) => setCfg(c => ({ ...c, weekly: { ...c.weekly, [k]: v } }));

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put('/compliance-config', { config: cfg });
      setUpdatedAt(r.data.updated_at);
      message.success('Saved — dashboard will reflect new rules on next load.');
      loadDash(); // refresh preview data after save
    } catch (e) {
      message.error(e.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: 48, textAlign: 'center' }}><Spin size="large" /></div>;

  const sharedProps = { cfg, dashData, dashLoading };

  const TAB_ITEMS = [
    {
      key:      'exec',
      label:    <Space size={6}><FundOutlined />Executive Overview</Space>,
      children: <ExecOverviewTab {...sharedProps} setMsl={setMsl} />,
    },
    {
      key:      'asset',
      label:    <Space size={6}><BarChartOutlined />Asset Inventory</Space>,
      children: <AssetInventoryTab {...sharedProps} setMsl={setMsl} />,
    },
    {
      key:      'ext',
      label:    <Space size={6}><HddOutlined />Extended Inventory</Space>,
      children: <ExtendedInventoryTab {...sharedProps} setExt={setExt} />,
    },
    {
      key:      'weekly',
      label:    <Space size={6}><CalendarOutlined />Weekly Report</Space>,
      children: <WeeklyReportTabContent {...sharedProps} setWeekly={setWeekly} />,
    },
  ];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 24px 80px' }}>

      <div style={{ marginBottom: 24 }}>
        <Title level={4} style={{ margin: 0 }}>Dashboard Compliance Config</Title>
        <Text type="secondary">
          Each tab matches a dashboard tab. The preview above each section shows the current dashboard card — save changes to update non-live previews.
        </Text>
      </div>

      {err && <Alert type="warning" message={err} closable style={{ marginBottom: 16 }} />}

      <Tabs type="line" size="middle" items={TAB_ITEMS} tabBarStyle={{ marginBottom: 24 }} />

      {/* Sticky save bar */}
      <div style={{
        position: 'sticky', bottom: 0, zIndex: 10,
        padding: '12px 0',
        borderTop: '1px solid var(--ant-color-border-secondary, #303030)',
        background: 'var(--ant-color-bg-container)',
      }}>
        <Space align="center" size={16} style={{ flexWrap: 'wrap' }}>
          <Button type="primary" icon={<SaveOutlined />} onClick={save} loading={saving} size="large">
            Save Changes
          </Button>
          <Button icon={<ReloadOutlined />} onClick={load} disabled={saving}>
            Reset to Saved
          </Button>
          {updatedAt && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Last saved: {new Date(updatedAt).toLocaleString()}
            </Text>
          )}
        </Space>
      </div>
    </div>
  );
}
