import { useEffect, useState } from 'react';
import {
  Card, Col, Row, Select, Typography, Empty, Spin, Table, Tag, Space, Statistic, Button, App,
} from 'antd';
import { FileTextOutlined, ReloadOutlined } from '@ant-design/icons';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';

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
      <Table
        rowKey="location"
        size="small"
        dataSource={data.locations || []}
        pagination={false}
        style={{ maxWidth: 360 }}
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
      <BreakdownTable breakdown={data.locationPatching} groupLabel="Location" />

      <Text underline strong style={{ display: 'block', margin: '20px 0 8px' }}>Departments Patching Onboarding Status:</Text>
      <BreakdownTable breakdown={data.departmentPatching} groupLabel="Department" />

      <Text underline strong style={{ display: 'block', margin: '20px 0 8px' }}>Auto Patching Group Count Status:</Text>
      <Paragraph>
        <strong>ManageEngine Compliance (MSL + Extended Inventory):</strong>{' '}
        {pctText(data.meCompliance?.combinedYes, data.meCompliance?.combinedDen, data.meCompliance?.combinedPct)}
      </Paragraph>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>{data.meCompliance?.footnote}</Text>
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
    </>
  );
}

function MigrationSection({ data }) {
  const hosts = data.hosts || {};
  const groups = [
    { label: 'Bomgar VMs', ...data.bomgar },
    { label: 'Security VMs', ...data.security },
    { label: 'Standalone ESXi', ...data.standalone },
  ];
  return (
    <>
      <Text strong style={{ display: 'block', marginBottom: 8 }}>Hosts</Text>
      <Space size={24} wrap style={{ marginBottom: 20 }}>
        <Statistic title="Total Hosts" value={hosts.total_hosts ?? 0} />
        <Statistic title="Fully Migrated" value={hosts.fully_migrated ?? 0} valueStyle={{ color: '#52c41a' }} />
        <Statistic title="Pending Vacate" value={hosts.pending_vacate ?? 0} valueStyle={{ color: '#fa8c16' }} />
        <Statistic title="VMs to Migrate" value={hosts.total_vms_to_migrate ?? 0} />
      </Space>
      <Text strong style={{ display: 'block', marginBottom: 8 }}>VMs by Source</Text>
      <Row gutter={16}>
        {groups.map(g => (
          <Col xs={24} sm={8} key={g.label}>
            <Card size="small" title={g.label}>
              <Space size={16}>
                <Statistic title="Total" value={g.total ?? 0} />
                <Statistic title="Migrated" value={g.migrated ?? 0} valueStyle={{ color: '#52c41a' }} />
              </Space>
            </Card>
          </Col>
        ))}
      </Row>
    </>
  );
}

const AUTO_RENDERERS = {
  asset_inventory: AssetInventorySection,
  nessus_agent: NessusSection,
  patch_management: PatchManagementSection,
  migration_project: MigrationSection,
};

function SectionCard({ section }) {
  const Renderer = section.kind === 'auto' ? AUTO_RENDERERS[section.section_key] : null;
  return (
    <Card title={section.title} style={{ marginBottom: 16 }}>
      {Renderer ? (
        <Renderer data={section.data} />
      ) : (
        section.data?.content
          ? <div style={{ whiteSpace: 'pre-wrap' }}>{section.data.content}</div>
          : <Text type="secondary">No content yet.</Text>
      )}
    </Card>
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

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>
            <FileTextOutlined style={{ marginRight: 8 }} />
            Weekly Report{report ? ` — ${report.reportDate}` : ''}
          </Title>
          <Text type="secondary">A snapshot is saved automatically every Wednesday.</Text>
        </div>
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

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin /></div>
      ) : !report ? (
        <Empty description="No report available" />
      ) : (
        report.sections.map(section => <SectionCard key={section.section_key} section={section} />)
      )}
    </div>
  );
}
