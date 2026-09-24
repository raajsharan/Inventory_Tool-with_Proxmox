import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card, Upload, Button, Typography, Space, App, Alert, Statistic, Row, Col, Table, Tag,
} from 'antd';
import { InboxOutlined, DownloadOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import api from '../../api/client';

export default function CustomPageImport() {
  const { slug } = useParams();
  const { message } = App.useApp();
  const nav = useNavigate();
  const [page, setPage] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    api.get(`/custom-pages/${slug}`)
      .then(r => setPage(r.data))
      .catch(e => message.error(e.response?.data?.error || 'Failed to load page'));
  }, [slug]);

  async function onUpload(file) {
    if (!page) return;
    setUploading(true);
    setResult(null);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const { data } = await api.post(`/custom-pages/${page.id}/records/import`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(data);
      message.success(`Imported ${data.success} of ${data.total} rows`);
    } catch (e) {
      message.error(e.response?.data?.error || 'Import failed');
    } finally {
      setUploading(false);
    }
    return false; // prevent default upload
  }

  async function downloadTemplate() {
    if (!page) return;
    try {
      const res = await api.get(`/custom-pages/${page.id}/template`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${page.slug}-template.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to download template');
    }
  }

  if (!page) return null;

  return (
    <Card
      title={
        <Space>
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => nav(`/custom-pages/${slug}`)} />
          <Typography.Title level={4} style={{ margin: 0 }}>Import — {page.name}</Typography.Title>
        </Space>
      }
      extra={
        <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>
          Download Template
        </Button>
      }
    >
      <Typography.Paragraph type="secondary">
        Upload an Excel (.xlsx) file. The header row must match this page's field labels or keys.
        Required fields must have a value in every row.
      </Typography.Paragraph>

      <Card size="small" style={{ marginBottom: 16, background: '#fafbfc' }}>
        <Typography.Text strong>Fields:</Typography.Text>{' '}
        <Space wrap>
          {page.fields.map(f => (
            <Tag key={f.field_key} color={f.is_required ? 'red' : 'blue'}>
              {f.label}{f.is_required && ' *'} <span style={{ opacity: 0.6 }}>({f.field_type})</span>
            </Tag>
          ))}
        </Space>
      </Card>

      <Upload.Dragger
        accept=".xlsx,.xls"
        beforeUpload={onUpload}
        showUploadList={false}
        disabled={uploading}
        multiple={false}
      >
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p className="ant-upload-text">Click or drag an Excel file to this area to upload</p>
        <p className="ant-upload-hint">Only .xlsx is supported. Max 10 MB.</p>
      </Upload.Dragger>

      {result && (
        <div style={{ marginTop: 24 }}>
          <Row gutter={16}>
            <Col span={8}><Card size="small"><Statistic title="Total Rows" value={result.total} /></Card></Col>
            <Col span={8}><Card size="small" style={{ background: '#f6ffed' }}><Statistic title="Imported" value={result.success} valueStyle={{ color: '#389e0d' }} /></Card></Col>
            <Col span={8}><Card size="small" style={{ background: '#fff1f0' }}><Statistic title="Failed" value={result.failed} valueStyle={{ color: '#cf1322' }} /></Card></Col>
          </Row>

          {result.failures?.length > 0 && (
            <>
              <Typography.Title level={5} style={{ marginTop: 16 }}>Failures</Typography.Title>
              <Table
                size="small"
                rowKey={(r) => r.row}
                dataSource={result.failures}
                pagination={{ showTotal: t => `${t} total`, pageSize: 10 }}
                columns={[
                  { title: 'Row', dataIndex: 'row', width: 80 },
                  { title: 'Errors', dataIndex: 'errors', render: v => (Array.isArray(v) ? v.join('; ') : String(v)) },
                ]}
              />
            </>
          )}

          {result.success > 0 && (
            <Alert
              type="success"
              showIcon
              style={{ marginTop: 12 }}
              message={`${result.success} records imported into ${page.name}.`}
              action={
                <Button size="small" type="primary" onClick={() => nav(`/custom-pages/${slug}`)}>
                  View Records
                </Button>
              }
            />
          )}
        </div>
      )}
    </Card>
  );
}
