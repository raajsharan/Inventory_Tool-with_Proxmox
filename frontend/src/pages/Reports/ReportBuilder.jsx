import { useEffect, useMemo, useState } from 'react';
import {
  Card, Select, Button, Space, Typography, Row, Col, Checkbox, Input, Table, Tag,
  App, Empty, Divider, Tabs, Tooltip,
} from 'antd';
import {
  BarChartOutlined, PieChartOutlined, LineChartOutlined, TableOutlined,
  AppstoreOutlined, FunnelPlotOutlined, PlusOutlined, DeleteOutlined,
  PlayCircleOutlined, DownloadOutlined, DatabaseOutlined, FilterOutlined,
} from '@ant-design/icons';
import { Column, Pie, Line } from '@ant-design/plots';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';
import { DASH_CSS } from '../../components/DashboardStatCard.jsx';

const VIZ_TYPES = [
  { value: 'table',    label: 'Data Table',     icon: <TableOutlined /> },
  { value: 'bar',      label: 'Bar Chart',      icon: <BarChartOutlined /> },
  { value: 'pie',      label: 'Pie Chart',      icon: <PieChartOutlined /> },
  { value: 'doughnut', label: 'Doughnut Chart', icon: <PieChartOutlined /> },
  { value: 'line',     label: 'Line Chart',     icon: <LineChartOutlined /> },
  { value: 'pivot',    label: 'Pivot Table',    icon: <AppstoreOutlined /> },
];

const OPERATORS = [
  { value: 'eq',      label: 'Equals' },
  { value: 'ne',      label: 'Not equals' },
  { value: 'like',    label: 'Contains' },
  { value: 'gt',      label: '>' },
  { value: 'gte',     label: '≥' },
  { value: 'lt',      label: '<' },
  { value: 'lte',     label: '≤' },
  { value: 'isnull',  label: 'Is empty' },
  { value: 'notnull', label: 'Is not empty' },
];

export default function ReportBuilder() {
  const { message } = App.useApp();
  const { user, canViewPasswords } = useAuth();
  const canSeePasswords = ['admin', 'superadmin', 'asset_manager'].includes(user?.role) || !!canViewPasswords;
  const [sources, setSources] = useState([]);
  const [source, setSource] = useState('assets');
  const [viz, setViz] = useState('table');
  const [columns, setColumns] = useState([]);
  const [filters, setFilters] = useState([]);
  const [groupBy, setGroupBy] = useState(undefined);
  const [measure, setMeasure] = useState('__count__');
  const [pivotRow, setPivotRow] = useState(undefined);
  const [pivotCol, setPivotCol] = useState(undefined);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    api.get('/reports/sources')
      .then(r => setSources(r.data.items || []))
      .catch(e => message.error(e.response?.data?.error || 'Failed to load sources'));
  }, []);

  const currentSource = useMemo(() => sources.find(s => s.key === source), [sources, source]);
  const allFields = useMemo(() => {
    const fields = currentSource?.fields || [];
    // Hide rather than merely disable — selecting it and only then hitting a
    // 403 on Generate Report would be a confusing dead end.
    return canSeePasswords ? fields : fields.filter(f => f.key !== 'asset_password');
  }, [currentSource, canSeePasswords]);

  useEffect(() => {
    // Default to first 7 fields selected, like the screenshot.
    if (!currentSource) return;
    setColumns(allFields.slice(0, 7).map(f => f.key));
    setFilters([]);
    setGroupBy(allFields[0]?.key);
    setMeasure('__count__');
    setPivotRow(allFields[0]?.key);
    setPivotCol(allFields[1]?.key);
    setResult(null);
  }, [source]); // eslint-disable-line

  function toggleColumn(key) {
    setColumns(c => c.includes(key) ? c.filter(k => k !== key) : [...c, key]);
  }

  function addFilter() {
    if (!allFields.length) return;
    setFilters(f => [...f, { field: allFields[0].key, op: 'eq', value: '' }]);
  }
  function updateFilter(i, patch) {
    setFilters(f => f.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  }
  function removeFilter(i) {
    setFilters(f => f.filter((_, idx) => idx !== i));
  }

  async function generate() {
    setRunning(true);
    try {
      const { data } = await api.post('/reports/run', {
        source,
        columns,
        filters: filters.filter(f => f.field && f.op && (['isnull','notnull'].includes(f.op) || f.value !== '')),
      });
      setResult(data);
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to run report');
    } finally { setRunning(false); }
  }

  function exportCsv() {
    if (!result?.rows?.length) return;
    const cols = result.columns.map(c => c.key);
    const header = result.columns.map(c => `"${c.label}"`).join(',');
    const lines = result.rows.map(r => cols.map(k => {
      const v = r[k];
      if (v === null || v === undefined) return '';
      const s = String(v).replace(/"/g, '""');
      return `"${s}"`;
    }).join(','));
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `report-${source}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card
      title={
        <Space>
          <BarChartOutlined style={{ color: '#1677ff', fontSize: 22 }} />
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>Report Builder</Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Customize, visualize and export reports from Asset, Beijing, or Extended Inventory data
            </Typography.Text>
          </div>
        </Space>
      }
    >
      <style>{DASH_CSS}</style>
      <Card size="small" className="dashcard" style={{ marginBottom: 16, animationDelay: '0ms' }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} md={12}>
            <Typography.Text strong style={{ display: 'block', marginBottom: 8, letterSpacing: 1, fontSize: 11 }}>
              <DatabaseOutlined style={{ marginRight: 6 }} />DATA SOURCE
            </Typography.Text>
            <Select
              value={source}
              onChange={setSource}
              style={{ width: '100%' }}
              options={sources.map(s => ({ value: s.key, label: s.label }))}
            />
          </Col>
          <Col xs={24} md={12}>
            <Typography.Text strong style={{ display: 'block', marginBottom: 8, letterSpacing: 1, fontSize: 11 }}>
              VISUALIZATION TYPE
            </Typography.Text>
            <Space wrap>
              {VIZ_TYPES.map(v => (
                <Button
                  key={v.value}
                  type={viz === v.value ? 'primary' : 'default'}
                  icon={v.icon}
                  onClick={() => setViz(v.value)}
                >
                  {v.label}
                </Button>
              ))}
            </Space>
          </Col>
        </Row>
      </Card>

      <Card size="small" className="dashcard" style={{ marginBottom: 16, animationDelay: '60ms' }}>
        <Typography.Text strong style={{ display: 'block', marginBottom: 8, letterSpacing: 1, fontSize: 11 }}>
          VISIBLE COLUMNS ({columns.length} selected)
        </Typography.Text>
        <Row gutter={[8, 6]}>
          {allFields.map(f => (
            <Col xs={12} md={6} lg={4} key={f.key}>
              <Checkbox checked={columns.includes(f.key)} onChange={() => toggleColumn(f.key)}>
                {f.label}
              </Checkbox>
            </Col>
          ))}
        </Row>
      </Card>

      {(viz === 'bar' || viz === 'pie' || viz === 'doughnut' || viz === 'line') && (
        <Card size="small" className="dashcard" style={{ marginBottom: 16, animationDelay: '100ms' }}>
          <Typography.Text strong style={{ display: 'block', marginBottom: 8, letterSpacing: 1, fontSize: 11 }}>
            CHART AXES
          </Typography.Text>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>Group by (category)</Typography.Text>
              <Select
                value={groupBy}
                onChange={setGroupBy}
                style={{ width: '100%' }}
                options={allFields.map(f => ({ value: f.key, label: f.label }))}
              />
            </Col>
            <Col xs={24} md={12}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>Measure</Typography.Text>
              <Select
                value={measure}
                onChange={setMeasure}
                style={{ width: '100%' }}
                options={[
                  { value: '__count__', label: 'Count of records' },
                  ...allFields.filter(f => f.type === 'number').map(f => ({ value: f.key, label: `Sum of ${f.label}` })),
                ]}
              />
            </Col>
          </Row>
        </Card>
      )}

      {viz === 'pivot' && (
        <Card size="small" className="dashcard" style={{ marginBottom: 16, animationDelay: '100ms' }}>
          <Typography.Text strong style={{ display: 'block', marginBottom: 8, letterSpacing: 1, fontSize: 11 }}>
            PIVOT AXES
          </Typography.Text>
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>Rows</Typography.Text>
              <Select value={pivotRow} onChange={setPivotRow} style={{ width: '100%' }}
                options={allFields.map(f => ({ value: f.key, label: f.label }))} />
            </Col>
            <Col xs={24} md={8}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>Columns</Typography.Text>
              <Select value={pivotCol} onChange={setPivotCol} style={{ width: '100%' }}
                options={allFields.map(f => ({ value: f.key, label: f.label }))} />
            </Col>
            <Col xs={24} md={8}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>Measure</Typography.Text>
              <Select value={measure} onChange={setMeasure} style={{ width: '100%' }}
                options={[
                  { value: '__count__', label: 'Count of records' },
                  ...allFields.filter(f => f.type === 'number').map(f => ({ value: f.key, label: `Sum of ${f.label}` })),
                ]} />
            </Col>
          </Row>
        </Card>
      )}

      <Card size="small" className="dashcard" style={{ marginBottom: 16, animationDelay: '140ms' }}>
        <Space style={{ justifyContent: 'space-between', display: 'flex', width: '100%', marginBottom: 8 }}>
          <Typography.Text strong style={{ letterSpacing: 1, fontSize: 11 }}><FilterOutlined style={{ marginRight: 6 }} />FILTERS</Typography.Text>
          <Button size="small" icon={<PlusOutlined />} onClick={addFilter}>Add Filter</Button>
        </Space>
        {filters.length === 0 && <Typography.Text type="secondary">No filters — all rows will be included.</Typography.Text>}
        {filters.map((f, i) => {
          const noVal = ['isnull','notnull'].includes(f.op);
          return (
            <Row gutter={8} key={i} style={{ marginBottom: 8 }} align="middle">
              <Col xs={24} md={6}>
                <Select value={f.field} onChange={v => updateFilter(i, { field: v })} style={{ width: '100%' }}
                  options={allFields.map(x => ({ value: x.key, label: x.label }))} />
              </Col>
              <Col xs={24} md={6}>
                <Select value={f.op} onChange={v => updateFilter(i, { op: v })} style={{ width: '100%' }} options={OPERATORS} />
              </Col>
              <Col xs={24} md={10}>
                <Input value={f.value} onChange={e => updateFilter(i, { value: e.target.value })}
                  disabled={noVal} placeholder={noVal ? '—' : 'Value'} />
              </Col>
              <Col xs={24} md={2}>
                <Tooltip title="Remove this filter">
                  <Button danger size="small" icon={<DeleteOutlined />} onClick={() => removeFilter(i)} />
                </Tooltip>
              </Col>
            </Row>
          );
        })}
      </Card>

      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlayCircleOutlined />} loading={running} onClick={generate}>
          Generate Report
        </Button>
        {result?.rows?.length > 0 && (
          <Tooltip title="Download the current result set as a CSV file">
            <Button icon={<DownloadOutlined />} onClick={exportCsv}>Export CSV</Button>
          </Tooltip>
        )}
      </Space>

      {result && (
        <Card className="dashcard" style={{ animationDelay: '180ms' }} title={<Space><FunnelPlotOutlined /><span>Result · {result.rows.length} rows</span></Space>}>
          {!result.rows.length ? (
            <Empty description="No data matches the selected filters" />
          ) : (
            <ReportVisualization
              viz={viz}
              rows={result.rows}
              cols={result.columns}
              groupBy={groupBy}
              measure={measure}
              pivotRow={pivotRow}
              pivotCol={pivotCol}
              visibleCols={columns}
            />
          )}
        </Card>
      )}
    </Card>
  );
}

function aggregate(rows, groupBy, measure) {
  const m = new Map();
  for (const r of rows) {
    const k = String(r[groupBy] ?? '—');
    if (!m.has(k)) m.set(k, 0);
    if (measure === '__count__') m.set(k, m.get(k) + 1);
    else m.set(k, m.get(k) + (Number(r[measure]) || 0));
  }
  return Array.from(m.entries()).map(([category, value]) => ({ category, value }));
}

function pivot(rows, rowKey, colKey, measure) {
  const rowVals = new Set();
  const colVals = new Set();
  const grid = new Map();
  for (const r of rows) {
    const rv = String(r[rowKey] ?? '—');
    const cv = String(r[colKey] ?? '—');
    rowVals.add(rv);
    colVals.add(cv);
    const k = `${rv}|||${cv}`;
    if (!grid.has(k)) grid.set(k, 0);
    if (measure === '__count__') grid.set(k, grid.get(k) + 1);
    else grid.set(k, grid.get(k) + (Number(r[measure]) || 0));
  }
  const cols = [...colVals].sort();
  const data = [...rowVals].sort().map(rv => {
    const obj = { __row__: rv };
    let total = 0;
    for (const cv of cols) {
      const v = grid.get(`${rv}|||${cv}`) || 0;
      obj[cv] = v;
      total += v;
    }
    obj.__total__ = total;
    return obj;
  });
  return { cols, data };
}

function ReportVisualization({ viz, rows, cols, groupBy, measure, pivotRow, pivotCol, visibleCols }) {
  if (viz === 'table') {
    const shownCols = cols.filter(c => visibleCols.includes(c.key));
    const tableColumns = shownCols.map(c => ({ title: c.label, dataIndex: c.key, key: c.key,
      render: (v) => formatCell(v, c.type) }));
    return (
      <Table
        rowKey={(_, i) => i}
        dataSource={rows}
        columns={tableColumns}
        size="small"
        scroll={{ x: 'max-content' }}
        pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: [10,20,50,100] }}
      />
    );
  }

  if (viz === 'bar') {
    const data = aggregate(rows, groupBy, measure);
    return <Column data={data} xField="category" yField="value" label={{ position: 'top' }} height={400} />;
  }

  if (viz === 'pie') {
    const data = aggregate(rows, groupBy, measure);
    return <Pie data={data} angleField="value" colorField="category" radius={0.85} height={420}
      label={{ text: 'category', position: 'outside' }} />;
  }

  if (viz === 'doughnut') {
    const data = aggregate(rows, groupBy, measure);
    return <Pie data={data} angleField="value" colorField="category" innerRadius={0.6} radius={0.85} height={420}
      label={{ text: 'value', position: 'inside' }} />;
  }

  if (viz === 'line') {
    const data = aggregate(rows, groupBy, measure);
    return <Line data={data} xField="category" yField="value" point={{ shapeField: 'circle' }} height={400} />;
  }

  if (viz === 'pivot') {
    const { cols: pcols, data } = pivot(rows, pivotRow, pivotCol, measure);
    const tableColumns = [
      { title: pivotRow, dataIndex: '__row__', fixed: 'left', width: 200 },
      ...pcols.map(c => ({ title: c, dataIndex: c, render: v => v || 0, align: 'right' })),
      { title: 'Total', dataIndex: '__total__', fixed: 'right', width: 100, align: 'right',
        render: v => <Tag color="blue">{v}</Tag> },
    ];
    return (
      <Table
        rowKey="__row__"
        dataSource={data}
        columns={tableColumns}
        size="small"
        scroll={{ x: 'max-content' }}
        pagination={false}
        summary={() => {
          const totals = {};
          for (const c of pcols) totals[c] = data.reduce((a, r) => a + (r[c] || 0), 0);
          const grand = data.reduce((a, r) => a + (r.__total__ || 0), 0);
          return (
            <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 600 }}>
              <Table.Summary.Cell index={0}>Total</Table.Summary.Cell>
              {pcols.map((c, i) => <Table.Summary.Cell key={c} index={i+1} align="right">{totals[c]}</Table.Summary.Cell>)}
              <Table.Summary.Cell index={pcols.length+1} align="right"><Tag color="green">{grand}</Tag></Table.Summary.Cell>
            </Table.Summary.Row>
          );
        }}
      />
    );
  }

  return null;
}

function formatCell(v, type) {
  if (v === null || v === undefined || v === '') return '—';
  if (type === 'boolean') return v ? <Tag color="green">Yes</Tag> : <Tag>No</Tag>;
  if (type === 'date') {
    const d = new Date(v);
    return isNaN(d) ? String(v) : d.toLocaleString();
  }
  return String(v);
}
