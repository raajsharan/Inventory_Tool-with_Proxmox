import { useState } from 'react';
import {
  Steps, Card, Form, Input, InputNumber, Switch, Button, Select, Table,
  Alert, Tag, Space, Tooltip, Typography, Divider, Row, Col, Segmented,
  message, Badge,
} from 'antd';
import {
  DatabaseOutlined, ApiOutlined, TableOutlined, CheckCircleOutlined,
  CloseCircleOutlined, SyncOutlined, ImportOutlined, InfoCircleOutlined,
} from '@ant-design/icons';
import api from '../../api/client';

const { Text, Title } = Typography;
const { TextArea } = Input;

const TARGET_TABLES = [
  { value: 'assets',                label: 'Asset Inventory' },
  { value: 'beijing_assets',        label: 'Beijing Asset Inventory' },
  { value: 'ext_assets',            label: 'Ext. Asset Inventory' },
  { value: 'physical_esxi_servers', label: 'Physical & ESXi Servers' },
];

const TARGET_FIELDS = [
  'vm_name', 'os_hostname', 'ip_address', 'asset_type', 'os_type', 'os_version',
  'assigned_user', 'department', 'business_purpose', 'server_status', 'patching_type',
  'server_patch_type', 'patching_schedule', 'location', 'eol_status', 'serial_number',
  'ome_status', 'hosted_ip', 'asset_tag', 'asset_username', 'asset_password',
  'additional_remarks', 'manage_engine_installed', 'tenable_installed', 'idrac_enabled',
];

const REQUIRED_FIELDS = new Set(['vm_name', 'ip_address']);

const ACTION_COLOR = { create: 'success', merge: 'gold', error: 'error' };
const ACTION_LABEL = { create: 'Create', merge: 'Merge', error: 'Error' };

function stepIcon(icon) { return <span style={{ fontSize: 18 }}>{icon}</span>; }

export default function DbImport() {
  const [current, setCurrent]         = useState(0);
  const [loading, setLoading]         = useState(false);

  // Step 1 — connection
  const [connForm]                    = Form.useForm();
  const [savedCreds, setSavedCreds]   = useState(null); // persisted after successful test
  const [tables, setTables]           = useState([]);

  // Step 2 — source
  const [sourceMode, setSourceMode]   = useState('table');
  const [selectedTable, setSelectedTable] = useState('');
  const [customQuery, setCustomQuery] = useState('');
  const [columns, setColumns]         = useState([]);
  const [sample, setSample]           = useState([]);
  const [suggested, setSuggested]     = useState({});

  // Step 3 — mapping
  const [targetTable, setTargetTable] = useState('assets');
  const [columnMap, setColumnMap]     = useState({});
  const [verifyByIp, setVerifyByIp]   = useState(true);

  // Step 4 — preview
  const [previewRows, setPreviewRows] = useState([]);
  const [rowFilter, setRowFilter]     = useState('all');
  const [selectedIdxs, setSelectedIdxs] = useState([]);

  // Step 5 — result
  const [result, setResult]           = useState(null);

  function readCreds() {
    const v = connForm.getFieldsValue();
    return { host: v.host, port: v.port, database: v.database, user: v.user, password: v.password, ssl: v.ssl || false };
  }

  // Returns saved creds (reliable after step 1); falls back to form values
  function creds() { return savedCreds || readCreds(); }

  // ── Step 1: Test connection ──────────────────────────────────────────────
  async function onTestConnection() {
    try {
      await connForm.validateFields();
    } catch { return; }
    setLoading(true);
    try {
      const c = readCreds();
      const { data } = await api.post('/db-import/test', c);
      setSavedCreds(c);                         // persist creds for later steps
      setTables(data.tables || []);
      message.success(`Connected — ${data.tables.length} table(s) found`);
      setCurrent(1);
    } catch (e) {
      message.error(e.response?.data?.error || e.message || 'Connection failed');
    } finally { setLoading(false); }
  }

  // ── Step 2: Fetch columns ────────────────────────────────────────────────
  async function onFetchColumns() {
    if (sourceMode === 'table' && !selectedTable) { message.warning('Select a table'); return; }
    if (sourceMode === 'query' && !customQuery.trim()) { message.warning('Enter a SQL query'); return; }
    setLoading(true);
    try {
      const payload = {
        ...creds(),
        table: sourceMode === 'table' ? selectedTable : undefined,
        query: sourceMode === 'query' ? customQuery   : undefined,
      };
      const { data } = await api.post('/db-import/columns', payload);
      setColumns(data.columns || []);
      setSample(data.sample  || []);
      setSuggested(data.suggested || {});
      setColumnMap(data.suggested || {});
      setCurrent(2);
    } catch (e) {
      const msg = e.response?.data?.error || e.message || 'Failed to fetch columns';
      message.error({ content: msg, duration: 8 });
    } finally { setLoading(false); }
  }

  // ── Step 3: Validate mapping ─────────────────────────────────────────────
  function onConfirmMapping() {
    const mapped = Object.values(columnMap).filter(Boolean);
    if (!mapped.includes('vm_name'))   { message.warning('Map a column to VM Name'); return; }
    if (!mapped.includes('ip_address')){ message.warning('Map a column to IP Address'); return; }
    setCurrent(3);
  }

  // ── Step 4: Generate preview ─────────────────────────────────────────────
  async function onPreview() {
    setLoading(true);
    try {
      const payload = {
        ...creds(),
        table:       sourceMode === 'table' ? selectedTable : undefined,
        query:       sourceMode === 'query' ? customQuery   : undefined,
        columnMap,
        targetTable,
        verifyByIp,
      };
      const { data } = await api.post('/db-import/preview', payload);
      setPreviewRows(data.rows || []);
      setSelectedIdxs((data.rows || []).filter(r => !r.errors.length).map(r => r.rowIdx));
      setRowFilter('all');
    } catch (e) {
      message.error(e.response?.data?.error || e.message || 'Preview failed');
    } finally { setLoading(false); }
  }

  // ── Step 5: Apply import ─────────────────────────────────────────────────
  async function onImport() {
    if (!selectedIdxs.length) { message.warning('Select at least one row'); return; }
    setLoading(true);
    try {
      const payload = {
        ...creds(),
        table:          sourceMode === 'table' ? selectedTable : undefined,
        query:          sourceMode === 'query' ? customQuery   : undefined,
        columnMap,
        targetTable,
        verifyByIp,
        selectedRowIdxs: selectedIdxs,
      };
      const { data } = await api.post('/db-import/apply', payload);
      setResult(data);
      setCurrent(4);
    } catch (e) {
      message.error(e.response?.data?.error || e.message || 'Import failed');
    } finally { setLoading(false); }
  }

  // ── Preview table ────────────────────────────────────────────────────────
  const filteredRows = previewRows.filter(r => {
    if (rowFilter === 'all')    return true;
    if (rowFilter === 'errors') return r.errors.length > 0;
    return r.action === rowFilter;
  });

  const counts = {
    create: previewRows.filter(r => r.action === 'create' && !r.errors.length).length,
    merge:  previewRows.filter(r => r.action === 'merge').length,
    errors: previewRows.filter(r => r.errors.length > 0).length,
  };

  const previewCols = [
    {
      title: '', key: 'action', width: 80,
      render: (_, r) => r.errors.length
        ? <Tag color="error">Error</Tag>
        : <Tag color={ACTION_COLOR[r.action]}>{ACTION_LABEL[r.action]}</Tag>,
    },
    { title: 'VM Name',    dataIndex: ['data', 'vm_name'],    key: 'vm_name',    ellipsis: true },
    { title: 'IP Address', dataIndex: ['data', 'ip_address'], key: 'ip_address', ellipsis: true },
    { title: 'OS Type',    dataIndex: ['data', 'os_type'],    key: 'os_type',    ellipsis: true },
    {
      title: 'Details', key: 'details', ellipsis: true,
      render: (_, r) => {
        if (r.errors.length) return <Text type="danger">{r.errors.join('; ')}</Text>;
        if (r.action === 'merge' && r.diffs?.length) {
          return <Text type="secondary">{r.diffs.map(d => d.field).join(', ')} will be filled</Text>;
        }
        if (r.action === 'merge') return <Text type="secondary">No empty fields to fill</Text>;
        return null;
      },
    },
  ];

  const rowSelection = {
    selectedRowKeys: selectedIdxs,
    onChange: keys => setSelectedIdxs(keys),
    getCheckboxProps: r => ({ disabled: r.errors.length > 0 }),
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const steps = [
    { title: 'Connect',    icon: stepIcon(<ApiOutlined />) },
    { title: 'Source',     icon: stepIcon(<DatabaseOutlined />) },
    { title: 'Map Columns',icon: stepIcon(<TableOutlined />) },
    { title: 'Preview',    icon: stepIcon(<InfoCircleOutlined />) },
    { title: 'Done',       icon: stepIcon(<CheckCircleOutlined />) },
  ];

  return (
    <Card
      title={<Space><ImportOutlined /> Import from PostgreSQL Database</Space>}
      style={{ maxWidth: 1100, margin: '0 auto' }}
    >
      <Steps current={current} items={steps} style={{ marginBottom: 32 }} />

      {/* ── Step 0: Connect ───────────────────────────────────────────── */}
      {current === 0 && (
        <Form form={connForm} layout="vertical" style={{ maxWidth: 560 }}>
          <Title level={5}>Source Database Connection</Title>
          <Alert
            type="info" style={{ marginBottom: 16 }}
            message="Credentials are used only for this import session and are never stored."
          />
          <Row gutter={16}>
            <Col span={16}>
              <Form.Item name="host" label="Host" rules={[{ required: true }]} initialValue="localhost">
                <Input placeholder="192.168.1.10" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="port" label="Port" initialValue={5432}>
                <InputNumber min={1} max={65535} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="database" label="Database Name" rules={[{ required: true }]}>
            <Input placeholder="mydb" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="user" label="Username" rules={[{ required: true }]}>
                <Input placeholder="postgres" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="password" label="Password">
                <Input.Password placeholder="••••••••" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="ssl" label="Use SSL" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Button type="primary" loading={loading} onClick={onTestConnection} icon={<ApiOutlined />}>
            Test Connection &amp; Continue
          </Button>
        </Form>
      )}

      {/* ── Step 1: Source ────────────────────────────────────────────── */}
      {current === 1 && (
        <div style={{ maxWidth: 640 }}>
          <Title level={5}>Select Data Source</Title>
          <Segmented
            value={sourceMode}
            onChange={setSourceMode}
            options={[{ label: 'Select a Table', value: 'table' }, { label: 'Custom SQL Query', value: 'query' }]}
            style={{ marginBottom: 16 }}
          />
          {sourceMode === 'table' ? (
            <>
              <Form.Item label="Table">
                <Select
                  showSearch
                  placeholder="Choose a table"
                  value={selectedTable || undefined}
                  onChange={setSelectedTable}
                  options={tables.map(t => ({ value: t, label: t }))}
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <Alert type="info" message="All rows from the selected table will be fetched. Use a Custom SQL Query to filter specific records." />
            </>
          ) : (
            <>
              <Form.Item label="SQL Query">
                <TextArea
                  rows={5}
                  value={customQuery}
                  onChange={e => setCustomQuery(e.target.value)}
                  placeholder={'SELECT vm_name, ip_address, os_type\nFROM assets\nWHERE department = \'Engineering\''}
                  style={{ fontFamily: 'monospace' }}
                />
              </Form.Item>
              <Alert type="warning" message="Write a valid SELECT query. Do not include trailing semicolons." />
            </>
          )}
          <Space style={{ marginTop: 16 }}>
            <Button onClick={() => setCurrent(0)}>Back</Button>
            <Button type="primary" loading={loading} onClick={onFetchColumns} icon={<TableOutlined />}>
              Fetch Columns &amp; Continue
            </Button>
          </Space>
        </div>
      )}

      {/* ── Step 2: Map Columns ───────────────────────────────────────── */}
      {current === 2 && (
        <div>
          <Title level={5}>Map Source Columns → Target Fields</Title>
          <Row gutter={24} style={{ marginBottom: 16 }}>
            <Col span={12}>
              <Form.Item label="Target Inventory Table">
                <Select
                  value={targetTable}
                  onChange={setTargetTable}
                  options={TARGET_TABLES}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Match existing records by IP">
                <Switch checked={verifyByIp} onChange={setVerifyByIp} />
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                  Merge into existing row if IP matches
                </Text>
              </Form.Item>
            </Col>
          </Row>

          <Alert
            style={{ marginBottom: 12 }}
            type="info"
            message={
              <>Auto-matched columns are pre-filled. <strong>VM Name</strong> and <strong>IP Address</strong> are required. Set to <em>— Skip —</em> to ignore a source column.</>
            }
          />

          <Table
            size="small"
            pagination={false}
            dataSource={columns.map(c => ({ key: c, src: c }))}
            columns={[
              {
                title: 'Source Column', dataIndex: 'src', key: 'src', width: 240,
                render: v => (
                  <Space>
                    <Text code>{v}</Text>
                    {suggested[v] && suggested[v] !== columnMap[v] && (
                      <Tooltip title={`Auto-suggested: ${suggested[v]}`}>
                        <InfoCircleOutlined style={{ color: '#1677ff' }} />
                      </Tooltip>
                    )}
                  </Space>
                ),
              },
              {
                title: 'Maps To (Target Field)', key: 'target',
                render: (_, row) => (
                  <Select
                    allowClear
                    showSearch
                    placeholder="— Skip —"
                    value={columnMap[row.src] || undefined}
                    onChange={v => setColumnMap(prev => ({ ...prev, [row.src]: v || '' }))}
                    style={{ width: '100%' }}
                    options={[
                      ...TARGET_FIELDS.map(f => ({
                        value: f,
                        label: (
                          <Space>
                            {f.replace(/_/g, ' ')}
                            {REQUIRED_FIELDS.has(f) && <Tag color="red" style={{ fontSize: 10, padding: '0 4px' }}>required</Tag>}
                          </Space>
                        ),
                        disabled: Object.values(columnMap).includes(f) && columnMap[row.src] !== f,
                      })),
                    ]}
                  />
                ),
              },
              {
                title: 'Sample Value', key: 'sample', width: 200,
                render: (_, row) => {
                  const val = sample[0]?.[row.src];
                  return val != null ? <Text type="secondary" ellipsis style={{ maxWidth: 180 }}>{String(val)}</Text> : '—';
                },
              },
            ]}
            style={{ marginBottom: 16 }}
          />

          <Space>
            <Button onClick={() => setCurrent(1)}>Back</Button>
            <Button type="primary" onClick={onConfirmMapping}>
              Confirm Mapping &amp; Preview
            </Button>
          </Space>
        </div>
      )}

      {/* ── Step 3: Preview ───────────────────────────────────────────── */}
      {current === 3 && (
        <div>
          <Title level={5}>Import Preview</Title>
          <Space style={{ marginBottom: 12 }}>
            <Button type="primary" loading={loading} onClick={onPreview} icon={<SyncOutlined />}>
              {previewRows.length ? 'Refresh Preview' : 'Generate Preview'}
            </Button>
            <Button onClick={() => setCurrent(2)}>Back</Button>
          </Space>

          {previewRows.length > 0 && (
            <>
              <Space style={{ marginBottom: 12 }}>
                <Badge count={counts.create} color="green">
                  <Tag color="success">Create</Tag>
                </Badge>
                <Badge count={counts.merge} color="gold">
                  <Tag color="gold">Merge</Tag>
                </Badge>
                <Badge count={counts.errors} color="red">
                  <Tag color="error">Errors</Tag>
                </Badge>
                <Divider type="vertical" />
                <Segmented
                  value={rowFilter}
                  onChange={setRowFilter}
                  options={[
                    { label: `All (${previewRows.length})`,       value: 'all' },
                    { label: `Create (${counts.create})`,          value: 'create' },
                    { label: `Merge (${counts.merge})`,            value: 'merge' },
                    { label: `Errors (${counts.errors})`,          value: 'errors' },
                  ]}
                />
              </Space>

              <Table
                size="small"
                rowKey="rowIdx"
                rowSelection={rowSelection}
                dataSource={filteredRows}
                columns={previewCols}
                pagination={{ pageSize: 50, showTotal: t => `${t} rows` }}
                style={{ marginBottom: 16 }}
              />

              <Space>
                <Text type="secondary">{selectedIdxs.length} row(s) selected for import</Text>
                <Button
                  type="primary"
                  loading={loading}
                  icon={<ImportOutlined />}
                  onClick={onImport}
                  disabled={!selectedIdxs.length}
                >
                  Import Selected ({selectedIdxs.length})
                </Button>
              </Space>
            </>
          )}
        </div>
      )}

      {/* ── Step 4: Done ─────────────────────────────────────────────── */}
      {current === 4 && result && (
        <div style={{ maxWidth: 560 }}>
          <Title level={5}>Import Complete</Title>
          <Row gutter={16} style={{ marginBottom: 24 }}>
            <Col span={8}>
              <Card size="small" style={{ textAlign: 'center', background: '#f6ffed', borderColor: '#b7eb8f' }}>
                <Title level={3} style={{ color: '#52c41a', margin: 0 }}>{result.success}</Title>
                <Text type="secondary">Imported</Text>
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small" style={{ textAlign: 'center', background: '#fffbe6', borderColor: '#ffe58f' }}>
                <Title level={3} style={{ color: '#faad14', margin: 0 }}>
                  {result.successes?.filter(s => s.action === 'merged').length || 0}
                </Title>
                <Text type="secondary">Merged</Text>
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small" style={{ textAlign: 'center', background: '#fff2f0', borderColor: '#ffccc7' }}>
                <Title level={3} style={{ color: '#ff4d4f', margin: 0 }}>{result.failed}</Title>
                <Text type="secondary">Failed</Text>
              </Card>
            </Col>
          </Row>

          {result.failures?.length > 0 && (
            <>
              <Divider>Failed Rows</Divider>
              <Table
                size="small"
                rowKey="row"
                pagination={false}
                dataSource={result.failures}
                columns={[
                  { title: 'Row', dataIndex: 'row', key: 'row', width: 60 },
                  { title: 'VM Name', dataIndex: ['data', 'vm_name'], key: 'vm_name' },
                  { title: 'Errors', dataIndex: 'errors', key: 'errors', render: errs => errs.join('; ') },
                ]}
              />
            </>
          )}

          <Space style={{ marginTop: 24 }}>
            <Button
              icon={<CloseCircleOutlined />}
              onClick={() => {
                setCurrent(0); setPreviewRows([]); setResult(null);
                setColumns([]); setSample([]); setTables([]);
                setColumnMap({}); setSuggested({}); setSavedCreds(null);
              }}
            >
              Start New Import
            </Button>
            <Button type="primary" onClick={() => setCurrent(3)}>
              Back to Preview
            </Button>
          </Space>
        </div>
      )}
    </Card>
  );
}
