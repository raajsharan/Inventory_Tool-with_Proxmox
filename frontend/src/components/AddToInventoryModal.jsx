import { useEffect, useState } from 'react';
import {
  Alert, Button, Col, Divider, Form, Input, Modal, Row, Select, Space, Tag, Typography,
} from 'antd';
import {
  AppstoreAddOutlined, CheckCircleOutlined, ExportOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import api from '../api/client';

const { Text } = Typography;

const SERVER_STATUS_OPTS = ['Active', 'Inactive', 'Decommissioned', 'Retired'].map(v => ({ label: v, value: v }));

// ── helpers ──────────────────────────────────────────────────────────────────
function firstValidIP(ips) {
  if (!Array.isArray(ips)) return '';
  return ips.find(ip => ip && ip !== 'Not Available' && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) || '';
}

function validMACs(macs) {
  if (!Array.isArray(macs)) return [];
  return macs.filter(m => m && m !== 'Not Available');
}

/**
 * Build an ext_assets prefill object from a VMware discovered VM row.
 */
export function vmwareToInventory(vm) {
  const macs = validMACs(vm.macs);
  return {
    vm_name:           vm.name        || '',
    os_hostname:       vm.hostname    || '',
    ip_address:        firstValidIP(vm.ips),
    mac_address:       macs[0]        || '',
    asset_type:        'VM',
    os_type:           vm.os_type     || '',
    os_version:        vm.os_version  || '',
    hosted_ip:         vm.esxi_host_ip || '',
    server_status:     'Active',
    additional_remarks: macs.length > 1
      ? `Additional MACs: ${macs.slice(1).join(', ')}`
      : '',
    _source_label: `VMware · ${vm.source_host || vm.esxi_host_name || ''}`,
    _source_detail: [
      vm.power_state && `Power: ${vm.power_state}`,
      vm.num_cpu     && `CPUs: ${vm.num_cpu}`,
      vm.memory_mb   && `RAM: ${vm.memory_mb} MB`,
    ].filter(Boolean).join('  ·  '),
  };
}

/**
 * Build an ext_assets prefill object from a Proxmox discovered VM row.
 */
export function proxmoxToInventory(vm) {
  const assetType = vm.vm_type === 'lxc' ? 'LXC Container' : 'VM';
  const macs = validMACs(vm.macs);
  return {
    vm_name:           vm.name    || '',
    os_hostname:       '',
    ip_address:        firstValidIP(vm.ips),
    mac_address:       macs[0]    || '',
    asset_type:        assetType,
    os_type:           vm.os_type || '',
    os_version:        '',
    hosted_ip:         vm.source_host || '',
    server_status:     vm.status === 'running' ? 'Active' : 'Inactive',
    additional_remarks: [
      `Proxmox Node: ${vm.node || '—'}  |  VMID: ${vm.vmid || '—'}  |  Type: ${vm.vm_type?.toUpperCase() || '—'}`,
      macs.length > 1 ? `Additional MACs: ${macs.slice(1).join(', ')}` : null,
    ].filter(Boolean).join('  ·  '),
    _source_label: `Proxmox · ${vm.source_host || vm.node || ''}`,
    _source_detail: [
      vm.cpu_count  && `CPUs: ${vm.cpu_count}`,
      vm.memory_mb  && `RAM: ${vm.memory_mb} MB`,
      vm.disk_gb    && `Disk: ${vm.disk_gb} GB`,
    ].filter(Boolean).join('  ·  '),
  };
}

// ── modal component ──────────────────────────────────────────────────────────
export default function AddToInventoryModal({ open, prefill, onClose }) {
  const [form]    = Form.useForm();
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [created, setCreated] = useState(null); // { id, vm_name }

  useEffect(() => {
    if (open && prefill) {
      form.setFieldsValue({
        vm_name:            prefill.vm_name,
        os_hostname:        prefill.os_hostname,
        ip_address:         prefill.ip_address,
        mac_address:        prefill.mac_address,
        asset_type:         prefill.asset_type,
        os_type:            prefill.os_type,
        os_version:         prefill.os_version,
        hosted_ip:          prefill.hosted_ip,
        server_status:      prefill.server_status,
        additional_remarks: prefill.additional_remarks,
        department:         '',
        location:           '',
      });
      setError('');
      setCreated(null);
    }
  }, [open, prefill, form]);

  async function onSubmit(values) {
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post('/ext-assets', values);
      setCreated({ id: data.id, vm_name: data.vm_name });
    } catch (e) {
      const err = e.response?.data;
      const { details } = err || {};
      if (details && typeof details === 'object' && !Array.isArray(details)) {
        // { field: 'reason' } shape from duplicate checks
        setError(Object.values(details).join(', '));
      } else if (Array.isArray(details) && details.length) {
        // express-validator shape: [{ path, msg, ... }]
        setError(details.map(d => d.msg).filter(Boolean).join(', '));
      } else {
        setError(err?.error || 'Failed to create asset');
      }
    }
    setSaving(false);
  }

  function handleClose() {
    form.resetFields();
    setError('');
    setCreated(null);
    onClose();
  }

  return (
    <Modal
      open={open}
      title={
        <Space>
          <AppstoreAddOutlined style={{ color: '#1677ff' }} />
          <span>Add to Ext. Asset Inventory</span>
          {prefill?._source_label && (
            <Tag color="purple" style={{ fontSize: 11, fontWeight: 400 }}>{prefill._source_label}</Tag>
          )}
        </Space>
      }
      onCancel={handleClose}
      width={760}
      footer={
        created ? (
          <Space>
            <Button onClick={handleClose}>Close</Button>
            <Link to={`/ext-assets/${created.id}`} onClick={handleClose}>
              <Button type="primary" icon={<ExportOutlined />}>View Asset</Button>
            </Link>
          </Space>
        ) : (
          <Space>
            <Button onClick={handleClose}>Cancel</Button>
            <Button type="primary" icon={<AppstoreAddOutlined />} loading={saving}
              onClick={() => form.submit()}>
              Add to Ext. Inventory
            </Button>
          </Space>
        )
      }
      destroyOnClose
    >
      {/* Success state */}
      {created && (
        <Alert
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
          message={
            <span>
              <strong>{created.vm_name}</strong> was added to Ext. Asset Inventory.
            </span>
          }
          description={
            <Link to={`/ext-assets/${created.id}`} onClick={handleClose}>
              Click here to view the asset →
            </Link>
          }
        />
      )}

      {/* Form */}
      {!created && (
        <>
          {prefill?._source_detail && (
            <div style={{ background: '#f5f5f5', borderRadius: 6, padding: '6px 12px', marginBottom: 16, fontSize: 12 }}>
              <Text type="secondary">{prefill._source_detail}</Text>
            </div>
          )}

          {error && (
            <Alert type="error" message={error} showIcon style={{ marginBottom: 14 }} />
          )}

          <Form form={form} layout="vertical" onFinish={onSubmit}>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="vm_name" label="VM Name" rules={[{ required: true, message: 'VM Name is required' }]}>
                  <Input placeholder="e.g. PROD-WEB-01" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="os_hostname" label="OS Hostname">
                  <Input placeholder="e.g. prod-web-01.example.com" />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="ip_address"
                  label="IP Address"
                  rules={[
                    { required: true, message: 'IP Address is required' },
                    { pattern: /^\d{1,3}(\.\d{1,3}){3}$/, message: 'Enter a valid IP address' },
                  ]}
                >
                  <Input placeholder="e.g. 192.168.1.100" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="hosted_ip" label="Hosted IP / ESXi Host">
                  <Input placeholder="e.g. 10.0.0.5" />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="mac_address" label="MAC Address" rules={[{ required: true, message: 'MAC Address is required' }]}>
                  <Input placeholder="e.g. 00:50:56:AB:CD:EF" />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={8}>
                <Form.Item name="asset_type" label="Asset Type">
                  <Input placeholder="e.g. VM, Server" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="os_type" label="OS Type">
                  <Input placeholder="e.g. Windows, Linux" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="os_version" label="OS Version">
                  <Input placeholder="e.g. Windows Server 2022" />
                </Form.Item>
              </Col>
            </Row>

            <Divider style={{ margin: '8px 0 16px' }} />

            <Row gutter={16}>
              <Col span={8}>
                <Form.Item name="server_status" label="Server Status">
                  <Select options={SERVER_STATUS_OPTS} />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="department" label="Department">
                  <Input placeholder="e.g. IT / Platform" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="location" label="Location">
                  <Input placeholder="e.g. US-East, HQ" />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item name="additional_remarks" label="Additional Remarks">
              <Input.TextArea rows={2} placeholder="MAC addresses, notes, etc." />
            </Form.Item>
          </Form>
        </>
      )}
    </Modal>
  );
}
