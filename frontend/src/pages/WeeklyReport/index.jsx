import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Card, Col, Row, Select, Typography, Empty, Spin, Table, Tag, Space, Statistic, Button, App,
  Tabs, Input, Modal, Popconfirm, Progress, Popover, List, theme, Switch, Alert,
} from 'antd';
import {
  FileTextOutlined, ReloadOutlined, EditOutlined, SaveOutlined, PlusOutlined, DeleteOutlined,
  CheckCircleOutlined, SyncOutlined, ClockCircleOutlined, DatabaseOutlined, ClusterOutlined, StopOutlined,
  NotificationOutlined, SendOutlined, SettingOutlined,
} from '@ant-design/icons';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';
import { DASH_CSS } from '../../components/DashboardStatCard.jsx';

const { Title, Text, Paragraph } = Typography;

function pctText(n, d, p) {
  return `${(n ?? 0).toLocaleString()} / ${(d ?? 0).toLocaleString()} = ${p ?? 0}%`;
}

function AssetInventorySection({ data }) {
  return (
    <>
      <Title level={5} style={{ marginTop: 0 }}>MSL Overall Active Count Status</Title>
      <Paragraph>
        Overall Asset Inventory: <strong>{pctText(data.combinedNumerator, data.combinedDenominator, data.combinedPct)}</strong>
      </Paragraph>
      <Paragraph style={{ marginBottom: 4 }}>
        Total decommissioned: <strong>{(data.decommissioned ?? 0).toLocaleString()}</strong>
      </Paragraph>
      <Text type="secondary">From active inventory, pending/follow-ups:</Text>
      <ul style={{ marginTop: 4 }}>
        <li><strong>{(data.noPassword ?? 0).toLocaleString()}</strong> assets do not have password info.</li>
        <li><strong>{(data.noHostedIp ?? 0).toLocaleString()}</strong> active assets are missing hosted/hypervisor details.</li>
        <li><strong>{(data.nameConflicts ?? 0).toLocaleString()}</strong> endpoints currently have name conflicts from OS Hostname.</li>
      </ul>
      <Text underline strong style={{ display: 'block', marginTop: 12, marginBottom: 8 }}>Location-wise endpoint count:</Text>
      <div className="weekly-breakdown-card" style={{ width: 'fit-content', maxWidth: '100%' }}>
        <Table
          rowKey="location"
          size="small"
          dataSource={data.locations || []}
          pagination={false}
          columns={[
            { title: 'Location', dataIndex: 'location' },
            { title: 'Count', dataIndex: 'count', align: 'right', render: v => <strong>{(v ?? 0).toLocaleString()}</strong> },
          ]}
          summary={(rows) => {
            if (!rows.length) return null;
            const grand = rows.reduce((s, r) => s + (r.count ?? 0), 0);
            return (
              <Table.Summary.Row style={{ fontWeight: 700 }}>
                <Table.Summary.Cell index={0}>Grand Total</Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">{grand.toLocaleString()}</Table.Summary.Cell>
              </Table.Summary.Row>
            );
          }}
        />
      </div>
    </>
  );
}

function NessusSection({ data }) {
  const rows = [
    { key: 'applicable', slNo: 1, description: 'Nessus Applicable', ...data.applicable, count: data.applicable?.total ?? 0 },
    { key: 'not_applicable', slNo: 2, description: 'Nessus Not Applicable', ...data.notApplicable, count: data.notApplicable?.total ?? 0 },
  ];
  return (
    <>
      <div className="weekly-breakdown-card" style={{ width: 'fit-content', maxWidth: '100%' }}>
        <Table
          rowKey="key"
          size="small"
          dataSource={rows}
          pagination={false}
          scroll={{ x: 'max-content' }}
          columns={[
            { title: 'Sl. No', dataIndex: 'slNo', width: 60 },
            { title: 'Description', dataIndex: 'description' },
            { title: 'Assets Inventory', dataIndex: 'mslAssets', align: 'right', render: v => (v ?? 0).toLocaleString() },
            { title: 'Ext. Inventory', dataIndex: 'extAssets', align: 'right', render: v => (v ?? 0).toLocaleString() },
            { title: 'Beijing Inventory', dataIndex: 'beijingAssets', align: 'right', render: v => (v ?? 0).toLocaleString() },
            { title: 'Physical & ESXi Inventory', dataIndex: 'physicalEsxi', align: 'right', render: v => (v ?? 0).toLocaleString() },
            { title: 'Total Count', dataIndex: 'count', align: 'right', render: v => <strong>{(v ?? 0).toLocaleString()}</strong> },
          ]}
        />
      </div>
      <Paragraph style={{ marginTop: 12 }}>
        <strong>Nessus Compliance Percentage</strong> = {pctText(data.applicable?.installed, data.applicable?.total, data.compliancePct)}
      </Paragraph>
    </>
  );
}

function BreakdownTable({ breakdown, groupLabel }) {
  if (!breakdown?.rows?.length) return <Empty description="No data" style={{ padding: '20px 0' }} />;
  const columns = [
    { title: groupLabel, dataIndex: 'bucket', render: v => <strong>{v}</strong> },
    ...breakdown.columns.map((title, i) => ({
      title, key: `c${i}`, align: 'center', render: (_, r) => r.values[i]?.toLocaleString() ?? '-',
    })),
    { title: 'Total', dataIndex: 'total', align: 'center', render: v => <strong>{(v ?? 0).toLocaleString()}</strong> },
    { title: 'Percentage', dataIndex: 'pct', align: 'center', render: v => <strong>{v}%</strong> },
  ];
  return (
    <Table
      rowKey="bucket"
      size="small"
      dataSource={breakdown.rows}
      columns={columns}
      pagination={false}
      scroll={{ x: 'max-content' }}
      summary={() => (
        <Table.Summary.Row style={{ fontWeight: 700 }}>
          <Table.Summary.Cell index={0}>Total</Table.Summary.Cell>
          {breakdown.columns.map((_, i) => (
            <Table.Summary.Cell key={i} index={i + 1} align="center">
              {breakdown.totals.values[i]?.toLocaleString() ?? '-'}
            </Table.Summary.Cell>
          ))}
          <Table.Summary.Cell index={breakdown.columns.length + 1} align="center">{breakdown.totals.total.toLocaleString()}</Table.Summary.Cell>
          <Table.Summary.Cell index={breakdown.columns.length + 2} align="center">{breakdown.totals.pct}%</Table.Summary.Cell>
        </Table.Summary.Row>
      )}
    />
  );
}

function PatchManagementSection({ data }) {
  return (
    <>
      <Space size={24} wrap style={{ marginBottom: 16 }}>
        <Statistic title="Managed computers" value={data.managedComputers} />
        <Statistic title="Waiting computers" value={data.waitingComputers} valueStyle={{ color: '#fa8c16' }} />
      </Space>

      <Text underline strong style={{ display: 'block', marginBottom: 8 }}>Location-wise Auto/Manual patching status:</Text>
      <Card size="small" className="weekly-breakdown-card" bodyStyle={{ padding: 0 }} style={{ marginBottom: 20, width: 'fit-content', maxWidth: '100%' }}>
        <BreakdownTable breakdown={data.locationPatching} groupLabel="Location" />
      </Card>

      <Text underline strong style={{ display: 'block', marginBottom: 8 }}>Departments Patching Onboarding Status:</Text>
      <Card size="small" className="weekly-breakdown-card" bodyStyle={{ padding: 0 }} style={{ marginBottom: 20, width: 'fit-content', maxWidth: '100%' }}>
        <BreakdownTable breakdown={data.departmentPatching} groupLabel="Department" />
      </Card>

      <Text underline strong style={{ display: 'block', marginBottom: 8 }}>Auto Patching Group Count Status:</Text>
      <Paragraph>
        <strong>ManageEngine Compliance (MSL + Extended Inventory):</strong>{' '}
        {pctText(data.meCompliance?.combinedYes, data.meCompliance?.combinedDen, data.meCompliance?.combinedPct)}
      </Paragraph>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>{data.meCompliance?.footnote}</Text>
      <Card size="small" className="weekly-breakdown-card" bodyStyle={{ padding: 0 }} style={{ width: 'fit-content', maxWidth: '100%' }}>
        <Table
          rowKey="bucket"
          size="small"
          dataSource={data.meCompliance?.rows || []}
          pagination={false}
          scroll={{ x: 'max-content' }}
          columns={[
            { title: 'Patching Type', dataIndex: 'bucket' },
            { title: 'No', dataIndex: 'no_me', align: 'center' },
            { title: 'Yes', dataIndex: 'yes_me', align: 'center' },
            { title: 'Total', dataIndex: 'total', align: 'center', render: v => <strong>{v}</strong> },
          ]}
        />
      </Card>
    </>
  );
}

function migrationPct(n, total) {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

// Same visual as Migration Tracker's own MigrationOverview.jsx (progress
// bar, host tiles, per-source cards with status tags) — but purely
// presentational off the `data` this section already carries, rather than
// that component's own live self-fetch. A past week's archived snapshot
// must keep showing what was true then, not re-fetch today's numbers.
function MigrationSection({ data }) {
  const { token } = theme.useToken();
  const hosts = data.hosts || {};
  const totalVMs = data.totalVMs ?? 0;
  const migrated = data.migrated ?? 0;
  const remaining = data.remaining ?? Math.max(0, totalVMs - migrated);
  const migrPct = migrationPct(migrated, totalVMs);
  const groups = [
    { label: 'Bomgar VMs', d: data.bomgar || {} },
    { label: 'Security VMs', d: data.security || {} },
    { label: 'Standalone ESXi', d: data.standalone || {} },
  ];

  return (
    <div>
      <Card size="small" className="migration-card" style={{ marginBottom: 20 }}>
        <Row gutter={24} align="middle">
          <Col flex="auto">
            <Progress
              percent={migrPct}
              strokeColor={{ '0%': '#1677ff', '100%': '#52c41a' }}
              format={() => `${migrated} / ${totalVMs} VMs migrated`}
              strokeWidth={16}
            />
          </Col>
          <Col>
            <Statistic title="Remaining" value={remaining} suffix="VMs"
              valueStyle={{ color: remaining ? token.colorWarning : token.colorSuccess }} />
          </Col>
        </Row>
      </Card>

      <Text strong style={{ display: 'block', marginBottom: 8 }}>Hosts</Text>
      <Row gutter={12} style={{ marginBottom: 20 }}>
        {[
          { title: 'Total Hosts', value: hosts.total_hosts, icon: <DatabaseOutlined />, color: undefined },
          { title: 'Fully Migrated', value: hosts.fully_migrated, icon: <CheckCircleOutlined />, color: '#52c41a' },
          { title: 'Pending Vacate', value: hosts.pending_vacate, icon: <ClockCircleOutlined />, color: '#fa8c16' },
          { title: 'VMs to Migrate', value: totalVMs, icon: <ClusterOutlined />, color: undefined },
        ].map((s) => (
          <Col key={s.title} xs={12} sm={6}>
            <Card size="small" className="migration-card">
              <Statistic title={s.title} value={s.value ?? 0} prefix={s.icon} valueStyle={s.color ? { color: s.color } : {}} />
            </Card>
          </Col>
        ))}
      </Row>

      <Text strong style={{ display: 'block', marginBottom: 8 }}>VMs by Source</Text>
      <Row gutter={12}>
        {groups.map(({ label, d }) => (
          <Col key={label} xs={24} sm={8}>
            <Card size="small" className="migration-card" title={label}>
              <Row gutter={8}>
                <Col span={12}>
                  <Statistic title="Total" value={d.total ?? 0} />
                </Col>
                <Col span={12}>
                  <Statistic title="Migrated" value={d.migrated ?? 0} valueStyle={{ color: '#52c41a' }} prefix={<CheckCircleOutlined />} />
                </Col>
              </Row>
              <Progress
                percent={migrationPct((d.migrated ?? 0) + (d.cleaned_up ?? 0), d.total)}
                size="small"
                style={{ marginTop: 8 }}
                strokeColor="#52c41a"
                format={(percent) => <span style={{ fontSize: 20 }}>{percent}%</span>}
              />
              <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {d.not_started > 0 && (
                  <Tag color="default" icon={<ClockCircleOutlined />}>{d.not_started} Not Started</Tag>
                )}
                {d.awaiting_confirmation > 0 && (
                  <Tag color="warning" icon={<ClockCircleOutlined />}>{d.awaiting_confirmation} Awaiting</Tag>
                )}
                {d.in_progress > 0 && (
                  <Popover
                    title={<span><SyncOutlined spin style={{ color: '#1677ff', marginRight: 6 }} />In Progress VMs</span>}
                    content={
                      <List
                        size="small"
                        dataSource={d.in_progress_vms || []}
                        style={{ maxHeight: 260, overflowY: 'auto', minWidth: 200, maxWidth: 320 }}
                        renderItem={vm => (
                          <List.Item style={{ padding: '3px 0', fontSize: 12 }}>
                            <Text ellipsis style={{ maxWidth: 300 }}>{vm}</Text>
                          </List.Item>
                        )}
                      />
                    }
                    trigger="hover"
                    placement="bottomLeft"
                    getPopupContainer={() => document.body}
                  >
                    <Tag color="processing" icon={<SyncOutlined spin />} style={{ cursor: 'pointer' }}>
                      {d.in_progress} In Progress
                    </Tag>
                  </Popover>
                )}
                {d.cleaned_up > 0 && (
                  <Tag color="cyan" icon={<CheckCircleOutlined />}>{d.cleaned_up} Cleaned up</Tag>
                )}
                {d.to_be_deleted > 0 && (
                  <Tag color="orange" icon={<DeleteOutlined />}>{d.to_be_deleted} To be Deleted</Tag>
                )}
                {d.blocked > 0 && (
                  <Tag color="error" icon={<StopOutlined />}>{d.blocked} Blocked</Tag>
                )}
              </div>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}

const AUTO_RENDERERS = {
  asset_inventory: AssetInventorySection,
  nessus_agent: NessusSection,
  patch_management: PatchManagementSection,
  migration_project: MigrationSection,
};

function SectionContent({ section }) {
  const Renderer = section.kind === 'auto' ? AUTO_RENDERERS[section.section_key] : null;
  if (Renderer) return <Renderer data={section.data} />;
  return section.data?.content
    ? <div style={{ whiteSpace: 'pre-wrap' }}>{section.data.content}</div>
    : <Text type="secondary" italic>No content yet.</Text>;
}

// ── The report itself: one row per section (Sl. No / Section / Content),
// matching the source Confluence-style report's layout instead of a
// Card-per-section stack. Rows fade in with a short stagger, and a colored
// tag marks whether a row is computed from live data or hand-maintained.
function ReportTable({ sections }) {
  const columns = [
    { title: 'Sl. No', width: 64, align: 'center', render: (_, __, i) => i + 1 },
    {
      title: 'Section',
      dataIndex: 'title',
      width: 260,
      render: (title, section) => (
        <Space direction="vertical" size={4}>
          <Text strong>{title}</Text>
          <Tag color={section.kind === 'auto' ? 'blue' : 'gold'} style={{ width: 'fit-content', margin: 0 }}>
            {section.kind === 'auto' ? 'Auto' : 'Manual'}
          </Tag>
        </Space>
      ),
    },
    {
      title: 'Content',
      dataIndex: 'content',
      render: (_, section) => <SectionContent section={section} />,
    },
  ];
  return (
    <Table
      className="weekly-report-table"
      rowKey="section_key"
      rowClassName="dashcard-row"
      columns={columns}
      dataSource={sections}
      pagination={false}
      bordered
      scroll={{ x: 'max-content' }}
      onRow={(_, index) => ({
        style: { animation: 'dashcard-fadein 0.4s cubic-bezier(0.22,1,0.36,1) both', animationDelay: `${Math.min(index, 14) * 40}ms` },
      })}
    />
  );
}

// ── Manage Inputs tab — the narrative/manual content the report can't
// compute automatically. Open to anyone who can see this page, not just
// admins — this is collaboratively maintained content, same as anything
// else on the Weekly Report.
function SectionEditor({ section, index, onSaved, onDeleted }) {
  const { message } = App.useApp();
  const [value, setValue] = useState(section.content || '');
  const [saving, setSaving] = useState(false);
  const dirty = value !== (section.content || '');

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put(`/weekly-report/manual-sections/${section.section_key}`, { content: value });
      message.success(`"${section.title}" saved`);
      onSaved(data);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await api.delete(`/weekly-report/manual-sections/${section.section_key}`);
      message.success(`"${section.title}" removed from the report`);
      onDeleted(section.section_key);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to remove section');
    }
  };

  return (
    <Card
      className="dashcard"
      style={{ marginBottom: 16, animationDelay: `${(index ?? 0) * 40}ms` }}
      title={section.title}
      extra={
        <Space size={12}>
          {section.updated_at && <Text type="secondary" style={{ fontSize: 12 }}>Last updated {new Date(section.updated_at).toLocaleString()}</Text>}
          <Popconfirm
            title="Remove this section?"
            description="It will no longer appear on the report."
            okText="Remove"
            okButtonProps={{ danger: true }}
            onConfirm={remove}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      }
    >
      <Input.TextArea
        value={value}
        onChange={e => setValue(e.target.value)}
        autoSize={{ minRows: 4, maxRows: 20 }}
        placeholder="Type this section's content — bullet lines, notes, links, or a small table typed as plain text."
      />
      <Space style={{ marginTop: 12 }}>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!dirty} onClick={save}>
          Save
        </Button>
      </Space>
    </Card>
  );
}

function AddSectionModal({ open, onClose, onCreated }) {
  const { message } = App.useApp();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim()) { message.error('Title is required'); return; }
    setSaving(true);
    try {
      const { data } = await api.post('/weekly-report/manual-sections', { title: title.trim(), content });
      message.success(`"${data.title}" added`);
      onCreated(data);
      setTitle('');
      setContent('');
      onClose();
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to add section');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Add report section"
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText="Add"
      confirmLoading={saving}
      destroyOnClose
    >
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <div>
          <Text strong style={{ display: 'block', marginBottom: 4 }}>Title</Text>
          <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Backup Verification" maxLength={255} />
        </div>
        <div>
          <Text strong style={{ display: 'block', marginBottom: 4 }}>Content (optional — can be filled in later)</Text>
          <Input.TextArea value={content} onChange={e => setContent(e.target.value)} autoSize={{ minRows: 3, maxRows: 10 }} />
        </div>
      </Space>
    </Modal>
  );
}

function ManageInputsPanel() {
  const { message } = App.useApp();
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/weekly-report/manual-sections')
      .then(r => setSections(r.data || []))
      .catch(() => message.error('Failed to load Weekly Report sections'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  const onSaved = (updated) => {
    setSections(prev => prev.map(s => s.section_key === updated.section_key ? updated : s));
  };
  const onCreated = (created) => {
    setSections(prev => [...prev, created].sort((a, b) => a.sort_order - b.sort_order));
  };
  const onDeleted = (sectionKey) => {
    setSections(prev => prev.filter(s => s.section_key !== sectionKey));
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 20 }}>
        <Text type="secondary">
          Content for the sections the Weekly Report can't compute automatically — BAU activities, SOP
          count, licenses, migration challenges, and so on. Whatever is saved here is what the next
          Wednesday snapshot (and the live "Current" preview) will show for that section.
        </Text>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)} style={{ flexShrink: 0 }}>
          Add Section
        </Button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin /></div>
      ) : (
        sections.map((s, i) => (
          <SectionEditor key={s.section_key} section={s} index={i} onSaved={onSaved} onDeleted={onDeleted} />
        ))
      )}

      <AddSectionModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={onCreated} />
    </div>
  );
}

// ── Teams Notification tab — this app already has one shared Teams webhook
// (Admin → Teams Notifications: URL, master enable switch, per-event
// toggles) used for asset changes, migration status, and host connectivity
// alerts. Rather than a second, separate webhook to configure, this panel
// just adds the Weekly Report's own on/off toggle to that shared config and
// surfaces its status here — the actual POST to Teams happens from
// weeklyReportService.js -> teamsNotificationService.notifyWeeklyReport()
// whenever a snapshot is generated (scheduled or "Generate Now").
function WebhookSettingsPanel() {
  const { message } = App.useApp();
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/teams-notification')
      .then(r => setCfg(r.data))
      .catch(() => message.error('Failed to load Teams notification settings'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  const toggle = async (notify_weekly_report) => {
    setCfg(prev => ({ ...prev, notify_weekly_report }));
    setSaving(true);
    try {
      const { data } = await api.put('/teams-notification', { notify_weekly_report });
      setCfg(data);
      message.success(notify_weekly_report ? 'Weekly Report notifications enabled' : 'Weekly Report notifications disabled');
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to save');
      load();
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      await api.post('/teams-notification/test', {});
      message.success('Test notification sent — check the Teams channel');
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to send test notification');
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 80 }}><Spin /></div>;

  const globallyReady = !!(cfg?.enabled && cfg?.webhook_url);

  return (
    <Card className="dashcard" style={{ maxWidth: 640 }}>
      <Text type="secondary" style={{ display: 'block', marginBottom: 20 }}>
        A Teams notification is posted whenever a Weekly Report snapshot is generated — automatically
        every Wednesday, and immediately if an admin clicks "Generate Now" — using the webhook already
        configured for this app's Teams notifications.
      </Text>

      {!globallyReady && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 20 }}
          message="Teams notifications aren't fully configured yet"
          description={
            <span>
              {cfg?.webhook_url ? 'Notifications are currently turned off.' : 'No webhook URL is set.'}{' '}
              Set it up under <Link to="/admin/teams-notifications">Admin → Teams Notifications</Link>,
              then come back here.
            </span>
          }
        />
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Switch checked={!!cfg?.notify_weekly_report} loading={saving} onChange={toggle} />
        <Text>{cfg?.notify_weekly_report ? 'Weekly Report notifications enabled' : 'Weekly Report notifications disabled'}</Text>
      </div>

      <Space>
        <Button icon={<SendOutlined />} loading={testing} disabled={!globallyReady} onClick={sendTest}>
          Send Test Notification
        </Button>
        <Link to="/admin/teams-notifications">
          <Button icon={<SettingOutlined />}>Manage Webhook &amp; Other Alerts</Button>
        </Link>
      </Space>
    </Card>
  );
}

function ReportPanel({ report, loading }) {
  if (loading) return <div style={{ textAlign: 'center', padding: 80 }}><Spin /></div>;
  if (!report) return <Empty description="No report available" />;
  return <ReportTable sections={report.sections} />;
}

// Pulls the four headline percentages out of the auto sections for the
// masthead figures — same document-header treatment already used for
// Dashboard's own Weekly tab (styles.css .wr-masthead/.wr-figures).
function reportFigures(sections) {
  const byKey = Object.fromEntries((sections || []).map(s => [s.section_key, s.data]));
  const asset = byKey.asset_inventory;
  const nessus = byKey.nessus_agent;
  const patch = byKey.patch_management;
  const hosts = byKey.migration_project?.hosts || {};
  const migrationPct = hosts.total_hosts ? Math.round((hosts.fully_migrated / hosts.total_hosts) * 100) : 0;
  return [
    {
      label: 'Asset Inventory', value: asset?.combinedPct ?? 0,
      detail: asset ? `${(asset.combinedNumerator ?? 0).toLocaleString()} / ${(asset.combinedDenominator ?? 0).toLocaleString()}` : '—',
    },
    {
      label: 'Nessus Compliance', value: nessus?.compliancePct ?? 0,
      detail: nessus ? `${(nessus.applicable?.installed ?? 0).toLocaleString()} / ${(nessus.applicable?.total ?? 0).toLocaleString()}` : '—',
    },
    {
      label: 'ME Compliance', value: patch?.meCompliance?.combinedPct ?? 0,
      detail: patch ? `${(patch.meCompliance?.combinedYes ?? 0).toLocaleString()} / ${(patch.meCompliance?.combinedDen ?? 0).toLocaleString()}` : '—',
    },
    {
      label: 'Migration Progress', value: migrationPct,
      detail: `${(hosts.fully_migrated ?? 0).toLocaleString()} / ${(hosts.total_hosts ?? 0).toLocaleString()} hosts`,
    },
  ];
}

function ReportMasthead({ report }) {
  const figures = reportFigures(report?.sections);
  const dateLabel = report?.reportDate
    ? new Date(`${report.reportDate}T00:00:00`).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';
  return (
    <div className="wr-masthead">
      <div className="wr-masthead-top">
        <div>
          <span className="wr-eyebrow">Server Team · Weekly Report</span>
          <h2 className="wr-title">Infrastructure &amp; Compliance Snapshot</h2>
        </div>
        <div className="wr-stamp">
          {dateLabel}<br />
          {(report?.sections?.length ?? 0)} sections
        </div>
      </div>
      <div className="wr-figures">
        {figures.map(f => (
          <div className="wr-figure" key={f.label}>
            <div className="wr-figure-value">{f.value}<span className="wr-pct">%</span></div>
            <div className="wr-figure-label">{f.label}</div>
            <div className="wr-figure-detail">{f.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WeeklyReport() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const isAdmin = ['admin', 'superadmin'].includes(user?.role);
  const [snapshots, setSnapshots] = useState([]);
  const [selectedId, setSelectedId] = useState('current');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const loadSnapshots = () => api.get('/weekly-report/snapshots').then(r => setSnapshots(r.data || [])).catch(() => setSnapshots([]));

  const loadReport = (id) => {
    setLoading(true);
    const req = id === 'current' ? api.get('/weekly-report/current') : api.get(`/weekly-report/snapshots/${id}`);
    req
      .then(r => setReport(id === 'current' ? r.data : { reportDate: r.data.report_date, sections: r.data.sections }))
      .catch(() => setReport(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadSnapshots(); }, []);
  useEffect(() => { loadReport(selectedId); }, [selectedId]); // eslint-disable-line

  const generateNow = async () => {
    setGenerating(true);
    try {
      await api.post('/weekly-report/generate-now');
      message.success('Snapshot generated');
      await loadSnapshots();
      setSelectedId('current');
      loadReport('current');
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to generate snapshot');
    } finally {
      setGenerating(false);
    }
  };

  const reportTab = (
    <div>
      <ReportMasthead report={report} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Space>
          <Select
            style={{ width: 220 }}
            value={selectedId}
            onChange={setSelectedId}
            options={[
              { value: 'current', label: 'Current (live)' },
              ...snapshots.map(s => ({ value: s.id, label: s.report_date })),
            ]}
          />
          {isAdmin && (
            <Button icon={<ReloadOutlined />} loading={generating} onClick={generateNow}>
              Generate Now
            </Button>
          )}
        </Space>
      </div>
      <ReportPanel report={report} loading={loading} />
    </div>
  );

  return (
    <div>
      <style>{DASH_CSS}</style>
      <Title level={4} style={{ margin: 0 }}>
        <FileTextOutlined style={{ marginRight: 8 }} />
        Weekly Report{report ? ` — ${report.reportDate}` : ''}
      </Title>
      <Text type="secondary">A snapshot is saved automatically every Wednesday.</Text>

      <Tabs
        style={{ marginTop: 16 }}
        items={[
          { key: 'report', label: 'Report', children: reportTab },
          { key: 'inputs', label: <span><EditOutlined /> Manage Inputs</span>, children: <ManageInputsPanel /> },
          ...(isAdmin ? [{
            key: 'webhook',
            label: <span><NotificationOutlined /> Teams Notification</span>,
            children: <WebhookSettingsPanel />,
          }] : []),
        ]}
      />
    </div>
  );
}
