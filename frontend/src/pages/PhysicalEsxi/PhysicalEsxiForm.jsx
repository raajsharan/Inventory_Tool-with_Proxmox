import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card, Form, Input, Select, Switch, Row, Col, Button, Space, App,
  Typography, InputNumber, Divider,
} from 'antd';
import {
  ArrowLeftOutlined, ReloadOutlined,
  CheckCircleFilled, CloseCircleFilled,
} from '@ant-design/icons';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';

const { Text, Link } = Typography;

const ipRe = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

const SectionLabel = ({ children }) => (
  <div style={{ marginBottom: 16 }}>
    <Text style={{
      fontSize: 11, fontWeight: 700, letterSpacing: 1.2,
      color: '#8c8c8c', textTransform: 'uppercase',
    }}>
      {children}
    </Text>
  </div>
);

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
  const [pendingTag, setPendingTag] = useState(null);
  const [osType, setOsType] = useState();

  const omeOn = Form.useWatch('omeActive', form);

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
          rackNumber:      d.rack_number,
          serverPosition:  d.server_position,
          additionalRemarks: d.additional_remarks,
          idracIp:         d.idrac_ip,
          assetType:       d.asset_type,
          osType:          d.os_type,
          osVersion:       d.os_version,
        });
        setOriginalIp(d.ip_address || null);
        setSelectedDept(d.department);
        setPendingTag(d.asset_tag);
        setOsType(d.os_type);
      });
    }
  }, [id, mode]); // eslint-disable-line

  // ── Auto-assign next asset tag when department changes (create mode) ───────
  useEffect(() => {
    if (mode !== 'create' || !selectedDept) { setPendingTag(null); return; }
    api.get('/physical-esxi/tag-stats', { params: { department: selectedDept } })
      .then(({ data }) => setPendingTag(data.nextAvailable != null ? String(data.nextAvailable) : null))
      .catch(() => setPendingTag(null));
  }, [selectedDept, mode]);

  const opts = (cat, parent) => (dd[cat] || [])
    .filter(d => parent === undefined ? true : d.parent_value === parent)
    .map(d => ({ label: d.value, value: d.value }));

  const deptOpts = departments.map(d => ({
    label: `${d.name} (${String(d.min_tag).padStart(4, '0')}–${String(d.max_tag).padStart(4, '0')})`,
    value: d.name,
  }));

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function onFinish(values) {
    setSubmitting(true);
    try {
      const payload = {
        ipAddress:         values.ipAddress,
        hostedIp:          values.ipAddress,   // keep hosted_ip in sync
        vmName:            values.vmName,
        department:        values.department,
        location:          values.location,
        serverModel:       values.serverModel,
        serialNumber:      values.serialNumber,
        cpuCores:          values.cpuCores   ?? 0,
        ramGb:             values.ramGb      ?? 0,
        totalDisks:        values.totalDisks ?? 0,
        omeStatus:         values.omeActive ? 'Active' : 'Expired',
        rackNumber:        values.rackNumber,
        serverPosition:    values.serverPosition,
        additionalRemarks: values.additionalRemarks,
        idracIp:           values.idracIp,
        idracEnabled:      !!(values.idracIp),
        assetType:         values.assetType,
        osType:            values.osType,
        osVersion:         values.osVersion,
        ...(pendingTag ? { assetTag: pendingTag } : {}),
      };

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
            if (isCreate) { setSelectedDept(null); setPendingTag(null); }
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
          {/* ══ HARDWARE INFORMATION ════════════════════════════════════════════ */}
          <SectionLabel>Hardware Information</SectionLabel>

          <Row gutter={16}>
            {/* Hosted IP */}
            <Col xs={24} md={8}>
              <Form.Item
                name="ipAddress"
                label="Hosted IP"
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
            </Col>

            {/* Device Name */}
            <Col xs={24} md={8}>
              <Form.Item
                name="vmName"
                label="Device Name"
                extra="Linked VM or primary asset on this host"
              >
                <Input placeholder="e.g. ESX-HOST-01" />
              </Form.Item>
            </Col>

            {/* Department */}
            <Col xs={24} md={8}>
              <Form.Item name="department" label="Department">
                <Select
                  allowClear showSearch optionFilterProp="label"
                  placeholder="Select department..."
                  options={deptOpts}
                  onChange={(v) => setSelectedDept(v || null)}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            {/* Location */}
            <Col xs={24} md={8}>
              <Form.Item name="location" label="Location">
                <Select allowClear showSearch optionFilterProp="label"
                  placeholder="Select location..."
                  options={opts('location')}
                />
              </Form.Item>
            </Col>

            {/* Server Model */}
            <Col xs={24} md={8}>
              <Form.Item name="serverModel" label="Server Model">
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
            </Col>

            {/* Serial Number */}
            <Col xs={24} md={8}>
              <Form.Item name="serialNumber" label="Serial Number">
                <Input placeholder="SRV-001-2024" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            {/* Asset Type */}
            <Col xs={24} md={8}>
              <Form.Item name="assetType" label="Asset Type">
                <Input placeholder="e.g. Physical Server" />
              </Form.Item>
            </Col>

            {/* OS Type */}
            <Col xs={24} md={8}>
              <Form.Item name="osType" label="OS Type">
                <Select
                  allowClear showSearch optionFilterProp="label"
                  placeholder="Select OS Type"
                  options={opts('os_type')}
                  onChange={(v) => { setOsType(v); form.setFieldValue('osVersion', undefined); }}
                />
              </Form.Item>
            </Col>

            {/* OS Version */}
            <Col xs={24} md={8}>
              <Form.Item
                name="osVersion"
                label="OS Version"
                extra={!osType ? 'Select an OS Type first to see available versions.' : undefined}
              >
                <Select
                  allowClear showSearch optionFilterProp="label"
                  disabled={!osType}
                  placeholder={osType ? 'Select OS Version' : 'Select OS Type first'}
                  options={osType ? opts('os_version', osType) : []}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            {/* CPU Cores */}
            <Col xs={24} md={8}>
              <Form.Item name="cpuCores" label="CPU Cores">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>

            {/* RAM */}
            <Col xs={24} md={8}>
              <Form.Item name="ramGb" label="RAM (GB)">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>

            {/* Total Disks */}
            <Col xs={24} md={8}>
              <Form.Item name="totalDisks" label="Total Disks">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          {/* OME Support Status */}
          <Form.Item label="OME Support Status">
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

          <Divider style={{ margin: '8px 0 20px' }} />

          {/* ══ RACK INFORMATION ════════════════════════════════════════════════ */}
          <SectionLabel>Rack Information</SectionLabel>

          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item
                name="rackNumber"
                label="Rack Number"
                extra="e.g. RACK-A1, RACK-B3"
              >
                <Input placeholder="RACK-A1" />
              </Form.Item>
            </Col>

            <Col xs={24} md={8}>
              <Form.Item
                name="serverPosition"
                label="Server Position (U)"
                extra="e.g. U12, U13-U14"
              >
                <Input placeholder="U12" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24}>
              <Form.Item name="additionalRemarks" label="Additional Notes">
                <Input.TextArea
                  rows={4}
                  placeholder="Any additional notes about this physical server..."
                />
              </Form.Item>
            </Col>
          </Row>

          <Divider style={{ margin: '8px 0 20px' }} />

          {/* ══ HARDWARE INFORMATION (iDRAC) ════════════════════════════════════ */}
          <SectionLabel>Hardware Information</SectionLabel>

          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Form.Item
                name="idracIp"
                label="iDRAC IP"
                rules={[{ pattern: ipRe, message: 'Invalid IP address' }]}
              >
                <Input placeholder="e.g. 10.0.0.2" />
              </Form.Item>
            </Col>
          </Row>

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
