import { useEffect, useState } from 'react';
import {
  Typography, Select, Input, Button, Space, Divider, App,
} from 'antd';
import { PlusOutlined, DeleteOutlined, SaveOutlined } from '@ant-design/icons';
import api from '../../api/client';

const CODE_RE = /^[A-Z0-9]{1,4}$/;

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
export default function HostnamePatternConfigPanel({ assetTypeValues, locationValues }) {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applicableTypes, setApplicableTypes] = useState([]);
  const [siteCodes, setSiteCodes] = useState({});
  const [teamCodes, setTeamCodes] = useState([]);
  const [tierCodes, setTierCodes] = useState([]);
  const [updatedAt, setUpdatedAt] = useState(null);

  function load() {
    setLoading(true);
    api.get('/hostname-pattern-config')
      .then(({ data }) => {
        const c = data.config || {};
        setApplicableTypes(c.applicable_asset_types || []);
        setSiteCodes(c.site_codes || {});
        setTeamCodes(c.team_codes || []);
        setTierCodes(c.tier_codes || []);
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

  if (loading) return <Typography.Text type="secondary">Loading…</Typography.Text>;

  return (
    <div>
      <Typography.Paragraph type="secondary" style={{ marginTop: -4 }}>
        Controls the "Suggested Hostname" panel on the Assets, Beijing Assets, Ext. Assets, and
        Physical &amp; ESXi Servers forms: which Asset Types get the panel at all, and the Site /
        Team / Tier codes it composes into <code>Site + OS + Team + Tier + 4-digit Asset Tag</code>
        {' '}(e.g. <code>BURWITOP0001</code>). The OS letter (Windows=W, Linux/Proxmox=L, VMware=E)
        isn't configurable here — it's fixed by the asset's own OS Type.
      </Typography.Paragraph>

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
      <div className="dd-list" style={{ marginBottom: 20 }}>
        {locationValues.length === 0 ? (
          <Typography.Text type="secondary">Add Locations above first.</Typography.Text>
        ) : locationValues.map(loc => (
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
