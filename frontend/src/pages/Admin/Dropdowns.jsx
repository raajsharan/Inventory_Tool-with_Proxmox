import { useEffect, useMemo, useState } from 'react';
import {
  Card, Table, Button, Modal, Form, Input, Select, InputNumber, Space, Popconfirm,
  App, Typography, Row, Col, Tag, Empty, Tooltip,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, AppstoreOutlined, SearchOutlined,
} from '@ant-design/icons';
import api from '../../api/client';

const CATEGORIES = [
  'os_type', 'os_version', 'server_status', 'patching_type', 'server_patch_type',
  'patching_schedule', 'location', 'eol_status',
];

const CATEGORY_LABEL = {
  os_type: 'OS Type',
  os_version: 'OS Version',
  server_status: 'Server Status',
  patching_type: 'Patching Type',
  server_patch_type: 'Server Patch Type',
  patching_schedule: 'Patching Schedule',
  location: 'Location',
  eol_status: 'EOL Status',
};

export default function Dropdowns() {
  const { message } = App.useApp();
  const [all, setAll] = useState([]);
  const [selected, setSelected] = useState(CATEGORIES[0]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();

  async function load() {
    const { data } = await api.get('/dropdowns');
    setAll(data.items || []);
  }
  useEffect(() => { load(); }, []);

  const byCategory = useMemo(() => {
    const map = {};
    for (const c of CATEGORIES) map[c] = [];
    for (const row of all) {
      if (!map[row.category]) map[row.category] = [];
      map[row.category].push(row);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.value.localeCompare(b.value));
    }
    return map;
  }, [all]);

  const visibleRows = useMemo(() => {
    const rows = byCategory[selected] || [];
    if (!search) return rows;
    const s = search.toLowerCase();
    return rows.filter(r =>
      String(r.value || '').toLowerCase().includes(s) ||
      String(r.parent_value || '').toLowerCase().includes(s)
    );
  }, [byCategory, selected, search]);

  function openCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ category: selected, sort_order: (byCategory[selected]?.length || 0) + 1 });
    setOpen(true);
  }
  function openEdit(v) { setEditing(v); form.setFieldsValue(v); setOpen(true); }

  async function onSubmit(v) {
    try {
      if (editing) await api.put(`/dropdowns/${editing.id}`, v);
      else await api.post('/dropdowns', v);
      message.success('Saved');
      setOpen(false);
      load();
    } catch (e) { message.error(e.response?.data?.error || 'Failed'); }
  }

  async function onDelete(id) {
    try {
      await api.delete(`/dropdowns/${id}`);
      message.success('Deleted');
      load();
    } catch (e) { message.error(e.response?.data?.error || 'Delete failed'); }
  }

  return (
    <Card
      title={<Typography.Title level={4} style={{ margin: 0 }}>Dropdown Master</Typography.Title>}
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Add Value to {CATEGORY_LABEL[selected] || selected}
        </Button>
      }
      bodyStyle={{ padding: 0 }}
    >
      <Row style={{ minHeight: 540 }}>
        <Col xs={24} md={7} lg={6} style={{ borderRight: '1px solid var(--ant-color-border, #f0f0f0)' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--ant-color-border, #f0f0f0)' }}>
            <Typography.Text type="secondary" style={{ fontSize: 12, letterSpacing: 0.4 }}>
              CATEGORIES
            </Typography.Text>
          </div>
          <div style={{ padding: 8 }}>
            {CATEGORIES.map(cat => {
              const count = byCategory[cat]?.length || 0;
              const active = cat === selected;
              return (
                <div
                  key={cat}
                  onClick={() => { setSelected(cat); setSearch(''); }}
                  style={{
                    cursor: 'pointer',
                    padding: '10px 12px',
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 4,
                    background: active ? 'var(--ant-color-primary-bg, #e6f4ff)' : 'transparent',
                    color: active ? 'var(--ant-color-primary, #1677ff)' : 'inherit',
                    fontWeight: active ? 600 : 400,
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.background = 'var(--ant-color-fill-tertiary, #00000008)';
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <Space size={8}>
                    <AppstoreOutlined />
                    <span>{CATEGORY_LABEL[cat] || cat}</span>
                  </Space>
                  <Tag color={active ? 'blue' : 'default'} style={{ marginRight: 0 }}>{count}</Tag>
                </div>
              );
            })}
          </div>
        </Col>

        <Col xs={24} md={17} lg={18}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--ant-color-border, #f0f0f0)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <Space size={8}>
              <Typography.Title level={5} style={{ margin: 0 }}>
                {CATEGORY_LABEL[selected] || selected}
              </Typography.Title>
              <Tag>{byCategory[selected]?.length || 0} values</Tag>
            </Space>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="Search values..."
              style={{ maxWidth: 280 }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <Table
            rowKey="id"
            dataSource={visibleRows}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            locale={{ emptyText: <Empty description={search ? 'No matches' : 'No values yet'} /> }}
            columns={[
              { title: 'Value', dataIndex: 'value', render: v => <strong>{v}</strong> },
              { title: 'Parent (cascade)', dataIndex: 'parent_value',
                render: v => v ? <Tag>{v}</Tag> : <Typography.Text type="secondary">—</Typography.Text> },
              { title: 'Sort', dataIndex: 'sort_order', width: 80, align: 'center' },
              {
                title: 'Actions', width: 130, align: 'right',
                render: (_, r) => (
                  <Space>
                    <Tooltip title="Edit">
                      <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
                    </Tooltip>
                    <Popconfirm title="Delete this value?" onConfirm={() => onDelete(r.id)} okType="danger">
                      <Tooltip title="Delete">
                        <Button size="small" danger icon={<DeleteOutlined />} />
                      </Tooltip>
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        </Col>
      </Row>

      <Modal
        open={open}
        title={editing ? `Edit Value — ${CATEGORY_LABEL[editing.category] || editing.category}` : `Add Value to ${CATEGORY_LABEL[selected] || selected}`}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={onSubmit}>
          <Form.Item name="category" label="Category" rules={[{ required: true }]}>
            <Select
              options={CATEGORIES.map(c => ({ label: CATEGORY_LABEL[c] || c, value: c }))}
              disabled={!!editing}
            />
          </Form.Item>
          <Form.Item name="value" label="Value" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="parent_value" label="Parent value (for cascading)" extra="Optional — used for OS Version → OS Type chains">
            <Input />
          </Form.Item>
          <Form.Item name="sort_order" label="Sort order">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
