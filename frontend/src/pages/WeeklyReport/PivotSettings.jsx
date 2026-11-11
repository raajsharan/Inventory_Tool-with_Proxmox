import { useEffect, useState } from 'react';
import {
  Alert, App, Button, Card, Checkbox, Collapse, Form, Input, Radio, Select, Space, Spin, Switch, Tag, Typography,
} from 'antd';
import { EyeOutlined, ReloadOutlined, SaveOutlined, UndoOutlined } from '@ant-design/icons';
import api from '../../api/client';

const { Text } = Typography;

// Immutable set at a path ('sources.assets.enabled').
function setPath(obj, path, value) {
  const [head, ...rest] = path.split('.');
  return { ...obj, [head]: rest.length ? setPath(obj?.[head] || {}, rest.join('.'), value) : value };
}

const tagSelect = (value, onChange, placeholder) => (
  <Select
    mode="tags" style={{ width: '100%' }} tokenSeparators={[',']} open={false}
    value={value || []} onChange={onChange} placeholder={placeholder}
  />
);

// ── Which assets are counted (advanced) ─────────────────────────────────────
function SourceFilters({ sources, value, onChange }) {
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
            <Form layout="vertical" size="small">
              <Form.Item label="Include this inventory">
                <Switch checked={!!c.enabled} onChange={v => set('enabled', v)} />
              </Form.Item>
              <Form.Item label="Server Status must be (empty = any)" extra="Exact match, e.g. Alive.">
                {tagSelect(c.status_include, v => set('status_include', v), 'Alive')}
              </Form.Item>
              <Form.Item label="OS must contain (empty = any)" extra="e.g. windows, linux.">
                {tagSelect(c.os_include, v => set('os_include', v), 'windows, linux')}
              </Form.Item>
              <Form.Item label="OS must not contain" extra="e.g. appliance, cisco, mac, storage, esxi, proxmox.">
                {tagSelect(c.os_exclude, v => set('os_exclude', v), 'esxi')}
              </Form.Item>
              <Form.Item label="Location must not contain" extra="e.g. beijing.">
                {tagSelect(c.location_exclude, v => set('location_exclude', v), 'beijing')}
              </Form.Item>
              <Form.Item label="Patching Type means Not Applicable" extra="% is a wildcard. These assets are left out of every column.">
                {tagSelect(c.patching_na, v => set('patching_na', v), 'Not Applicable%')}
              </Form.Item>
              <Form.Item label="Patching Type left out of Total" extra="% is a wildcard, e.g. EOL%, Exception%, %power%off%.">
                {tagSelect(c.patching_exclude, v => set('patching_exclude', v), 'EOL%')}
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

// ── Columns ────────────────────────────────────────────────────────────────
function ColumnsEditor({ meta, tc, onChange }) {
  const keys = meta.columns.map(c => c.key);
  const hidden = tc.hidden_columns || [];
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {meta.columns.map(col => (
        <Space key={col.key} wrap>
          <Checkbox
            checked={!hidden.includes(col.key)}
            onChange={e => onChange('hidden_columns',
              e.target.checked ? hidden.filter(k => k !== col.key) : [...new Set([...hidden, col.key])].filter(k => keys.includes(k)))}
          >
            Show
          </Checkbox>
          <Text style={{ width: 140, display: 'inline-block' }}>{col.label}</Text>
          <Input
            style={{ width: 220 }} placeholder={`Rename (now: ${col.label})`}
            value={tc.column_labels?.[col.key] || ''}
            onChange={e => onChange(`column_labels.${col.key}`, e.target.value)}
          />
        </Space>
      ))}
      <Text type="secondary" style={{ fontSize: 12 }}>A column with no values in any row is hidden automatically.</Text>
    </Space>
  );
}

// ── Percentage ─────────────────────────────────────────────────────────────
function PercentageEditor({ meta, tc, onChange }) {
  const opts = meta.columns.map(c => ({ value: c.key, label: tc.column_labels?.[c.key] || c.label }));
  const pct = tc.pct || {};
  return (
    <Form layout="vertical" size="small">
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

// ── One table's settings, split into short sections ────────────────────────
function TableEditor({ meta, tc, onChange, onReset }) {
  const sup = meta.supports;
  const groupOpts = (meta.group_fields || []).map(g => ({ value: g.key, label: g.label }));
  const filtersOn = sup.filters && tc.mode === 'filtered';

  const basics = (
    <Form layout="vertical" size="small">
      {sup.title && (
        <Form.Item label="Table title">
          <Input value={tc.title} onChange={e => onChange('title', e.target.value)} maxLength={200} />
        </Form.Item>
      )}
      {sup.group_by && (
        <Form.Item label="Group rows by">
          <Select
            style={{ width: 240 }} value={tc.group_by} onChange={v => onChange('group_by', v)}
            options={tc.mode === 'legacy' ? groupOpts.filter(o => ['location', 'department'].includes(o.value)) : groupOpts}
          />
        </Form.Item>
      )}
      {sup.mode && (
        <Form.Item label="Which assets are counted">
          <Radio.Group value={tc.mode} onChange={e => onChange('mode', e.target.value)}>
            <Radio.Button value="filtered">My own rules</Radio.Button>
            <Radio.Button value="legacy">Built-in rules</Radio.Button>
          </Radio.Group>
        </Form.Item>
      )}
      {sup.labels && (
        <Space wrap>
          <Form.Item label="Group column title">
            <Input value={tc.group_label} onChange={e => onChange('group_label', e.target.value)} />
          </Form.Item>
          <Form.Item label="Count column title">
            <Input value={tc.count_label} onChange={e => onChange('count_label', e.target.value)} />
          </Form.Item>
        </Space>
      )}
      {sup.footnote && (
        <Form.Item label="Footnote (empty = default)">
          <Input.TextArea rows={2} value={tc.footnote} onChange={e => onChange('footnote', e.target.value)} maxLength={600} />
        </Form.Item>
      )}
      {sup.hint && (
        <Form.Item label="Note under the title (empty = automatic)">
          <Input.TextArea rows={2} value={tc.hint} onChange={e => onChange('hint', e.target.value)} maxLength={600} />
        </Form.Item>
      )}
    </Form>
  );

  const items = [{ key: 'basics', label: <Text strong>Basics</Text>, children: basics }];

  if (sup.columns || sup.pct) {
    items.push({
      key: 'columns',
      label: <Text strong>{sup.pct ? 'Columns and percentage' : 'Columns'}</Text>,
      children: (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {sup.columns && <ColumnsEditor meta={meta} tc={tc} onChange={onChange} />}
          {sup.pct && <PercentageEditor meta={meta} tc={tc} onChange={onChange} />}
        </Space>
      ),
    });
  }
  if (sup.buckets) {
    items.push({
      key: 'buckets',
      label: <Text strong>Left out of the percentage</Text>,
      children: (
        <Form layout="vertical" size="small">
          <Form.Item label="MSL side">
            <Select mode="multiple" options={meta.buckets.map(b => ({ value: b, label: b }))}
              value={tc.msl_exclude_buckets || []} onChange={v => onChange('msl_exclude_buckets', v)} />
          </Form.Item>
          <Form.Item label="Ext. side">
            <Select mode="multiple" options={meta.buckets.map(b => ({ value: b, label: b }))}
              value={tc.ext_exclude_buckets || []} onChange={v => onChange('ext_exclude_buckets', v)} />
          </Form.Item>
        </Form>
      ),
    });
  }
  if (sup.os_lists) {
    items.push({
      key: 'os',
      label: <Text strong>OS classification</Text>,
      children: (
        <Form layout="vertical" size="small">
          <Form.Item label="Windows">{tagSelect(tc.os_windows, v => onChange('os_windows', v))}</Form.Item>
          <Form.Item label="Linux">{tagSelect(tc.os_linux, v => onChange('os_linux', v))}</Form.Item>
          <Form.Item label="Always Not Applicable">{tagSelect(tc.os_not_applicable, v => onChange('os_not_applicable', v))}</Form.Item>
        </Form>
      ),
    });
  }
  if (sup.excluded_groups) {
    items.push({
      key: 'hide',
      label: <Text strong>Hide rows</Text>,
      children: (
        <Form layout="vertical" size="small">
          <Form.Item label="Rows to hide (type the group name, press Enter)">
            {tagSelect(tc.excluded_groups, v => onChange('excluded_groups', v), 'e.g. Unassigned')}
          </Form.Item>
        </Form>
      ),
    });
  }
  if (sup.filters) {
    items.push({
      key: 'filters',
      label: <Text strong>Asset rules (advanced)</Text>,
      children: filtersOn
        ? <SourceFilters sources={meta._sources} value={tc.sources} onChange={onChange} />
        : <Alert type="info" showIcon message="Choose “My own rules” under Basics to edit these." />,
    });
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Text type="secondary">{meta.description}</Text>
      <Collapse defaultActiveKey={['basics', 'columns']} items={items} />
      <Button size="small" icon={<UndoOutlined />} onClick={onReset}>Reset this table to defaults</Button>
    </Space>
  );
}

// ── The tab ────────────────────────────────────────────────────────────────
export default function PivotSettingsPanel({ renderPreview }) {
  const { message } = App.useApp();
  const [meta, setMeta] = useState(null);
  const [tables, setTables] = useState(null);
  const [active, setActive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewStale, setPreviewStale] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const load = () => {
    setLoading(true);
    api.get('/weekly-report/pivot-config')
      .then(r => {
        setMeta(r.data.meta); setTables(r.data.config.tables); setDirty(false);
        setActive(a => a || r.data.meta.tables[0].key);
        setPreview(null); setPreviewStale(false); setPreviewError('');
      })
      .catch(e => message.error(e.response?.data?.error || 'Failed to load table settings'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []); // eslint-disable-line

  const touch = () => { setDirty(true); setPreviewStale(true); };
  const update = (key, path, value) => { setTables(t => ({ ...t, [key]: setPath(t[key], path, value) })); touch(); };
  const reset = (key) => { setTables(t => ({ ...t, [key]: JSON.parse(JSON.stringify(meta.defaults[key])) })); touch(); };

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
      const { data } = await api.put('/weekly-report/pivot-config', { tables });
      setTables(data.config.tables);
      setDirty(false);
      message.success('Saved — new reports and the Dashboard Weekly tab use these settings');
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to save table settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !meta || !tables) return <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>;
  const current = meta.tables.find(t => t.key === active) || meta.tables[0];

  return (
    <div>
      <Space wrap style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Space wrap>
          <Text strong>Table:</Text>
          <Select
            style={{ width: 360 }} value={current.key} onChange={setActive}
            options={meta.tables.map(t => ({ value: t.key, label: t.title }))}
          />
        </Space>
        <Space wrap>
          {dirty && <Tag color="gold">Unsaved changes</Tag>}
          <Button icon={<EyeOutlined />} loading={previewing} onClick={runPreview}>Preview</Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!dirty} onClick={save}>Save</Button>
          <Button icon={<ReloadOutlined />} onClick={load} disabled={saving || !dirty}>Discard</Button>
        </Space>
      </Space>

      <Card size="small" title="Settings" style={{ marginBottom: 16 }}>
        <TableEditor
          key={current.key}
          meta={{ ...current, _sources: meta.sources }}
          tc={tables[current.key]}
          onChange={(path, value) => update(current.key, path, value)}
          onReset={() => reset(current.key)}
        />
      </Card>

      <Card
        size="small"
        title={<Space>Preview <Tag>not saved</Tag>{preview && previewStale && <Tag color="orange">out of date — press Preview</Tag>}</Space>}
      >
        {previewError && <Alert type="error" showIcon message={previewError} style={{ marginBottom: 8 }} />}
        {!preview && !previewing && !previewError && (
          <Text type="secondary">Press Preview to see this table with your current settings. Nothing is saved until you press Save.</Text>
        )}
        {previewing && <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>}
        {preview && !previewing && (
          <div style={{ opacity: previewStale ? 0.55 : 1 }}>
            {renderPreview ? renderPreview(current.key, preview.sections) : null}
          </div>
        )}
      </Card>
    </div>
  );
}
