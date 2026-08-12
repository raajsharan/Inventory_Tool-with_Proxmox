import { useEffect, useState } from 'react';
import {
  Card, Form, Input, InputNumber, Switch, Button, Divider, Alert, Space, Typography, message, Tooltip, Row, Col,
} from 'antd';
import {
  SendOutlined, CheckCircleOutlined, TeamOutlined, ClockCircleOutlined,
} from '@ant-design/icons';
import api from '../../api/client';
import { DASH_CSS } from '../../components/DashboardStatCard.jsx';

const { Title, Text } = Typography;

const PING_PLATFORMS = [
  { key: 'vmware',  label: 'VMware' },
  { key: 'proxmox', label: 'Proxmox' },
  { key: 'hyperv',  label: 'Hyper-V' },
];

function PingMonitorSchedule() {
  const [pingForm] = Form.useForm();
  const [pingLoading, setPingLoading] = useState(false);
  const [pingSaved, setPingSaved] = useState(false);

  useEffect(() => {
    api.get('/ping-monitor')
      .then(r => {
        const values = {};
        for (const p of PING_PLATFORMS) {
          values[`${p.key}_enabled`] = r.data[`${p.key}_enabled`] ?? true;
          values[`${p.key}_interval_minutes`] = r.data[`${p.key}_interval_minutes`] ?? 5;
        }
        pingForm.setFieldsValue(values);
      })
      .catch(() => message.error('Failed to load ping monitor schedule'));
  }, [pingForm]);

  const handlePingSave = async (values) => {
    setPingLoading(true);
    setPingSaved(false);
    try {
      await api.put('/ping-monitor', values);
      message.success('Ping monitor schedule saved.');
      setPingSaved(true);
    } catch {
      message.error('Failed to save ping monitor schedule.');
    } finally {
      setPingLoading(false);
    }
  };

  return (
    <Card className="dashcard" style={{ marginTop: 20 }}>
      <Space style={{ marginBottom: 16 }}>
        <ClockCircleOutlined style={{ fontSize: 20, color: '#5a4fcf' }} />
        <Title level={5} style={{ margin: 0 }}>Ping Connectivity Monitor Schedule</Title>
      </Space>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        Independent of each platform's own discovery poll — pings every host on
        the interval below. 1st consecutive failure sends a Warning alert,
        every failure after that sends Critical, and recovery sends a Good
        alert. Uses the connectivity toggles above.
      </Text>
      <Form form={pingForm} layout="vertical" onFinish={handlePingSave}>
        {PING_PLATFORMS.map(p => (
          <Row gutter={16} key={p.key} align="middle" style={{ marginBottom: 8 }}>
            <Col span={8}>
              <Form.Item name={`${p.key}_enabled`} valuePropName="checked" label={`${p.label} ping check`} style={{ marginBottom: 0 }}>
                <Switch />
              </Form.Item>
            </Col>
            <Col span={16}>
              <Form.Item name={`${p.key}_interval_minutes`} label="Check every (minutes)" style={{ marginBottom: 0 }}>
                <InputNumber min={1} max={1440} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        ))}
        <Space style={{ marginTop: 12 }}>
          <Button
            type="primary"
            htmlType="submit"
            loading={pingLoading}
            icon={pingSaved ? <CheckCircleOutlined /> : undefined}
          >
            Save Schedule
          </Button>
        </Space>
      </Form>
    </Card>
  );
}

export default function TeamsNotifications() {
  const [form]    = Form.useForm();
  const [loading, setLoading]   = useState(false);
  const [testing, setTesting]   = useState(false);
  const [saved,   setSaved]     = useState(false);

  useEffect(() => {
    api.get('/teams-notification')
      .then(r => {
        form.setFieldsValue({
          webhook_url:             r.data.webhook_url || '',
          enabled:                 r.data.enabled ?? false,
          notify_new_asset:        r.data.notify_new_asset ?? true,
          notify_asset_update:     r.data.notify_asset_update ?? true,
          notify_decommission:     r.data.notify_decommission ?? true,
          notify_migration_status:  r.data.notify_migration_status ?? true,
          notify_host_down_vmware:  r.data.notify_host_down_vmware ?? true,
          notify_host_down_proxmox: r.data.notify_host_down_proxmox ?? true,
          notify_host_down_hyperv:  r.data.notify_host_down_hyperv ?? true,
        });
      })
      .catch(() => message.error('Failed to load Teams notification config'));
  }, [form]);

  const handleSave = async (values) => {
    setLoading(true);
    setSaved(false);
    try {
      await api.put('/teams-notification', values);
      message.success('Configuration saved.');
      setSaved(true);
    } catch {
      message.error('Failed to save configuration.');
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    const webhookUrl = form.getFieldValue('webhook_url');
    if (!webhookUrl) {
      message.warning('Enter a webhook URL before testing.');
      return;
    }
    setTesting(true);
    try {
      await api.post('/teams-notification/test', { webhook_url: webhookUrl });
      message.success('Test notification sent to Teams!');
    } catch (err) {
      message.error(err?.response?.data?.error || 'Test notification failed.');
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 0' }}>
      <style>{DASH_CSS}</style>
      <Space style={{ marginBottom: 20 }}>
        <TeamOutlined style={{ fontSize: 24, color: '#5a4fcf' }} />
        <Title level={4} style={{ margin: 0 }}>Microsoft Teams Notifications</Title>
      </Space>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 20 }}
        message="How to get a webhook URL"
        description={
          <span>
            In Teams, go to <b>Apps → Search "Incoming Webhook" → Add to a channel</b>.
            Copy the webhook URL and paste it below.
          </span>
        }
      />

      <Card className="dashcard">
        <Form form={form} layout="vertical" onFinish={handleSave}>

          <Form.Item
            name="webhook_url"
            label="Webhook URL"
            rules={[{ type: 'url', message: 'Enter a valid URL' }]}
          >
            <Input
              placeholder="https://outlook.office.com/webhook/..."
              allowClear
            />
          </Form.Item>

          <Form.Item name="enabled" valuePropName="checked" label="Enable Teams notifications">
            <Switch />
          </Form.Item>

          <Divider>Notification Events</Divider>

          <Form.Item name="notify_new_asset" valuePropName="checked" label="New asset registered">
            <Switch />
          </Form.Item>

          <Form.Item name="notify_asset_update" valuePropName="checked" label="Asset updated">
            <Switch />
          </Form.Item>

          <Form.Item name="notify_decommission" valuePropName="checked" label="Asset decommissioned / reactivated">
            <Switch />
          </Form.Item>

          <Form.Item name="notify_migration_status" valuePropName="checked" label="Migration status changed">
            <Switch />
          </Form.Item>

          <Form.Item name="notify_host_down_vmware" valuePropName="checked" label="VMware Discovery host lost / regained connectivity">
            <Switch />
          </Form.Item>

          <Form.Item name="notify_host_down_proxmox" valuePropName="checked" label="Proxmox Discovery host lost / regained connectivity">
            <Switch />
          </Form.Item>

          <Form.Item name="notify_host_down_hyperv" valuePropName="checked" label="Hyper-V Discovery host lost / regained connectivity">
            <Switch />
          </Form.Item>

          <Divider />

          <Space>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              icon={saved ? <CheckCircleOutlined /> : undefined}
            >
              Save Configuration
            </Button>
            <Tooltip title="Send a sample message to the configured webhook to verify it works">
              <Button
                icon={<SendOutlined />}
                loading={testing}
                onClick={handleTest}
              >
                Send Test Notification
              </Button>
            </Tooltip>
          </Space>

          {saved && (
            <div style={{ marginTop: 12 }}>
              <Text type="success">Settings saved successfully.</Text>
            </div>
          )}
        </Form>
      </Card>

      <PingMonitorSchedule />
    </div>
  );
}
