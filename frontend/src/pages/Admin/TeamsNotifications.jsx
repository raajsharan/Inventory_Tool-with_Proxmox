import { useEffect, useState } from 'react';
import {
  Card, Form, Input, InputNumber, Switch, Button, Divider, Alert, Space, Typography, message, Tooltip, Row, Col, TimePicker, Tag,
} from 'antd';
import {
  SendOutlined, CheckCircleOutlined, TeamOutlined, ClockCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../api/client';
import { DASH_CSS } from '../../components/DashboardStatCard.jsx';
import UtilizationThresholds from '../../components/UtilizationThresholds.jsx';

const { Title, Text } = Typography;

const PING_PLATFORMS = [
  { key: 'vmware',  label: 'VMware' },
  { key: 'proxmox', label: 'Proxmox' },
  { key: 'hyperv',  label: 'Hyper-V' },
];

// ── Shared schedule-visualization helpers ───────────────────────────────────

const HOUR_MARKS = [0, 4, 8, 12, 16, 20, 24];

function timeToPct(d) {
  if (!d) return 0;
  return ((d.hour() * 60 + d.minute()) / 1440) * 100;
}

// A 24h strip showing the active window as a highlighted band (handles an
// overnight window, e.g. 21:00-06:00, by splitting into two segments), plus
// a "now" marker so it's obvious at a glance whether the window is currently
// open. Read-only preview — the actual editing happens via the TimePickers.
function TimeWindowBar({ start, end, active }) {
  const startPct = timeToPct(start);
  const endPct   = timeToPct(end);
  const nowPct   = timeToPct(dayjs());
  const wraps    = start && end && endPct < startPct;

  const segments = !start || !end ? [] : wraps
    ? [{ left: startPct, width: 100 - startPct }, { left: 0, width: endPct }]
    : [{ left: startPct, width: Math.max(0, endPct - startPct) }];

  return (
    <div style={{ marginTop: 6, marginBottom: 2 }}>
      <div style={{
        position: 'relative', height: 20,
        background: 'var(--ant-color-fill-tertiary, #f0f0f0)',
        borderRadius: 6, overflow: 'hidden',
      }}>
        {active && segments.map((s, i) => (
          <div key={i} style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${s.left}%`, width: `${s.width}%`,
            background: '#1677ff', opacity: 0.4,
          }} />
        ))}
        <div style={{
          position: 'absolute', top: 0, bottom: 0, left: `${nowPct}%`,
          width: 2, background: '#f5222d',
        }} title="Now" />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#8c8c8c', marginTop: 2 }}>
        {HOUR_MARKS.map(h => <span key={h}>{String(h).padStart(2, '0')}</span>)}
      </div>
    </div>
  );
}

const WEEKDAYS = [
  { day: 0, label: 'S' }, { day: 1, label: 'M' }, { day: 2, label: 'T' },
  { day: 3, label: 'W' }, { day: 4, label: 'T' }, { day: 5, label: 'F' },
  { day: 6, label: 'S' },
];

// Toggle-button day-of-week picker — value/onChange contract matches what
// Form.Item passes its child, so it drops straight into a form field.
function ActiveDaysPicker({ value = [], onChange }) {
  const toggle = (day) => {
    const next = value.includes(day) ? value.filter(d => d !== day) : [...value, day].sort();
    onChange?.(next);
  };
  return (
    <Space size={6}>
      {WEEKDAYS.map(({ day, label }) => {
        const active = value.includes(day);
        return (
          <Button
            key={day}
            shape="circle"
            size="small"
            onClick={() => toggle(day)}
            style={active ? { background: '#d84315', borderColor: '#d84315', color: '#fff' } : undefined}
          >
            {label}
          </Button>
        );
      })}
    </Space>
  );
}

const INTERVAL_PRESETS = [1, 5, 15, 30, 60];

// Quick-select buttons for the common intervals, falling back to a plain
// number input for anything else — exposes the same value/onChange contract
// Form.Item gives its child, so it drops straight into the existing form
// field with no change to what gets saved.
function IntervalQuickPicker({ value, onChange }) {
  const isPreset = INTERVAL_PRESETS.includes(value);
  return (
    <Space wrap size={6}>
      {INTERVAL_PRESETS.map(m => (
        <Button
          key={m} size="small"
          type={value === m ? 'primary' : 'default'}
          onClick={() => onChange(m)}
        >
          {m < 60 ? `${m}m` : '1h'}
        </Button>
      ))}
      <InputNumber
        size="small" min={1} max={1440} style={{ width: 90 }}
        placeholder="Custom"
        value={isPreset ? undefined : value}
        onChange={v => onChange(v || 1)}
      />
    </Space>
  );
}

function PlatformScheduleCard({ platform, form }) {
  const { key, label } = platform;
  const enabled  = Form.useWatch(`${key}_enabled`, form);
  const interval = Form.useWatch(`${key}_interval_minutes`, form);
  const start    = Form.useWatch(`${key}_window_start`, form);
  const end      = Form.useWatch(`${key}_window_end`, form);

  return (
    <div style={{
      border: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
      borderRadius: 10, padding: 16, marginBottom: 12,
    }}>
      <Space align="center" style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
        <Space>
          <Form.Item name={`${key}_enabled`} valuePropName="checked" noStyle>
            <Switch />
          </Form.Item>
          <Text strong>{label} ping check</Text>
        </Space>
        <Tag color={enabled ? 'success' : 'default'}>{enabled ? 'ACTIVE' : 'DISABLED'}</Tag>
      </Space>

      <Row gutter={16}>
        <Col xs={24} md={8}>
          <Form.Item name={`${key}_interval_minutes`} label="Check every" style={{ marginBottom: 8 }}>
            <IntervalQuickPicker />
          </Form.Item>
        </Col>
        <Col xs={12} md={8}>
          <Form.Item name={`${key}_window_start`} label="Start Time" style={{ marginBottom: 8 }}>
            <TimePicker format="HH:mm" style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col xs={12} md={8}>
          <Form.Item name={`${key}_window_end`} label="End Time" style={{ marginBottom: 8 }}>
            <TimePicker format="HH:mm" style={{ width: '100%' }} />
          </Form.Item>
        </Col>
      </Row>

      <TimeWindowBar start={start} end={end} active={!!enabled} />

      <Form.Item name={`${key}_active_days`} label="Active days" style={{ marginTop: 12, marginBottom: 4 }}>
        <ActiveDaysPicker />
      </Form.Item>

      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
        {enabled
          ? `Checking every ${interval || 5}m, active ${start ? start.format('HH:mm') : '00:00'}–${end ? end.format('HH:mm') : '23:59'}.`
          : `${label} ping check is disabled.`}
      </Text>
    </div>
  );
}

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
          values[`${p.key}_window_start`] = dayjs(r.data[`${p.key}_window_start`] || '00:00', 'HH:mm');
          values[`${p.key}_window_end`]   = dayjs(r.data[`${p.key}_window_end`]   || '23:59', 'HH:mm');
          values[`${p.key}_active_days`]  = r.data[`${p.key}_active_days`] ?? [0, 1, 2, 3, 4, 5, 6];
        }
        pingForm.setFieldsValue(values);
      })
      .catch(() => message.error('Failed to load ping monitor schedule'));
  }, [pingForm]);

  const handlePingSave = async (values) => {
    setPingLoading(true);
    setPingSaved(false);
    try {
      const payload = { ...values };
      for (const p of PING_PLATFORMS) {
        payload[`${p.key}_window_start`] = values[`${p.key}_window_start`]?.format('HH:mm') || '00:00';
        payload[`${p.key}_window_end`]   = values[`${p.key}_window_end`]?.format('HH:mm')   || '23:59';
      }
      await api.put('/ping-monitor', payload);
      message.success('Ping monitor schedule saved.');
      setPingSaved(true);
    } catch (err) {
      message.error(err?.response?.data?.error || 'Failed to save ping monitor schedule.');
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
        Independent of each platform's own discovery poll — pings every host
        every N minutes, only during the Start/End active window below (a
        check outside the window is skipped entirely). 1st consecutive
        failure sends a Warning alert, every failure after that sends
        Critical, and recovery sends a Good alert. Uses the connectivity
        toggles above.
      </Text>
      <Form form={pingForm} layout="vertical" onFinish={handlePingSave}>
        {PING_PLATFORMS.map(p => (
          <PlatformScheduleCard key={p.key} platform={p} form={pingForm} />
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
  const windowEnabled = Form.useWatch('alert_window_enabled', form);
  const windowStart   = Form.useWatch('alert_window_start', form);
  const windowEnd     = Form.useWatch('alert_window_end', form);

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
          notify_weekly_report:     r.data.notify_weekly_report ?? true,
          alert_window_enabled: r.data.alert_window_enabled ?? false,
          alert_window_start:   dayjs(r.data.alert_window_start || '00:00', 'HH:mm'),
          alert_window_end:     dayjs(r.data.alert_window_end   || '23:59', 'HH:mm'),
          alert_active_days:    r.data.alert_active_days ?? [0, 1, 2, 3, 4, 5, 6],
        });
      })
      .catch(() => message.error('Failed to load Teams notification config'));
  }, [form]);

  const handleSave = async (values) => {
    setLoading(true);
    setSaved(false);
    try {
      const payload = {
        ...values,
        alert_window_start: values.alert_window_start?.format('HH:mm') || '00:00',
        alert_window_end:   values.alert_window_end?.format('HH:mm') || '23:59',
      };
      await api.put('/teams-notification', payload);
      message.success('Configuration saved.');
      setSaved(true);
    } catch (err) {
      message.error(err?.response?.data?.error || 'Failed to save configuration.');
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

          <Form.Item name="notify_weekly_report" valuePropName="checked" label="Weekly Report generated">
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

          <Divider>
            <Space>
              Connectivity Alert Time Window
              <Tag color={windowEnabled ? 'processing' : 'default'} style={{ margin: 0 }}>
                {windowEnabled ? 'RESTRICTED' : 'UNRESTRICTED'}
              </Tag>
            </Space>
          </Divider>

          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            Restricts when the connectivity alerts above (host-down / recovered,
            ping warning / critical / recovered) are allowed to send. Outside
            this window they're dropped silently — the next check inside the
            window will re-alert if the problem is still real. Other alert
            types above are unaffected.
          </Text>

          <Form.Item name="alert_window_enabled" valuePropName="checked" label="Restrict connectivity alerts to a time window">
            <Switch />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="alert_window_start" label="Start time">
                <TimePicker format="HH:mm" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="alert_window_end" label="End time">
                <TimePicker format="HH:mm" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <TimeWindowBar start={windowStart} end={windowEnd} active={!!windowEnabled} />

          <Form.Item name="alert_active_days" label="Active days" style={{ marginTop: 12 }}>
            <ActiveDaysPicker />
          </Form.Item>

          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: -8, marginBottom: 8 }}>
            Connectivity alerts are dropped entirely on unselected days, regardless of the time window above.
          </Text>

          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6, marginBottom: 8 }}>
            {windowEnabled
              ? `Connectivity alerts are only allowed from ${windowStart ? windowStart.format('HH:mm') : '00:00'} to ${windowEnd ? windowEnd.format('HH:mm') : '23:59'}.`
              : 'Connectivity alerts are allowed to send at any time.'}
          </Text>

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
      <div style={{ marginTop: 20 }}><UtilizationThresholds /></div>
    </div>
  );
}
