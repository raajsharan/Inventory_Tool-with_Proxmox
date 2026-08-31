import { useEffect, useState } from 'react';
import {
  Card, Tabs, Alert, Button, Form, Input, InputNumber, Select, Switch, Space, Typography,
  TimePicker, Upload, App, Tag, Table, Divider, Modal, Checkbox, Tooltip,
} from 'antd';
import {
  DatabaseOutlined, FileTextOutlined, DownloadOutlined, UploadOutlined,
  PlayCircleOutlined, SaveOutlined, ReloadOutlined, ExclamationCircleOutlined,
  HistoryOutlined, RollbackOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../api/client';
import { DASH_CSS } from '../../components/DashboardStatCard.jsx';

const CSV_TARGETS = [
  { value: 'assets',                label: 'Asset Inventory',     desc: 'All assets, VM names, IPs, patching status, custom fields' },
  { value: 'ext_assets',            label: 'Extended Inventory',  desc: 'Network devices, switches, printers, UPS records' },
  { value: 'beijing_assets',        label: 'Beijing Asset List',  desc: 'All Beijing assets with VM names, IPs, OS, migration status' },
  { value: 'physical_esxi_servers', label: 'Physical & ESXi',     desc: 'Physical hosts and ESXi servers' },
];

function ScheduleForm({ kind, settings, onSaved }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    form.setFieldsValue({
      enabled: settings.enabled,
      frequency: settings.frequency || 'daily',
      time_24h: settings.time_24h ? dayjs(settings.time_24h, 'HH:mm') : dayjs('09:00', 'HH:mm'),
      day_of_week: settings.day_of_week ?? 1,
      day_of_month: settings.day_of_month ?? 1,
      retain_days: settings.retain_days ?? 14,
      directory: settings.directory || (kind === 'pg' ? '/backups/postgres' : '/backups/csv'),
      file_naming: settings.file_naming || 'timestamped',
      csv_targets: settings.csv_targets || ['assets', 'beijing_assets', 'ext_assets', 'physical_esxi_servers'],
    });
  }, [settings, kind]);

  async function onSubmit(values) {
    setSaving(true);
    try {
      const payload = {
        enabled: !!values.enabled,
        frequency: values.frequency,
        time_24h: values.time_24h ? values.time_24h.format('HH:mm') : '09:00',
        day_of_week: values.day_of_week,
        day_of_month: values.day_of_month,
        retain_days: values.retain_days,
        directory: values.directory,
        file_naming: values.file_naming,
      };
      if (kind === 'csv') payload.csv_targets = values.csv_targets;
      const { data } = await api.put(`/backup/settings/${kind}`, payload);
      message.success('Schedule saved');
      onSaved?.(data);
    } catch (e) {
      message.error(e.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  }

  return (
    <Form form={form} layout="vertical" onFinish={onSubmit}>
      <Space size="large" wrap align="start">
        <Form.Item name="enabled" label="Enable Scheduled Backup" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="frequency" label="Frequency" style={{ minWidth: 160 }}>
          <Select options={[
            { value: 'daily', label: 'Daily' },
            { value: 'weekly', label: 'Weekly' },
            { value: 'monthly', label: 'Monthly' },
          ]} />
        </Form.Item>
        <Form.Item name="time_24h" label="Time (24h)">
          <TimePicker format="HH:mm" minuteStep={5} />
        </Form.Item>
        <Form.Item name="retain_days" label="Retain Backups" tooltip="Days to keep files">
          <InputNumber min={0} max={3650} addonAfter="days" />
        </Form.Item>
      </Space>

      <Form.Item shouldUpdate={(p, c) => p.frequency !== c.frequency} noStyle>
        {({ getFieldValue }) => {
          const f = getFieldValue('frequency');
          if (f === 'weekly') {
            return (
              <Form.Item name="day_of_week" label="Day of Week" style={{ maxWidth: 220 }}>
                <Select options={[
                  { value: 0, label: 'Sunday' }, { value: 1, label: 'Monday' },
                  { value: 2, label: 'Tuesday' }, { value: 3, label: 'Wednesday' },
                  { value: 4, label: 'Thursday' }, { value: 5, label: 'Friday' },
                  { value: 6, label: 'Saturday' },
                ]} />
              </Form.Item>
            );
          }
          if (f === 'monthly') {
            return (
              <Form.Item name="day_of_month" label="Day of Month" style={{ maxWidth: 220 }}>
                <InputNumber min={1} max={28} style={{ width: '100%' }} />
              </Form.Item>
            );
          }
          return null;
        }}
      </Form.Item>

      <Space size="large" wrap align="start">
        <Form.Item name="directory" label={kind === 'pg' ? 'Backup Directory' : 'Export Directory'}
          tooltip="Absolute path on the server" style={{ minWidth: 320 }}>
          <Input />
        </Form.Item>
        <Form.Item name="file_naming" label="File Naming">
          <Select options={[
            { value: 'timestamped', label: 'New file each run (timestamped)' },
            { value: 'overwrite',   label: 'Overwrite single file' },
          ]} />
        </Form.Item>
      </Space>

      {kind === 'csv' && (
        <Form.Item name="csv_targets" label="Tables to export">
          <Checkbox.Group options={CSV_TARGETS.map(t => ({ label: t.label, value: t.value }))} />
        </Form.Item>
      )}

      <Button type="primary" icon={<SaveOutlined />} htmlType="submit" loading={saving}>
        Save Schedule
      </Button>
    </Form>
  );
}

function RunsTable({ kind, runs, onReload }) {
  return (
    <div>
      <Space style={{ marginBottom: 8 }}>
        <Typography.Text strong>Recent runs</Typography.Text>
        <Button size="small" icon={<ReloadOutlined />} onClick={onReload}>Refresh</Button>
      </Space>
      <Table
        size="small" rowKey="id" dataSource={runs} pagination={{ pageSize: 8 }}
        scroll={{ x: 'max-content' }}
        sticky={{ offsetScroll: 0 }}
        columns={[
          { title: 'When', dataIndex: 'started_at', render: v => new Date(v).toLocaleString(), width: 180 },
          { title: 'Trigger', dataIndex: 'trigger', width: 100,
            render: v => <Tag color={v === 'scheduled' ? 'blue' : 'geekblue'}>{v}</Tag> },
          { title: 'Status', dataIndex: 'status', width: 90,
            render: v => <Tag color={v === 'ok' ? 'green' : v === 'error' ? 'red' : 'orange'}>{v}</Tag> },
          { title: 'File', dataIndex: 'file_path', ellipsis: true },
          { title: 'Size', dataIndex: 'file_size', width: 100,
            render: v => v ? `${(v / 1024).toFixed(1)} KB` : '—' },
          { title: 'By', dataIndex: 'triggered_by_name', width: 140,
            render: v => v || <Typography.Text type="secondary">—</Typography.Text> },
          { title: 'Error', dataIndex: 'error', ellipsis: true,
            render: v => v ? <Typography.Text type="danger">{v}</Typography.Text> : '' },
        ]}
      />
    </div>
  );
}

function PgBackupTab() {
  const { message, modal } = App.useApp();
  const [settings, setSettings] = useState(null);
  const [runs, setRuns] = useState([]);
  const [running, setRunning] = useState(false);
  const [restoring, setRestoring] = useState(false);

  async function load() {
    try {
      const [s, r] = await Promise.all([
        api.get('/backup/settings/pg'),
        api.get('/backup/runs/pg'),
      ]);
      setSettings(s.data);
      setRuns(r.data.items || []);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load');
    }
  }
  useEffect(() => { load(); }, []);

  async function onRunNow() {
    setRunning(true);
    try {
      const res = await api.post('/backup/pg/run', null, { responseType: 'blob' });
      const cd = res.headers['content-disposition'] || '';
      const m = /filename="([^"]+)"/.exec(cd);
      const fname = m ? m[1] : 'pg_dump.sql';
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a'); a.href = url; a.download = fname; a.click();
      URL.revokeObjectURL(url);
      message.success('pg_dump completed');
      load();
    } catch (e) {
      try {
        const text = await e.response?.data?.text?.();
        const parsed = text ? JSON.parse(text) : null;
        message.error(parsed?.error || 'pg_dump failed');
      } catch {
        message.error(e.response?.data?.error || 'pg_dump failed');
      }
    } finally { setRunning(false); }
  }

  function onRestore(file) {
    modal.confirm({
      title: 'Restore from SQL dump?',
      icon: <ExclamationCircleOutlined />,
      content: (
        <div>
          <Typography.Paragraph type="danger" style={{ marginBottom: 8 }}>
            This will <strong>DROP the public schema and restore everything</strong> from the uploaded dump.
            All current data will be replaced.
          </Typography.Paragraph>
          <Typography.Text>File: <code>{file.name}</code></Typography.Text>
        </div>
      ),
      okType: 'danger',
      okText: 'Yes, replace everything',
      onOk: async () => {
        setRestoring(true);
        try {
          const form = new FormData();
          form.append('file', file);
          await api.post('/backup/pg/restore', form, { headers: { 'Content-Type': 'multipart/form-data' } });
          message.success('Database restored');
          load();
        } catch (e) {
          message.error(e.response?.data?.error || 'Restore failed');
        } finally { setRestoring(false); }
      },
    });
    return false;
  }

  return (
    <div>
      <Alert
        type="info" showIcon
        message="PostgreSQL Database Backup"
        description={
          <span>
            Creates a full SQL dump of the <code>infrastructure_inventory</code> database using <code>pg_dump</code>.
            The dump file can be used to restore the full database at any point.
            Scheduled backups run on the server; manual backup triggers an immediate download.
            <br /><strong>Requirement:</strong> <code>pg_dump</code>/<code>psql</code> must be installed on the server (standard with PostgreSQL).
          </span>
        }
        style={{ marginBottom: 16 }}
      />

      <Card type="inner" className="dashcard" title={<Space><PlayCircleOutlined /><span>Manual Backup</span></Space>} style={{ marginBottom: 16, animationDelay: '0ms' }}>
        <Space wrap>
          <Button type="primary" icon={<DatabaseOutlined />} onClick={onRunNow} loading={running}>
            Download SQL Dump Now
          </Button>
          <Upload
            accept=".sql"
            beforeUpload={onRestore}
            showUploadList={false}
            disabled={restoring}
          >
            <Button danger icon={<UploadOutlined />} loading={restoring}>
              Restore from SQL Dump
            </Button>
          </Upload>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          Generates a full pg_dump and immediately downloads it as a .sql file. Restore drops and recreates the public schema.
        </Typography.Paragraph>
      </Card>

      <Card type="inner" className="dashcard" title={<Space><SaveOutlined /><span>Backup Schedule</span></Space>} style={{ marginBottom: 16, animationDelay: '60ms' }}>
        <ScheduleForm kind="pg" settings={settings} onSaved={() => load()} />
        {settings?.enabled && (
          <Alert type="success" showIcon style={{ marginTop: 12 }}
            message={`Schedule: ${settings.frequency} at ${settings.time_24h} · Retain for ${settings.retain_days} days`}
            description="Server-side scheduler is active. No manual cron entry is required." />
        )}
      </Card>

      <RunsTable kind="pg" runs={runs} onReload={load} />
    </div>
  );
}

function CsvExportTab() {
  const { message } = App.useApp();
  const [settings, setSettings] = useState(null);
  const [runs, setRuns] = useState([]);
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState(['assets', 'ext_assets', 'beijing_assets']);

  async function load() {
    try {
      const [s, r] = await Promise.all([
        api.get('/backup/settings/csv'),
        api.get('/backup/runs/csv'),
      ]);
      setSettings(s.data);
      setRuns(r.data.items || []);
      if (Array.isArray(s.data?.csv_targets) && s.data.csv_targets.length) {
        setSelected(s.data.csv_targets);
      }
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load');
    }
  }
  useEffect(() => { load(); }, []);

  async function onRunNow() {
    if (!selected.length) { message.warning('Pick at least one table'); return; }
    setRunning(true);
    try {
      const res = await api.post('/backup/csv/run', { targets: selected }, { responseType: 'blob' });
      const cd = res.headers['content-disposition'] || '';
      const m = /filename="([^"]+)"/.exec(cd);
      const fname = m ? m[1] : (selected.length === 1 ? `${selected[0]}.csv` : 'inventory_export.xlsx');
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a'); a.href = url; a.download = fname; a.click();
      URL.revokeObjectURL(url);
      message.success(selected.length === 1 ? 'CSV downloaded.' : 'XLSX downloaded — one sheet per selected table.');
      load();
    } catch (e) {
      let msg = 'CSV export failed';
      if (e.response?.data instanceof Blob) {
        try { msg = JSON.parse(await e.response.data.text())?.error || msg; } catch { /* not JSON */ }
      } else {
        msg = e.response?.data?.error || msg;
      }
      message.error(msg);
    } finally { setRunning(false); }
  }

  return (
    <div>
      <Alert
        type="info" showIcon
        message="CSV Export"
        description="Export inventory tables to CSV. Selecting one table downloads a .csv; selecting more than one downloads a single .xlsx workbook with one sheet per table. Every export also writes to the server's export directory and appears in run history."
        style={{ marginBottom: 16 }}
      />

      <Card type="inner" className="dashcard" title={<Space><FileTextOutlined /><span>Export Selection</span></Space>} style={{ marginBottom: 16, animationDelay: '0ms' }}>
        <Checkbox.Group
          value={selected}
          onChange={setSelected}
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {CSV_TARGETS.map(t => (
            <Checkbox key={t.value} value={t.value}>
              <strong>{t.label}</strong>
              <Typography.Text type="secondary" style={{ marginLeft: 8 }}>{t.desc}</Typography.Text>
            </Checkbox>
          ))}
        </Checkbox.Group>
        <Divider style={{ margin: '12px 0' }} />
        <Button type="primary" icon={<DownloadOutlined />} onClick={onRunNow} loading={running}>
          Export Selected CSVs Now
        </Button>
      </Card>

      <Card type="inner" className="dashcard" title={<Space><SaveOutlined /><span>Export Schedule</span></Space>} style={{ marginBottom: 16, animationDelay: '60ms' }}>
        <ScheduleForm kind="csv" settings={settings} onSaved={() => load()} />
      </Card>

      <RunsTable kind="csv" runs={runs} onReload={load} />
    </div>
  );
}

function RestoreByDateTab() {
  const { message, modal } = App.useApp();
  const [table, setTable] = useState('assets');
  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [mode, setMode] = useState('replace');
  const [restoring, setRestoring] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);

  async function loadFiles() {
    setLoadingFiles(true);
    try {
      const { data } = await api.get('/backup/csv/files', { params: { table } });
      setFiles(data.files || []);
      setSelectedFile(null);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to list backup files');
    } finally { setLoadingFiles(false); }
  }
  useEffect(() => { loadFiles(); }, [table]); // eslint-disable-line

  function confirmAndRun(action, summary) {
    modal.confirm({
      title: `Restore ${CSV_TARGETS.find(t => t.value === table)?.label || table}?`,
      icon: <ExclamationCircleOutlined />,
      okType: 'danger',
      okText: 'Yes, restore',
      content: (
        <div>
          {mode === 'replace' && (
            <Typography.Paragraph type="danger" style={{ marginBottom: 8 }}>
              <strong>Replace All</strong> will TRUNCATE the {table} table and reload from the backup.
              All current rows in this inventory will be deleted.
            </Typography.Paragraph>
          )}
          {mode === 'merge' && (
            <Typography.Paragraph style={{ marginBottom: 8 }}>
              <strong>Merge</strong> upserts each backup row by primary key (id). Existing rows are
              updated; new rows are inserted; rows in the DB that aren't in the backup remain.
            </Typography.Paragraph>
          )}
          <div>{summary}</div>
        </div>
      ),
      onOk: action,
    });
  }

  async function onRestoreHistorical() {
    if (!selectedFile) { message.warning('Pick a backup first'); return; }
    confirmAndRun(async () => {
      setRestoring(true);
      try {
        const { data } = await api.post('/backup/csv/restore', {
          table, filename: selectedFile, mode,
        });
        message.success(`Restored: ${data.inserted}/${data.totalRows} rows (skipped ${data.skipped})`);
      } catch (e) {
        message.error(e.response?.data?.error || 'Restore failed');
      } finally { setRestoring(false); }
    }, <span>Backup: <code>{selectedFile}</code></span>);
  }

  async function onRestoreUpload() {
    if (!uploadFile) { message.warning('Pick a CSV file to upload'); return; }
    confirmAndRun(async () => {
      setRestoring(true);
      try {
        const form = new FormData();
        form.append('file', uploadFile);
        form.append('table', table);
        form.append('mode', mode);
        const { data } = await api.post('/backup/csv/restore-upload', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        message.success(`Restored: ${data.inserted}/${data.totalRows} rows (skipped ${data.skipped})`);
        setUploadFile(null);
      } catch (e) {
        message.error(e.response?.data?.error || 'Restore failed');
      } finally { setRestoring(false); }
    }, <span>Upload: <code>{uploadFile.name}</code></span>);
  }

  return (
    <div>
      <Alert
        type="warning" showIcon
        message="Restore an inventory from a CSV backup"
        description="Pick which inventory and a backup date (from the server's CSV export directory). Replace All wipes and reloads; Merge upserts rows by id."
        style={{ marginBottom: 16 }}
      />

      <Card type="inner" className="dashcard" style={{ marginBottom: 16, animationDelay: '0ms' }} title={<Space><RollbackOutlined /><span>Choose target</span></Space>}>
        <Space size={16} wrap>
          <div>
            <Typography.Text strong>Inventory</Typography.Text>
            <div>
              <Select
                value={table}
                onChange={setTable}
                style={{ minWidth: 240 }}
                options={CSV_TARGETS.map(t => ({ value: t.value, label: t.label }))}
              />
            </div>
          </div>
          <div>
            <Typography.Text strong>Mode</Typography.Text>
            <div>
              <Select
                value={mode}
                onChange={setMode}
                style={{ minWidth: 240 }}
                options={[
                  { value: 'replace', label: 'Replace All (TRUNCATE + reload)' },
                  { value: 'merge',   label: 'Merge (upsert by id)' },
                ]}
              />
            </div>
          </div>
        </Space>
      </Card>

      <Card type="inner" className="dashcard" style={{ marginBottom: 16, animationDelay: '60ms' }}
        title={<Space><HistoryOutlined /><span>Restore from a historical backup</span></Space>}
        extra={<Tooltip title="Reload the list of available backup files"><Button size="small" icon={<ReloadOutlined />} onClick={loadFiles}>Refresh list</Button></Tooltip>}
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
          Files are read from the CSV export directory on the server. Run a CSV export first to populate this list.
        </Typography.Paragraph>
        <Table
          size="small"
          rowKey="filename"
          loading={loadingFiles}
          dataSource={files}
          pagination={{ pageSize: 10 }}
          rowSelection={{
            type: 'radio',
            selectedRowKeys: selectedFile ? [selectedFile] : [],
            onChange: (keys) => setSelectedFile(keys[0]),
          }}
          columns={[
            { title: 'Taken at', dataIndex: 'takenAt', width: 200,
              render: v => new Date(v).toLocaleString() },
            { title: 'File',     dataIndex: 'filename', ellipsis: true },
            { title: 'Size',     dataIndex: 'size', width: 100,
              render: v => v ? `${(v / 1024).toFixed(1)} KB` : '—' },
          ]}
        />
        <Button
          type="primary" danger
          icon={<RollbackOutlined />}
          loading={restoring}
          disabled={!selectedFile}
          onClick={onRestoreHistorical}
          style={{ marginTop: 8 }}
        >
          Restore selected backup
        </Button>
      </Card>

      <Card type="inner" className="dashcard" style={{ animationDelay: '120ms' }} title={<Space><UploadOutlined /><span>Restore from uploaded CSV</span></Space>}>
        <Upload
          accept=".csv"
          maxCount={1}
          beforeUpload={(f) => { setUploadFile(f); return false; }}
          fileList={uploadFile ? [{ uid: '1', name: uploadFile.name, status: 'done' }] : []}
          onRemove={() => setUploadFile(null)}
        >
          <Button icon={<UploadOutlined />}>Select .csv file</Button>
        </Upload>
        <Button
          type="primary" danger
          icon={<RollbackOutlined />}
          loading={restoring}
          disabled={!uploadFile}
          onClick={onRestoreUpload}
          style={{ marginTop: 12 }}
        >
          Restore from upload
        </Button>
      </Card>
    </div>
  );
}

export default function AdminBackup() {
  return (
    <Card className="dashcard" title={<Space><DatabaseOutlined style={{ color: '#1677ff' }} /><Typography.Title level={4} style={{ margin: 0 }}>Backup / Export &amp; Import</Typography.Title></Space>}>
      <style>{DASH_CSS}</style>
      <Tabs
        items={[
          { key: 'pg',  label: <span><DatabaseOutlined /> PostgreSQL Backup</span>, children: <PgBackupTab /> },
          { key: 'csv', label: <span><FileTextOutlined /> CSV Export</span>,        children: <CsvExportTab /> },
          { key: 'restore', label: <span><RollbackOutlined /> Restore by Date</span>, children: <RestoreByDateTab /> },
        ]}
      />
    </Card>
  );
}
