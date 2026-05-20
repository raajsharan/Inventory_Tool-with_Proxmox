import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Form, Input, Button, Space, Typography, Select, Switch, Row, Col, App, Alert, AutoComplete,
} from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';

const COMMON_SECTIONS = [
  'Basic Information', 'Identity', 'Ownership', 'Operations',
  'Asset Tagging & Credentials', 'Tools', 'Network', 'Other',
];
import api from '../../api/client';

const FIELD_TYPES = [
  { label: 'Text', value: 'text' },
  { label: 'Text Area', value: 'textarea' },
  { label: 'Number', value: 'number' },
  { label: 'Dropdown', value: 'dropdown' },
  { label: 'Toggle', value: 'toggle' },
  { label: 'Date', value: 'date' },
];

export default function CustomPageBuilder() {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const nav = useNavigate();
  const [saving, setSaving] = useState(false);

  async function onFinish(values) {
    setSaving(true);
    try {
      const payload = {
        name: values.name,
        description: values.description,
        fields: (values.fields || []).map(f => ({
          ...f,
          section: (f.section && f.section.trim()) || 'General',
          options: f.field_type === 'dropdown' && f.optionsCsv
            ? f.optionsCsv.split(',').map(s => s.trim()).filter(Boolean)
            : undefined,
        })),
      };
      const { data } = await api.post('/custom-pages', payload);
      message.success('Page created');
      nav(`/custom-pages/${data.slug}`);
      setTimeout(() => location.reload(), 50); // refresh sidebar
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to create page');
    } finally { setSaving(false); }
  }

  return (
    <Card title={<Typography.Title level={4} style={{ margin: 0 }}>Create New Page</Typography.Title>}>
      <Form form={form} layout="vertical" onFinish={onFinish}
        initialValues={{ fields: [{ field_type: 'text', is_required: false, section: 'Basic Information' }] }}>
        <Row gutter={16}>
          <Col xs={24} md={10}>
            <Form.Item name="name" label="Page Name" rules={[{ required: true }]}>
              <Input placeholder="e.g. Network Switches" />
            </Form.Item>
          </Col>
          <Col xs={24} md={14}>
            <Form.Item name="description" label="Description"><Input /></Form.Item>
          </Col>
        </Row>

        <Typography.Title level={5}>Fields</Typography.Title>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Group fields into sections (e.g. Basic Information, Ownership). Pick from the suggestions or type a new section name — the Add Record page renders one panel per section."
        />
        <Form.List name="fields">
          {(items, { add, remove }) => (
            <>
              {items.map(({ key, name, ...rest }) => (
                <Row key={key} gutter={8} align="bottom" style={{ marginBottom: 8 }}>
                  <Col xs={24} md={5}>
                    <Form.Item {...rest} name={[name, 'section']} label="Section">
                      <AutoComplete
                        placeholder="Basic Information"
                        options={(() => {
                          const used = (form.getFieldValue('fields') || [])
                            .map(f => f?.section).filter(Boolean);
                          const set = new Set([...used, ...COMMON_SECTIONS]);
                          return Array.from(set).map(v => ({ value: v }));
                        })()}
                        filterOption={(input, option) =>
                          (option?.value || '').toLowerCase().includes(input.toLowerCase())
                        }
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={5}>
                    <Form.Item {...rest} name={[name, 'label']} label="Label" rules={[{ required: true }]}>
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={3}>
                    <Form.Item {...rest} name={[name, 'field_type']} label="Type" rules={[{ required: true }]}>
                      <Select options={FIELD_TYPES} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={6}>
                    <Form.Item shouldUpdate noStyle>
                      {() => form.getFieldValue(['fields', name, 'field_type']) === 'dropdown' ? (
                        <Form.Item {...rest} name={[name, 'optionsCsv']} label="Options (comma-separated)">
                          <Input placeholder="Option A, Option B, Option C" />
                        </Form.Item>
                      ) : <Form.Item label=" " ><Input disabled placeholder="—" /></Form.Item>}
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={2}>
                    <Form.Item {...rest} name={[name, 'is_required']} label="Required" valuePropName="checked">
                      <Switch />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={3}>
                    <Form.Item label=" ">
                      <Button danger icon={<DeleteOutlined />} onClick={() => remove(name)}>Remove</Button>
                    </Form.Item>
                  </Col>
                </Row>
              ))}
              <Button icon={<PlusOutlined />} onClick={() => add({ field_type: 'text', is_required: false, section: 'Basic Information' })}>
                Add Field
              </Button>
            </>
          )}
        </Form.List>

        <Space style={{ marginTop: 16 }}>
          <Button type="primary" htmlType="submit" loading={saving}>Create Page</Button>
          <Button onClick={() => nav(-1)}>Cancel</Button>
        </Space>
      </Form>
    </Card>
  );
}
