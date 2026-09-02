import { useEffect, useState } from 'react';
import { Card, Form, Switch, InputNumber, Button, Space, Typography, message } from 'antd';
import { ClockCircleOutlined, CheckCircleOutlined } from '@ant-design/icons';
import api from '../api/client';

const { Title, Text } = Typography;

// Shared between Admin > Teams Notifications (where it originated) and the
// Connectivity Alerts page — same config, same form, so editing it in
// either place can never drift out of sync with the other.
export default function UtilizationThresholds() {
  const [utilForm] = Form.useForm();
  const [utilLoading, setUtilLoading] = useState(false);
  const [utilSaved, setUtilSaved] = useState(false);

  useEffect(() => {
    api.get('/utilization-monitor')
      .then(r => utilForm.setFieldsValue({
        enabled: r.data.enabled ?? true,
        cpu_threshold_pct: r.data.cpu_threshold_pct ?? 85,
        memory_threshold_pct: r.data.memory_threshold_pct ?? 85,
        disk_threshold_pct: r.data.disk_threshold_pct ?? 85,
      }))
      .catch(() => message.error('Failed to load utilization thresholds'));
  }, [utilForm]);

  const handleUtilSave = async (values) => {
    setUtilLoading(true);
    setUtilSaved(false);
    try {
      await api.put('/utilization-monitor', values);
      message.success('Utilization thresholds saved.');
      setUtilSaved(true);
    } catch (err) {
      message.error(err?.response?.data?.error || 'Failed to save utilization thresholds.');
    } finally {
      setUtilLoading(false);
    }
  };

  return (
    <Card className="dashcard">
      <Space style={{ marginBottom: 16 }}>
        <ClockCircleOutlined style={{ fontSize: 20, color: '#fa8c16' }} />
        <Title level={5} style={{ margin: 0 }}>High Utilization Thresholds</Title>
      </Space>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        A host is flagged as "High Utilization" on the Connectivity Alerts page whenever its CPU,
        Memory, or Disk usage — checked on every VMware/Proxmox/Hyper-V discovery run — is at or
        above any of the thresholds below.
      </Text>
      <Form form={utilForm} layout="inline" onFinish={handleUtilSave}>
        <Form.Item name="enabled" label="Enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item
          name="cpu_threshold_pct" label="CPU threshold"
          rules={[{ required: true, message: 'Required' }]}
        >
          <InputNumber min={0} max={100} addonAfter="%" style={{ width: 120 }} />
        </Form.Item>
        <Form.Item
          name="memory_threshold_pct" label="Memory threshold"
          rules={[{ required: true, message: 'Required' }]}
        >
          <InputNumber min={0} max={100} addonAfter="%" style={{ width: 120 }} />
        </Form.Item>
        <Form.Item
          name="disk_threshold_pct" label="Disk threshold"
          rules={[{ required: true, message: 'Required' }]}
        >
          <InputNumber min={0} max={100} addonAfter="%" style={{ width: 120 }} />
        </Form.Item>
        <Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            loading={utilLoading}
            icon={utilSaved ? <CheckCircleOutlined /> : undefined}
          >
            Save Thresholds
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}
