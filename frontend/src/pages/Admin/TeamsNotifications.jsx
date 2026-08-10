import { useEffect, useState } from 'react';
import {
  Card, Form, Input, Switch, Button, Divider, Alert, Space, Typography, message, Tooltip,
} from 'antd';
import {
  SendOutlined, CheckCircleOutlined, TeamOutlined,
} from '@ant-design/icons';
import api from '../../api/client';
import { DASH_CSS } from '../../components/DashboardStatCard.jsx';

const { Title, Text } = Typography;

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
          notify_migration_status: r.data.notify_migration_status ?? true,
          notify_host_down:        r.data.notify_host_down ?? true,
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

          <Form.Item name="notify_host_down" valuePropName="checked" label="Discovery host lost / regained connectivity">
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
    </div>
  );
}
