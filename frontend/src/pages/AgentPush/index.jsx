import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert, App, Button, Card, Checkbox, Col, Form, Input, Modal, Radio, Row, Select,
  Space, Spin, Statistic, Table, Tag, Typography, Upload,
} from 'antd';
import {
  CheckCircleFilled, CloseCircleFilled, ClockCircleFilled, CloudUploadOutlined,
  MinusCircleFilled, PlusOutlined, ReloadOutlined, RocketOutlined, SettingOutlined,
  SyncOutlined, UploadOutlined, WindowsOutlined,
} from '@ant-design/icons';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';
import { DASH_CSS, StatCard } from '../../components/DashboardStatCard.jsx';

const JOB_STATUS_META = {
  pending:   { color: 'default',    label: 'Pending' },
  running:   { color: 'processing', label: 'Running' },
  completed: { color: 'success',    label: 'Completed' },
};
const TARGET_STATUS_META = {
  pending: { color: 'default',    label: 'Pending',   icon: <ClockCircleFilled /> },
  running: { color: 'processing', label: 'Running',   icon: <SyncOutlined spin /> },
  success: { color: 'success',    label: 'Success',   icon: <CheckCircleFilled /> },
  skipped: { color: 'blue',       label: 'Skipped',   icon: <MinusCircleFilled /> },
  failed:  { color: 'error',      label: 'Failed',    icon: <CloseCircleFilled /> },
};
const isWindows = (t) => /windows/i.test(t || '');

function TerminalBox({ children }) {
  return (
    <pre style={{
      background: '#1a1a2e', color: '#e0e0e0', borderRadius: 6,
      padding: '10px 14px', fontSize: 12, lineHeight: 1.6, margin: 0,
      maxHeight: 320, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    }}>
      {children || '(no output yet)'}
    </pre>
  );
}

export default function AgentPush() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const isAdmin = ['admin', 'superadmin'].includes(user?.role);

  const [jobs, setJobs]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [newJobOpen, setNewJobOpen] = useState(false);
  const [detail, setDetail]     = useState({ open: false, jobId: null, job: null });
  const pollRef = useRef(null);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/agent-push/jobs');
      setJobs(data.jobs || []);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load jobs');
    } finally { setLoading(false); }
  }, []); // eslint-disable-line

  useEffect(() => { loadJobs(); }, [loadJobs]);

  const openDetail = useCallback(async (jobId) => {
    setDetail({ open: true, jobId, job: null });
    try {
      const { data } = await api.get(`/agent-push/jobs/${jobId}`);
      setDetail({ open: true, jobId, job: data });
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to load job');
    }
  }, []); // eslint-disable-line

  // Poll the open job's status every 3s while it's still in progress.
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!detail.open || !detail.jobId) return;

    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/agent-push/jobs/${detail.jobId}/status`);
        setDetail((prev) => {
          if (!prev.job || prev.jobId !== detail.jobId) return prev;
          const targetsById = new Map(data.targets.map((t) => [t.id, t]));
          return {
            ...prev,
            job: {
              ...prev.job,
              status: data.job_status,
              targets: prev.job.targets.map((t) => ({ ...t, ...targetsById.get(t.id) })),
            },
          };
        });
        if (data.job_status === 'completed') {
          clearInterval(pollRef.current);
          loadJobs();
        }
      } catch { /* a missed poll tick isn't worth surfacing */ }
    }, 3000);

    return () => clearInterval(pollRef.current);
  }, [detail.open, detail.jobId]); // eslint-disable-line

  const closeDetail = () => { setDetail({ open: false, jobId: null, job: null }); loadJobs(); };

  const runningCount = jobs.filter((j) => j.status === 'running').length;

  const jobColumns = [
    { title: 'ID', dataIndex: 'id', width: 70 },
    { title: 'Created', dataIndex: 'created_at', width: 170, render: (v) => v ? new Date(v).toLocaleString() : '—' },
    {
      title: 'OS', dataIndex: 'os_type', width: 110,
      render: (t) => <Tag icon={isWindows(t) ? <WindowsOutlined /> : null} color={isWindows(t) ? 'blue' : 'default'}>{t}</Tag>,
    },
    { title: 'Location', dataIndex: 'location_name', width: 160 },
    { title: 'Targets', dataIndex: 'target_count', width: 90, align: 'right' },
    {
      title: 'Status', dataIndex: 'status', width: 120,
      render: (s) => <Tag color={(JOB_STATUS_META[s] || {}).color}>{(JOB_STATUS_META[s] || {}).label || s}</Tag>,
    },
    {
      title: '', width: 100,
      render: (_, r) => <Button size="small" onClick={() => openDetail(r.id)}>View</Button>,
    },
  ];

  return (
    <div>
      <style>{DASH_CSS}</style>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <Space align="start">
          <RocketOutlined style={{ fontSize: 24, color: '#1677ff', marginTop: 3 }} />
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>Agent Push</Typography.Title>
            <Typography.Text type="secondary">Bulk ME Agent deployment — paste a target list, push, and watch live progress</Typography.Text>
          </div>
        </Space>
        <Space>
          {isAdmin && (
            <Link to="/admin/agent-push-locations"><Button icon={<SettingOutlined />}>Locations</Button></Link>
          )}
          {isAdmin && (
            <Link to="/admin/agent-push-credentials"><Button icon={<SettingOutlined />}>Credentials</Button></Link>
          )}
          <Button icon={<ReloadOutlined />} onClick={loadJobs} loading={loading}>Refresh</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setNewJobOpen(true)}>New Deployment</Button>
        </Space>
      </div>

      <Row gutter={16} style={{ marginBottom: 20 }}>
        <Col xs={12} sm={8}>
          <StatCard index={0} title="Total Jobs" value={jobs.length} icon={<RocketOutlined />} color="#1677ff" bg="rgba(22,119,255,0.12)" />
        </Col>
        <Col xs={12} sm={8}>
          <StatCard index={1} title="Running Now" value={runningCount} icon={<SyncOutlined spin={runningCount > 0} />} color="#faad14" bg="rgba(250,173,20,0.12)" />
        </Col>
      </Row>

      <Table rowKey="id" loading={loading} dataSource={jobs} columns={jobColumns} pagination={{ pageSize: 20 }} size="middle" />

      <NewJobModal
        open={newJobOpen}
        onClose={() => setNewJobOpen(false)}
        onCreated={(jobId) => { setNewJobOpen(false); loadJobs(); openDetail(jobId); }}
      />

      <Modal
        open={detail.open}
        title={<Space><RocketOutlined />Deployment #{detail.jobId}</Space>}
        onCancel={closeDetail}
        footer={<Button type="primary" onClick={closeDetail}>Close</Button>}
        width={800}
        destroyOnClose
      >
        {!detail.job ? <Spin /> : <JobDetail job={detail.job} />}
      </Modal>
    </div>
  );
}

function JobDetail({ job }) {
  const [expanded, setExpanded] = useState([]);
  const meta = JOB_STATUS_META[job.status] || {};
  const counts = job.targets.reduce((acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {});

  const columns = [
    { title: 'Target', dataIndex: 'ip_or_host', width: 180 },
    {
      title: 'Status', dataIndex: 'status', width: 130,
      render: (s) => {
        const m = TARGET_STATUS_META[s] || {};
        return <Tag color={m.color} icon={m.icon}>{m.label || s}</Tag>;
      },
    },
    {
      title: '', width: 100,
      render: (_, r) => (
        <Button size="small" type="link"
          onClick={() => setExpanded((p) => p.includes(r.id) ? p.filter((k) => k !== r.id) : [...p, r.id])}>
          {expanded.includes(r.id) ? 'Hide log' : 'View log'}
        </Button>
      ),
    },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Space wrap>
        <Tag color={meta.color}>{meta.label || job.status}</Tag>
        {Object.entries(counts).map(([s, n]) => (
          <Tag key={s} color={(TARGET_STATUS_META[s] || {}).color}>{(TARGET_STATUS_META[s] || {}).label || s}: {n}</Tag>
        ))}
      </Space>
      <Table
        rowKey="id" dataSource={job.targets} columns={columns} pagination={false} size="small"
        expandable={{
          expandedRowKeys: expanded,
          showExpandColumn: false,
          expandedRowRender: (r) => <TerminalBox>{r.log_output}</TerminalBox>,
        }}
      />
    </Space>
  );
}

function NewJobModal({ open, onClose, onCreated }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [locations, setLocations]   = useState([]);
  const [profiles, setProfiles]     = useState([]);
  const osType = Form.useWatch('os_type', form) || 'windows';
  const credChoice = Form.useWatch('credential_choice', form);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    api.get('/agent-push/locations').then((r) => setLocations(r.data.locations || [])).catch(() => setLocations([]));
    api.get('/agent-push/credentials').then((r) => setProfiles(r.data.profiles || [])).catch(() => setProfiles([]));
  }, [open]); // eslint-disable-line

  const filteredProfiles = profiles.filter((p) => p.os_type === osType);

  const handleFileRead = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      const current = form.getFieldValue('ip_list') || '';
      const text = String(reader.result || '');
      form.setFieldValue('ip_list', current.trim() ? `${current}\n${text}` : text);
    };
    reader.readAsText(file);
    return false; // prevent antd's default upload behavior — we just read it locally
  };

  const submit = async (vals) => {
    setSubmitting(true);
    try {
      const payload = {
        os_type: vals.os_type,
        location_id: vals.location_id,
        force_reinstall: !!vals.force_reinstall,
        raw_text: vals.ip_list,
      };
      if (vals.credential_choice === 'adhoc') {
        payload.adhoc_domain = vals.adhoc_domain;
        payload.adhoc_username = vals.adhoc_username;
        payload.adhoc_password = vals.adhoc_password;
      } else if (vals.credential_choice && vals.credential_choice !== 'none') {
        payload.credential_profile_id = Number(vals.credential_choice);
      }
      const { data } = await api.post('/agent-push/jobs', payload);
      message.success(`Deployment #${data.id} started for ${data.targetCount} target(s).`
        + (data.skippedLines?.length ? ` Skipped ${data.skippedLines.length} unparseable line(s).` : ''));
      onCreated(data.id);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to start deployment');
    } finally { setSubmitting(false); }
  };

  return (
    <Modal open={open} onCancel={onClose} title="New Deployment" width={640} destroyOnClose
      footer={[
        <Button key="cancel" onClick={onClose}>Cancel</Button>,
        <Button key="submit" type="primary" icon={<RocketOutlined />} loading={submitting} onClick={() => form.submit()}>
          Start Deployment
        </Button>,
      ]}
    >
      <Form form={form} layout="vertical" onFinish={submit} initialValues={{ os_type: 'windows', credential_choice: 'none' }}>
        <Form.Item name="os_type" label="Operating System">
          <Radio.Group options={[{ label: 'Windows', value: 'windows' }, { label: 'Linux', value: 'linux' }]} optionType="button" />
        </Form.Item>
        <Form.Item name="location_id" label="Location" rules={[{ required: true, message: 'Pick a location' }]}>
          <Select
            placeholder="Select a location"
            options={locations.map((l) => ({
              value: l.id,
              label: `${l.name}${isWindows(osType) ? (l.windows_ready ? '' : ' (no Windows package)') : (l.linux_ready ? '' : ' (no Linux package)')}`,
            }))}
          />
        </Form.Item>
        <Form.Item name="credential_choice" label="Credentials">
          <Select
            options={[
              { value: 'none', label: 'None — every target must supply its own override' },
              { value: 'adhoc', label: 'Ad-hoc, this job only' },
              ...filteredProfiles.map((p) => ({ value: String(p.id), label: p.name })),
            ]}
          />
        </Form.Item>
        {credChoice === 'adhoc' && (
          <Row gutter={12}>
            {isWindows(osType) && (
              <Col span={8}><Form.Item name="adhoc_domain" label="Domain"><Input placeholder="(blank = local)" /></Form.Item></Col>
            )}
            <Col span={isWindows(osType) ? 8 : 12}><Form.Item name="adhoc_username" label="Username"><Input /></Form.Item></Col>
            <Col span={isWindows(osType) ? 8 : 12}><Form.Item name="adhoc_password" label="Password"><Input.Password /></Form.Item></Col>
          </Row>
        )}
        <Form.Item
          name="ip_list" label="Targets" rules={[{ required: true, message: 'Paste at least one target' }]}
          extra="One per line: ip  or  ip,user,pass  or  ip,domain\user,pass,Location  or  ip,user,pass,,linux (mix OS)"
        >
          <Input.TextArea rows={6} placeholder={'192.168.1.10\n192.168.1.11,localadmin,Password123'} style={{ fontFamily: 'monospace' }} />
        </Form.Item>
        <Upload beforeUpload={handleFileRead} showUploadList={false} accept=".txt,.csv">
          <Button icon={<UploadOutlined />} size="small">Upload a target list file</Button>
        </Upload>
        <Form.Item name="force_reinstall" valuePropName="checked" style={{ marginTop: 16 }}>
          <Checkbox>Force reinstall (skip the already-installed check)</Checkbox>
        </Form.Item>
      </Form>
    </Modal>
  );
}
