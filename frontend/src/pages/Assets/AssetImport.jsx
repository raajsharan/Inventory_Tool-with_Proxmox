import { useMemo, useState } from 'react';
import {
  Card, Button, Upload, Space, Typography, Alert, Table, Tag, Checkbox, Tooltip,
} from 'antd';
import {
  DownloadOutlined, UploadOutlined, FileExcelOutlined, InboxOutlined,
  ThunderboltOutlined, EyeOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import api from '../../api/client';

const TARGET_LABELS = {
  '/assets':         'Asset List',
  '/ext-assets':     'Ext. Asset List',
  '/beijing-assets': 'Beijing Asset List',
  '/physical-esxi':  'Physical & ESXi',
};

export default function AssetImport({
  apiPrefix = '/assets',
  title = 'Excel Smart Import',
  templateFilename = 'asset-import-template.xlsx',
}) {
  const targetLabel = TARGET_LABELS[apiPrefix] || 'Selected List';

  const [file, setFile] = useState(null);
  const [verifyByIp, setVerifyByIp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState(null);
  const [selectedRows, setSelectedRows] = useState([]);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  const selectedCount = selectedRows.length;

  async function onDownloadTemplate() {
    try {
      const res = await api.get(`${apiPrefix}/template`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a'); a.href = url; a.download = templateFilename; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e.response?.data?.error || 'Template download failed');
    }
  }

  function clearAll() {
    setPreview(null);
    setSelectedRows([]);
    setResult(null);
    setErr('');
  }

  async function onVerifyData() {
    if (!file) { setErr('Pick a file first'); return; }
    setErr('');
    setResult(null);
    setPreviewing(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post(
        `${apiPrefix}/smart-import/preview?verifyByIp=${verifyByIp}`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      setPreview(res.data);
      setSelectedRows(
        (res.data.rows || [])
          .filter(r => !r.errors.length && (r.action === 'create' || (r.action === 'merge' && r.diffs.length)))
          .map(r => r.rowIdx)
      );
    } catch (e) {
      setErr(e.response?.data?.error || 'Verify failed');
    } finally { setPreviewing(false); }
  }

  async function runImport({ selectedOnly }) {
    if (!file) { setErr('Pick a file first'); return; }
    setErr('');
    setLoading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      if (selectedOnly) form.append('selectedRowIdxs', JSON.stringify(selectedRows));
      const res = await api.post(
        `${apiPrefix}/smart-import?verifyByIp=${verifyByIp}`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      setResult(res.data);
    } catch (e) {
      setErr(e.response?.data?.error || 'Import failed');
    } finally { setLoading(false); }
  }

  const previewColumns = useMemo(() => ([
    { title: 'Row', dataIndex: 'rowIdx', width: 60 },
    { title: 'Action', dataIndex: 'action', width: 100,
      render: (v, r) => {
        if (r.errors?.length) return <Tag color="red">error</Tag>;
        if (v === 'merge') return <Tag color="gold">merge by IP</Tag>;
        return <Tag color="green">create</Tag>;
      } },
    { title: 'VM Name', render: (_, r) => r.data?.vm_name },
    { title: 'IP', dataIndex: ['data', 'ip_address'], width: 130 },
    { title: 'Diff / Errors',
      render: (_, r) => {
        if (r.errors?.length) {
          return r.errors.map((e, i) => <Tag key={i} color="red">{e}</Tag>);
        }
        if (r.action === 'merge') {
          if (!r.diffs.length) return <Typography.Text type="secondary">no missing fields to fill</Typography.Text>;
          return (
            <Space size={[4, 4]} wrap>
              {r.diffs.map((d, i) => (
                <Tooltip key={i} title={`${String(d.from || '∅')} → ${String(d.to)}`}>
                  <Tag color="blue">{d.field}: +{String(d.to).slice(0, 24)}</Tag>
                </Tooltip>
              ))}
            </Space>
          );
        }
        return <Typography.Text type="secondary">new record</Typography.Text>;
      },
    },
  ]), []);

  const rowSelection = preview ? {
    selectedRowKeys: selectedRows,
    onChange: setSelectedRows,
    getCheckboxProps: (r) => ({
      disabled: r.errors?.length > 0 || (r.action === 'merge' && !r.diffs.length),
    }),
  } : undefined;

  return (
    <Card
      title={
        <Space>
          <FileExcelOutlined style={{ color: '#16a34a' }} />
          <Typography.Title level={4} style={{ margin: 0 }}>{title}</Typography.Title>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary">
        Upload Excel/CSV with random columns, auto-map against template fields, and import into the selected list.
      </Typography.Paragraph>

      <Space size={16} wrap style={{ marginBottom: 12 }}>
        <div>
          <Typography.Text strong>Target List</Typography.Text>
          <div style={{ marginTop: 4 }}>
            <Tag color="blue" style={{ fontSize: 14, padding: '4px 12px' }}>{targetLabel}</Tag>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 280 }}>
          <Typography.Text strong>Import File</Typography.Text>
          <div>
            <Upload
              accept=".xlsx,.xls,.csv"
              beforeUpload={(f) => { setFile(f); clearAll(); return false; }}
              maxCount={1}
              fileList={file ? [{ uid: '1', name: file.name, status: 'done' }] : []}
              onRemove={() => { setFile(null); clearAll(); }}
            >
              <Button icon={<UploadOutlined />}>Select .xlsx / .xls / .csv</Button>
            </Upload>
          </div>
        </div>
      </Space>

      <Alert
        type="info" showIcon
        style={{ marginBottom: 12 }}
        message={
          <span>
            Import compares incoming headers with template fields using flexible matching (spacing, casing, and common aliases).
            EOL Status also accepts <code>InSupport</code>, <code>EOL</code>, <code>Decom</code>, and <code>Not Applicable</code> (including <code>NA</code>/<code>N/A</code> variants).
          </span>
        }
      />

      <Checkbox
        checked={verifyByIp}
        onChange={(e) => { setVerifyByIp(e.target.checked); clearAll(); }}
        style={{ marginBottom: 12 }}
      >
        Verify if mapped fields differ from existing data (by IP)
        <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
          — when an IP already exists, only empty fields will be filled from the file
        </Typography.Text>
      </Checkbox>

      <div style={{ marginBottom: 16 }}>
        <Space wrap>
          <Button icon={<DownloadOutlined />} onClick={onDownloadTemplate}>Download Template</Button>
          <Button icon={<EyeOutlined />} onClick={onVerifyData} loading={previewing} disabled={!file}>
            Verify Data
          </Button>
          <Button
            icon={<CheckCircleOutlined />}
            onClick={() => runImport({ selectedOnly: true })}
            disabled={!preview || !selectedCount || loading}
          >
            Import Selected ({selectedCount})
          </Button>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            onClick={() => runImport({ selectedOnly: false })}
            loading={loading}
            disabled={!file}
          >
            Import to {targetLabel}
          </Button>
        </Space>
      </div>

      {!file && (
        <Upload.Dragger
          name="file"
          multiple={false}
          accept=".xlsx,.xls,.csv"
          beforeUpload={(f) => { setFile(f); clearAll(); return false; }}
          showUploadList={false}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">Click or drag .xlsx / .xls / .csv to attach</p>
          <p className="ant-upload-hint">Max 10 MB. Validation runs in the next step.</p>
        </Upload.Dragger>
      )}

      {err && <Alert type="error" message={err} style={{ marginTop: 16 }} />}

      {preview && (
        <Card type="inner" title="Preview" style={{ marginTop: 16 }} extra={
          <Space>
            <Tag color="blue">Total: {preview.rows.length}</Tag>
            <Tag color="green">Create: {preview.rows.filter(r => !r.errors.length && r.action === 'create').length}</Tag>
            <Tag color="gold">Merge: {preview.rows.filter(r => !r.errors.length && r.action === 'merge').length}</Tag>
            <Tag color="red">Errors: {preview.rows.filter(r => r.errors.length).length}</Tag>
          </Space>
        }>
          <Table
            size="small"
            rowKey="rowIdx"
            dataSource={preview.rows}
            columns={previewColumns}
            rowSelection={rowSelection}
            pagination={{ pageSize: 10 }}
            scroll={{ x: 700 }}
          />
        </Card>
      )}

      {result && (
        <Card type="inner" title="Import Results" style={{ marginTop: 16 }}>
          <Space wrap>
            <Tag color="blue">Selected: {result.selected}</Tag>
            <Tag color="green">Succeeded: {result.success}</Tag>
            <Tag color={result.failed ? 'red' : 'default'}>Failed: {result.failed}</Tag>
          </Space>
          {result.failures?.length > 0 && (
            <Table
              style={{ marginTop: 16 }}
              size="small"
              rowKey={(r) => r.row}
              dataSource={result.failures}
              columns={[
                { title: 'Row', dataIndex: 'row', width: 80 },
                { title: 'Errors', dataIndex: 'errors',
                  render: arr => arr?.map((e, i) => <Tag key={i} color="red">{e}</Tag>) },
                { title: 'Data', dataIndex: 'data',
                  render: d => <code style={{ fontSize: 12 }}>{JSON.stringify(d).slice(0, 200)}</code> },
              ]}
              pagination={{ pageSize: 5 }}
            />
          )}
        </Card>
      )}
    </Card>
  );
}
