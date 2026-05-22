import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  Card, Row, Col, Space, Button, Typography, Tag, Divider, Descriptions, Spin, Alert, App, Tooltip,
} from 'antd';
import {
  ArrowLeftOutlined, EditOutlined, DeleteOutlined, EyeOutlined, EyeInvisibleOutlined,
  ReloadOutlined, AppstoreOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';
import PasswordConfirmModal from '../../components/PasswordConfirmModal.jsx';

const NA = <Typography.Text type="secondary">—</Typography.Text>;

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
  const color = v === 'Supported' ? 'green'
              : v === 'EOL'       ? 'red'
              : v === 'Decommissioned' ? 'red'
              : v === 'Not Applicable'  ? 'default'
              : 'orange';
  return <Tag color={color}>{v}</Tag>;
}

// Renders the right read-only widget for a single field, using fieldMeta
// to pick the correct presentation (date / toggle / dropdown text / number).
function renderValue(field_key, raw, fieldMeta, helpers) {
  if (raw === null || raw === undefined || raw === '') return NA;
  if (field_key === 'server_status')      return <StatusTag status={raw} />;
  if (field_key === 'eol_status')         return <EolTag v={raw} />;
  if (field_key === 'asset_tag')          return <Tag>{raw}</Tag>;
  if (field_key === 'manage_engine_installed' || field_key === 'tenable_installed' || field_key === 'idrac_enabled') {
    return <YesNo v={raw} />;
  }
  if (field_key === 'asset_password') {
    return helpers?.passwordCell ?? NA;
  }
  // Built-in fields fall through to the meta-driven rendering below.
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

export default function AssetView({
  apiPrefix = '/assets',
  basePath = '/assets',
  entityLabel = 'Asset',
  pageKey = 'assets',
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

  // Group every (non-extras) field by its section, ordered by fieldMeta.groups.
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

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>;
  }
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

  // Built-in extras come back at record.extras[field_key]; built-in fields
  // are on the record object directly. Pick the right source per field.
  function valueFor(field_key, isExtra) {
    if (isExtra) return record.extras?.[field_key];
    return record[field_key];
  }

  const title = record.vm_name || `(unnamed ${effectiveLabel.toLowerCase()})`;

  return (
    <div>
      <Card
        className="inventory-form-card"
        title={
          <Space>
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => nav(basePath)} />
            <AppstoreOutlined style={{ color: '#1f3a8a' }} />
            <div>
              <Typography.Title level={4} style={{ margin: 0 }}>{title}</Typography.Title>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {effectiveLabel} · viewing details
              </Typography.Text>
            </div>
          </Space>
        }
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={load}>Reload</Button>
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
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={
            <Space split={<Divider type="vertical" />} wrap>
              <span>
                <Typography.Text type="secondary">Submitted By:</Typography.Text>{' '}
                <strong>{record.created_by_name || '—'}</strong>
              </span>
              <span>
                <Typography.Text type="secondary">Created:</Typography.Text>{' '}
                <strong>{record.created_at ? new Date(record.created_at).toLocaleString() : '—'}</strong>
              </span>
              <span>
                <Typography.Text type="secondary">Modified By:</Typography.Text>{' '}
                <strong>{record.updated_by_name || '—'}</strong>
              </span>
              <span>
                <Typography.Text type="secondary">Modified:</Typography.Text>{' '}
                <strong>{record.updated_at ? new Date(record.updated_at).toLocaleString() : '—'}</strong>
              </span>
            </Space>
          }
        />

        {sections.map(([sectionName, sectionFields]) => {
          const visible = sectionFields;
          if (visible.length === 0) return null;
          return (
            <div key={sectionName}>
              <Divider orientation="left" style={{ marginTop: 12 }}>{sectionName}</Divider>
              <Descriptions
                column={{ xs: 1, sm: 2, md: 3 }}
                size="small"
                bordered
                labelStyle={{ width: 200, fontWeight: 600 }}
              >
                {visible.map(f => (
                  <Descriptions.Item key={f.field_key} label={f.label}>
                    {renderValue(
                      f.field_key,
                      valueFor(f.field_key, f.is_extra),
                      fieldMeta,
                      { passwordCell }
                    )}
                  </Descriptions.Item>
                ))}
              </Descriptions>
            </div>
          );
        })}

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
      </Card>

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
