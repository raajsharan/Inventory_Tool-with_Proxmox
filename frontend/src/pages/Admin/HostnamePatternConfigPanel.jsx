import { useEffect, useState } from 'react';
import {
  Typography, Select, Input, Button, Space, Divider, App,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, SaveOutlined, UpOutlined, DownOutlined,
} from '@ant-design/icons';
import api from '../../api/client';
import { SEGMENT_LABELS, SEGMENT_ORDER_DEFAULT, isValidSegmentOrder } from '../../constants/hostnamePattern.js';

const CODE_RE = /^[A-Z0-9]{1,4}$/;

// Example code used per segment to render a live "e.g. ..." preview of the
// current order, purely illustrative — not tied to any real site/team/tier.
const SEGMENT_EXAMPLE = { site: 'BUR', os: 'W', team: 'ITO', tier: 'P', asset_tag: '0001' };

function SegmentOrderEditor({ order, onChange }) {
  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }
  return (
    <div style={{ marginBottom: 20 }}>
      <Typography.Text strong style={{ display: 'block', marginBottom: 2 }}>Hostname Pattern</Typography.Text>
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 10, fontSize: 12.5 }}>
        The order the segments below are joined into a hostname. Use the arrows to reorder.
      </Typography.Text>
      <div className="dd-list" style={{ marginBottom: 10 }}>
        {order.map((key, i) => (
          <div key={key} className="dd-row">
            <div className="dd-row-main">
              <Space size={10}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 22, height: 22, borderRadius: '50%', fontSize: 12,
                  background: 'var(--ant-color-fill-secondary, #f0f0f0)',
                }}>
                  {i + 1}
                </span>
                <span style={{ minWidth: 90 }}>{SEGMENT_LABELS[key]}</span>
              </Space>
            </div>
            <Space size={2}>
              <Button size="small" type="text" icon={<UpOutlined />} disabled={i === 0} onClick={() => move(i, -1)} />
              <Button size="small" type="text" icon={<DownOutlined />} disabled={i === order.length - 1} onClick={() => move(i, 1)} />
            </Space>
          </div>
        ))}
      </div>
      <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
        Format: {order.map(k => SEGMENT_LABELS[k]).join(' + ')} — e.g.{' '}
        <Typography.Text code>{order.map(k => SEGMENT_EXAMPLE[k]).join('')}</Typography.Text>
      </Typography.Text>
    </div>
  );
}

// Add/edit/remove rows of { code, label } — shared shape for Team Codes and
// Tier Codes, which only differ in copy and which config key they write to.
function CodeListEditor({ title, hint, rows, onChange }) {
  const [newCode, setNewCode] = useState('');
  const [newLabel, setNewLabel] = useState('');

  function updateRow(i, patch) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeRow(i) {
    onChange(rows.filter((_, idx) => idx !== i));
  }
  function addRow() {
    const code = newCode.trim().toUpperCase();
    if (!code || !CODE_RE.test(code)) return;
    if (!newLabel.trim()) return;
    if (rows.some(r => r.code === code)) return;
    onChange([...rows, { code, label: newLabel.trim() }]);
    setNewCode('');
    setNewLabel('');
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <Typography.Text strong style={{ display: 'block', marginBottom: 2 }}>{title}</Typography.Text>
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 10, fontSize: 12.5 }}>{hint}</Typography.Text>
      <div className="dd-list">
        {rows.map((r, i) => (
          <div key={i} className="dd-row">
            <div className="dd-row-main">
              <Space size={6} wrap>
                <Input
                  value={r.code}
                  onChange={(e) => updateRow(i, { code: e.target.value.toUpperCase() })}
                  style={{ width: 70 }}
                  maxLength={4}
                />
                <Input
                  value={r.label}
                  onChange={(e) => updateRow(i, { label: e.target.value })}
                  style={{ width: 260 }}
                />
              </Space>
            </div>
            <Button size="small" type="text" icon={<DeleteOutlined style={{ color: '#dc2626' }} />} onClick={() => removeRow(i)} />
          </div>
        ))}
      </div>
      <div className="dd-add-row">
        <Input value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase())} placeholder="Code" style={{ width: 70 }} maxLength={4} />
        <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Label..." style={{ flex: 1 }} onPressEnter={addRow} />
        <Button type="primary" icon={<PlusOutlined />} onClick={addRow}>Add</Button>
      </div>
    </div>
  );
}

// Lives on Dropdown Master as one more Collapse panel. Unlike the generic
// per-category editors above it on that page (a flat growable value list),
// this config is a handful of fixed settings saved together — so it gets its
// own form instead of being force-fit into CategoryPanel's add/edit-one-row
// shape.
export default function HostnamePatternConfigPanel({ assetTypeValues, locationValues, onAddLocation }) {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applicableTypes, setApplicableTypes] = useState([]);
  const [siteCodes, setSiteCodes] = useState({});
  const [teamCodes, setTeamCodes] = useState([]);
  const [tierCodes, setTierCodes] = useState([]);
  const [segmentOrder, setSegmentOrder] = useState(SEGMENT_ORDER_DEFAULT);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [newLocation, setNewLocation] = useState('');
  const [addingLocation, setAddingLocation] = useState(false);

  function load() {
    setLoading(true);
    api.get('/hostname-pattern-config')
      .then(({ data }) => {
        const c = data.config || {};
        setApplicableTypes(c.applicable_asset_types || []);
        setSiteCodes(c.site_codes || {});
        setTeamCodes(c.team_codes || []);
        setTierCodes(c.tier_codes || []);
        setSegmentOrder(isValidSegmentOrder(c.segment_order) ? c.segment_order : SEGMENT_ORDER_DEFAULT);
        setUpdatedAt(data.updated_at || null);
      })
      .catch(() => message.error('Failed to load hostname naming pattern config'))
      .finally(() => setLoading(false));
  }
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setSaving(true);
    try {
      await api.put('/hostname-pattern-config', {
        config: {
          applicable_asset_types: applicableTypes,
          site_codes: siteCodes,
          team_codes: teamCodes,
          tier_codes: tierCodes,
          segment_order: segmentOrder,
        },
      });
      message.success('Hostname naming pattern saved');
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function addLocation() {
    const value = newLocation.trim();
    if (!value) { message.warning('Enter a location name'); return; }
    if (locationValues.some(v => v.toLowerCase() === value.toLowerCase())) {
      message.warning(`"${value}" already exists`);
      return;
    }
    setAddingLocation(true);
    try {
      await onAddLocation(value);
      setNewLocation('');
    } catch (e) { /* parent (Dropdowns.jsx onAdd) already shows a message */ } finally {
      setAddingLocation(false);
    }
  }

  if (loading) return <Typography.Text type="secondary">Loading…</Typography.Text>;

  return (
    <div>
      <Typography.Paragraph type="secondary" style={{ marginTop: -4 }}>
        Controls the "Suggested Hostname" panel on the Assets, Beijing Assets, Ext. Assets, and
        Physical &amp; ESXi Servers forms: which Asset Types get the panel at all, the order its
        segments are joined in, and the Site / Team / Tier codes they're built from. The OS letter
        (Windows=W, Linux/Proxmox=L, VMware=E) isn't configurable — it's fixed by the asset's own OS Type.
      </Typography.Paragraph>

      <SegmentOrderEditor order={segmentOrder} onChange={setSegmentOrder} />

      <Divider style={{ margin: '0 0 20px' }} />

      <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>Applicable Asset Types</Typography.Text>
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12.5 }}>
        The Suggested Hostname panel only appears when the record's Asset Type is one of these.
      </Typography.Text>
      <Select
        mode="multiple"
        value={applicableTypes}
        onChange={setApplicableTypes}
        style={{ width: '100%', maxWidth: 520, marginBottom: 20 }}
        placeholder="Select which Asset Types get the Suggested Hostname panel"
        options={assetTypeValues.map(v => ({ value: v, label: v }))}
      />

      <Divider style={{ margin: '0 0 20px' }} />

      <Typography.Text strong style={{ display: 'block', marginBottom: 2 }}>Site Codes</Typography.Text>
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 10, fontSize: 12.5 }}>
        One short code per Location (managed above, under Locations). A Location left blank here can't suggest a hostname yet.
      </Typography.Text>
      <div className="dd-list" style={{ marginBottom: locationValues.length === 0 ? 0 : 10 }}>
        {locationValues.map(loc => (
          <div key={loc} className="dd-row">
            <div className="dd-row-main">
              <Space size={10}>
                <span style={{ minWidth: 160 }}>{loc}</span>
                <Input
                  value={siteCodes[loc] || ''}
                  onChange={(e) => setSiteCodes({ ...siteCodes, [loc]: e.target.value.toUpperCase() })}
                  placeholder="e.g. BUR"
                  style={{ width: 100 }}
                  maxLength={4}
                />
              </Space>
            </div>
          </div>
        ))}
      </div>
      <div className="dd-add-row" style={{ marginBottom: 20 }}>
        <Input
          value={newLocation}
          onChange={(e) => setNewLocation(e.target.value)}
          onPressEnter={addLocation}
          placeholder="Add new location..."
          style={{ flex: 1, maxWidth: 260 }}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={addLocation} loading={addingLocation}>Add Location</Button>
      </div>

      <Divider style={{ margin: '0 0 20px' }} />

      <CodeListEditor
        title="Team Codes"
        hint="Used to pre-fill the Team select, and auto-guessed from the department name when it's first selected."
        rows={teamCodes}
        onChange={setTeamCodes}
      />

      <CodeListEditor
        title="Tier Codes"
        hint="Production / Staging / Development / etc."
        rows={tierCodes}
        onChange={setTierCodes}
      />

      <Space align="center" style={{ marginTop: 8 }}>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>Save</Button>
        {updatedAt && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Last updated {new Date(updatedAt).toLocaleString()}
          </Typography.Text>
        )}
      </Space>
    </div>
  );
}
