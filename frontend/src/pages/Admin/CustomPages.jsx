import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Card, Table, Button, Modal, Form, Input, Space, Popconfirm, App, Typography, Tag, Switch, Tooltip,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, AppstoreAddOutlined,
  DatabaseOutlined, GlobalOutlined, CloudServerOutlined, HddOutlined, EyeOutlined, LockOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';

const BUILT_IN_PAGES = [
  { page_key: 'assets',                slug: 'assets',          path: '/assets',         icon: <DatabaseOutlined /> },
  { page_key: 'beijing_assets',        slug: 'beijing-assets',  path: '/beijing-assets', icon: <GlobalOutlined /> },
  { page_key: 'ext_assets',            slug: 'ext-assets',      path: '/ext-assets',     icon: <CloudServerOutlined /> },
  { page_key: 'physical_esxi_servers', slug: 'physical-esxi',   path: '/physical-esxi',  icon: <HddOutlined /> },
];

export default function AdminCustomPages() {
  const { message } = App.useApp();
  const { refreshBuiltinOverrides } = useAuth();
  const nav = useNavigate();
  const [custom, setCustom] = useState([]);
  const [builtins, setBuiltins] = useState([]);
  const [builtInFieldCounts, setBuiltInFieldCounts] = useState({});
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  async function load() {
    setLoading(true);
    try {
      const [customRes, biRes, fvRes] = await Promise.all([
        api.get('/custom-pages'),
        api.get('/builtin-pages').catch(() => ({ data: { items: [] } })),
        api.get('/field-visibility').catch(() => ({ data: { items: [] } })),
      ]);
      setCustom(customRes.data.items || []);
      setBuiltins(biRes.data.items || []);
      const counts = {};
      for (const p of fvRes.data.items || []) counts[p.key] = (p.fields || []).length;
      setBuiltInFieldCounts(counts);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load');
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  function openEdit(p) {
    setEditing(p);
    form.setFieldsValue({
      name: p.name,
      description: p.description,
      icon: p.icon,
      is_active: p.is_active,
    });
    setOpen(true);
  }

  async function onSubmit(values) {
    try {
      if (editing.isBuiltIn) {
        await api.put(`/builtin-pages/${editing.page_key}`, {
          name: values.name,
          description: values.description,
          icon: values.icon,
        });
        message.success('Built-in page updated');
        await refreshBuiltinOverrides();
      } else {
        await api.put(`/custom-pages/${editing.id}`, values);
        message.success('Saved');
      }
      setOpen(false);
      load();
      setTimeout(() => location.reload(), 50);
    } catch (e) {
      message.error(e.response?.data?.error || 'Save failed');
    }
  }

  async function onResetBuiltin(pageKey) {
    try {
      await api.delete(`/builtin-pages/${pageKey}`);
      message.success('Reset to default');
      await refreshBuiltinOverrides();
      load();
      setTimeout(() => location.reload(), 50);
    } catch (e) {
      message.error(e.response?.data?.error || 'Reset failed');
    }
  }

  async function onDelete(id) {
    try {
      await api.delete(`/custom-pages/${id}`);
      message.success('Page deleted');
      load();
      setTimeout(() => location.reload(), 50);
    } catch (e) {
      message.error(e.response?.data?.error || 'Delete failed');
    }
  }

  // Merge built-in metadata from API response with hardcoded paths/icons.
  const builtinRows = BUILT_IN_PAGES.map(meta => {
    const api = builtins.find(b => b.page_key === meta.page_key) || {};
    return {
      ...meta,
      isBuiltIn: true,
      id: `built-in:${meta.page_key}`,
      name: api.name || meta.page_key,
      defaultName: api.default_name,
      description: api.description,
      is_overridden: !!api.is_overridden,
      is_active: true,
      fields: { length: builtInFieldCounts[meta.page_key] ?? 0 },
    };
  });

  const rows = [
    ...builtinRows,
    ...custom.map(p => ({ ...p, isBuiltIn: false, path: `/custom-pages/${p.slug}`, icon: <AppstoreAddOutlined /> })),
  ];

  return (
    <Card
      title={<Typography.Title level={4} style={{ margin: 0 }}>Custom Pages</Typography.Title>}
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => nav('/custom-pages/new')}>
          New Page
        </Button>
      }
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
        Built-in inventories appear at the top — admins/superadmins can rename them, change the description,
        or pick a new icon. To hide individual fields, use{' '}
        <Link to="/admin/field-visibility">Field Customization</Link>. User-created pages can be fully edited or deleted.
      </Typography.Paragraph>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination={false}
        columns={[
          {
            title: 'Page',
            render: (_, r) => (
              <Space>
                {r.icon || <AppstoreAddOutlined />}
                <Link to={r.path}>
                  <strong>{r.name}</strong>
                </Link>
                {r.isBuiltIn && (
                  <Tooltip title="Built-in page — schema is managed by the system">
                    <Tag color="purple" icon={<LockOutlined />}>Built-in</Tag>
                  </Tooltip>
                )}
                {r.is_overridden && <Tag color="orange">customized</Tag>}
              </Space>
            ),
          },
          { title: 'Slug', dataIndex: 'slug', render: v => <Tag>{v}</Tag> },
          { title: 'Description', dataIndex: 'description', render: v => v || <Typography.Text type="secondary">—</Typography.Text> },
          {
            title: 'Fields',
            render: (_, r) => <Tag color="blue">{r.fields?.length ?? 0} fields</Tag>,
            width: 110,
          },
          {
            title: 'Active', dataIndex: 'is_active', width: 90,
            render: v => (v ? <Tag color="green">Yes</Tag> : <Tag>No</Tag>),
          },
          {
            title: 'Actions', width: 280, render: (_, r) => (
              r.isBuiltIn ? (
                <Space>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>Edit</Button>
                  <Tooltip title="Customize visible fields">
                    <Button size="small" icon={<EyeOutlined />} onClick={() => nav('/admin/field-visibility')}>
                      Fields
                    </Button>
                  </Tooltip>
                  {r.is_overridden && (
                    <Popconfirm
                      title="Reset to default name and description?"
                      onConfirm={() => onResetBuiltin(r.page_key)}
                    >
                      <Tooltip title="Reset to default">
                        <Button size="small" icon={<ReloadOutlined />} />
                      </Tooltip>
                    </Popconfirm>
                  )}
                </Space>
              ) : (
                <Space>
                  <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>Edit</Button>
                  <Popconfirm
                    title="Delete this page?"
                    description="This will permanently delete the page and all its records."
                    okType="danger"
                    onConfirm={() => onDelete(r.id)}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              )
            ),
          },
        ]}
      />

      <Modal
        open={open}
        title={editing?.isBuiltIn
          ? `Edit Built-in Page: ${editing.defaultName || editing.name}`
          : (editing ? `Edit Page: ${editing.name}` : 'Edit Page')}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={onSubmit}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input placeholder={editing?.defaultName || ''} />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="icon" label="Icon (Ant Design name, optional)" extra="e.g. ApiOutlined, DatabaseOutlined">
            <Input />
          </Form.Item>
          {!editing?.isBuiltIn && (
            <Form.Item name="is_active" label="Active" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {editing?.isBuiltIn
              ? 'Field structure is fixed for built-in pages. Use Field Customization to hide individual fields.'
              : 'Field structure (columns) cannot be edited from this dialog to protect existing records. Create a new page if you need a different schema.'}
          </Typography.Text>
        </Form>
      </Modal>
    </Card>
  );
}
