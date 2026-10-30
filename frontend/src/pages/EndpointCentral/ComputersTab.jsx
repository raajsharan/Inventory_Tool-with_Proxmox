import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Input, Select, Table, Tag, Tooltip } from 'antd';
import api from '../../api/client';
import { INSTALL, LIVE, Pill, Dash, contact, isBlank, orDash } from './common';

const SIZES = [25, 50, 100, 200];
const opts = (map) => Object.entries(map).map(([value, s]) => ({ value: Number(value), label: s.label }));

// The service reports liveness as 0 Online / 1 Offline / 2 Unknown; the page uses EC's own 1 / 2 / 3.
const liveOf = (a) => (a.agent_status === 0 ? 1 : a.agent_status === 1 ? 2 : 3);

/** Every managed computer with its live and agent status and its custom groups. */
export default function ComputersTab({ agents, loading, error, groupsVersion, onOpenGroups }) {
  const [groupsSynced, setGroupsSynced] = useState(true);
  const [f, setF] = useState({ live: undefined, install: undefined, group: undefined, office: undefined });
  const [text, setText] = useState('');
  const [page, setPage] = useState({ current: 1, pageSize: 50 });
  const set = (patch) => { setF((x) => ({ ...x, ...patch })); setPage((p) => ({ ...p, current: 1 })); };

  useEffect(() => {
    api.get('/endpoint-central/groups').then((r) => setGroupsSynced(r.data.groups.length > 0)).catch(() => {});
  }, [groupsVersion]);

  const rows = useMemo(() => agents.map((a) => ({
    ...a,
    live: liveOf(a),
    groups: a.custom_groups || [],
    key: a.resource_id ?? a.computer_name,
  })), [agents]);

  const groupNames = useMemo(() => [...new Set(rows.flatMap((r) => r.groups))].sort(), [rows]);
  const offices    = useMemo(() => [...new Set(rows.map((r) => r.office).filter((o) => !isBlank(o)))].sort(), [rows]);

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase();
    return rows.filter((r) => {
      if (f.live    !== undefined && r.live !== f.live) return false;
      if (f.install !== undefined && r.agent_install_status !== f.install) return false;
      if (f.group === 'none' && r.groups.length) return false;
      if (f.group && f.group !== 'none' && !r.groups.includes(f.group)) return false;
      if (f.office === '(none)' && !isBlank(r.office)) return false;
      if (f.office && f.office !== '(none)' && r.office !== f.office) return false;
      if (q && ![r.computer_name, r.ip_address, r.mac_address, r.os_name, r.domain]
        .some((v) => !isBlank(v) && String(v).toLowerCase().includes(q))) return false;
      return true;
    });
  }, [rows, f, text]);

  const count = (fn) => rows.filter(fn).length;
  const cells = [
    ['Computers', rows.length],
    ['Live', count((r) => r.live === 1)],
    ['Down', count((r) => r.live === 2)],
    ['Unknown', count((r) => r.live === 3)],
    ['Agent not installed', count((r) => r.agent_install_status === 21)],
    ['Install failed', count((r) => r.agent_install_status === 29)],
  ];

  const columns = [
    { title: 'Computer', dataIndex: 'computer_name', sorter: (a, b) => String(a.computer_name).localeCompare(b.computer_name),
      render: (v) => (isBlank(v) ? <Dash /> : <b>{v}</b>) },
    { title: 'IP', dataIndex: 'ip_address', render: orDash },
    { title: 'OS', dataIndex: 'os_name', render: orDash },
    { title: 'Live', dataIndex: 'live', render: (v) => <Pill s={LIVE[v]} /> },
    { title: 'Agent', render: (_, r) => (r.agent_install_status == null
      ? <Dash />
      : <div>
          <Pill s={INSTALL[r.agent_install_status] || { label: String(r.agent_install_status), cls: 'idle', icon: null }} />
          {!isBlank(r.agent_version) && <div className="nx-ver nx-dim nx-small">{r.agent_version}</div>}
        </div>) },
    { title: 'Last contact', dataIndex: 'last_sync', render: contact },
    { title: 'Office', dataIndex: 'office', render: orDash },
    { title: 'Groups', render: (_, r) => (r.groups.length
      ? <span>
          {r.groups.slice(0, 2).map((g) => <Tag key={g}>{g}</Tag>)}
          {r.groups.length > 2 && <Tooltip title={r.groups.slice(2).join(', ')}><Tag>+{r.groups.length - 2}</Tag></Tooltip>}
        </span>
      : <Dash />) },
  ];

  return (
    <div>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      {!groupsSynced && !error && (
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="Custom groups have not been copied from Endpoint Central yet."
          description="Open Custom groups and press Sync now. Until then the Groups column stays empty."
          action={<Button size="small" onClick={onOpenGroups}>Open Custom groups</Button>} />
      )}
      <div className="nx-summary">
        {cells.map(([k, n]) => <div className="nx-cell" key={k}><div className="nx-k">{k}</div><div className="nx-big">{n}</div></div>)}
      </div>
      <div className="nx-toolbar">
        <Input.Search allowClear placeholder="Search name, IP, MAC, OS" style={{ width: 260 }}
          value={text} onChange={(e) => { setText(e.target.value); setPage((p) => ({ ...p, current: 1 })); }} />
        <Select allowClear placeholder="Live status" style={{ width: 140 }} options={opts(LIVE)} value={f.live} onChange={(v) => set({ live: v })} />
        <Select allowClear placeholder="Agent install" style={{ width: 170 }} options={opts(INSTALL)} value={f.install} onChange={(v) => set({ install: v })} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="Custom group" style={{ width: 200 }} value={f.group}
          onChange={(v) => set({ group: v })}
          options={[{ value: 'none', label: '(none)' }, ...groupNames.map((g) => ({ value: g, label: g }))]} />
        <Select allowClear placeholder="Office" style={{ width: 160 }} value={f.office} onChange={(v) => set({ office: v })}
          options={[{ value: '(none)', label: '(none)' }, ...offices.map((o) => ({ value: o, label: o }))]} />
      </div>
      <Table rowKey="key" size="small" loading={loading} dataSource={filtered} columns={columns} scroll={{ x: 'max-content' }}
        pagination={{ ...page, showSizeChanger: true, pageSizeOptions: SIZES, showTotal: (t) => `${t} computers`,
          onChange: (current, pageSize) => setPage({ current, pageSize }) }} />
    </div>
  );
}
