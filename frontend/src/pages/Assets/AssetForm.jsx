import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card, Form, Input, Select, Switch, Row, Col, Button, Space, App, Typography, Divider, Alert, Tag,
  InputNumber, DatePicker,
} from 'antd';
import dayjs from 'dayjs';
import { ThunderboltOutlined, EditOutlined } from '@ant-design/icons';
import api from '../../api/client';
import AssetTagPicker from './AssetTagPicker.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

const ipRe = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

function extractTagNumber(tag) {
  const m = String(tag || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : NaN;
}

// Map snake_case server field keys to camelCase Form.Item names.
function camel(s) { return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase()); }

export default function AssetForm({ mode, apiPrefix = '/assets', listPath = '/assets', entityLabel = 'Asset', pageKey = 'assets' }) {
  const { id } = useParams();
  const nav = useNavigate();
  const { message } = App.useApp();
  const { user, getPageLabel } = useAuth();
  const effectiveEntityLabel = getPageLabel ? getPageLabel(pageKey, entityLabel) : entityLabel;
  const isAdmin = ['admin', 'superadmin'].includes(user?.role);
  const [form] = Form.useForm();
  const [dd, setDd] = useState({});
  const [departments, setDepartments] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [osType, setOsType] = useState();
  const [department, setDepartment] = useState();
  const [autoTagInfo, setAutoTagInfo] = useState(null);
  const [autoTagLoading, setAutoTagLoading] = useState(false);
  const [manualOverride, setManualOverride] = useState(false);
  const [hiddenSet, setHiddenSet] = useState(new Set());
  const isHidden = (snakeKey) => hiddenSet.has(snakeKey);
  const [fieldMeta, setFieldMeta] = useState({ fields: [], byKey: {} });
  const labelOf = (snakeKey, fallback) => fieldMeta.byKey[snakeKey]?.label || fallback;
  const [meta, setMeta] = useState({ created_by_name: '', created_at: '' });

  const departmentOptions = useMemo(
    () => departments.map(d => ({
      label: `${d.name} (${String(d.min_tag).padStart(4, '0')}–${String(d.max_tag).padStart(4, '0')})`,
      value: d.name,
    })),
    [departments],
  );

  const rangeFor = (name) => departments.find(d => d.name === name);

  useEffect(() => {
    api.get('/dropdowns').then(r => setDd(r.data.grouped || {}));
    api.get('/departments', { params: { activeOnly: 1 } })
      .then(r => setDepartments(r.data.items || []))
      .catch(() => {});
    api.get(`/field-visibility/${pageKey}`)
      .then(r => setHiddenSet(new Set(r.data.hidden || [])))
      .catch(() => {});
    api.get(`/inventory-fields/${pageKey}`)
      .then(r => {
        const byKey = {};
        for (const f of r.data.fields || []) byKey[f.field_key] = f;
        setFieldMeta({ fields: r.data.fields || [], byKey });
      })
      .catch(() => {});

    if (mode === 'edit' && id) {
      api.get(`${apiPrefix}/${id}`).then(r => {
        form.setFieldsValue({
          vmName: r.data.vm_name,
          osHostname: r.data.os_hostname,
          ipAddress: r.data.ip_address,
          assetType: r.data.asset_type,
          osType: r.data.os_type,
          osVersion: r.data.os_version,
          assignedUser: r.data.assigned_user,
          department: r.data.department,
          businessPurpose: r.data.business_purpose,
          serverStatus: r.data.server_status,
          patchingType: r.data.patching_type,
          serverPatchType: r.data.server_patch_type,
          patchingSchedule: r.data.patching_schedule,
          location: r.data.location,
          eolStatus: r.data.eol_status,
          serialNumber: r.data.serial_number,
          omeStatus: r.data.ome_status,
          hostedIp: r.data.hosted_ip,
          assetTag: r.data.asset_tag,
          assetUsername: r.data.asset_username,
          additionalRemarks: r.data.additional_remarks,
          manageEngineInstalled: r.data.manage_engine_installed,
          tenableInstalled: r.data.tenable_installed,
          idracEnabled: r.data.idrac_enabled,
          idracIp: r.data.idrac_ip,
          // Hydrate any admin-added extras under the `extras` namespace.
          extras: Object.fromEntries(
            Object.entries(r.data.extras || {}).map(([k, v]) =>
              [k, v && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? dayjs(v) : v]
            )
          ),
        });
        setOsType(r.data.os_type);
        setDepartment(r.data.department);
        setMeta({ created_by_name: r.data.created_by_name || '', created_at: r.data.created_at || '' });
      });
    }
  }, [id, mode]); // eslint-disable-line

  // Auto-assign next tag whenever department changes (create mode, no manual override).
  useEffect(() => {
    if (mode !== 'create') return;
    if (!department) {
      setAutoTagInfo(null);
      form.setFieldValue('assetTag', undefined);
      return;
    }
    if (manualOverride) return;

    let cancelled = false;
    setAutoTagLoading(true);
    api.get(`${apiPrefix}/tag-stats`, { params: { department } })
      .then(({ data }) => {
        if (cancelled) return;
        setAutoTagInfo(data);
        if (data.nextAvailable != null) {
          form.setFieldValue('assetTag', String(data.nextAvailable));
        } else {
          form.setFieldValue('assetTag', undefined);
        }
      })
      .catch(() => { if (!cancelled) setAutoTagInfo(null); })
      .finally(() => { if (!cancelled) setAutoTagLoading(false); });

    return () => { cancelled = true; };
  }, [department, manualOverride, mode]); // eslint-disable-line

  // If a parent is provided (e.g. OS Type for OS Version), only return rows
  // whose parent_value matches. Otherwise return all rows for the category.
  const opts = (cat, parent) => (dd[cat] || [])
    .filter(d => parent === undefined ? true : d.parent_value === parent)
    .map(d => ({ label: d.value, value: d.value }));

  async function onFinish(values) {
    setSubmitting(true);
    try {
      // Convert any dayjs values inside `extras` to ISO strings before POSTing.
      const payload = { ...values };
      if (payload.extras && typeof payload.extras === 'object') {
        payload.extras = Object.fromEntries(
          Object.entries(payload.extras).map(([k, v]) => {
            if (v && typeof v === 'object' && typeof v.toISOString === 'function') return [k, v.toISOString()];
            return [k, v];
          })
        );
      }
      if (mode === 'create') {
        await api.post(apiPrefix, payload);
        message.success(`${effectiveEntityLabel} created`);
      } else {
        await api.put(`${apiPrefix}/${id}`, payload);
        message.success(`${effectiveEntityLabel} updated`);
      }
      nav(listPath);
    } catch (e) {
      const err = e.response?.data;
      if (err?.details && typeof err.details === 'object' && !Array.isArray(err.details)) {
        const fields = Object.entries(err.details).map(([k, v]) => ({
          name: k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
          errors: [v],
        }));
        form.setFields(fields);
      }
      message.error(err?.error || 'Failed to save');
    } finally { setSubmitting(false); }
  }

  const showAutoTagBlock = mode === 'create' && !manualOverride;
  const range = rangeFor(department);

  return (
    <Card title={<Typography.Title level={4} style={{ margin: 0 }}>{mode === 'create' ? `Add ${effectiveEntityLabel}` : `Edit ${effectiveEntityLabel}`}</Typography.Title>}
      className="inventory-form-card"
    >
      <Form form={form} layout="vertical" onFinish={onFinish} className="inventory-form"
        initialValues={{ manageEngineInstalled: false, tenableInstalled: false, idracEnabled: false }}>
        {mode === 'edit' && (meta.created_by_name || meta.created_at) && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={
              <Space split={<Divider type="vertical" />} wrap>
                <span><Typography.Text type="secondary">Submitted By:</Typography.Text>{' '}
                  <strong>{meta.created_by_name || '—'}</strong></span>
                <span><Typography.Text type="secondary">Created:</Typography.Text>{' '}
                  <strong>{meta.created_at ? new Date(meta.created_at).toLocaleString() : '—'}</strong></span>
              </Space>
            }
          />
        )}
        <Divider orientation="left">Identity</Divider>
        <Row gutter={16}>
          {!isHidden('vm_name') && <Col xs={24} md={8}><Form.Item name="vmName" label={labelOf('vm_name', 'VM Name')} rules={[{ required: true }]}><Input /></Form.Item></Col>}
          {!isHidden('os_hostname') && <Col xs={24} md={8}><Form.Item name="osHostname" label={labelOf('os_hostname', 'OS Hostname')}><Input /></Form.Item></Col>}
          {!isHidden('ip_address') && <Col xs={24} md={8}>
            <Form.Item
              name="ipAddress"
              label={labelOf('ip_address', 'IP Address')}
              validateDebounce={400}
              rules={[
                { required: true },
                { pattern: ipRe, message: 'Invalid IP address' },
                {
                  validator: async (_, value) => {
                    if (!value || !ipRe.test(value)) return;
                    try {
                      const params = { ip: value };
                      if (mode === 'edit' && id) {
                        params.excludeTable =
                          apiPrefix.includes('beijing')       ? 'beijing_assets'
                          : apiPrefix.includes('ext')         ? 'ext_assets'
                          : apiPrefix.includes('physical')    ? 'physical_esxi_servers'
                          : 'assets';
                        params.excludeId = id;
                      }
                      const { data } = await api.get(`${apiPrefix}/check-ip`, { params });
                      if (data.used) {
                        const where =
                          data.conflictTable === 'beijing_assets'        ? 'Beijing Inventory'
                          : data.conflictTable === 'ext_assets'          ? 'Ext. Asset Inventory'
                          : data.conflictTable === 'physical_esxi_servers' ? 'Physical & ESXi Servers'
                          : 'Asset Inventory';
                        throw new Error(`IP already exists in ${where}`);
                      }
                    } catch (e) {
                      if (e.message?.startsWith('IP already')) throw e;
                      // network errors fall through — server-side check is the final gate
                    }
                  },
                },
              ]}
            >
              <Input />
            </Form.Item>
          </Col>}
          {!isHidden('asset_type') && <Col xs={24} md={8}><Form.Item name="assetType" label={labelOf('asset_type', 'Asset Type')}><Input placeholder="e.g. Virtual Server" /></Form.Item></Col>}
          {!isHidden('os_type') && <Col xs={24} md={8}>
            <Form.Item name="osType" label={labelOf('os_type', 'OS Type')}>
              <Select allowClear options={opts('os_type')} onChange={(v) => { setOsType(v); form.setFieldValue('osVersion', undefined); }} />
            </Form.Item>
          </Col>}
          {!isHidden('os_version') && <Col xs={24} md={8}>
            <Form.Item name="osVersion" label={labelOf('os_version', 'OS Version')}>
              <Select allowClear options={opts('os_version', osType)} />
            </Form.Item>
          </Col>}
        </Row>

        <Divider orientation="left">Ownership</Divider>
        <Row gutter={16}>
          {!isHidden('assigned_user') && <Col xs={24} md={8}><Form.Item name="assignedUser" label={labelOf('assigned_user', 'Assigned User')}><Input /></Form.Item></Col>}
          {!isHidden('department') && <Col xs={24} md={8}>
            <Form.Item name="department" label={labelOf('department', 'Department')}>
              <Select
                allowClear
                showSearch
                placeholder="Select department"
                options={departmentOptions}
                optionFilterProp="label"
                onChange={(v) => {
                  setDepartment(v);
                  if (!manualOverride) form.setFieldValue('assetTag', undefined);
                  form.validateFields(['assetTag']).catch(() => {});
                }}
              />
            </Form.Item>
          </Col>}
          {!isHidden('business_purpose') && <Col xs={24} md={24}><Form.Item name="businessPurpose" label={labelOf('business_purpose', 'Business Purpose')}><Input.TextArea rows={2} /></Form.Item></Col>}
        </Row>

        <Divider orientation="left">Operations</Divider>
        <Row gutter={16}>
          {!isHidden('server_status') && <Col xs={24} md={6}><Form.Item name="serverStatus" label={labelOf('server_status', 'Server Status')}><Select allowClear options={opts('server_status')} /></Form.Item></Col>}
          {!isHidden('patching_type') && <Col xs={24} md={6}><Form.Item name="patchingType" label={labelOf('patching_type', 'Patching Type')}><Select allowClear options={opts('patching_type')} /></Form.Item></Col>}
          {!isHidden('server_patch_type') && <Col xs={24} md={6}><Form.Item name="serverPatchType" label={labelOf('server_patch_type', 'Server Patch Type')}><Select allowClear options={opts('server_patch_type')} /></Form.Item></Col>}
          {!isHidden('patching_schedule') && <Col xs={24} md={6}><Form.Item name="patchingSchedule" label={labelOf('patching_schedule', 'Patching Schedule')}><Select allowClear options={opts('patching_schedule')} /></Form.Item></Col>}
          {!isHidden('location') && <Col xs={24} md={6}><Form.Item name="location" label={labelOf('location', 'Location')}><Select allowClear options={opts('location')} /></Form.Item></Col>}
          {!isHidden('eol_status') && <Col xs={24} md={6}><Form.Item name="eolStatus" label={labelOf('eol_status', 'EOL Status')}><Select allowClear options={opts('eol_status')} /></Form.Item></Col>}
          {!isHidden('ome_status') && <Col xs={24} md={6}><Form.Item name="omeStatus" label={labelOf('ome_status', 'OME Status')}><Input /></Form.Item></Col>}
          {!isHidden('hosted_ip') && <Col xs={24} md={6}><Form.Item name="hostedIp" label={labelOf('hosted_ip', 'Hosted IP')}><Input /></Form.Item></Col>}
        </Row>

        <Divider orientation="left">Asset Tagging & Credentials</Divider>
        <Row gutter={16}>
          {!isHidden('serial_number') && <Col xs={24} md={8}><Form.Item name="serialNumber" label={labelOf('serial_number', 'Serial Number')}><Input /></Form.Item></Col>}
          {!isHidden('asset_username') && <Col xs={24} md={8}><Form.Item name="assetUsername" label={labelOf('asset_username', 'Asset Username')}><Input /></Form.Item></Col>}
          {!isHidden('asset_password') && <Col xs={24} md={8}>
            <Form.Item name="assetPassword" label={labelOf('asset_password', 'Asset Password')} extra="Encrypted (AES-256-GCM) at rest">
              <Input.Password placeholder={mode === 'edit' ? 'Leave blank to keep existing' : ''} autoComplete="new-password" />
            </Form.Item>
          </Col>}

          <Col xs={24}>
            <Form.Item
              name="assetTag"
              label={
                <Space>
                  <span>Asset Tag</span>
                  {mode === 'create' && isAdmin && (
                    <Tag
                      color={manualOverride ? 'orange' : 'blue'}
                      icon={manualOverride ? <EditOutlined /> : <ThunderboltOutlined />}
                    >
                      {manualOverride ? 'Manual override' : 'Auto-assigned'}
                    </Tag>
                  )}
                </Space>
              }
              dependencies={['department']}
              rules={[
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value) return Promise.resolve();
                    const dept = getFieldValue('department');
                    const r = rangeFor(dept);
                    if (!r) return Promise.resolve();
                    const n = extractTagNumber(value);
                    if (Number.isNaN(n)) return Promise.reject(new Error('Asset tag must contain a number'));
                    if (n < r.min_tag || n > r.max_tag) {
                      return Promise.reject(new Error(`Tag ${n} is outside ${r.name}'s range ${r.min_tag}–${r.max_tag}`));
                    }
                    return Promise.resolve();
                  },
                }),
              ]}
            >
              {showAutoTagBlock ? (
                <AutoAssignedTagDisplay
                  department={department}
                  range={range}
                  info={autoTagInfo}
                  loading={autoTagLoading}
                  isAdmin={isAdmin}
                  onEnableOverride={() => setManualOverride(true)}
                />
              ) : (
                <AssetTagPicker department={department} apiPrefix={apiPrefix} />
              )}
            </Form.Item>
            {mode === 'create' && isAdmin && manualOverride && (
              <Button size="small" type="link" style={{ paddingLeft: 0, marginTop: -8 }}
                onClick={() => { setManualOverride(false); form.setFieldValue('assetTag', undefined); }}>
                ← Back to auto-assign
              </Button>
            )}
          </Col>

          {!isHidden('additional_remarks') && <Col xs={24}><Form.Item name="additionalRemarks" label={labelOf('additional_remarks', 'Additional Remarks')}><Input.TextArea rows={2} /></Form.Item></Col>}
        </Row>

        <Divider orientation="left">Tools</Divider>
        <Row gutter={16}>
          {!isHidden('manage_engine_installed') && <Col xs={12} md={6}><Form.Item name="manageEngineInstalled" label={labelOf('manage_engine_installed', 'ManageEngine Installed')} valuePropName="checked"><Switch /></Form.Item></Col>}
          {!isHidden('tenable_installed') && <Col xs={12} md={6}><Form.Item name="tenableInstalled" label={labelOf('tenable_installed', 'Tenable Installed')} valuePropName="checked"><Switch /></Form.Item></Col>}
          {!isHidden('idrac_enabled') && <Col xs={12} md={6}><Form.Item name="idracEnabled" label={labelOf('idrac_enabled', 'iDRAC')} valuePropName="checked"><Switch /></Form.Item></Col>}
          {!isHidden('idrac_ip') && <Col xs={24} md={6}><Form.Item name="idracIp" label={labelOf('idrac_ip', 'iDRAC IP')} rules={[{ pattern: ipRe, message: 'Invalid IP address' }]}><Input placeholder="10.x.x.x" /></Form.Item></Col>}
        </Row>

        {fieldMeta.fields.filter(f => f.is_extra && !isHidden(f.field_key)).length > 0 && (
          <>
            <Divider orientation="left">Custom Fields</Divider>
            <Row gutter={16}>
              {fieldMeta.fields
                .filter(f => f.is_extra && !isHidden(f.field_key))
                .sort((a, b) => a.sort_order - b.sort_order)
                .map(f => (
                  <Col xs={24} md={f.input_type === 'textarea' ? 24 : 8} key={f.field_key}>
                    <Form.Item
                      name={['extras', f.field_key]}
                      label={f.label}
                      rules={f.is_required ? [{ required: true, message: `${f.label} is required` }] : []}
                      valuePropName={f.input_type === 'toggle' ? 'checked' : 'value'}
                    >
                      {renderExtraInput(f)}
                    </Form.Item>
                  </Col>
                ))}
            </Row>
          </>
        )}

        <Space>
          <Button type="primary" htmlType="submit" loading={submitting}>{mode === 'create' ? `Create ${effectiveEntityLabel}` : 'Save Changes'}</Button>
          <Button onClick={() => nav(listPath)}>Cancel</Button>
        </Space>
      </Form>
    </Card>
  );
}

function renderExtraInput(f) {
  switch (f.input_type) {
    case 'textarea': return <Input.TextArea rows={3} />;
    case 'number':   return <InputNumber style={{ width: '100%' }} />;
    case 'dropdown': return <Select options={(f.options || []).map(o => ({ label: o, value: o }))} allowClear />;
    case 'toggle':   return <Switch />;
    case 'date':     return <DatePicker style={{ width: '100%' }} />;
    default:         return <Input />;
  }
}

function AutoAssignedTagDisplay({ department, range, info, loading, isAdmin, onEnableOverride, value }) {
  if (!department) {
    return <Alert type="info" showIcon message="Select a department to auto-assign an asset tag." />;
  }
  if (loading && !info) {
    return <Alert type="info" message="Looking up next available tag…" />;
  }
  if (!info) return null;
  const noneAvailable = info.nextAvailable == null;
  return (
    <Card size="small" style={{ background: '#f6ffed', borderColor: '#b7eb8f' }}>
      <Row gutter={16} align="middle">
        <Col flex="auto">
          <Space direction="vertical" size={0}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              <ThunderboltOutlined style={{ color: '#1677ff' }} /> Auto-assigned for {range?.name || department}
            </Typography.Text>
            {noneAvailable ? (
              <Typography.Text type="danger">No available tags in this department's range ({range?.min_tag}–{range?.max_tag}).</Typography.Text>
            ) : (
              <Space size="middle" align="center">
                <Typography.Text style={{ fontSize: 28, fontWeight: 600, color: '#1677ff' }}>
                  {value || info.nextAvailable}
                </Typography.Text>
                <Typography.Text type="secondary">
                  Range {info.min}–{info.max} · {info.available.toLocaleString()} of {info.total.toLocaleString()} available
                </Typography.Text>
              </Space>
            )}
          </Space>
        </Col>
        {isAdmin && (
          <Col>
            <Button icon={<EditOutlined />} onClick={onEnableOverride}>
              Override manually
            </Button>
          </Col>
        )}
      </Row>
    </Card>
  );
}
