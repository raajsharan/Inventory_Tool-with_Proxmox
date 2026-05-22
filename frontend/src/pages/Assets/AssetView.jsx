import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card, Row, Col, Space, Button, Typography, Tag, Spin, Alert, App, Tooltip, Empty,
} from 'antd';
import {
  ArrowLeftOutlined, EditOutlined, DeleteOutlined, EyeOutlined, EyeInvisibleOutlined,
  ReloadOutlined, AppstoreOutlined, TeamOutlined, ThunderboltOutlined,
  SafetyOutlined, HddOutlined, KeyOutlined, FileTextOutlined,
  DatabaseOutlined, HistoryOutlined, CopyOutlined, BlockOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';
import PasswordConfirmModal from '../../components/PasswordConfirmModal.jsx';

const NA = <Typography.Text type="secondary">—</Typography.Text>;

// Map well-known group names to a header icon. Falls back to a block icon.
const SECTION_ICONS = {
  'Identity':                       <AppstoreOutlined />,
  'Basic Information':              <AppstoreOutlined />,
  'Ownership':                      <TeamOutlined />,
  'Operations':                     <ThunderboltOutlined />,
  'Status & Patching':              <SafetyOutlined />,
  'Asset Tagging & Credentials':    <KeyOutlined />,
  'Tagging & Credentials':          <KeyOutlined />,
  'Credentials':                    <KeyOutlined />,
  'Tools':                          <SafetyOutlined />,
  'Agent Status':                   <SafetyOutlined />,
  'Host Details':                   <HddOutlined />,
  'Custom Fields':                  <FileTextOutlined />,
};

function YesNo({ v }) {
  if (v === null || v === undefined) return NA;
  return v ? <Tag color="green">Yes</Tag> : <Tag>No</Tag>;
}

function StatusTag({ status }) {
  if (!status) return NA;
  const color =
    status === 'Active' || /alive/i.test(status)        ? 'green'   :
    /decom|inactive|not alive|dead/i.test(status)       ? 'red'     :
    /onboard|pending/i.test(status)                     ? 'cyan'    :
    /on hold/i.test(status)                             ? 'default' :
    /powered off|power off/i.test(status)               ? 'orange'  :
    /maintenance/i.test(status)                         ? 'gold'    : 'blue';
  return <Tag color={color}>{status}</Tag>;
}

function EolTag({ v }) {
  if (!v) return NA;
  const color = v === 'Supported'           ? 'green'
              : v === 'EOL'                 ? 'red'
              : v === 'Decommissioned'      ? 'red'
              : v === 'Not Applicable'      ? 'default'
              : 'orange';
  return <Tag color={color}>{v}</Tag>;
}

function CopyableIp({ ip }) {
  const { message } = App.useApp();
  if (!ip) return NA;
  return (
    <Space size={6}>
      <Tag color="blue" style={{ fontFamily: 'monospace' }}>{ip}</Tag>
      <Tooltip title="Copy">
        <Button
          size="small" type="text" icon={<CopyOutlined />}
          onClick={() => {
            navigator.clipboard?.writeText(ip);
            message.success(`Copied ${ip}`);
          }}
        />
      </Tooltip>
    </Space>
  );
}

function renderValue(field_key, raw, fieldMeta, helpers) {
  if (raw === null || raw === undefined || raw === '') return NA;
  if (field_key === 'server_status')      return <StatusTag status={raw} />;
  if (field_key === 'eol_status')         return <EolTag v={raw} />;
  if (field_key === 'asset_tag')          return <Tag style={{ fontFamily: 'monospace' }}>{raw}</Tag>;
  if (field_key === 'ip_address' || field_key === 'idrac_ip' || field_key === 'hosted_ip') {
    return <CopyableIp ip={raw} />;
  }
  if (field_key === 'manage_engine_installed' || field_key === 'tenable_installed' || field_key === 'idrac_enabled') {
    return <YesNo v={raw} />;
  }
  if (field_key === 'asset_password') {
    return helpers?.passwordCell ?? NA;
  }
  const meta = fieldMeta?.byKey?.[field_key];
  const type = meta?.input_type || meta?.default_type;
  if (type === 'toggle')   return <YesNo v={!!raw} />;
  if (type === 'date')     return dayjs(raw).isValid() ? dayjs(raw).format('YYYY-MM-DD') : String(raw);
  if (type === 'textarea') {
    return <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{String(raw)}</Typography.Paragraph>;
  }
  if (type === 'number')   return <span>{Number(raw).toLocaleString()}</span>;
  return <span>{String(raw)}</span>;
}

// One label/value pair in a section card.
function FieldRow({ label, value }) {
  return (
    <div className="asset-view-row">
      <div className="asset-view-label">{label}</div>
      <div className="asset-view-value">{value}</div>
    </div>
  );
}

function SummaryChip({ label, value, tone }) {
  const tones = {
    indigo: { bg: 'rgba(99,102,241,0.12)',  fg: '#4338ca' },
    cyan:   { bg: 'rgba(8,145,178,0.12)',   fg: '#0e7490' },
    emerald:{ bg: 'rgba(16,185,129,0.12)',  fg: '#047857' },
    amber:  { bg: 'rgba(245,158,11,0.16)',  fg: '#b45309' },
    pink:   { bg: 'rgba(236,72,153,0.12)',  fg: '#be185d' },
    slate:  { bg: 'rgba(100,116,139,0.16)', fg: '#334155' },
  }[tone] || { bg: 'rgba(100,116,139,0.16)', fg: '#334155' };
  return (
    <Col xs={12} md={6}>
      <div className="asset-view-chip" style={{ background: tones.bg }}>
        <div className="asset-view-chip-label" style={{ color: tones.fg }}>{label}</div>
        <div className="asset-view-chip-value">{value || '—'}</div>
      </div>
    </Col>
  );
}

export default function AssetView({
  apiPrefix = '/assets',
  basePath = '/assets',
  entityLabel = 'Asset',
  pageKey = 'assets',
  auditEntityType = 'asset',
}) {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, getPageLabel } = useAuth();
  const { message } = App.useApp();
  const effectiveLabel = getPageLabel ? getPageLabel(pageKey, entityLabel) : entityLabel;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [record, setRecord] = useState(null);
  const [fieldMeta, setFieldMeta] = useState({ fields: [], byKey: {}, groups: [] });
  const [hiddenSet, setHiddenSet] = useState(new Set());
  const [pwdShown, setPwdShown] = useState(null);
  const [pwdLoading, setPwdLoading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [auditRows, setAuditRows] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditUnavailable, setAuditUnavailable] = useState(false);

  const canWrite = ['admin', 'superadmin', 'asset_manager'].includes(user?.role);
  const isAdmin  = ['admin', 'superadmin'].includes(user?.role);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [recRes, fvRes, ifRes] = await Promise.all([
        api.get(`${apiPrefix}/${id}`),
        api.get(`/field-visibility/${pageKey}`).catch(() => ({ data: { hidden: [] } })),
        api.get(`/inventory-fields/${pageKey}`).catch(() => ({ data: { fields: [], groups: [] } })),
      ]);
      setRecord(recRes.data);
      setHiddenSet(new Set(fvRes.data.hidden || []));
      const byKey = {};
      for (const f of ifRes.data.fields || []) byKey[f.field_key] = f;
      setFieldMeta({ fields: ifRes.data.fields || [], byKey, groups: ifRes.data.groups || [] });
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load');
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [id]); // eslint-disable-line

  async function togglePassword() {
    if (!record?.hasPassword) return;
    if (pwdShown) { setPwdShown(null); return; }
    setPwdLoading(true);
    try {
      const { data } = await api.get(`${apiPrefix}/${id}/password`);
      setPwdShown(data.password || '');
    } catch (e) {
      message.error(e.response?.data?.error || 'Cannot view password');
    } finally { setPwdLoading(false); }
  }

  async function onDeleteConfirmed(password) {
    await api.delete(`${apiPrefix}/${id}`, { data: { password } });
    message.success('Moved to Recycle Bin');
    setDeleteOpen(false);
    nav(basePath);
  }

  async function loadAudit() {
    if (auditUnavailable) return;
    setAuditLoading(true);
    try {
      const { data } = await api.get('/audit', {
        params: { entityType: auditEntityType, entityId: id, pageSize: 50 },
      });
      setAuditRows(data.items || []);
    } catch (e) {
      if (e.response?.status === 403) setAuditUnavailable(true);
    } finally { setAuditLoading(false); }
  }

  function toggleAudit() {
    if (!showAudit) loadAudit();
    setShowAudit(s => !s);
  }

  const sections = useMemo(() => {
    if (!record || !fieldMeta.fields.length) return [];
    const map = new Map();
    for (const g of fieldMeta.groups || []) map.set(g, []);
    for (const f of fieldMeta.fields) {
      if (hiddenSet.has(f.field_key)) continue;
      const sec = f.section || 'Other';
      if (!map.has(sec)) map.set(sec, []);
      map.get(sec).push(f);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    }
    return Array.from(map.entries());
  }, [record, fieldMeta, hiddenSet]);

  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>;
  if (error) {
    return (
      <Card>
        <Alert type="error" message={error} showIcon />
        <div style={{ marginTop: 12 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => nav(basePath)}>Back to list</Button>
        </div>
      </Card>
    );
  }
  if (!record) return null;

  const passwordCell = record.hasPassword ? (
    <Space size={4}>
      <span style={{ fontFamily: 'monospace', minWidth: 70, display: 'inline-block' }}>
        {pwdShown ?? '••••••••'}
      </span>
      {canWrite && (
        <Tooltip title={pwdShown ? 'Hide password' : 'Reveal password'}>
          <Button
            size="small" type="text"
            icon={pwdShown ? <EyeInvisibleOutlined /> : <EyeOutlined />}
            loading={pwdLoading}
            onClick={togglePassword}
          />
        </Tooltip>
      )}
    </Space>
  ) : NA;

  const valueFor = (field_key, isExtra) =>
    isExtra ? record.extras?.[field_key] : record[field_key];

  const title = record.vm_name || `(unnamed ${effectiveLabel.toLowerCase()})`;
  const osCombined = [record.os_type, record.os_version].filter(Boolean).join(' · ');

  return (
    <div className="asset-view">
      <div className="asset-view-titlebar">
        <Space size={12} align="center">
          <Button shape="circle" icon={<ArrowLeftOutlined />} onClick={() => nav(basePath)} />
          <div className="asset-view-titlebar-icon"><DatabaseOutlined /></div>
          <div>
            <Space size={8} align="center" wrap>
              <Typography.Title level={3} style={{ margin: 0 }}>{title}</Typography.Title>
              {record.ip_address && (
                <Tag color="blue" style={{ fontFamily: 'monospace' }}>{record.ip_address}</Tag>
              )}
              <StatusTag status={record.server_status} />
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {effectiveLabel} · viewing details
            </Typography.Text>
          </div>
        </Space>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>Reload</Button>
          <Button icon={<HistoryOutlined />} onClick={toggleAudit} disabled={auditUnavailable}>
            Audit Trail
          </Button>
          <Button onClick={() => nav(basePath)}>Back</Button>
          {canWrite && (
            <Button type="primary" icon={<EditOutlined />}
              onClick={() => nav(`${basePath}/${id}/edit`)}>
              Edit
            </Button>
          )}
          {isAdmin && (
            <Button danger icon={<DeleteOutlined />} onClick={() => setDeleteOpen(true)}>
              Delete
            </Button>
          )}
        </Space>
      </div>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <SummaryChip tone="indigo"  label="Asset Type" value={record.asset_type} />
        <SummaryChip tone="cyan"    label="OS"         value={osCombined} />
        <SummaryChip tone="emerald" label="Department" value={record.department} />
        <SummaryChip tone="amber"   label="Location"   value={record.location} />
      </Row>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={
          <Space split={<span style={{ color: '#cbd5e1' }}>·</span>} wrap>
            <span><Typography.Text type="secondary">Submitted By:</Typography.Text>{' '}
              <strong>{record.created_by_name || '—'}</strong></span>
            <span><Typography.Text type="secondary">Created:</Typography.Text>{' '}
              <strong>{record.created_at ? new Date(record.created_at).toLocaleString() : '—'}</strong></span>
            <span><Typography.Text type="secondary">Modified By:</Typography.Text>{' '}
              <strong>{record.updated_by_name || '—'}</strong></span>
            <span><Typography.Text type="secondary">Modified:</Typography.Text>{' '}
              <strong>{record.updated_at ? new Date(record.updated_at).toLocaleString() : '—'}</strong></span>
          </Space>
        }
      />

      <Row gutter={[16, 16]}>
        {sections.map(([sectionName, sectionFields]) => {
          if (sectionFields.length === 0) return null;
          return (
            <Col key={sectionName} xs={24} lg={12}>
              <Card className="asset-view-section" type="inner"
                title={
                  <Space>
                    <span className="asset-view-section-icon">
                      {SECTION_ICONS[sectionName] || <BlockOutlined />}
                    </span>
                    <strong>{sectionName}</strong>
                  </Space>
                }
              >
                <div className="asset-view-rows">
                  {sectionFields.map(f => (
                    <FieldRow
                      key={f.field_key}
                      label={f.label}
                      value={renderValue(
                        f.field_key,
                        valueFor(f.field_key, f.is_extra),
                        fieldMeta,
                        { passwordCell }
                      )}
                    />
                  ))}
                </div>
              </Card>
            </Col>
          );
        })}
      </Row>

      {showAudit && (
        <Card type="inner" style={{ marginTop: 16 }}
          title={
            <Space>
              <HistoryOutlined style={{ color: '#7c3aed' }} />
              <strong>Audit Trail</strong>
            </Space>
          }
          extra={
            <Button size="small" icon={<ReloadOutlined />} onClick={loadAudit} loading={auditLoading}>
              Refresh
            </Button>
          }
        >
          {auditLoading
            ? <div style={{ textAlign: 'center', padding: 30 }}><Spin /></div>
            : auditRows.length === 0
              ? <Empty description="No audit entries yet." />
              : (
                <div className="asset-view-audit">
                  {auditRows.map(a => (
                    <div key={a.id} className="asset-view-audit-row">
                      <Tag color={
                        a.action === 'CREATE' ? 'green' :
                        a.action === 'UPDATE' ? 'blue' :
                        a.action === 'DELETE' ? 'red' :
                        a.action === 'RESTORE' ? 'cyan' :
                        a.action === 'VIEW_PASSWORD' ? 'gold' : 'default'
                      }>{a.action}</Tag>
                      <span style={{ flex: 1 }}>
                        <strong>{a.user_email || 'system'}</strong>{' '}
                        <Typography.Text type="secondary">
                          {a.ip_address ? `from ${a.ip_address}` : ''}
                        </Typography.Text>
                      </span>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {new Date(a.created_at).toLocaleString()}
                      </Typography.Text>
                    </div>
                  ))}
                </div>
              )}
        </Card>
      )}

      <div style={{ marginTop: 16, textAlign: 'right' }}>
        <Space>
          <Button onClick={() => nav(basePath)}>Back to list</Button>
          {canWrite && (
            <Button type="primary" icon={<EditOutlined />}
              onClick={() => nav(`${basePath}/${id}/edit`)}>
              Edit {effectiveLabel}
            </Button>
          )}
        </Space>
      </div>

      <PasswordConfirmModal
        open={deleteOpen}
        title={`Delete "${record.vm_name}"?`}
        message="This will move the record to the Recycle Bin. A superadmin can restore it later."
        okText="Delete"
        onCancel={() => setDeleteOpen(false)}
        onConfirm={onDeleteConfirmed}
      />
    </div>
  );
}
