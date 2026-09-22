import { useEffect, useState } from 'react';
import {
  Alert, App, Button, Card, Form, Input, Modal, Popconfirm, Space, Table, Tag,
  Typography, Upload,
} from 'antd';
import {
  CheckCircleFilled, CloseCircleFilled, DeleteOutlined, InfoCircleOutlined,
  PlusOutlined, SettingOutlined, UploadOutlined,
} from '@ant-design/icons';
import api from '../../api/client';

const { Title, Text } = Typography;

export default function AgentPushLocations() {
  const { message } = App.useApp();
  const [locations, setLocations] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [addOpen, setAddOpen]     = useState(false);
  const [pkgModal, setPkgModal]   = useState({ open: false, location: null, os: null });
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/agent-push/locations');
      setLocations(data.locations || []);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load locations');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  const responseIssConfigured = !!locations[0]?.response_iss_configured;

  const createLocation = async (vals) => {
    try {
      await api.post('/agent-push/locations', vals);
      message.success(`Location "${vals.name}" created.`);
      setAddOpen(false);
      form.resetFields();
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to create location');
    }
  };

  const deleteLocation = async (loc) => {
    try {
      await api.delete(`/agent-push/locations/${loc.id}`);
      message.success(`Deleted "${loc.name}".`);
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to delete location');
    }
  };

  const uploadPackageFile = async (file) => {
    const body = new FormData();
    body.append('files', file);
    body.append('os', pkgModal.os);
    try {
      await api.post(`/agent-push/locations/${pkgModal.location.id}/packages`, body, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      message.success(`Uploaded ${file.name}`);
      load();
    } catch (e) {
      message.error(e.response?.data?.error || `Failed to upload ${file.name}`);
    }
    return false;
  };

  const uploadResponseIss = async (file) => {
    const body = new FormData();
    body.append('file', file);
    try {
      await api.post('/agent-push/response-iss', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      message.success('response.iss uploaded.');
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to upload response.iss');
    }
    return false;
  };

  const columns = [
    { title: 'Name', dataIndex: 'name', width: 180 },
    { title: 'Folder', dataIndex: 'folder_name', width: 160, render: (v) => <Text code>{v}</Text> },
    {
      title: 'Windows', width: 190,
      render: (_, r) => (
        <Space>
          <Tag icon={r.windows_ready ? <CheckCircleFilled /> : <CloseCircleFilled />} color={r.windows_ready ? 'success' : 'default'}>
            {r.windows_ready ? `Ready (${r.windows_package?.kind === 'exe' ? 'exe' : 'msi'})` : 'Missing files'}
          </Tag>
          <Button size="small" onClick={() => setPkgModal({ open: true, location: r, os: 'windows' })}>Upload</Button>
        </Space>
      ),
    },
    {
      title: 'Linux', width: 190,
      render: (_, r) => (
        <Space>
          <Tag icon={r.linux_ready ? <CheckCircleFilled /> : <CloseCircleFilled />} color={r.linux_ready ? 'success' : 'default'}>
            {r.linux_ready ? 'Ready' : 'Missing files'}
          </Tag>
          <Button size="small" onClick={() => setPkgModal({ open: true, location: r, os: 'linux' })}>Upload</Button>
        </Space>
      ),
    },
    { title: 'Notes', dataIndex: 'notes', ellipsis: true },
    {
      title: '', width: 60,
      render: (_, r) => (
        <Popconfirm title={`Delete "${r.name}"?`} onConfirm={() => deleteLocation(r)} okText="Delete" okType="danger">
          <Button size="small" danger icon={<DeleteOutlined />} type="text" />
        </Popconfirm>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1100 }}>
      <Space align="start" style={{ marginBottom: 20 }}>
        <SettingOutlined style={{ fontSize: 22, color: '#1677ff', marginTop: 4 }} />
        <div>
          <Title level={4} style={{ margin: 0 }}>Agent Push Locations</Title>
          <Text type="secondary">Per-office installer packages for Agent Push</Text>
        </div>
      </Space>

      <Card size="small" title="InstallShield response file (shared across all locations)" style={{ marginBottom: 20 }}>
        <Alert
          type="info" showIcon icon={<InfoCircleOutlined />} style={{ marginBottom: 12 }}
          message="Only needed if any location's Windows package is a single InstallShield .exe"
          description={
            <>
              Record once on a test machine: <Text code>installer.exe /r /f1"C:\response.iss"</Text>,
              let it actually install, then upload the resulting response.iss here. The same file
              works for every location using this package format.
            </>
          }
        />
        <Space>
          <Tag icon={responseIssConfigured ? <CheckCircleFilled /> : <CloseCircleFilled />} color={responseIssConfigured ? 'success' : 'default'}>
            {responseIssConfigured ? 'Configured' : 'Not configured'}
          </Tag>
          <Upload beforeUpload={uploadResponseIss} showUploadList={false} accept=".iss">
            <Button size="small" icon={<UploadOutlined />}>Upload response.iss</Button>
          </Upload>
        </Space>
      </Card>

      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>Add Location</Button>
      </div>

      <Table rowKey="id" loading={loading} dataSource={locations} columns={columns} pagination={false} size="middle" />

      <Modal open={addOpen} title="Add Location" onCancel={() => setAddOpen(false)} destroyOnClose
        footer={[
          <Button key="cancel" onClick={() => setAddOpen(false)}>Cancel</Button>,
          <Button key="submit" type="primary" onClick={() => form.submit()}>Create</Button>,
        ]}
      >
        <Form form={form} layout="vertical" onFinish={createLocation}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input placeholder="Burlington" />
          </Form.Item>
          <Form.Item name="folder_name" label="Folder name" rules={[{ required: true }]}
            extra="Used as the storage folder name — letters, digits, dashes/underscores only.">
            <Input placeholder="Burlington" style={{ fontFamily: 'monospace' }} />
          </Form.Item>
          <Form.Item name="notes" label="Notes"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Modal
        open={pkgModal.open}
        title={`Upload ${pkgModal.os} package — ${pkgModal.location?.name || ''}`}
        onCancel={() => setPkgModal({ open: false, location: null, os: null })}
        footer={<Button type="primary" onClick={() => setPkgModal({ open: false, location: null, os: null })}>Done</Button>}
        destroyOnClose
      >
        {pkgModal.os === 'windows' ? (
          <Alert type="info" showIcon style={{ marginBottom: 12 }}
            message="Two supported formats" description="Either UEMSAgent.msi + UEMSAgent.mst (+ up to 2 .crt files), or a single *_Agent.exe. Upload all files for one location together." />
        ) : (
          <Alert type="info" showIcon style={{ marginBottom: 12 }}
            message="Two files needed" description="A *.bin agent binary and serverinfo.json — upload both." />
        )}
        <Upload.Dragger beforeUpload={uploadPackageFile} multiple showUploadList={false}>
          <p className="ant-upload-drag-icon"><UploadOutlined style={{ fontSize: 28 }} /></p>
          <p className="ant-upload-text">Click or drag file(s) here</p>
        </Upload.Dragger>
      </Modal>
    </div>
  );
}
