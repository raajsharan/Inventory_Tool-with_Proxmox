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
import {
  useInventoryFieldMeta,
  overridableFormItem as sharedOverridableFormItem,
  renderExtraWidget as sharedRenderExtraWidget,
  buildDynamicSections,
} from '../../utils/dynamicFormFields.jsx';

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
  const idracEnabled = Form.useWatch('idracEnabled', form);
  const [autoTagInfo, setAutoTagInfo] = useState(null);
  const [autoTagLoading, setAutoTagLoading] = useState(false);
  const [manualOverride, setManualOverride] = useState(false);
  const { isHidden, fieldMeta, labelOf } = useInventoryFieldMeta(pageKey);
  const [meta, setMeta] = useState({ created_by_name: '', created_at: '' });
  const [originalIp, setOriginalIp] = useState(null); // record's stored IP (edit mode)

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
          macAddress: r.data.mac_address,
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
        setOriginalIp(r.data.ip_address || null);
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
        // { field: 'reason' } shape from duplicate checks
        const fields = Object.entries(err.details).map(([k, v]) => ({
          name: k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
          errors: [v],
        }));
        form.setFields(fields);
        message.error(err?.error || 'Failed to save');
      } else if (Array.isArray(err?.details) && err.details.length) {
        // express-validator shape: [{ path, msg, ... }]
        const fields = err.details
          .filter(d => d?.path)
          .map(d => ({ name: d.path, errors: [d.msg === 'Invalid value' ? 'Invalid or empty value' : d.msg] }));
        if (fields.length) form.setFields(fields);
        const first = err.details[0];
        message.error(`${err?.error || 'Validation failed'}${first?.path ? ` — check "${first.path}"` : ''}`);
      } else {
        message.error(err?.error || 'Failed to save');
      }
    } finally { setSubmitting(false); }
  }

  const showAutoTagBlock = mode === 'create' && !manualOverride;
  const range = rangeFor(department);

  // Width map for built-in widgets so a moved field keeps a sensible size.
  const FIELD_WIDTHS = {
    vm_name: { xs: 24, md: 8 }, os_hostname: { xs: 24, md: 8 }, ip_address: { xs: 24, md: 8 },
    asset_type: { xs: 24, md: 8 }, os_type: { xs: 24, md: 8 }, os_version: { xs: 24, md: 8 },
    assigned_user: { xs: 24, md: 8 }, department: { xs: 24, md: 8 }, business_purpose: { xs: 24, md: 24 },
    server_status: { xs: 24, md: 6 }, patching_type: { xs: 24, md: 6 }, server_patch_type: { xs: 24, md: 6 },
    patching_schedule: { xs: 24, md: 6 }, location: { xs: 24, md: 6 }, eol_status: { xs: 24, md: 6 },
    ome_status: { xs: 24, md: 6 }, hosted_ip: { xs: 24, md: 6 },
    serial_number: { xs: 24, md: 8 }, asset_username: { xs: 24, md: 8 }, asset_password: { xs: 24, md: 8 },
    asset_tag: { xs: 24, md: 24 }, additional_remarks: { xs: 24, md: 24 },
    mac_address: { xs: 24, md: 8 },
    manage_engine_installed: { xs: 12, md: 6 }, tenable_installed: { xs: 12, md: 6 },
    idrac_enabled: { xs: 12, md: 6 }, idrac_ip: { xs: 24, md: 6 },
  };

  // Thin wrapper around the shared implementation (frontend/src/utils/dynamicFormFields.jsx)
  // so every existing call site below (fieldKey-based) keeps working unchanged.
  // Frozen and DB-linked fields bypass this and keep their special widgets so
  // we don't lose IP/asset-tag/cascade behavior.
  function overridableFormItem(opts) {
    return sharedOverridableFormItem({ ...opts, fieldMeta, dd });
  }

  function renderBuiltinWidget(field_key) {
    if (isHidden(field_key)) return null;
    const width = FIELD_WIDTHS[field_key] || { xs: 24, md: 8 };
    const wrap = (children) => <Col key={field_key} xs={width.xs} md={width.md}>{children}</Col>;

    switch (field_key) {
      case 'vm_name':
        return wrap(overridableFormItem({
          fieldKey: 'vm_name', name: 'vmName',
          label: labelOf('vm_name', 'VM Name'),
          rules: [{ required: true }],
          defaultChild: <Input />,
        }));
      case 'os_hostname':
        return wrap(overridableFormItem({
          fieldKey: 'os_hostname', name: 'osHostname',
          label: labelOf('os_hostname', 'OS Hostname'),
          defaultChild: <Input />,
        }));
      case 'ip_address':
        return wrap(
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
                  // Unchanged IP on an existing record is always allowed —
                  // don't block edits over historical cross-inventory duplicates.
                  if (mode === 'edit' && originalIp && value === originalIp) return;
                  try {
                    const params = { ip: value };
                    if (mode === 'edit' && id) {
                      params.excludeTable =
                        apiPrefix.includes('beijing')    ? 'beijing_assets'
                        : apiPrefix.includes('ext')      ? 'ext_assets'
                        : apiPrefix.includes('physical') ? 'physical_esxi_servers'
                        : 'assets';
                      params.excludeId = id;
                    }
                    const { data } = await api.get(`${apiPrefix}/check-ip`, { params });
                    if (data.used) {
                      const where =
                        data.conflictTable === 'beijing_assets'         ? 'Beijing Inventory'
                        : data.conflictTable === 'ext_assets'           ? 'Ext. Asset Inventory'
                        : data.conflictTable === 'physical_esxi_servers' ? 'Physical & ESXi Servers'
                        : 'Asset Inventory';
                      throw new Error(`IP already exists in ${where}`);
                    }
                  } catch (e) {
                    if (e.message?.startsWith('IP already')) throw e;
                  }
                },
              },
            ]}
          ><Input /></Form.Item>
        );
      case 'asset_type':
        return wrap(
          <Form.Item name="assetType" label={labelOf('asset_type', 'Asset Type')}>
            <Select allowClear showSearch optionFilterProp="label" placeholder="Select Asset Type" options={opts('asset_type')} />
          </Form.Item>
        );
      case 'os_type':
        return wrap(
          <Form.Item name="osType" label={labelOf('os_type', 'OS Type')}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="Select OS Type"
              options={opts('os_type')}
              onChange={(v) => { setOsType(v); form.setFieldValue('osVersion', undefined); }}
            />
          </Form.Item>
        );
      case 'mac_address':
        return wrap(
          <Form.Item
            name="macAddress"
            label={labelOf('mac_address', 'MAC Address')}
          >
            <Input placeholder="e.g. 00:11:22:33:44:55" />
          </Form.Item>
        );
      case 'os_version':
        return wrap(
          <Form.Item
            name="osVersion"
            label={labelOf('os_version', 'OS Version')}
            extra={!osType ? 'Select an OS Type first to see available versions.' : undefined}
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              disabled={!osType}
              placeholder={osType ? 'Select OS Version' : 'Select OS Type first'}
              options={osType ? opts('os_version', osType) : []}
            />
          </Form.Item>
        );
      case 'assigned_user':
        return wrap(overridableFormItem({
          fieldKey: 'assigned_user', name: 'assignedUser',
          label: labelOf('assigned_user', 'Assigned User'),
          defaultChild: <Input />,
        }));
      case 'department':
        return wrap(
          <Form.Item name="department" label={labelOf('department', 'Department')}>
            <Select allowClear showSearch placeholder="Select department"
              options={departmentOptions} optionFilterProp="label"
              onChange={(v) => {
                setDepartment(v);
                if (!manualOverride) form.setFieldValue('assetTag', undefined);
                form.validateFields(['assetTag']).catch(() => {});
              }}
            />
          </Form.Item>
        );
      case 'business_purpose':
        return wrap(overridableFormItem({
          fieldKey: 'business_purpose', name: 'businessPurpose',
          label: labelOf('business_purpose', 'Business Purpose'),
          defaultChild: <Input.TextArea rows={2} />,
        }));
      case 'server_status':
        return wrap(
          <>
            <Form.Item name="serverStatus" label={labelOf('server_status', 'Server Status')}>
              <Select allowClear options={opts('server_status')} />
            </Form.Item>
            {/* Decommission reason — recorded in the permanent decommission report */}
            <Form.Item noStyle shouldUpdate={(prev, cur) => prev.serverStatus !== cur.serverStatus}>
              {({ getFieldValue }) =>
                /^decom/i.test(String(getFieldValue('serverStatus') || '')) ? (
                  <Form.Item
                    name="decommissionReason"
                    label="Decommission reason"
                    extra="Optional — recorded in the decommission report with your name and date."
                  >
                    <Input.TextArea rows={2} placeholder="e.g. Hardware refresh — replaced by BURWPLTG1010" maxLength={500} />
                  </Form.Item>
                ) : null
              }
            </Form.Item>
          </>
        );
      case 'patching_type':
        return wrap(<Form.Item name="patchingType" label={labelOf('patching_type', 'Patching Type')}><Select allowClear options={opts('patching_type')} /></Form.Item>);
      case 'server_patch_type':
        return wrap(<Form.Item name="serverPatchType" label={labelOf('server_patch_type', 'Server Patch Type')}><Select allowClear options={opts('server_patch_type')} /></Form.Item>);
      case 'patching_schedule':
        return wrap(<Form.Item name="patchingSchedule" label={labelOf('patching_schedule', 'Patching Schedule')}><Select allowClear options={opts('patching_schedule')} /></Form.Item>);
      case 'location':
        return wrap(<Form.Item name="location" label={labelOf('location', 'Location')}><Select allowClear options={opts('location')} /></Form.Item>);
      case 'eol_status':
        return wrap(<Form.Item name="eolStatus" label={labelOf('eol_status', 'EOL Status')}><Select allowClear options={opts('eol_status')} /></Form.Item>);
      case 'ome_status':
        if (!idracEnabled) return null;
        return wrap(overridableFormItem({
          fieldKey: 'ome_status', name: 'omeStatus',
          label: labelOf('ome_status', 'OME Status'),
          defaultChild: <Input />,
        }));
      case 'hosted_ip':
        return wrap(overridableFormItem({
          fieldKey: 'hosted_ip', name: 'hostedIp',
          label: labelOf('hosted_ip', 'Hosted IP'),
          defaultChild: <Input />,
        }));
      case 'serial_number':
        return wrap(overridableFormItem({
          fieldKey: 'serial_number', name: 'serialNumber',
          label: labelOf('serial_number', 'Serial Number'),
          defaultChild: <Input />,
        }));
      case 'asset_username':
        return wrap(overridableFormItem({
          fieldKey: 'asset_username', name: 'assetUsername',
          label: labelOf('asset_username', 'Asset Username'),
          defaultChild: <Input />,
        }));
      case 'asset_password':
        return wrap(
          <Form.Item name="assetPassword" label={labelOf('asset_password', 'Asset Password')} extra="Encrypted (AES-256-GCM) at rest">
            <Input.Password placeholder={mode === 'edit' ? 'Leave blank to keep existing' : ''} autoComplete="new-password" />
          </Form.Item>
        );
      case 'asset_tag':
        return (
          <Col key="asset_tag" xs={24}>
            <Form.Item
              name="assetTag"
              label={
                <Space>
                  <span>{labelOf('asset_tag', 'Asset Tag')}</span>
                  {mode === 'create' && isAdmin && (
                    <Tag color={manualOverride ? 'orange' : 'blue'}
                      icon={manualOverride ? <EditOutlined /> : <ThunderboltOutlined />}>
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
                  department={department} range={range} info={autoTagInfo}
                  loading={autoTagLoading} isAdmin={isAdmin}
                  onEnableOverride={() => setManualOverride(true)}
                />
              ) : (
                <AssetTagPicker department={department} apiPrefix={apiPrefix} />
              )}
            </Form.Item>
            {mode === 'create' && isAdmin && manualOverride && (
              <Button size="small" type="link" style={{ paddingLeft: 0, marginTop: -8 }}
                onClick={() => { setManualOverride(false); form.setFieldValue('assetTag', undefined); }}>
                ← Back to auto-assign
              </Button>
            )}
          </Col>
        );
      case 'additional_remarks':
        return wrap(overridableFormItem({
          fieldKey: 'additional_remarks', name: 'additionalRemarks',
          label: labelOf('additional_remarks', 'Additional Remarks'),
          defaultChild: <Input.TextArea rows={2} />,
        }));
      case 'manage_engine_installed':
        return wrap(overridableFormItem({
          fieldKey: 'manage_engine_installed', name: 'manageEngineInstalled',
          label: labelOf('manage_engine_installed', 'ManageEngine Installed'),
          defaultChild: <Switch />, defaultValuePropName: 'checked',
        }));
      case 'tenable_installed':
        return wrap(overridableFormItem({
          fieldKey: 'tenable_installed', name: 'tenableInstalled',
          label: labelOf('tenable_installed', 'Tenable Installed'),
          defaultChild: <Switch />, defaultValuePropName: 'checked',
        }));
      case 'idrac_enabled':
        return wrap(overridableFormItem({
          fieldKey: 'idrac_enabled', name: 'idracEnabled',
          label: labelOf('idrac_enabled', 'iDRAC'),
          defaultChild: <Switch />, defaultValuePropName: 'checked',
        }));
      case 'idrac_ip':
        if (!idracEnabled) return null;
        return wrap(<Form.Item name="idracIp" label={labelOf('idrac_ip', 'iDRAC IP')} rules={[{ pattern: ipRe, message: 'Invalid IP address' }]}><Input placeholder="10.x.x.x" /></Form.Item>);
      default:
        return null;
    }
  }

  function renderExtraWidget(f) {
    return sharedRenderExtraWidget(f, { isHidden, dd });
  }

  const dynamicSections = useMemo(() => buildDynamicSections(fieldMeta), [fieldMeta]);

  return (
    <Card title={<Typography.Title level={4} style={{ margin: 0 }}>{mode === 'create' ? `Add ${effectiveEntityLabel}` : `Edit ${effectiveEntityLabel}`}</Typography.Title>}
      className="inventory-form-card"
    >
      <Form form={form} layout="vertical" onFinish={onFinish} className="inventory-form"
        scrollToFirstError={{ behavior: 'smooth', block: 'center' }}
        onFinishFailed={({ errorFields }) => {
          const first = errorFields?.[0];
          message.error(first?.errors?.[0]
            ? `Cannot save — ${first.errors[0]}`
            : 'Cannot save — please fix the highlighted fields');
        }}
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
        {dynamicSections === null ? (
          <Typography.Text type="secondary">Loading fields…</Typography.Text>
        ) : (
          dynamicSections.map(([sectionName, sectionFields]) => {
            const widgets = sectionFields
              .map(f => f.is_extra ? renderExtraWidget(f) : renderBuiltinWidget(f.field_key))
              .filter(Boolean);
            if (widgets.length === 0) return null;
            return (
              <div key={sectionName}>
                <Divider orientation="left">{sectionName}</Divider>
                <Row gutter={16}>{widgets}</Row>
              </div>
            );
          })
        )}
        <Space>
          <Button type="primary" htmlType="submit" loading={submitting}>{mode === 'create' ? `Create ${effectiveEntityLabel}` : 'Save Changes'}</Button>
          <Button onClick={() => nav(listPath)}>Cancel</Button>
        </Space>
      </Form>
    </Card>
  );
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
