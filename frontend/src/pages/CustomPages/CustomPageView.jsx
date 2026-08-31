import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card, Table, Button, Modal, Form, Input, Switch, Space, Typography, App, Popconfirm,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, UploadOutlined, SettingOutlined,
} from '@ant-design/icons';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';
import PasswordConfirmModal from '../../components/PasswordConfirmModal.jsx';

export default function CustomPageView() {
  const { slug } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const { message } = App.useApp();
  const [page, setPage] = useState(null);
  const [records, setRecords] = useState({ items: [], total: 0 });
  const [pageEditOpen, setPageEditOpen] = useState(false);
  const [pageForm] = Form.useForm();
  const [pg, setPg] = useState({ current: 1, pageSize: 20 });
  const [deleteTarget, setDeleteTarget] = useState(null);

  const canWrite = ['admin', 'superadmin', 'asset_manager'].includes(user?.role);
  const isAdmin = ['admin', 'superadmin'].includes(user?.role);

  useEffect(() => {
    api.get(`/custom-pages/${slug}`)
      .then(r => setPage(r.data))
      .catch(e => message.error(e.response?.data?.error || 'Failed to load page'));
  }, [slug]);

  async function loadRecords() {
    if (!page) return;
    const { data } = await api.get(`/custom-pages/${page.id}/records`, { params: { page: pg.current, pageSize: pg.pageSize } });
    setRecords(data);
  }
  useEffect(() => { loadRecords(); }, [page, pg.current, pg.pageSize]); // eslint-disable-line

  async function onDeleteConfirmed(password) {
    if (!deleteTarget) return;
    await api.delete(`/custom-pages/${page.id}/records/${deleteTarget}`, { data: { password } });
    message.success('Moved to Recycle Bin');
    setDeleteTarget(null);
    loadRecords();
  }

  function openPageEdit() {
    pageForm.setFieldsValue({
      name: page.name,
      description: page.description,
      icon: page.icon,
      is_active: page.is_active,
    });
    setPageEditOpen(true);
  }

  async function onPageEditSubmit(values) {
    try {
      const { data } = await api.put(`/custom-pages/${page.id}`, values);
      message.success('Page updated');
      setPageEditOpen(false);
      if (data.slug && data.slug !== slug) {
        setTimeout(() => location.replace(`/custom-pages/${data.slug}`), 50);
      } else {
        setPage({ ...page, ...data });
        setTimeout(() => location.reload(), 50);
      }
    } catch (e) {
      message.error(e.response?.data?.error || 'Update failed');
    }
  }

  async function onPageDelete() {
    try {
      await api.delete(`/custom-pages/${page.id}`);
      message.success('Page deleted');
      setTimeout(() => location.replace('/dashboard'), 50);
    } catch (e) {
      message.error(e.response?.data?.error || 'Delete failed');
    }
  }

  if (!page) return null;

  return (
    <Card
      title={<Typography.Title level={4} style={{ margin: 0 }}>{page.name}</Typography.Title>}
      extra={
        <Space>
          {canWrite && (
            <Button icon={<UploadOutlined />} onClick={() => nav(`/custom-pages/${slug}/import`)}>
              Import
            </Button>
          )}
          {canWrite && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => nav(`/custom-pages/${slug}/new`)}>
              Add Record
            </Button>
          )}
          {isAdmin && (
            <>
              <Button icon={<SettingOutlined />} onClick={openPageEdit}>
                Edit Page
              </Button>
              <Popconfirm
                title="Delete this page?"
                description="This will permanently delete the page and all its records."
                okType="danger"
                onConfirm={onPageDelete}
              >
                <Button danger icon={<DeleteOutlined />}>Delete Page</Button>
              </Popconfirm>
            </>
          )}
        </Space>
      }
    >
      {page.description && <Typography.Paragraph type="secondary">{page.description}</Typography.Paragraph>}

      <Table
        rowKey="id"
        dataSource={records.items}
        pagination={{
          current: pg.current, pageSize: pg.pageSize, total: records.total,
          onChange: (current, pageSize) => setPg({ current, pageSize }),
          showSizeChanger: true,
        }}
        scroll={{ x: 'max-content' }}
        columns={[
          ...page.fields.map(f => ({
            title: f.label,
            dataIndex: ['data', f.field_key],
            render: (v) => {
              if (f.field_type === 'toggle') return v ? 'Yes' : 'No';
              if (f.field_type === 'date' && v) return new Date(v).toLocaleDateString();
              return v ?? '—';
            },
          })),
          {
            title: 'Actions', width: 130, render: (_, r) => (
              <Space>
                {canWrite && <Button size="small" icon={<EditOutlined />} onClick={() => nav(`/custom-pages/${slug}/${r.id}/edit`)} />}
                {isAdmin && (
                  <Button size="small" danger icon={<DeleteOutlined />}
                    onClick={() => setDeleteTarget(r.id)} />
                )}
              </Space>
            )
          }
        ]}
      />

      <Modal
        title={`Edit Page — ${page.name}`}
        open={pageEditOpen}
        onCancel={() => setPageEditOpen(false)}
        onOk={() => pageForm.submit()}
        destroyOnClose
      >
        <Form form={pageForm} layout="vertical" onFinish={onPageEditSubmit}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="icon" label="Icon (Ant Design name, optional)">
            <Input placeholder="e.g. ApiOutlined" />
          </Form.Item>
          <Form.Item name="is_active" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Field schema cannot be edited here — it would orphan existing record data.
          </Typography.Text>
        </Form>
      </Modal>

      <PasswordConfirmModal
        open={!!deleteTarget}
        title="Delete this record?"
        message="The record will be moved to the Recycle Bin. A superadmin can restore it later."
        okText="Delete"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={onDeleteConfirmed}
      />
    </Card>
  );
}
