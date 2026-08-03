import { useEffect, useState, useRef } from 'react';
import {
  Card, Table, Button, Space, Tag, Upload, message, Popconfirm, Tooltip, Typography,
  Alert, Spin, Row, Col, Statistic,
} from 'antd';
import {
  UploadOutlined, DeleteOutlined, ClearOutlined, FileExcelOutlined, FileDoneOutlined,
  ReloadOutlined, InfoCircleOutlined,
} from '@ant-design/icons';
import api from '../../../api/client';
import { useAuth } from '../../../context/AuthContext.jsx';

const { Text, Paragraph } = Typography;
const { Dragger } = Upload;

export default function VMMacUpload() {
  const { user } = useAuth();
  const canWrite = ['admin', 'superadmin', 'asset_manager'].includes(user?.role);
  const [files,     setFiles]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [uploading, setUploading] = useState(false);

  function loadFiles() {
    setLoading(true);
    api.get('/vmware/mac-lookup/files')
      .then(r => setFiles(r.data.files || []))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadFiles(); }, []);

  async function handleUpload({ file, onSuccess, onError }) {
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    try {
      const r = await api.post('/vmware/mac-lookup/files', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      message.success(`"${r.data.filename}" uploaded — ${r.data.row_count} entries`);
      loadFiles();
      onSuccess(r.data);
    } catch (err) {
      const msg = err?.response?.data?.error || 'Upload failed';
      message.error(msg);
      onError(new Error(msg));
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id, filename) {
    try {
      await api.delete(`/vmware/mac-lookup/files/${id}`);
      message.success(`"${filename}" removed`);
      loadFiles();
    } catch {
      message.error('Delete failed');
    }
  }

  async function handleClearAll() {
    try {
      const r = await api.delete('/vmware/mac-lookup/files');
      message.info(`${r.data.deleted} file(s) cleared`);
      loadFiles();
    } catch {
      message.error('Clear failed');
    }
  }

  const totalEntries = files.reduce((s, f) => s + (f.row_count || 0), 0);

  const columns = [
    {
      title: 'Filename', dataIndex: 'filename', key: 'filename', ellipsis: true,
      render: (v, row) => (
        <Space>
          {v.endsWith('.xlsx') || v.endsWith('.xls')
            ? <FileExcelOutlined style={{ color: '#52c41a' }} />
            : <FileDoneOutlined style={{ color: '#1677ff' }} />
          }
          <Text>{v}</Text>
        </Space>
      ),
    },
    {
      title: 'Uploaded', dataIndex: 'uploaded_at', key: 'uploaded_at', width: 180,
      render: v => v ? new Date(v).toLocaleString() : '—',
    },
    {
      title: 'Rows', dataIndex: 'row_count', key: 'row_count', width: 90, align: 'right',
      render: v => <Tag color="blue">{v}</Tag>,
    },
    {
      title: 'Columns Detected', key: 'cols', width: 300,
      render: (_, row) => {
        const cols = row.cols_detected || {};
        return (
          <Space wrap size={4}>
            {Object.entries(cols).map(([k, v]) =>
              v ? <Tag key={k} color="geekblue">{k}: {v}</Tag> : null
            )}
          </Space>
        );
      },
    },
    {
      title: '', key: 'actions', width: 60, align: 'center',
      render: (_, row) => (
        canWrite ? (
          <Popconfirm
            title={`Remove "${row.filename}"?`}
            onConfirm={() => handleDelete(row.id, row.filename)}
            okText="Remove"
            okType="danger"
          >
            <Button icon={<DeleteOutlined />} size="small" danger type="text" />
          </Popconfirm>
        ) : null
      ),
    },
  ];

  return (
    <div style={{ padding: 16 }}>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8}>
          <Card size="small">
            <Statistic title="Mapping Files" value={files.length} />
          </Card>
        </Col>
        <Col xs={12} sm={8}>
          <Card size="small">
            <Statistic title="Total Mapping Entries" value={totalEntries} />
          </Card>
        </Col>
      </Row>

      {/* Upload area */}
      {canWrite && (
        <Card size="small" title="Upload MAC → IP Mapping File" style={{ marginBottom: 16 }}>
          <Alert
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            style={{ marginBottom: 12 }}
            message="Supported formats: .csv and .xlsx"
            description={
              <Paragraph style={{ margin: 0 }}>
                The file must include a <Text code>MAC Address</Text> column and an{' '}
                <Text code>IP Address</Text> column. Optional columns:{' '}
                <Text code>LAN Segment</Text>, <Text code>VLAN Group</Text>,{' '}
                <Text code>Data Retrieved</Text>. Column names are auto-detected.
                Multiple files are combined — first match per MAC wins.
              </Paragraph>
            }
          />
          <Dragger
            name="file"
            accept=".csv,.xlsx,.xls"
            multiple={false}
            showUploadList={false}
            customRequest={handleUpload}
            disabled={uploading}
          >
            <p className="ant-upload-drag-icon">
              {uploading ? <Spin /> : <UploadOutlined style={{ fontSize: 32 }} />}
            </p>
            <p className="ant-upload-text">
              {uploading ? 'Uploading…' : 'Click or drag a .csv / .xlsx file here'}
            </p>
            <p className="ant-upload-hint">
              Max 20 MB. Each upload is stored separately and combined during MAC lookup.
            </p>
          </Dragger>
        </Card>
      )}

      {/* Stored files list */}
      <Card
        size="small"
        title={`Stored Mapping Files (${files.length})`}
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} size="small" onClick={loadFiles} />
            {canWrite && files.length > 0 && (
              <Popconfirm
                title="Remove ALL mapping files?"
                onConfirm={handleClearAll}
                okText="Clear All"
                okType="danger"
              >
                <Button icon={<ClearOutlined />} size="small" danger>Clear All</Button>
              </Popconfirm>
            )}
          </Space>
        }
      >
        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={files}
          columns={columns}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: 'No mapping files uploaded yet' }}
        />
      </Card>
    </div>
  );
}
