import { useEffect, useState } from 'react';
import {
  Alert, App, Button, Card, Checkbox, Collapse, Divider, Form, Input, Radio, Select, Space, Spin, Switch, Tag, Typography,
} from 'antd';
import { ReloadOutlined, SaveOutlined, UndoOutlined } from '@ant-design/icons';
import api from '../../api/client';

const { Text, Paragraph } = Typography;

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

function SourceFilters({ meta, value, onChange }) {
  return (
    <Collapse
      size="small"
      items={meta.sources.map(src => {
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
              <Form.Item label="Server Status — only these (empty = any)" extra="Exact match, e.g. Alive. Alive But Powered Off is a different status.">
                {tagSelect(c.status_include, v => set('status_include', v), 'Alive')}
              </Form.Item>
              <Form.Item label="OS Type — only these (empty = any)" extra="Matches text contained in the OS type, e.g. windows, linux.">
                {tagSelect(c.os_include, v => set('os_include', v), 'windows, linux')}
              </Form.Item>
              <Form.Item label="OS Type — exclude" extra="e.g. appliance, cisco, mac, storage, esxi, proxmox.">
                {tagSelect(c.os_exclude, v => set('os_exclude', v), 'esxi')}
              </Form.Item>
              <Form.Item label="Location — exclude" extra="Matches text contained in the location, e.g. beijing.">
                {tagSelect(c.location_exclude, v => set('location_exclude', v), 'beijing')}
              </Form.Item>
              <Form.Item label="Patching Type = Not Applicable" extra="Patterns, % is a wildcard. These rows are left out of every column.">
                {tagSelect(c.patching_na, v => set('patching_na', v), 'Not Applicable%')}
              </Form.Item>
              <Form.Item label="Patching Type — exclude from Total" extra="Patterns, % is a wildcard, e.g. EOL%, Exception%, %power%off%.">
                {tagSelect(c.patching_exclude, v => set('patching_exclude', v), 'EOL%')}
              </Form.Item>
              <Form.Item label="Exclude when EOL Status = EOL">
                <Switch checked={!!c.exclude_eol} onChange={v => set('exclude_eol', v)} />
              </Form.Item>
            </Form>
          ),
        };
      })}
    />
  );
}

function ColumnsEditor({ meta, tc, onChange, isPatching }) {
  const keys = meta.columns.map(c => c.key);
  const hidden = tc.hidden_columns || [];
  return (
    <>
      {isPatching && tc.hidden_columns == null && (
        <Alert type="info" showIcon style={{ marginBottom: 8 }}
          message="Visible columns are inherited from Compliance Config until you change them here." />
      )}
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
            <Text style={{ width: 150, display: 'inline-block' }}>{col.label}</Text>
            <Input
              style={{ width: 240 }} placeholder={`Label (default: ${col.label})`}
              value={tc.column_labels?.[col.key] || ''}
              onChange={e => onChange(`column_labels.${col.key}`, e.target.value)}
            />
          </Space>
        ))}
      </Space>
      <Paragraph type="secondary" style={{ marginTop: 8, fontSize: 12 }}>
        Columns with no values in any row stay hidden automatically.
      </Paragraph>
    </>
  );
}

function PercentageEditor({ meta, tc, onChange }) {
  const opts = meta.columns.map(c => ({ value: c.key, label: tc.column_labels?.[c.key] || c.label }));
  const pct = tc.pct || {};
  return (
    <>
      <Radio.Group value={pct.mode} onChange={e => onChange('pct.mode', e.target.value)} style={{ marginBottom: 8 }}>
        <Radio value="formula">Formula: sum of columns ÷ sum of columns</Radio>
        <Radio value="exclude">(Total − excluded columns) ÷ Total</Radio>
      </Radio.Group>
      {pct.mode === 'formula' ? (
        <Form layout="vertical" size="small">
          <Form.Item label="Numerator — add these columns">
            <Select mode="multiple" options={opts} value={pct.num || []} onChange={v => onChange('pct.num', v)} />
          </Form.Item>
          <Form.Item label="Denominator — add these columns">
            <Select mode="multiple" options={opts} value={pct.den || []} onChange={v => onChange('pct.den', v)} />
          </Form.Item>
        </Form>
      ) : (
        <Form layout="vertical" size="small">
          <Form.Item label="Columns subtracted from Total" extra={pct.exclude == null ? 'Not customised — inherits Compliance Config.' : undefined}>
            <Select mode="multiple" options={opts} value={pct.exclude || []} onChange={v => onChange('pct.exclude', v)} />
          </Form.Item>
        </Form>
      )}
    </>
  );
}

function TableEditor({ meta, tc, defaults, onChange, onReset }) {
  const sup = meta.supports;
  const isPatching = !!sup.pct;
  const groupOpts = (meta.group_fields || []).map(g => ({ value: g.key, label: g.label }));
  const filtersOn = sup.filters && tc.mode === 'filtered';
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Text type="secondary">{meta.description}</Text>

      <Form layout="vertical" size="small">
        {sup.title && (
          <Form.Item label="Table title">
            <Input value={tc.title} onChange={e => onChange('title', e.target.value)} maxLength={200} />
          </Form.Item>
        )}
        {sup.hint && (
          <Form.Item label="Hint text under the title" extra="Leave empty to generate it from the settings below.">
            <Input.TextArea rows={2} value={tc.hint} onChange={e => onChange('hint', e.target.value)} maxLength={600} />
          </Form.Item>
        )}
        {sup.footnote && (
          <Form.Item label="Footnote" extra="Leave empty to use the Compliance Config / built-in footnote.">
            <Input.TextArea rows={2} value={tc.footnote} onChange={e => onChange('footnote', e.target.value)} maxLength={600} />
          </Form.Item>
        )}
        {sup.labels && (
          <Space>
            <Form.Item label="Group column title">
              <Input value={tc.group_label} onChange={e => onChange('group_label', e.target.value)} />
            </Form.Item>
            <Form.Item label="Count column title">
              <Input value={tc.count_label} onChange={e => onChange('count_label', e.target.value)} />
            </Form.Item>
          </Space>
        )}
        {sup.mode && (
          <Form.Item label="Rule set" extra="Legacy keeps the built-in rules (row filters are ignored). Filtered uses the row filters below.">
            <Radio.Group value={tc.mode} onChange={e => onChange('mode', e.target.value)}>
              <Radio.Button value="filtered">Filtered (row filters)</Radio.Button>
              <Radio.Button value="legacy">Legacy (built-in)</Radio.Button>
            </Radio.Group>
          </Form.Item>
        )}
        {sup.group_by && (
          <Form.Item label="Group rows by (pivot field)" extra={tc.mode === 'legacy' ? 'Legacy rules can group by Location or Department only.' : undefined}>
            <Select
              style={{ width: 240 }} value={tc.group_by} onChange={v => onChange('group_by', v)}
              options={tc.mode === 'legacy' ? groupOpts.filter(o => ['location', 'department'].includes(o.value)) : groupOpts}
            />
          </Form.Item>
        )}
      </Form>

      {sup.filters && (
        <>
          <Divider orientation="left" plain style={{ margin: 0 }}>Row filters per inventory</Divider>
          {filtersOn
            ? <SourceFilters meta={{ sources: meta._sources }} value={tc.sources} onChange={onChange} />
            : <Alert type="info" showIcon message="Row filters apply when the rule set is “Filtered”." />}
        </>
      )}

      {sup.pct && (
        <>
          <Divider orientation="left" plain style={{ margin: 0 }}>Percentage</Divider>
          <PercentageEditor meta={meta} tc={tc} onChange={onChange} />
        </>
      )}

      {sup.columns && (
        <>
          <Divider orientation="left" plain style={{ margin: 0 }}>Columns and labels</Divider>
          <ColumnsEditor meta={meta} tc={tc} onChange={onChange} isPatching={isPatching} />
        </>
      )}

      {sup.excluded_groups && (
        <>
          <Divider orientation="left" plain style={{ margin: 0 }}>Hide groups</Divider>
          <Form layout="vertical" size="small">
            <Form.Item
              label="Hide these rows (exact group names)"
              extra={tc.excluded_groups == null ? 'Not customised — inherits Compliance Config.' : undefined}
            >
              {tagSelect(tc.excluded_groups, v => onChange('excluded_groups', v), 'e.g. Unassigned')}
            </Form.Item>
          </Form>
        </>
      )}

      {sup.buckets && (
        <>
          <Divider orientation="left" plain style={{ margin: 0 }}>Buckets left out of the compliance percentage</Divider>
          <Form layout="vertical" size="small">
            <Form.Item label="MSL side" extra={tc.msl_exclude_buckets == null ? 'Not customised — inherits Compliance Config.' : undefined}>
              <Select mode="multiple" options={meta.buckets.map(b => ({ value: b, label: b }))}
                value={tc.msl_exclude_buckets || []} onChange={v => onChange('msl_exclude_buckets', v)} />
            </Form.Item>
            <Form.Item label="Ext. side" extra={tc.ext_exclude_buckets == null ? 'Not customised — inherits Compliance Config.' : undefined}>
              <Select mode="multiple" options={meta.buckets.map(b => ({ value: b, label: b }))}
                value={tc.ext_exclude_buckets || []} onChange={v => onChange('ext_exclude_buckets', v)} />
            </Form.Item>
          </Form>
        </>
      )}

      {sup.os_lists && (
        <>
          <Divider orientation="left" plain style={{ margin: 0 }}>OS classification (contains-text, case-insensitive)</Divider>
          <Form layout="vertical" size="small">
            <Form.Item label="Windows">{tagSelect(tc.os_windows, v => onChange('os_windows', v))}</Form.Item>
            <Form.Item label="Linux">{tagSelect(tc.os_linux, v => onChange('os_linux', v))}</Form.Item>
            <Form.Item label="Always Not Applicable (overrides the two above)">
              {tagSelect(tc.os_not_applicable, v => onChange('os_not_applicable', v))}
            </Form.Item>
          </Form>
        </>
      )}

      <div>
        <Button icon={<UndoOutlined />} onClick={onReset}>Reset this table to defaults</Button>
      </div>
    </Space>
  );
}

export default function PivotSettingsPanel() {
  const { message } = App.useApp();
  const [meta, setMeta] = useState(null);
  const [tables, setTables] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/weekly-report/pivot-config')
      .then(r => { setMeta(r.data.meta); setTables(r.data.config.tables); setDirty(false); })
      .catch(e => message.error(e.response?.data?.error || 'Failed to load table settings'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []); // eslint-disable-line

  const update = (key, path, value) => {
    setTables(t => ({ ...t, [key]: setPath(t[key], path, value) }));
    setDirty(true);
  };
  const reset = (key) => {
    setTables(t => ({ ...t, [key]: JSON.parse(JSON.stringify(meta.defaults[key])) }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put('/weekly-report/pivot-config', { tables });
      setTables(data.config.tables);
      setDirty(false);
      message.success('Table settings saved — the Report tab and the Dashboard use them now');
    } catch (e) {
      message.error(e.response?.data?.error || 'Failed to save table settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !meta || !tables) return <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>;

  return (
    <div>
      <Alert
        type="info" showIcon style={{ marginBottom: 16 }}
        message="Table settings"
        description="Configure the pivot tables on the Report tab: what each table groups by, which assets count, which columns appear and how the percentage is calculated. Changes apply to new reports and the Dashboard Weekly tab; snapshots already saved keep their numbers."
      />
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!dirty} onClick={save}>Save settings</Button>
        <Button icon={<ReloadOutlined />} onClick={load} disabled={saving}>Discard changes</Button>
        {dirty && <Tag color="gold">Unsaved changes</Tag>}
      </Space>
      <Card bodyStyle={{ padding: 0 }}>
        <Collapse
          defaultActiveKey={[meta.tables[0].key]}
          items={meta.tables.map(t => ({
            key: t.key,
            label: <Text strong>{t.title}</Text>,
            children: (
              <TableEditor
                meta={{ ...t, _sources: meta.sources }}
                tc={tables[t.key]}
                defaults={meta.defaults[t.key]}
                onChange={(path, value) => update(t.key, path, value)}
                onReset={() => reset(t.key)}
              />
            ),
          }))}
        />
      </Card>
    </div>
  );
}
