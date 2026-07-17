import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card, Form, Input, Select, Switch, Row, Col, Button, Space, App,
  Typography, InputNumber, Divider, Tag,
} from 'antd';
import {
  ArrowLeftOutlined, ReloadOutlined,
  CheckCircleFilled, CloseCircleFilled,
  ThunderboltOutlined, EditOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';
import AssetTagPicker from '../Assets/AssetTagPicker.jsx';
import { AutoAssignedTagDisplay } from '../Assets/AssetForm.jsx';
import {
  useInventoryFieldMeta,
  overridableFormItem as sharedOverridableFormItem,
  renderExtraWidget as sharedRenderExtraWidget,
  buildDynamicSections,
} from '../../utils/dynamicFormFields.jsx';

const { Text, Link } = Typography;

const ipRe = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

function extractTagNumber(tag) {
  const m = String(tag || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : NaN;
}

const PAGE_KEY = 'physical_esxi_servers';

// Fields that always take the full row width, regardless of neighbors.
// Everything else gets a flexible ~300px column that grows to fill any
// leftover space on its row (e.g. a lone trailing field on a row of 1 or 2
// stretches instead of leaving a ragged gap), and wraps naturally when the
// row is full — no need to hand-tune spans every time a field is added.
const FULL_WIDTH_FIELDS = new Set(['asset_tag', 'additional_remarks']);

export default function PhysicalEsxiForm({ mode }) {
  const { id } = useParams();
  const nav = useNavigate();
  const { message } = App.useApp();
  const { user } = useAuth();
  const isAdmin = ['admin', 'superadmin'].includes(user?.role);

  const [form] = Form.useForm();
  const [dd, setDd] = useState({});
  const [serverModels, setServerModels] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [originalIp, setOriginalIp] = useState(null);
  const [selectedDept, setSelectedDept] = useState(null);
  const [autoTagInfo, setAutoTagInfo] = useState(null);
  const [autoTagLoading, setAutoTagLoading] = useState(false);
  const [manualOverride, setManualOverride] = useState(false);
  const [osType, setOsType] = useState();
  const { isHidden, fieldMeta, labelOf } = useInventoryFieldMeta(PAGE_KEY);

  const omeOn = Form.useWatch('omeActive', form);
  const serverStatusValue = Form.useWatch('serverStatus', form);

  // ome_status keeps its bespoke Active/Expired switch as the default widget;
  // only falls back to a generic override widget if an admin explicitly
  // changes its type away from default via Change Field Types.
  const omeMeta = fieldMeta.byKey?.ome_status;
  const omeOverridden = !!(omeMeta?.input_type && omeMeta.input_type !== omeMeta.default_type);

  // ── Load dropdowns + record (edit mode) ────────────────────────────────────
  useEffect(() => {
    api.get('/dropdowns').then(r => setDd(r.data.grouped || {}));
    api.get('/server-models').then(r => setServerModels(r.data || [])).catch(() => {});
    api.get('/departments', { params: { activeOnly: 1 } })
      .then(r => setDepartments(r.data.items || []))
      .catch(() => {});

    if (mode === 'edit' && id) {
      api.get(`/physical-esxi/${id}`).then(r => {
        const d = r.data;
        form.setFieldsValue({
          ipAddress:       d.ip_address,
          vmName:          d.vm_name,
          department:      d.department,
          location:        d.location,
          serverModel:     d.server_model,
          serialNumber:    d.serial_number,
          cpuCores:        d.cpu_cores ?? 0,
          ramGb:           d.ram_gb    ?? 0,
          totalDisks:      d.total_disks ?? 0,
          omeActive:       d.ome_status === 'Active',
          omeStatus:       d.ome_status,
          rackNumber:      d.rack_number,
          serverPosition:  d.server_position,
          additionalRemarks: d.additional_remarks,
          idracIp:         d.idrac_ip,
          assetType:       d.asset_type,
          osType:          d.os_type,
          osVersion:       d.os_version,
          assetUsername:   d.asset_username,
          serverStatus:    d.server_status,
          assetTag:        d.asset_tag,
          assignedUser:    d.assigned_user,
          idracUsername:   d.idrac_username,
          extras: Object.fromEntries(
            Object.entries(d.extras || {}).map(([k, v]) =>
              [k, v && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? dayjs(v) : v]
            )
          ),
        });
        setOriginalIp(d.ip_address || null);
        setSelectedDept(d.department);
        setOsType(d.os_type);
      });
    }
  }, [id, mode]); // eslint-disable-line

  // ── Auto-assign next asset tag when department changes (create mode) ───────
  useEffect(() => {
    if (mode !== 'create') return;
    if (!selectedDept) {
      setAutoTagInfo(null);
      form.setFieldValue('assetTag', undefined);
      return;
    }
    if (manualOverride) return;

    let cancelled = false;
    setAutoTagLoading(true);
    api.get('/physical-esxi/tag-stats', { params: { department: selectedDept } })
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
  }, [selectedDept, manualOverride, mode]); // eslint-disable-line

  const opts = (cat, parent) => (dd[cat] || [])
    .filter(d => parent === undefined ? true : d.parent_value === parent)
    .map(d => ({ label: d.value, value: d.value }));

  const deptOpts = departments.map(d => ({
    label: `${d.name} (${String(d.min_tag).padStart(4, '0')}–${String(d.max_tag).padStart(4, '0')})`,
    value: d.name,
  }));

  const rangeFor = (name) => departments.find(d => d.name === name);
  const showAutoTagBlock = mode === 'create' && !manualOverride;

  // Thin wrapper around the shared implementation (frontend/src/utils/dynamicFormFields.jsx)
  // so every fieldKey-based call site below keeps working unchanged.
  function overridableFormItem(opts) {
    return sharedOverridableFormItem({ ...opts, fieldMeta, dd });
  }

  function renderExtraWidget(f) {
    return sharedRenderExtraWidget(f, { isHidden, dd });
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function onFinish(values) {
    setSubmitting(true);
    try {
      const payload = {
        ipAddress:         values.ipAddress,
        vmName:            values.vmName,
        department:        values.department,
        location:          values.location,
        serverModel:       values.serverModel,
        serialNumber:      values.serialNumber,
        cpuCores:          values.cpuCores   ?? 0,
        ramGb:             values.ramGb      ?? 0,
        totalDisks:        values.totalDisks ?? 0,
        omeStatus:         omeOverridden ? values.omeStatus : (values.omeActive ? 'Active' : 'Expired'),
        rackNumber:        values.rackNumber,
        serverPosition:    values.serverPosition,
        additionalRemarks: values.additionalRemarks,
        idracIp:           values.idracIp,
        idracEnabled:      !!(values.idracIp),
        assetType:         values.assetType,
        osType:            values.osType,
        osVersion:         values.osVersion,
        assetUsername:     values.assetUsername,
        assignedUser:      values.assignedUser,
        idracUsername:     values.idracUsername,
        ...(values.serverStatus !== undefined ? { serverStatus: values.serverStatus } : {}),
        ...(values.serverStatus && /^decom/i.test(values.serverStatus) ? { decommissionReason: values.decommissionReason } : {}),
        ...(values.assetPassword ? { assetPassword: values.assetPassword } : {}),
        ...(values.idracPassword ? { idracPassword: values.idracPassword } : {}),
        ...(values.assetTag ? { assetTag: values.assetTag } : {}),
      };

      if (values.extras && typeof values.extras === 'object' && Object.keys(values.extras).length) {
        payload.extras = Object.fromEntries(
          Object.entries(values.extras).map(([k, v]) => {
            if (v && typeof v === 'object' && typeof v.toISOString === 'function') return [k, v.toISOString()];
            return [k, v];
          })
        );
      }

      if (mode === 'create') {
        await api.post('/physical-esxi', payload);
        message.success('Server registered successfully');
      } else {
        await api.put(`/physical-esxi/${id}`, payload);
        message.success('Server updated');
      }
      nav('/physical-esxi');
    } catch (e) {
      const err = e.response?.data;
      if (err?.details && typeof err.details === 'object' && !Array.isArray(err.details)) {
        form.setFields(
          Object.entries(err.details).map(([k, v]) => ({
            name: k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
            errors: [v],
          }))
        );
        message.error(err?.error || 'Failed to save');
      } else {
        message.error(err?.error || 'Failed to save');
      }
    } finally { setSubmitting(false); }
  }

  const isCreate = mode === 'create';
  const title    = isCreate ? 'Register Physical Server' : 'Edit Physical Server';

  function renderBuiltinWidget(field_key) {
    if (isHidden(field_key)) return null;
    const isFull = FULL_WIDTH_FIELDS.has(field_key);
    const wrap = (children) => (
      <Col key={field_key} flex={isFull ? '1 1 100%' : '1 1 300px'} style={isFull ? undefined : { minWidth: 220 }}>
        {children}
      </Col>
    );

    switch (field_key) {
      case 'vm_name':
        return wrap(overridableFormItem({
          fieldKey: 'vm_name', name: 'vmName',
          label: labelOf('vm_name', 'Device Name'),
          extra: 'Linked VM or primary asset on this host',
          defaultChild: <Input placeholder="e.g. ESX-HOST-01" />,
        }));
      case 'ip_address':
        return wrap(
          <Form.Item
            name="ipAddress"
            label={labelOf('ip_address', 'Hosted IP')}
            extra="IP address of this physical server"
            validateDebounce={400}
            rules={[
              { required: true, message: 'Hosted IP is required' },
              { pattern: ipRe, message: 'Invalid IP address' },
              {
                validator: async (_, value) => {
                  if (!value || !ipRe.test(value)) return;
                  if (mode === 'edit' && originalIp && value === originalIp) return;
                  try {
                    const params = { ip: value };
                    if (mode === 'edit' && id) {
                      params.excludeTable = 'physical_esxi_servers';
                      params.excludeId = id;
                    }
                    const { data } = await api.get('/physical-esxi/check-ip', { params });
                    if (data.used) {
                      const where =
                        data.conflictTable === 'beijing_assets'          ? 'Beijing Inventory'
                        : data.conflictTable === 'ext_assets'            ? 'Ext. Asset Inventory'
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
          >
            <Input placeholder="10.0.0.1" />
          </Form.Item>
        );
      case 'department':
        return wrap(
          <Form.Item name="department" label={labelOf('department', 'Department')}>
            <Select
              allowClear showSearch optionFilterProp="label"
              placeholder="Select department..."
              options={deptOpts}
              onChange={(v) => setSelectedDept(v || null)}
            />
          </Form.Item>
        );
      case 'assigned_user':
        return wrap(
          <Form.Item name="assignedUser" label={labelOf('assigned_user', 'Owner')}>
            <Input placeholder="e.g. Jane Doe" />
          </Form.Item>
        );
      case 'asset_tag':
        return (
          <Col key="asset_tag" flex="1 1 100%">
            <Form.Item
              name="assetTag"
              label={
                <Space>
                  <span>{labelOf('asset_tag', 'Asset Tag')}</span>
                  {isCreate && isAdmin && (
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
                  department={selectedDept} range={rangeFor(selectedDept)} info={autoTagInfo}
                  loading={autoTagLoading} isAdmin={isAdmin}
                  onEnableOverride={() => setManualOverride(true)}
                />
              ) : (
                <AssetTagPicker department={selectedDept} apiPrefix="/physical-esxi" />
              )}
            </Form.Item>
            {isCreate && isAdmin && manualOverride && (
              <Button size="small" type="link" style={{ paddingLeft: 0, marginTop: -8 }}
                onClick={() => { setManualOverride(false); form.setFieldValue('assetTag', undefined); }}>
                ← Back to auto-assign
              </Button>
            )}
          </Col>
        );
      case 'location':
        return wrap(
          <Form.Item name="location" label={labelOf('location', 'Location')}>
            <Select allowClear showSearch optionFilterProp="label"
              placeholder="Select location..."
              options={opts('location')}
            />
          </Form.Item>
        );
      case 'server_status':
        return wrap(
          <>
            <Form.Item name="serverStatus" label={labelOf('server_status', 'Server Status')}>
              <Select allowClear options={opts('server_status')} />
            </Form.Item>
            {/^decom/i.test(String(serverStatusValue || '')) && (
              <Form.Item
                name="decommissionReason"
                label="Decommission reason"
                extra="Optional — recorded in the decommission report with your name and date."
              >
                <Input.TextArea rows={2} placeholder="e.g. Hardware refresh — replaced by new unit" maxLength={500} />
              </Form.Item>
            )}
          </>
        );
      case 'server_model':
        return wrap(
          <>
            <Form.Item name="serverModel" label={labelOf('server_model', 'Server Model')}>
              <Select
                allowClear showSearch optionFilterProp="label"
                placeholder="Select model..."
                options={serverModels.map(m => ({
                  label: m.manufacturer ? `${m.manufacturer} ${m.model_name}` : m.model_name,
                  value: m.model_name,
                }))}
              />
            </Form.Item>
            {isAdmin && (
              <div style={{ marginTop: -18, marginBottom: 16 }}>
                <Link onClick={() => nav('/admin/server-models')}>Manage models →</Link>
              </div>
            )}
          </>
        );
      case 'serial_number':
        return wrap(overridableFormItem({
          fieldKey: 'serial_number', name: 'serialNumber',
          label: labelOf('serial_number', 'Serial Number'),
          defaultChild: <Input placeholder="SRV-001-2024" />,
        }));
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
              allowClear showSearch optionFilterProp="label"
              placeholder="Select OS Type"
              options={opts('os_type')}
              onChange={(v) => { setOsType(v); form.setFieldValue('osVersion', undefined); }}
            />
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
              allowClear showSearch optionFilterProp="label"
              disabled={!osType}
              placeholder={osType ? 'Select OS Version' : 'Select OS Type first'}
              options={osType ? opts('os_version', osType) : []}
            />
          </Form.Item>
        );
      case 'asset_username':
        return wrap(overridableFormItem({
          fieldKey: 'asset_username', name: 'assetUsername',
          label: labelOf('asset_username', 'Asset Username'),
          defaultChild: <Input placeholder="e.g. svc_admin" autoComplete="off" />,
        }));
      case 'asset_password':
        return wrap(
          <Form.Item name="assetPassword" label={labelOf('asset_password', 'Asset Password')} extra="Encrypted (AES-256-GCM) at rest">
            <Input.Password
              placeholder={mode === 'edit' ? 'Leave blank to keep existing' : ''}
              autoComplete="new-password"
            />
          </Form.Item>
        );
      case 'cpu_cores':
        return wrap(overridableFormItem({
          fieldKey: 'cpu_cores', name: 'cpuCores',
          label: labelOf('cpu_cores', 'CPU Cores'),
          defaultChild: <InputNumber min={0} style={{ width: '100%' }} />,
        }));
      case 'ram_gb':
        return wrap(overridableFormItem({
          fieldKey: 'ram_gb', name: 'ramGb',
          label: labelOf('ram_gb', 'RAM (GB)'),
          defaultChild: <InputNumber min={0} style={{ width: '100%' }} />,
        }));
      case 'total_disks':
        return wrap(overridableFormItem({
          fieldKey: 'total_disks', name: 'totalDisks',
          label: labelOf('total_disks', 'Total Disks'),
          defaultChild: <InputNumber min={0} style={{ width: '100%' }} />,
        }));
      case 'ome_status':
        if (omeOverridden) {
          return wrap(overridableFormItem({
            fieldKey: 'ome_status', name: 'omeStatus',
            label: labelOf('ome_status', 'OME Support Status'),
            defaultChild: <Input />,
          }));
        }
        return wrap(
          <Form.Item label={labelOf('ome_status', 'OME Support Status')}>
            <Space align="center">
              <Form.Item name="omeActive" valuePropName="checked" noStyle>
                <Switch />
              </Form.Item>
              {omeOn ? (
                <Space size={4}>
                  <CheckCircleFilled style={{ color: '#52c41a' }} />
                  <Text style={{ color: '#52c41a' }}>Support Active</Text>
                </Space>
              ) : (
                <Space size={4}>
                  <CloseCircleFilled style={{ color: '#ff4d4f' }} />
                  <Text style={{ color: '#ff4d4f' }}>Support Expired</Text>
                </Space>
              )}
            </Space>
          </Form.Item>
        );
      case 'rack_number':
        return wrap(overridableFormItem({
          fieldKey: 'rack_number', name: 'rackNumber',
          label: labelOf('rack_number', 'Rack Number'),
          extra: 'e.g. RACK-A1, RACK-B3',
          defaultChild: <Input placeholder="RACK-A1" />,
        }));
      case 'server_position':
        return wrap(overridableFormItem({
          fieldKey: 'server_position', name: 'serverPosition',
          label: labelOf('server_position', 'Server Position (U)'),
          extra: 'e.g. U12, U13-U14',
          defaultChild: <Input placeholder="U12" />,
        }));
      case 'additional_remarks':
        return wrap(overridableFormItem({
          fieldKey: 'additional_remarks', name: 'additionalRemarks',
          label: labelOf('additional_remarks', 'Additional Notes'),
          defaultChild: <Input.TextArea rows={4} placeholder="Any additional notes about this physical server..." />,
        }));
      case 'idrac_ip':
        return wrap(
          <Form.Item name="idracIp" label={labelOf('idrac_ip', 'iDRAC IP')} rules={[{ pattern: ipRe, message: 'Invalid IP address' }]}>
            <Input placeholder="e.g. 10.0.0.2" />
          </Form.Item>
        );
      case 'idrac_username':
        return wrap(
          <Form.Item name="idracUsername" label={labelOf('idrac_username', 'iDRAC Username')}>
            <Input placeholder="e.g. root" autoComplete="off" />
          </Form.Item>
        );
      case 'idrac_password':
        return wrap(
          <Form.Item name="idracPassword" label={labelOf('idrac_password', 'iDRAC Password')} extra="Encrypted (AES-256-GCM) at rest">
            <Input.Password
              placeholder={mode === 'edit' ? 'Leave blank to keep existing' : ''}
              autoComplete="new-password"
            />
          </Form.Item>
        );
      case 'idrac_enabled':
        // Derived from whether iDRAC IP is filled in (see onFinish) — no
        // standalone widget, matching the form's existing behavior.
        return null;
      default:
        return null;
    }
  }

  const dynamicSections = useMemo(() => buildDynamicSections(fieldMeta), [fieldMeta]);

  return (
    <div style={{ padding: '16px 24px' }}>
      {/* ── Page header ── */}
      <div style={{
        display: 'flex', alignItems: 'flex-start',
        justifyContent: 'space-between', marginBottom: 16,
      }}>
        <Space align="start">
          <Button
            icon={<ArrowLeftOutlined />}
            style={{ marginTop: 4 }}
            onClick={() => nav('/physical-esxi')}
          />
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>{title}</Typography.Title>
            <Text type="secondary" style={{ fontSize: 13 }}>
              Fill in the server details and assign a Hosted IP to register it
            </Text>
          </div>
        </Space>
        <Button
          icon={<ReloadOutlined />}
          title="Reset form"
          onClick={() => {
            form.resetFields();
            if (isCreate) { setSelectedDept(null); setAutoTagInfo(null); setManualOverride(false); }
          }}
        />
      </div>

      <Card>
        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          initialValues={{ cpuCores: 0, ramGb: 0, totalDisks: 0, omeActive: false }}
        >
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

          {/* ── Actions ── */}
          <Row style={{ marginTop: 8 }}>
            <Col>
              <Space>
                <Button type="primary" htmlType="submit" loading={submitting}>
                  {isCreate ? 'Register Server' : 'Save Changes'}
                </Button>
                <Button onClick={() => nav('/physical-esxi')}>Cancel</Button>
              </Space>
            </Col>
          </Row>
        </Form>
      </Card>
    </div>
  );
}
