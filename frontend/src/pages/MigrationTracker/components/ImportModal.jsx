import { useState, useRef } from 'react';
import {
  Modal, Upload, Button, Steps, Alert, Descriptions, Table, Switch,
  Typography, Space, Tag, Spin, message,
} from 'antd';
import { InboxOutlined, CheckCircleOutlined, ImportOutlined } from '@ant-design/icons';
import api from '../../../api/client';

const { Dragger } = Upload;
const { Text, Title } = Typography;

const BUILTIN_SHEETS = ['Hosts', 'Bomgar VMs', 'Security VMs', 'Standalone ESXi'];

export default function ImportModal({ open, onClose, onImported, projectId, projectName }) {
  const [step,           setStep]           = useState(0); // 0=upload 1=preview 2=done
  const [preview,        setPreview]        = useState(null);
  const [preserveStatus, setPreserveStatus] = useState(true);
  const [loading,        setLoading]        = useState(false);
  const [counts,         setCounts]         = useState(null);
  const fileRef = useRef(null);

  const reset = () => {
    setStep(0); setPreview(null); setCounts(null); fileRef.current = null;
  };

  const handleClose = () => { reset(); onClose(); };

  // ── Step 1: Upload & Preview ─────────────────────────────────────────────
  const handleFile = async (file) => {
    fileRef.current = file;
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (projectId) fd.append('project_id', String(projectId));
      const r = await api.post('/migration/import/preview', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setPreview(r.data.preview);
      setStep(1);
    } catch (e) {
      message.error('Failed to parse file: ' + (e.response?.data?.error || e.message));
    } finally {
      setLoading(false);
    }
    return false; // prevent antd auto-upload
  };

  // ── Step 2: Confirm ──────────────────────────────────────────────────────
  const handleConfirm = async () => {
    if (!fileRef.current) return;
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', fileRef.current);
      fd.append('preserve_status', String(preserveStatus));
      if (projectId) fd.append('project_id', String(projectId));
      const r = await api.post('/migration/import/confirm', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setCounts(r.data.counts);
      setStep(2);
      onImported?.();
    } catch (e) {
      message.error('Import failed: ' + (e.response?.data?.error || e.message));
    } finally {
      setLoading(false);
    }
  };

  // ── Preview table columns ────────────────────────────────────────────────
  const previewCols = (sampleRow) => {
    if (!sampleRow) return [];
    return Object.keys(sampleRow).map(k => ({
      key: k, dataIndex: k,
      title: <span style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{k}</span>,
      width: 140,
      ellipsis: true,
      render: v => v == null ? <Text type="secondary">—</Text> : String(v),
    }));
  };

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      title={<Space><ImportOutlined /> Import from XLSX</Space>}
      width={860}
      footer={null}
      destroyOnClose
    >
      <Steps
        size="small"
        current={step}
        style={{ marginBottom: 24 }}
        items={[
          { title: 'Upload' },
          { title: 'Preview & confirm' },
          { title: 'Done' },
        ]}
      />

      {/* ── Step 0: Upload ──────────────────────────────────────────────── */}
      {step === 0 && (
        <Spin spinning={loading}>
          <Alert
            type="info"
            style={{ marginBottom: 16 }}
            message={projectName ? `Importing into: ${projectName}` : 'Expected worksheet names'}
            description={
              <Space wrap>
                {BUILTIN_SHEETS.map(s => <Tag key={s}>{s}</Tag>)}
                <Tag color="purple">+ custom tab sheets (matched by name)</Tag>
              </Space>
            }
          />
          <Dragger
            accept=".xlsx,.xls"
            multiple={false}
            beforeUpload={handleFile}
            showUploadList={false}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">Click or drag your XLSX file here</p>
            <p className="ant-upload-hint">Sheets not matching expected names will be ignored. Existing data will be replaced.</p>
          </Dragger>
        </Spin>
      )}

      {/* ── Step 1: Preview ─────────────────────────────────────────────── */}
      {step === 1 && preview && (
        <Spin spinning={loading}>
          <Alert
            type="warning"
            showIcon
            message="This will replace all existing data for each imported sheet."
            style={{ marginBottom: 16 }}
          />

          <Space style={{ marginBottom: 16 }}>
            <Switch
              checked={preserveStatus}
              onChange={setPreserveStatus}
            />
            <Text>Preserve existing migration status values (overrides file values for records already in the DB)</Text>
          </Space>

          {Object.keys(preview).map(sheetName => {
            const sh = preview[sheetName];
            return (
              <div key={sheetName} style={{ marginBottom: 24 }}>
                <Title level={5} style={{ marginBottom: 8 }}>
                  {sheetName}
                  <Tag color="blue" style={{ marginLeft: 8 }}>{sh.count.toLocaleString()} rows</Tag>
                </Title>
                {sh.sample.length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                    <Table
                      size="small"
                      rowKey={(_, i) => i}
                      dataSource={sh.sample}
                      columns={previewCols(sh.sample[0])}
                      pagination={false}
                      scroll={{ x: 'max-content' }}
                      caption={<Text type="secondary">Showing first {sh.sample.length} of {sh.count} rows</Text>}
                    />
                  </div>
                )}
              </div>
            );
          })}

          <Space style={{ marginTop: 8 }}>
            <Button onClick={() => setStep(0)}>Back</Button>
            <Button type="primary" onClick={handleConfirm} loading={loading}>
              Confirm Import
            </Button>
          </Space>
        </Spin>
      )}

      {/* ── Step 2: Done ────────────────────────────────────────────────── */}
      {step === 2 && counts && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <CheckCircleOutlined style={{ fontSize: 48, color: '#52c41a', marginBottom: 16 }} />
          <Title level={4}>Import complete</Title>
          <Descriptions column={1} bordered size="small" style={{ maxWidth: 360, margin: '16px auto' }}>
            {Object.entries(counts).map(([sheet, n]) => (
              <Descriptions.Item key={sheet} label={sheet}>
                <Tag color="success">{n.toLocaleString()} rows imported</Tag>
              </Descriptions.Item>
            ))}
          </Descriptions>
          <Button type="primary" onClick={handleClose} style={{ marginTop: 16 }}>
            Done
          </Button>
        </div>
      )}
    </Modal>
  );
}
