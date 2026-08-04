import { useEffect, useState } from 'react';
import {
  Card, Row, Col, Table, Tag, Typography, Space, Button, Tabs, App,
  Input, Select, InputNumber, DatePicker, Form, Popconfirm, Alert, Spin, Divider,
} from 'antd';
import {
  ReloadOutlined, SaveOutlined, PlusOutlined, DeleteOutlined,
  CalendarOutlined, TeamOutlined, HistoryOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../api/client';
import { DASH_CSS } from '../../components/DashboardStatCard.jsx';

const { Text, Title } = Typography;

const PERIOD_COLS = [
  { key: 'last',      label: 'LAST', color: '#8c8c8c' },
  { key: 'current',   label: 'CURRENT', color: '#fa8c16' },
  { key: 'next',      label: 'NEXT', color: '#1d1d5c' },
  { key: 'afterNext', label: 'AFTER NEXT', color: '#722ed1' },
];

function PeriodColumn({ title, periodLabel, color, activities, periodKeyField }) {
  return (
    <Card
      size="small"
      styles={{ header: { background: color, color: '#fff' }, body: { padding: 0 } }}
      title={<span style={{ fontSize: 12, letterSpacing: 0.5 }}>{title}</span>}
    >
      <div style={{ padding: '6px 12px', fontSize: 11, color: '#8c8c8c' }}>{periodLabel}</div>
      <Table
        size="small"
        pagination={false}
        showHeader
        dataSource={activities}
        rowKey="key"
        columns={[
          { title: 'Activity', dataIndex: 'label', ellipsis: true },
          {
            title: 'Owner', dataIndex: periodKeyField, width: 90, align: 'right',
            render: v => v == null
              ? <Text type="secondary">–</Text>
              : <Text strong style={{ color: v === 'All 3' ? '#8c8c8c' : '#fa541c' }}>{v}</Text>,
          },
        ]}
      />
    </Card>
  );
}

function ReckonerView({ data, onRefresh, loading }) {
  if (!data) return <Spin />;
  const { monthly, weekly, workloadBalance, today } = data;

  return (
    <div>
      <Space align="center" style={{ marginBottom: 12 }}>
        <Text type="secondary">Today: {dayjs(today).format('DD-MMM-YYYY')}</Text>
        <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={onRefresh}>Refresh</Button>
      </Space>

      <Title level={5} style={{ marginBottom: 8 }}>Monthly Activities</Title>
      <Row gutter={12}>
        {PERIOD_COLS.map(p => (
          <Col xs={24} md={12} lg={6} key={p.key} style={{ marginBottom: 12 }}>
            <PeriodColumn
              title={p.label + ' MONTH'}
              periodLabel={monthly.period[p.key]}
              color={p.color}
              activities={monthly.activities}
              periodKeyField={p.key}
            />
          </Col>
        ))}
      </Row>

      <Divider />

      <Title level={5} style={{ marginBottom: 8 }}>Weekly Activities</Title>
      <Row gutter={12}>
        {PERIOD_COLS.map(p => (
          <Col xs={24} md={12} lg={6} key={p.key} style={{ marginBottom: 12 }}>
            <PeriodColumn
              title={p.label + ' WEEK'}
              periodLabel={weekly.period[p.key]}
              color={p.color}
              activities={weekly.activities}
              periodKeyField={p.key}
            />
          </Col>
        ))}
      </Row>

      <Divider />

      <Title level={5} style={{ marginBottom: 8 }}>Workload Balance</Title>
      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Card size="small" title={`Monthly (rotating activities, ${workloadBalance.months}-month schedule)`}>
            <Table
              size="small"
              pagination={false}
              dataSource={Object.entries(workloadBalance.monthly).map(([person, total]) => ({ person, total }))}
              rowKey="person"
              columns={[
                { title: 'Person', dataIndex: 'person' },
                { title: 'Total Assignments', dataIndex: 'total', align: 'right', render: v => <Text strong>{v}</Text> },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card size="small" title={`Weekly (rotating activities, ${workloadBalance.weeks}-week schedule)`}>
            <Table
              size="small"
              pagination={false}
              dataSource={Object.entries(workloadBalance.weekly).map(([person, total]) => ({ person, total }))}
              rowKey="person"
              columns={[
                { title: 'Person', dataIndex: 'person' },
                { title: 'Total Assignments', dataIndex: 'total', align: 'right', render: v => <Text strong>{v}</Text> },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}

function SetupView({ config, onSave, saving }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();

  useEffect(() => {
    form.setFieldsValue({
      team: config.team,
      monthlyReferenceYear: config.monthlyReference.year,
      monthlyReferenceMonth: config.monthlyReference.month,
      weeklyReferenceMonday: dayjs(config.weeklyReferenceMonday),
      monthlyRotating: config.monthlyRotating,
      monthlyShared: config.monthlyShared,
      weeklyRotating: config.weeklyRotating,
    });
  }, [config, form]);

  function submit(values) {
    const team = values.team || [];
    if (!team.length) { message.error('At least one team member is required'); return; }
    onSave({
      team,
      monthlyReference: { year: values.monthlyReferenceYear, month: values.monthlyReferenceMonth },
      weeklyReferenceMonday: values.weeklyReferenceMonday.format('YYYY-MM-DD'),
      monthlyRotating: values.monthlyRotating || [],
      monthlyShared:   values.monthlyShared || [],
      weeklyRotating:  values.weeklyRotating || [],
    });
  }

  return (
    <Form form={form} layout="vertical" onFinish={submit}>
      <Card size="small" title={<Space><TeamOutlined /><span>Team Members</span></Space>} style={{ marginBottom: 16 }}>
        <Form.Item name="team" label="Names (order doesn't matter here — set rotation order per activity below)">
          <Select mode="tags" tokenSeparators={[',']} placeholder="e.g. Ashok, Haran, Sharan" />
        </Form.Item>
      </Card>

      <Card size="small" title="Monthly Rotating Activities" style={{ marginBottom: 16 }}>
        <Form.List name="monthlyRotating">
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name, ...rest }) => (
                <Row gutter={8} key={key} align="middle" style={{ marginBottom: 8 }}>
                  <Col flex="auto">
                    <Form.Item {...rest} name={[name, 'label']} noStyle rules={[{ required: true, message: 'Label required' }]}>
                      <Input placeholder="Activity name" />
                    </Form.Item>
                  </Col>
                  <Col flex="1 1 320px">
                    <Form.Item {...rest} name={[name, 'order']} noStyle rules={[{ required: true, message: 'Pick rotation order' }]}>
                      <Select mode="multiple" placeholder="Rotation order — pick in sequence" options={(form.getFieldValue('team') || []).map(t => ({ value: t, label: t }))} />
                    </Form.Item>
                  </Col>
                  <Col>
                    <Form.Item {...rest} name={[name, 'key']} hidden><Input /></Form.Item>
                    <Button danger type="text" icon={<DeleteOutlined />} onClick={() => remove(name)} />
                  </Col>
                </Row>
              ))}
              <Button icon={<PlusOutlined />} onClick={() => add({ key: `activity_${Date.now()}`, label: '', order: [] })}>
                Add monthly rotating activity
              </Button>
            </>
          )}
        </Form.List>
      </Card>

      <Card size="small" title="Monthly Shared / Fixed Activities" style={{ marginBottom: 16 }}>
        <Form.List name="monthlyShared">
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name, ...rest }) => (
                <Row gutter={8} key={key} align="middle" style={{ marginBottom: 8 }}>
                  <Col flex="auto">
                    <Form.Item {...rest} name={[name, 'label']} noStyle rules={[{ required: true, message: 'Label required' }]}>
                      <Input placeholder="Activity name" />
                    </Form.Item>
                  </Col>
                  <Col flex="0 0 200px">
                    <Form.Item {...rest} name={[name, 'owner']} noStyle rules={[{ required: true, message: 'Owner required' }]}>
                      <Input placeholder='Owner label — e.g. "All 3"' />
                    </Form.Item>
                  </Col>
                  <Col>
                    <Form.Item {...rest} name={[name, 'key']} hidden><Input /></Form.Item>
                    <Button danger type="text" icon={<DeleteOutlined />} onClick={() => remove(name)} />
                  </Col>
                </Row>
              ))}
              <Button icon={<PlusOutlined />} onClick={() => add({ key: `shared_${Date.now()}`, label: '', owner: 'All 3' })}>
                Add shared activity
              </Button>
            </>
          )}
        </Form.List>
      </Card>

      <Card size="small" title="Weekly Rotating Activities" style={{ marginBottom: 16 }}>
        <Form.List name="weeklyRotating">
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name, ...rest }) => (
                <Row gutter={8} key={key} align="middle" style={{ marginBottom: 8 }}>
                  <Col flex="auto">
                    <Form.Item {...rest} name={[name, 'label']} noStyle rules={[{ required: true, message: 'Label required' }]}>
                      <Input placeholder="Activity name" />
                    </Form.Item>
                  </Col>
                  <Col flex="1 1 320px">
                    <Form.Item {...rest} name={[name, 'order']} noStyle rules={[{ required: true, message: 'Pick rotation order' }]}>
                      <Select mode="multiple" placeholder="Rotation order — pick in sequence" options={(form.getFieldValue('team') || []).map(t => ({ value: t, label: t }))} />
                    </Form.Item>
                  </Col>
                  <Col>
                    <Form.Item {...rest} name={[name, 'key']} hidden><Input /></Form.Item>
                    <Button danger type="text" icon={<DeleteOutlined />} onClick={() => remove(name)} />
                  </Col>
                </Row>
              ))}
              <Button icon={<PlusOutlined />} onClick={() => add({ key: `weekly_${Date.now()}`, label: '', order: [] })}>
                Add weekly rotating activity
              </Button>
            </>
          )}
        </Form.List>
      </Card>

      <Card size="small" title="Rotation Reference Points" style={{ marginBottom: 16 }}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          Which period counts as "period 0" (the first entry in each activity's rotation order). Only change this if
          the whole schedule needs to shift — normally leave as-is.
        </Text>
        <Space wrap size="large">
          <Space>
            <Text>Monthly reference:</Text>
            <Form.Item name="monthlyReferenceMonth" noStyle><InputNumber min={1} max={12} addonBefore="Month" /></Form.Item>
            <Form.Item name="monthlyReferenceYear" noStyle><InputNumber min={2020} max={2100} addonBefore="Year" /></Form.Item>
          </Space>
          <Space>
            <Text>Weekly reference Monday:</Text>
            <Form.Item name="weeklyReferenceMonday" noStyle><DatePicker /></Form.Item>
          </Space>
        </Space>
      </Card>

      <Button type="primary" icon={<SaveOutlined />} htmlType="submit" loading={saving}>Save Configuration</Button>
    </Form>
  );
}

function OverridesView() {
  const { message } = App.useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const frequency = Form.useWatch('frequency', form);

  function load() {
    setLoading(true);
    api.get('/recurring-activities/overrides')
      .then(r => setItems(r.data.items || []))
      .catch(e => message.error(e.response?.data?.error || 'Failed to load overrides'))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []); // eslint-disable-line

  async function submit(values) {
    try {
      await api.post('/recurring-activities/overrides', values);
      message.success('Override saved');
      form.resetFields();
      load();
    } catch (e) { message.error(e.response?.data?.error || 'Failed to save override'); }
  }

  async function onDelete(id) {
    try {
      await api.delete(`/recurring-activities/overrides/${id}`);
      message.success('Override removed');
      load();
    } catch (e) { message.error(e.response?.data?.error || 'Failed to remove override'); }
  }

  return (
    <div>
      <Card size="small" title="Log a manual reassignment (leave, handover)" style={{ marginBottom: 16 }}>
        <Form form={form} layout="inline" onFinish={submit} style={{ rowGap: 12 }}>
          <Form.Item name="frequency" rules={[{ required: true }]}>
            <Select placeholder="Frequency" style={{ width: 120 }} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'weekly', label: 'Weekly' }]} />
          </Form.Item>
          <Form.Item name="periodKey" rules={[{ required: true }]} tooltip="Monthly: YYYY-MM · Weekly: Monday's date YYYY-MM-DD">
            <Input placeholder={frequency === 'weekly' ? 'YYYY-MM-DD' : 'YYYY-MM'} style={{ width: 130 }} />
          </Form.Item>
          <Form.Item name="activityKey" rules={[{ required: true }]}>
            <Input placeholder="activity key" style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="assignedTo" rules={[{ required: true }]}>
            <Input placeholder="Assigned to" style={{ width: 140 }} />
          </Form.Item>
          <Form.Item name="reason">
            <Input placeholder="Reason (optional)" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" icon={<PlusOutlined />}>Add Override</Button>
          </Form.Item>
        </Form>
      </Card>

      <Table
        size="small"
        loading={loading}
        rowKey="id"
        dataSource={items}
        pagination={{ pageSize: 20 }}
        columns={[
          { title: 'Frequency', dataIndex: 'frequency', width: 100, render: v => <Tag>{v}</Tag> },
          { title: 'Period', dataIndex: 'period_key', width: 110 },
          { title: 'Activity', dataIndex: 'activity_key' },
          { title: 'Assigned To', dataIndex: 'assigned_to' },
          { title: 'Reason', dataIndex: 'reason', ellipsis: true },
          { title: 'By', dataIndex: 'created_by_name', width: 140 },
          {
            title: '', key: 'actions', width: 50,
            render: (_, row) => (
              <Popconfirm title="Remove this override?" onConfirm={() => onDelete(row.id)}>
                <Button danger type="text" size="small" icon={<DeleteOutlined />} />
              </Popconfirm>
            ),
          },
        ]}
      />
    </div>
  );
}

export default function RecurringActivities() {
  const { message } = App.useApp();
  const [reckoner, setReckoner] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function load() {
    setLoading(true);
    setError('');
    api.get('/recurring-activities/reckoner')
      .then(r => setReckoner(r.data))
      .catch(e => setError(e.response?.data?.error || 'Failed to load'))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  async function saveConfig(config) {
    setSaving(true);
    try {
      await api.put('/recurring-activities/config', { config });
      message.success('Configuration saved');
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to save configuration');
    } finally { setSaving(false); }
  }

  if (error) return <Alert type="error" showIcon message={error} />;

  return (
    <div style={{ padding: 16 }}>
      <style>{DASH_CSS}</style>
      <Title level={4}>Recurring Activities — Ready Reckoner</Title>
      <Text type="secondary">Last month, current month, next month, and the month after — who owns what. Editable here; every team member sees only their own tasks on their Dashboard's "My Tasks" tab.</Text>

      <Tabs
        style={{ marginTop: 16 }}
        items={[
          {
            key: 'reckoner', label: <span><CalendarOutlined /> Ready Reckoner</span>,
            children: <ReckonerView data={reckoner} onRefresh={load} loading={loading} />,
          },
          {
            key: 'setup', label: <span><TeamOutlined /> Setup</span>,
            children: reckoner ? <SetupView config={reckoner.config} onSave={saveConfig} saving={saving} /> : <Spin />,
          },
          {
            key: 'overrides', label: <span><HistoryOutlined /> Overrides</span>,
            children: <OverridesView />,
          },
        ]}
      />
    </div>
  );
}
