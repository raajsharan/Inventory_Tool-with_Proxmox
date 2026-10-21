import { useState } from 'react';
import { Card, Form, Input, Button, Space, Typography, App, Alert, Descriptions, Table, Tag } from 'antd';
import { CloudServerOutlined, PlayCircleOutlined } from '@ant-design/icons';
import api from '../../api/client';
import { DASH_CSS } from '../../components/DashboardStatCard.jsx';

const { Text } = Typography;

// Msvm_ComputerSystem.EnabledState
const VM_STATES = { 2: 'Running', 3: 'Off', 6: 'Saved', 9: 'Paused', 32768: 'Paused', 32769: 'Saved' };

export default function HypervCollectTest() {
  const { message } = App.useApp();
  const [running, setRunning] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  async function onFinish(values) {
    setRunning(true); setData(null); setError(null);
    try {
      const { data: r } = await api.post('/hyperv-collect-test/collect', values, { timeout: 150000 });
      setData(r.data);
      message.success('Collected hypervisor details');
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Collection failed');
    } finally { setRunning(false); }
  }

  const host = data?.Host;
  return (
    <div style={{ padding: 16 }}>
      <style>{DASH_CSS}</style>
      <Card size="small" className="dashcard"
        title={<Space><CloudServerOutlined /><span>Hyper-V Collect Test</span></Space>}>
        <Form layout="inline" onFinish={onFinish} initialValues={{ username: 'Administrator' }} style={{ rowGap: 8, marginBottom: 16 }}>
          <Form.Item name="host" rules={[{ required: true, message: 'Host required' }]}>
            <Input placeholder="Host / IP" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="username" rules={[{ required: true }]}>
            <Input placeholder="Username" style={{ width: 180 }} />
          </Form.Item>
          <Form.Item name="domain"><Input placeholder="Domain (optional)" style={{ width: 180 }} /></Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: 'Password required' }]}>
            <Input.Password placeholder="Password" autoComplete="off" style={{ width: 200 }} />
          </Form.Item>
          <Button type="primary" htmlType="submit" icon={<PlayCircleOutlined />} loading={running}>Collect</Button>
        </Form>
        <Text type="secondary">Runs scripts/hyperv_collect.py (WMI over DCOM). Credentials are used for this request only and are not stored.</Text>

        {error && <Alert style={{ marginTop: 16 }} type="error" showIcon message="Collection failed" description={error} />}

        {host && (
          <Space direction="vertical" size={16} style={{ width: '100%', marginTop: 16 }}>
            <Descriptions size="small" bordered column={{ xs: 1, md: 2, xl: 3 }} title="Host">
              <Descriptions.Item label="Hostname">{host.Hostname}</Descriptions.Item>
              <Descriptions.Item label="IP">{host.IPAddress}</Descriptions.Item>
              <Descriptions.Item label="Manufacturer / Model">{host.Manufacturer} {host.Model}</Descriptions.Item>
              <Descriptions.Item label="Serial">{host.SerialNumber}</Descriptions.Item>
              <Descriptions.Item label="OS">{host.OS} ({host.OSVersion})</Descriptions.Item>
              <Descriptions.Item label="CPU">{host.CPU} × {host.CPUCount} logical</Descriptions.Item>
              <Descriptions.Item label="RAM">{host.RAMTotalGB} GB ({host.RAMUsedPercent}% used)</Descriptions.Item>
              <Descriptions.Item label="Collected">{data.CollectionTime}</Descriptions.Item>
            </Descriptions>
            <Table size="small" rowKey="Drive" pagination={false} dataSource={host.Disks} title={() => 'Disks'}
              columns={[
                { title: 'Drive', dataIndex: 'Drive' },
                { title: 'Total GB', dataIndex: 'TotalGB' },
                { title: 'Free GB', dataIndex: 'FreeGB' },
                { title: 'Used %', dataIndex: 'UsedPercent' },
              ]} />
            <Table size="small" rowKey="VMID" pagination={{ pageSize: 20 }} dataSource={data.VMs}
              title={() => `Virtual machines (${data.VMCount})`}
              columns={[
                { title: 'VM Name', dataIndex: 'VMName' },
                { title: 'VM ID', dataIndex: 'VMID' },
                { title: 'State', dataIndex: 'State', render: v => <Tag color={v === 2 ? 'green' : 'default'}>{VM_STATES[v] || v}</Tag> },
              ]} />
            <details><summary>Raw JSON</summary><pre style={{ maxHeight: 400, overflow: 'auto' }}>{JSON.stringify(data, null, 2)}</pre></details>
          </Space>
        )}
      </Card>
    </div>
  );
}
