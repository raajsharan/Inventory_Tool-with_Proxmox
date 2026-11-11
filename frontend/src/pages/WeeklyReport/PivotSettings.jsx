import { useEffect, useMemo, useState } from 'react';
import {
  Alert, App, Button, Card, Checkbox, Col, Collapse, Form, Input, InputNumber, Radio, Row, Select, Space,
  Spin, Switch, Table, Tag, Typography,
} from 'antd';
import {
  ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, EyeOutlined, PlusOutlined, ReloadOutlined,
  SaveOutlined, UndoOutlined,
} from '@ant-design/icons';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext.jsx';

const { Text } = Typography;

// Immutable set at a path ('sources.assets.enabled').
function setPath(obj, path, value) {
  const [head, ...rest] = path.split('.');
  return { ...obj, [head]: rest.length ? setPath(obj?.[head] || {}, rest.join('.'), value) : value };
}

const tagSelect = (value, onChange, placeholder, disabled) => (
  <Select
    mode="tags" style={{ width: '100%' }} tokenSeparators={[',']} open={false} disabled={disabled}
    value={value || []} onChange={onChange} placeholder={placeholder}
  />
);

// ── Which assets are counted (advanced, built-in tables) ───────────────────
function SourceFilters({ sources, value, onChange, disabled }) {
  return (
    <Collapse
      size="small"
      items={sources.map(src => {
        const c = value?.[src.key] || {};
        const set = (k, v) => onChange(`sources.${src.key}.${k}`, v);
        return {
          key: src.key,
          label: (
            <Space>
              <Text strong>{src.label}</Text>
              <Tag color={c.enabled ? 'green' : 'default'}>{c.enabled ? 'Included' : 'Not included'}</Tag>
            </Space>
          ),
          children: (
            <Form layout="vertical" size="small" disabled={disabled}>
              <Form.Item label="Include this inventory">
                <Switch checked={!!c.enabled} onChange={v => set('enabled', v)} />
              </Form.Item>
              <Form.Item label="Server Status must be (empty = any)" extra="Exact match, e.g. Alive.">
                {tagSelect(c.status_include, v => set('status_include', v), 'Alive', disabled)}
              </Form.Item>
              <Form.Item label="OS must contain (empty = any)" extra="e.g. windows, linux.">
                {tagSelect(c.os_include, v => set('os_include', v), 'windows, linux', disabled)}
              </Form.Item>
              <Form.Item label="OS must not contain" extra="e.g. appliance, cisco, mac, storage, esxi, proxmox.">
                {tagSelect(c.os_exclude, v => set('os_exclude', v), 'esxi', disabled)}
              </Form.Item>
              <Form.Item label="Location must not contain" extra="e.g. beijing.">
                {tagSelect(c.location_exclude, v => set('location_exclude', v), 'beijing', disabled)}
              </Form.Item>
              <Form.Item label="Patching Type means Not Applicable" extra="% is a wildcard. These assets are left out of every column.">
                {tagSelect(c.patching_na, v => set('patching_na', v), 'Not Applicable%', disabled)}
              </Form.Item>
              <Form.Item label="Patching Type left out of Total" extra="% is a wildcard, e.g. EOL%, Exception%, %power%off%.">
                {tagSelect(c.patching_exclude, v => set('patching_exclude', v), 'EOL%', disabled)}
              </Form.Item>
              <Form.Item label="Leave out when EOL Status is EOL">
                <Switch checked={!!c.exclude_eol} onChange={v => set('exclude_eol', v)} />
              </Form.Item>
            </Form>
          ),
        };
      })}
    />
  );
}

// ── Percentage ─────────────────────────────────────────────────────────────
function PercentageEditor({ cols, rules, onChange, disabled }) {
  const opts = cols.map(c => ({ value: c.key, label: c.label }));
  const pct = rules.pct || {};
  return (
    <Form layout="vertical" size="small" disabled={disabled}>
      <Form.Item label="Percentage is calculated as">
        <Radio.Group value={pct.mode} onChange={e => onChange('pct.mode', e.target.value)}>
          <Radio.Button value="formula">Columns ÷ columns</Radio.Button>
          <Radio.Button value="exclude">(Total − some columns) ÷ Total</Radio.Button>
        </Radio.Group>
      </Form.Item>
      {pct.mode === 'formula' ? (
        <>
          <Form.Item label="Top (numerator) = add these columns">
            <Select mode="multiple" options={opts} value={pct.num || []} onChange={v => onChange('pct.num', v)} />
          </Form.Item>
          <Form.Item label="Bottom (denominator) = add these columns">
            <Select mode="multiple" options={opts} value={pct.den || []} onChange={v => onChange('pct.den', v)} />
          </Form.Item>
        </>
      ) : (
        <Form.Item label="Subtract these columns from Total">
          <Select mode="multiple" options={opts} value={pct.exclude || []} onChange={v => onChange('pct.exclude', v)} />
        </Form.Item>
      )}
    </Form>
  );
}

// ── Calculation rules of a built-in table ──────────────────────────────────
function RulesEditor({ reg, rules, cols, sources, onChange, onReset, disabled }) {
  const sup = reg.supports;
  const groupOpts = (reg.group_fields || []).map(g => ({ value: g.key, label: g.label }));
  const filtersOn = sup.filters && rules.mode === 'filtered';

  const basics = (
    <Form layout="vertical" size="small" disabled={disabled}>
      {sup.group_by && (
        <Form.Item label="Group rows by">
          <Select
            style={{ width: 240 }} value={rules.group_by} onChange={v => onChange('group_by', v)}
            options={rules.mode === 'legacy' ? groupOpts.filter(o => ['location', 'department'].includes(o.value)) : groupOpts}
          />
        </Form.Item>
      )}
      {sup.mode && (
        <Form.Item label="Which assets are counted">
          <Radio.Group value={rules.mode} onChange={e => onChange('mode', e.target.value)}>
            <Radio.Button value="filtered">My own rules</Radio.Button>
            <Radio.Button value="legacy">Built-in rules</Radio.Button>
          </Radio.Group>
        </Form.Item>
      )}
      {sup.labels && (
        <Space wrap>
          <Form.Item label="Group column title">
            <Input value={rules.group_label} onChange={e => onChange('group_label', e.target.value)} />
          </Form.Item>
          <Form.Item label="Count column title">
            <Input value={rules.count_label} onChange={e => onChange('count_label', e.target.value)} />
          </Form.Item>
        </Space>
      )}
      {sup.footnote && (
        <Form.Item label="Footnote (empty = default)">
          <Input.TextArea rows={2} value={rules.footnote} onChange={e => onChange('footnote', e.target.value)} maxLength={600} />
        </Form.Item>
      )}
      {sup.hint && (
        <Form.Item label="Note under the title (empty = automatic)">
          <Input.TextArea rows={2} value={rules.hint} onChange={e => onChange('hint', e.target.value)} maxLength={600} />
        </Form.Item>
      )}
    </Form>
  );

  const items = [{ key: 'basics', label: <Text strong>Basics</Text>, children: basics }];
  if (sup.pct) {
    items.push({ key: 'pct', label: <Text strong>Percentage</Text>,
      children: <PercentageEditor cols={cols} rules={rules} onChange={onChange} disabled={disabled} /> });
  }
  if (sup.buckets) {
    items.push({
      key: 'buckets', label: <Text strong>Left out of the percentage</Text>,
      children: (
        <Form layout="vertical" size="small" disabled={disabled}>
          <Form.Item label="MSL side">
            <Select mode="multiple" options={reg.buckets.map(b => ({ value: b, label: b }))}
              value={rules.msl_exclude_buckets || []} onChange={v => onChange('msl_exclude_buckets', v)} />
          </Form.Item>
          <Form.Item label="Ext. side">
            <Select mode="multiple" options={reg.buckets.map(b => ({ value: b, label: b }))}
              value={rules.ext_exclude_buckets || []} onChange={v => onChange('ext_exclude_buckets', v)} />
          </Form.Item>
        </Form>
      ),
    });
  }
  if (sup.os_lists) {
    items.push({
      key: 'os', label: <Text strong>OS classification</Text>,
      children: (
        <Form layout="vertical" size="small" disabled={disabled}>
          <Form.Item label="Windows">{tagSelect(rules.os_windows, v => onChange('os_windows', v), '', disabled)}</Form.Item>
          <Form.Item label="Linux">{tagSelect(rules.os_linux, v => onChange('os_linux', v), '', disabled)}</Form.Item>
          <Form.Item label="Always Not Applicable">{tagSelect(rules.os_not_applicable, v => onChange('os_not_applicable', v), '', disabled)}</Form.Item>
        </Form>
      ),
    });
  }
  if (sup.excluded_groups) {
    items.push({
      key: 'hide', label: <Text strong>Hide rows</Text>,
      children: (
        <Form layout="vertical" size="small" disabled={disabled}>
          <Form.Item label="Rows to hide (type the group name, press Enter)">
            {tagSelect(rules.excluded_groups, v => onChange('excluded_groups', v), 'e.g. Unassigned', disabled)}
          </Form.Item>
        </Form>
      ),
    });
  }
  if (sup.filters) {
    items.push({
      key: 'filters', label: <Text strong>Asset rules (advanced)</Text>,
      children: filtersOn
        ? <SourceFilters sources={sources} value={rules.sources} onChange={onChange} disabled={disabled} />
        : <Alert type="info" showIcon message="Choose “My own rules” under Basics to edit these." />,
    });
  }
  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Text type="secondary">{reg.description}</Text>
      <Collapse defaultActiveKey={['basics']} items={items} />
      {!disabled && <Button size="small" icon={<UndoOutlined />} onClick={onReset}>Reset rules to defaults</Button>}
    </Space>
  );
}

// ── Column editor (guide section 6.2) ──────────────────────────────────────
// Built-in tables: only visible + label (the report engine fixes the rest).
// Detail tables: every property, any field from the whitelist.
function ColumnEditor({ row, meta, onChange, disabled }) {
  const fixed = row.config.kind === 'pivot';
  const cols = [...row.config.columns].sort((a, b) => a.order - b.order);
  const labelOf = (k) => meta.fields.find(f => f.key === k)?.label
    || meta.builtin.find(t => t.key === row.table_key)?.columns?.find(c => c.key === k)?.label || k;
  const used = new Set(cols.map(c => c.key));
  const free = meta.fields.filter(f => !used.has(f.key));

  const patch = (key, p) => onChange(cols.map(c => (c.key === key ? { ...c, ...p } : c)));
  const move = (i, d) => {
    const next = [...cols]; const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next.map((c, n) => ({ ...c, order: n + 1 })));
  };

  const columns = [
    { title: 'Order', width: 80, render: (_, c, i) => (
      <Space size={2}>
        <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={disabled || fixed || i === 0} onClick={() => move(i, -1)} />
        <Button size="small" type="text" icon={<ArrowDownOutlined />} disabled={disabled || fixed || i === cols.length - 1} onClick={() => move(i, 1)} />
      </Space>) },
    { title: 'Show', width: 60, render: (_, c) => (
      <Switch size="small" checked={c.visible} disabled={disabled} onChange={v => patch(c.key, { visible: v })} />) },
    { title: 'Field', width: 150, render: (_, c) => <Text type="secondary">{labelOf(c.key)}</Text> },
    { title: 'Label', render: (_, c) => (
      <Input size="small" maxLength={60} value={c.label} placeholder={labelOf(c.key)} disabled={disabled}
        onChange={e => patch(c.key, { label: e.target.value })} />) },
    ...(fixed ? [] : [
      { title: 'Format', width: 110, render: (_, c) => (
        <Select size="small" style={{ width: 96 }} value={c.format} disabled={disabled}
          options={meta.formats.map(f => ({ value: f, label: f }))} onChange={v => patch(c.key, { format: v })} />) },
      { title: 'Width', width: 100, render: (_, c) => (
        <InputNumber size="small" style={{ width: 84 }} min={meta.limits.minWidth} max={meta.limits.maxWidth}
          value={c.width} disabled={disabled} onChange={v => patch(c.key, { width: v || 140 })} />) },
      { title: 'Sortable', width: 80, render: (_, c) => (
        <Checkbox checked={c.sortable} disabled={disabled} onChange={e => patch(c.key, { sortable: e.target.checked })} />) },
      { title: '', width: 40, render: (_, c) => (
        <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={disabled}
          onClick={() => onChange(cols.filter(x => x.key !== c.key).map((x, n) => ({ ...x, order: n + 1 })))} />) },
    ]),
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Table size="small" rowKey="key" pagination={false} dataSource={cols} columns={columns} scroll={{ x: 'max-content' }} />
      {fixed
        ? <Text type="secondary" style={{ fontSize: 12 }}>
            This is a built-in table: you can show/hide and rename its columns. Their order and format are fixed by the report.
          </Text>
        : !disabled && (
          <Select
            style={{ width: 280 }} placeholder="Add a column…" value={null} disabled={!free.length || cols.length >= meta.limits.columns}
            options={free.map(f => ({ value: f.key, label: f.label }))}
            onChange={(k) => {
              const f = meta.fields.find(x => x.key === k);
              onChange([...cols, { key: k, label: f.label, visible: true, order: cols.length + 1, width: 150, sortable: true, format: f.format }]);
            }}
          />
        )}
    </Space>
  );
}

// ── Preview of a detail table (plain rows) ─────────────────────────────────
function DetailPreview({ detail }) {
  if (!detail) return null;
  return (
    <Table
      size="small" rowKey={(_, i) => i} pagination={false} dataSource={detail.rows} scroll={{ x: 'max-content' }}
      columns={detail.columns.map(c => ({
        title: c.label || c.key, dataIndex: c.key, width: c.width,
        sorter: c.sortable ? (a, b) => String(a[c.key] ?? '').localeCompare(String(b[c.key] ?? '')) : undefined,
        render: c.format === 'tag' ? (v) => (v ? <Tag>{v}</Tag> : null) : undefined,
      }))}
      footer={() => <Text type="secondary" style={{ fontSize: 12 }}>First {detail.rows.length} rows</Text>}
    />
  );
}

// ── Pivot options (guide: "End-user pivot options") ────────────────────────
function PivotOptions({ meta, value, onChange, disabled }) {
  const dims = meta.pivot_fields.map(f => ({ value: f.key, label: f.label }));
  const fields = value.row_fields.map(k => dims.find(d => d.value === k)).filter(Boolean);
  return (
    <Form layout="vertical" size="small" disabled={disabled}>
      <Form.Item label="Allow end users to pivot">
        <Switch checked={value.allow_pivot} onChange={v => onChange({ ...value, allow_pivot: v })} />
      </Form.Item>
      <Form.Item label="Fields users can group by" extra="High-cardinality fields (IP, asset tag, VM name…) are not offered.">
        <Select mode="multiple" options={dims} value={value.row_fields}
          onChange={v => onChange({ ...value, row_fields: v })} />
      </Form.Item>
      <Form.Item label="Values users can show">
        <Checkbox.Group value={value.value_options} onChange={v => onChange({ ...value, value_options: v })}
          options={[{ value: 'count', label: 'Count' }, { value: 'pct', label: '% of all' }, { value: 'rowpct', label: '% of row' }]} />
      </Form.Item>
      <Space wrap>
        <Form.Item label="Default rows">
          <Select style={{ width: 200 }} options={fields} value={value.default_rows}
            onChange={v => onChange({ ...value, default_rows: v })} />
        </Form.Item>
        <Form.Item label="Default columns">
          <Select style={{ width: 200 }} allowClear options={fields} value={value.default_cols || undefined}
            placeholder="None" onChange={v => onChange({ ...value, default_cols: v || '' })} />
        </Form.Item>
      </Space>
    </Form>
  );
}

// ── The tab ────────────────────────────────────────────────────────────────
export default function TableSettingsPanel({ renderPreview }) {
  const { message } = App.useApp();
  const { user } = useAuth();
  const isAdmin = ['admin', 'superadmin'].includes(user?.role);
  const ro = !isAdmin;

  const [meta, setMeta] = useState(null);
  const [tables, setTables] = useState(null);
  const [options, setOptions] = useState(null);
  const [active, setActive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewStale, setPreviewStale] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const apply = (d) => {
    setMeta(d.meta); setTables(d.tables); setOptions(d.options); setDirty(false);
    setActive(a => (d.tables.some(t => t.table_key === a) ? a : d.tables[0]?.table_key));
    setPreview(null); setPreviewStale(false); setPreviewError('');
  };
  const load = () => {
    setLoading(true);
    api.get('/weekly-report/table-config')
      .then(r => apply(r.data))
      .catch(e => message.error(e.response?.data?.error || 'Failed to load table settings'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []); // eslint-disable-line

  const touch = () => { setDirty(true); setPreviewStale(true); };
  const patchRow = (key, fn) => { setTables(ts => ts.map(t => (t.table_key === key ? fn(t) : t))); touch(); };
  const move = (i, d) => {
    setTables(ts => {
      const next = [...ts]; const j = i + d;
      if (j < 0 || j >= next.length) return ts;
      [next[i], next[j]] = [next[j], next[i]];
      return next.map((t, n) => ({ ...t, sort_order: n + 1 }));
    });
    touch();
  };

  const addDetail = () => {
    const key = `detail_${Date.now().toString(36)}`;
    const cols = ['vm_name', 'ip_address', 'os_type', 'department', 'server_status'].map((k, i) => {
      const f = meta.fields.find(x => x.key === k);
      return { key: k, label: f.label, visible: true, order: i + 1, width: 150, sortable: true, format: f.format };
    });
    setTables(ts => [...ts, { table_key: key, title: 'New detail table', enabled: true, sort_order: ts.length + 1,
      config: { kind: 'rows', source: 'all', groupBy: null, excludeStatuses: [], columns: cols } }]);
    setActive(key); touch();
  };
  const removeDetail = (key) => {
    setTables(ts => ts.filter(t => t.table_key !== key).map((t, n) => ({ ...t, sort_order: n + 1 })));
    setActive(tables.find(t => t.table_key !== key)?.table_key); touch();
  };
  const resetRules = (row) => patchRow(row.table_key, t => ({
    ...t, config: { ...t.config, rules: JSON.parse(JSON.stringify(meta.defaults[row.table_key])) },
  }));

  const runPreview = async () => {
    setPreviewing(true); setPreviewError('');
    try {
      const { data } = await api.post('/weekly-report/pivot-preview', { tables });
      setPreview(data); setPreviewStale(false);
    } catch (e) {
      setPreviewError(e.response?.data?.error || 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put('/weekly-report/table-config', { tables, options });
      apply(data);
      message.success('Saved — the Report tab, Pivot and exports use these settings');
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to save table settings');
    } finally {
      setSaving(false);
    }
  };

  const row = useMemo(() => tables?.find(t => t.table_key === active) || tables?.[0], [tables, active]);
  if (loading || !meta || !tables || !row) return <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>;

  const isPivot = row.config.kind === 'pivot';
  const reg = isPivot ? meta.builtin.find(t => t.key === row.table_key) : null;
  const rules = row.config.rules;
  const setRule = (path, value) => patchRow(row.table_key, t => {
    const r = setPath(t.config.rules, path, value);
    return { ...t, title: path === 'title' ? (value || t.title) : t.title, config: { ...t.config, rules: r } };
  });
  const setCfg = (p) => patchRow(row.table_key, t => ({ ...t, config: { ...t.config, ...p } }));

  const previewNode = !preview ? null : isPivot
    ? (renderPreview ? renderPreview(row.table_key, preview.sections) : null)
    : <DetailPreview detail={preview.detail?.find(d => d.key === row.table_key)} />;

  return (
    <div>
      {ro && <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="You can view these settings. Only an admin can change them." />}
      <Space wrap style={{ marginBottom: 16, width: '100%', justifyContent: 'flex-end' }}>
        {dirty && <Tag color="gold">Unsaved changes</Tag>}
        {!ro && <Button icon={<EyeOutlined />} loading={previewing} onClick={runPreview}>Preview</Button>}
        {!ro && <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!dirty} onClick={save}>Save changes</Button>}
        {!ro && <Button icon={<ReloadOutlined />} onClick={load} disabled={saving || !dirty}>Discard</Button>}
      </Space>

      <Row gutter={16}>
        <Col xs={24} md={8} lg={7}>
          <Card size="small" title="Report tables" extra={!ro && <Button size="small" icon={<PlusOutlined />} onClick={addDetail}>Detail table</Button>}>
            <Space direction="vertical" style={{ width: '100%' }} size={6}>
              {tables.map((t, i) => (
                <div
                  key={t.table_key} onClick={() => setActive(t.table_key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 6, cursor: 'pointer',
                    border: `1px solid ${t.table_key === row.table_key ? '#1677ff' : 'rgba(128,128,128,.25)'}`,
                  }}
                >
                  <Space size={0} direction="vertical">
                    <Button size="small" type="text" style={{ height: 16 }} icon={<ArrowUpOutlined />} disabled={ro || i === 0}
                      onClick={(e) => { e.stopPropagation(); move(i, -1); }} />
                    <Button size="small" type="text" style={{ height: 16 }} icon={<ArrowDownOutlined />} disabled={ro || i === tables.length - 1}
                      onClick={(e) => { e.stopPropagation(); move(i, 1); }} />
                  </Space>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                    <Text type="secondary" style={{ fontSize: 11 }}>{t.config.kind === 'pivot' ? 'Built-in' : 'Detail list'}</Text>
                  </div>
                  <Switch size="small" checked={t.enabled} disabled={ro}
                    onClick={(v, e) => { e.stopPropagation(); patchRow(t.table_key, x => ({ ...x, enabled: v })); }} />
                </div>
              ))}
            </Space>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
              Order and the switch control what the Report tab shows. Built-in tables are ordered within their own section.
            </Text>
          </Card>
        </Col>

        <Col xs={24} md={16} lg={17}>
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <Card
              size="small" title={row.title}
              extra={!ro && !isPivot && <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeDetail(row.table_key)}>Delete</Button>}
            >
              <Form layout="vertical" size="small" disabled={ro}>
                <Form.Item label="Table title">
                  <Input maxLength={120} value={isPivot ? rules.title : row.title}
                    onChange={e => (isPivot ? setRule('title', e.target.value) : patchRow(row.table_key, t => ({ ...t, title: e.target.value })))} />
                </Form.Item>
                {!isPivot && (
                  <Space wrap align="start">
                    <Form.Item label="Data source">
                      <Select style={{ width: 200 }} value={row.config.source} options={meta.sources.map(s => ({ value: s.key, label: s.label }))}
                        onChange={v => setCfg({ source: v })} />
                    </Form.Item>
                    <Form.Item label="Group by (optional)">
                      <Select style={{ width: 200 }} allowClear value={row.config.groupBy || undefined}
                        options={meta.pivot_fields.map(f => ({ value: f.key, label: f.label }))}
                        onChange={v => setCfg({ groupBy: v || null })} />
                    </Form.Item>
                    <Form.Item label="Exclude statuses" extra="NA and Not in Scope are always excluded.">
                      <div style={{ width: 280 }}>{tagSelect(row.config.excludeStatuses, v => setCfg({ excludeStatuses: v }), 'e.g. Decommissioned', ro)}</div>
                    </Form.Item>
                  </Space>
                )}
              </Form>
            </Card>

            <Card size="small" title="Columns">
              <ColumnEditor row={row} meta={meta} disabled={ro} onChange={(columns) => setCfg({ columns })} />
            </Card>

            {isPivot && (
              <Card size="small" title="Calculation rules">
                <RulesEditor
                  reg={reg} rules={rules} sources={meta.sources_meta} disabled={ro}
                  cols={row.config.columns} onChange={setRule} onReset={() => resetRules(row)}
                />
              </Card>
            )}

            <Card size="small" title="End-user pivot options (applies to the Pivot tab)">
              <PivotOptions meta={meta} value={options} disabled={ro}
                onChange={(o) => { setOptions(o); touch(); }} />
            </Card>

            {!ro && (
              <Card
                size="small"
                title={<Space>Preview <Tag>not saved</Tag>{preview && previewStale && <Tag color="orange">out of date — press Preview</Tag>}</Space>}
              >
                {previewError && <Alert type="error" showIcon message={previewError} style={{ marginBottom: 8 }} />}
                {!preview && !previewing && !previewError && (
                  <Text type="secondary">Press Preview to see this table with your current settings. Nothing is saved until you press Save changes.</Text>
                )}
                {previewing && <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>}
                {preview && !previewing && <div style={{ opacity: previewStale ? 0.55 : 1 }}>{previewNode}</div>}
              </Card>
            )}
          </Space>
        </Col>
      </Row>
    </div>
  );
}
