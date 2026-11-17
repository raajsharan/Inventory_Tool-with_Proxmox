import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Empty, Segmented, Select, Space, Spin, Table, Tag, Typography, theme } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import api from '../../api/client';

const { Title, Text } = Typography;

const GREEN = '#2f9e6e';
const AMBER = '#e0a020';
const RED = '#d64545';
const METRIC_COLORS = { cpu: '#1d4ed8', ram: '#ea580c', storage: '#0f766e' };
const METRICS = [
  { key: 'cpu', label: 'CPU' },
  { key: 'ram', label: 'RAM' },
  { key: 'storage', label: 'Storage' },
];

const nf = (n, d = 0) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d });

// Capacity / used in each metric's own unit.
const UNIT = { cpu: ['cores', 0], ram: ['GB', 0], storage: ['TB', 1] };

function hostParts(h) {
  return {
    cpu: { cap: h.cpuCores, used: (h.cpuCores * h.cpuPct) / 100 },
    ram: { cap: h.ramGb, used: h.ramUsedGb ?? (h.ramGb * (h.ramPct ?? 0)) / 100 },
    storage: { cap: h.storageTb ?? 0, used: h.storageUsedTb ?? 0 },
  };
}

function aggregate(list) {
  const t = { cpu: { cap: 0, used: 0 }, ram: { cap: 0, used: 0 }, storage: { cap: 0, used: 0 }, vms: 0 };
  for (const h of list) {
    const p = hostParts(h);
    for (const m of METRICS) { t[m.key].cap += p[m.key].cap; t[m.key].used += p[m.key].used; }
    t.vms += h.vms || 0;
  }
  return t;
}

export default function EsxiUtilization() {
  const { token } = theme.useToken();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loc, setLoc] = useState('all');
  const [dept, setDept] = useState('all');
  const [mode, setMode] = useState('used');
  const [sortKey, setSortKey] = useState('name');

  const load = useCallback(() => {
    setLoading(true); setError('');
    api.get('/esxi-utilization')
      .then(r => setData(r.data))
      .catch(e => setError(e.response?.data?.error || 'Could not load ESXi utilization'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const level = useCallback((metric, usedPct) => {
    const crit = data?.thresholds?.critical?.[metric] ?? 85;
    const warn = data?.thresholds?.warning?.[metric] ?? 70;
    if (usedPct >= crit) return { fill: RED, text: '#b91c1c', name: 'Critical' };
    if (usedPct >= warn) return { fill: AMBER, text: '#92400e', name: 'Warning' };
    return { fill: GREEN, text: '#15803d', name: 'Healthy' };
  }, [data]);

  const allHosts = useMemo(() => (data?.hosts || []).filter(h => h.hasStats), [data]);
  const withoutStats = (data?.hosts || []).length - allHosts.length;
  const locations = useMemo(() => [...new Set(allHosts.map(h => h.location))].sort(), [allHosts]);
  const hosts = useMemo(() => allHosts.filter(h => loc === 'all' || h.location === loc), [allHosts, loc]);

  // Department order: by host count, Unassigned last.
  const deptNames = useMemo(() => {
    const counts = {};
    hosts.forEach(h => { counts[h.department] = (counts[h.department] || 0) + 1; });
    return Object.keys(counts).sort((a, b) =>
      (a === 'Unassigned') - (b === 'Unassigned') || counts[b] - counts[a] || a.localeCompare(b));
  }, [hosts]);

  // Reset the department filter if it no longer exists under the chosen location.
  useEffect(() => { if (dept !== 'all' && !deptNames.includes(dept)) setDept('all'); }, [deptNames, dept]);

  const isUsed = mode === 'used';
  const metricView = (metric, cap, used) => {
    const usedPct = cap > 0 ? Math.round((used / cap) * 100) : 0;
    const L = level(metric, usedPct);
    const [unit, dec] = UNIT[metric];
    return {
      key: metric, label: METRICS.find(m => m.key === metric).label,
      usedPct, freePct: 100 - usedPct, fill: L.fill, textColor: L.text, level: L.name,
      head: `${isUsed ? usedPct : 100 - usedPct}%`, sub: isUsed ? 'used' : 'free',
      usedTxt: `${nf(used, dec)} ${unit}`, freeTxt: `${nf(cap - used, dec)} ${unit}`, capTxt: `${nf(cap, dec)} ${unit}`,
    };
  };
  const metricsOf = (t) => METRICS.map(m => metricView(m.key, t[m.key].cap, t[m.key].used));

  const total = useMemo(() => aggregate(hosts), [hosts]); // eslint-disable-line react-hooks/exhaustive-deps
  const depts = useMemo(() => deptNames.map(n => {
    const list = hosts.filter(h => h.department === n);
    const t = aggregate(list);
    return { name: n, hosts: list.length, vms: t.vms, t };
  }), [deptNames, hosts]);

  const rows = useMemo(() => {
    const list = hosts.filter(h => dept === 'all' || h.department === dept);
    const k = { cpu: 'cpuPct', ram: 'ramPct', storage: 'storagePct' }[sortKey];
    return list.slice().sort((a, b) => (k ? (b[k] ?? -1) - (a[k] ?? -1) : a.name.localeCompare(b.name)));
  }, [hosts, dept, sortKey]);

  const exportCsv = () => {
    const head = ['Host', 'IP', 'vCenter', 'Department', 'Location', 'VMs', 'CPU cores', 'CPU used %', 'RAM GB', 'RAM used %', 'Storage TB', 'Storage used %'];
    const esc = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const body = rows.map(h => [h.name, h.ip, h.vcenter, h.department, h.location, h.vms, h.cpuCores, h.cpuPct, h.ramGb, h.ramPct, h.storageTb, h.storagePct]);
    const csv = [head, ...body].map(r => r.map(esc).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'esxi-utilization.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const track = token.colorFillSecondary;
  const card = { background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 10 };

  const Bar = ({ pctUsed, fill, h = 10 }) => (
    <div style={{ height: h, borderRadius: h / 2, background: track, overflow: 'hidden' }}>
      <div style={{ width: `${pctUsed}%`, height: '100%', background: fill }} />
    </div>
  );

  if (loading && !data) return <div style={{ textAlign: 'center', padding: 80 }}><Spin /></div>;
  if (error && !data) return <Alert type="error" showIcon message={error} />;
  if (!allHosts.length) {
    return (
      <Card>
        <Title level={4} style={{ marginTop: 0 }}>ESXi Utilization</Title>
        <Empty description="No ESXi utilization data yet. Run a VMware discovery to collect host capacity and usage." />
      </Card>
    );
  }

  const crit = data.thresholds.critical;
  const sameCrit = crit.cpu === crit.ram && crit.ram === crit.storage;
  const legend = sameCrit
    ? [`Under ${data.thresholds.warning.cpu}% used`, `${data.thresholds.warning.cpu}-${crit.cpu}%`, `${crit.cpu}% and over`]
    : ['Healthy', 'Warning', 'Critical'];

  const summary = metricsOf(total);
  const chartMax = 100; // percent
  const sortBtn = (key, label) => (
    <a onClick={() => setSortKey(key)} style={{ color: sortKey === key ? token.colorPrimary : undefined, fontWeight: 700 }}>
      {label}{sortKey === key ? (key === 'name' ? ' (A-Z)' : ' (high-low)') : ''}
    </a>
  );
  const cellFor = (h, metric) => {
    const usedPct = { cpu: h.cpuPct, ram: h.ramPct, storage: h.storagePct }[metric];
    if (usedPct == null) return <Text type="secondary">—</Text>;
    const p = hostParts(h)[metric];
    const L = level(metric, usedPct);
    const [unit, dec] = UNIT[metric];
    return (
      <div style={{ minWidth: 150 }}>
        <Bar pctUsed={Math.round(usedPct)} fill={L.fill} h={8} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 4 }}>
          <span style={{ fontWeight: 600, color: L.text }}>{Math.round(usedPct)}% used</span>
          <Text type="secondary">{Math.round(100 - usedPct)}% free</Text>
        </div>
        <Text type="secondary" style={{ fontSize: 11 }}>{nf(p.used, dec)} / {nf(p.cap, dec)} {unit}</Text>
      </div>
    );
  };

  const columns = [
    { title: sortBtn('name', 'Host'), dataIndex: 'name', render: (v, h) => (<div><div style={{ fontWeight: 600 }}>{v}</div><Text type="secondary" style={{ fontSize: 11 }}>{h.ip}</Text></div>) },
    { title: 'Department', dataIndex: 'department' },
    { title: 'Location', dataIndex: 'location' },
    { title: sortBtn('cpu', 'CPU'), key: 'cpu', render: (_, h) => cellFor(h, 'cpu') },
    { title: sortBtn('ram', 'RAM'), key: 'ram', render: (_, h) => cellFor(h, 'ram') },
    { title: sortBtn('storage', 'Storage'), key: 'storage', render: (_, h) => cellFor(h, 'storage') },
    { title: 'VMs', dataIndex: 'vms', align: 'center' },
  ];

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>VM Discovery › ESXi Utilization</Text>
          <Title level={4} style={{ margin: 0 }}>ESXi Capacity by Department</Title>
        </div>
        <Space wrap>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Last discovery: {data.lastDiscoveryAt ? new Date(data.lastDiscoveryAt).toLocaleString() : '—'}
          </Text>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>Refresh</Button>
          <Button type="primary" icon={<DownloadOutlined />} onClick={exportCsv}>Export CSV</Button>
        </Space>
      </div>

      {withoutStats > 0 && (
        <Alert type="info" showIcon
          message={`${withoutStats} ESXi host${withoutStats === 1 ? ' has' : 's have'} no usage data yet and ${withoutStats === 1 ? 'is' : 'are'} not counted.`} />
      )}

      <div style={{ ...card, padding: '14px 16px', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 16 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: token.colorTextSecondary, marginBottom: 4 }}>Location</div>
          <Select style={{ minWidth: 180 }} value={loc} onChange={setLoc}
            options={[{ value: 'all', label: 'All locations' }, ...locations.map(l => ({ value: l, label: l }))]} />
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: token.colorTextSecondary, marginBottom: 4 }}>Department</div>
          <Space>
            <span>{dept === 'all' ? 'All departments' : dept}</span>
            {dept !== 'all' && <Button size="small" onClick={() => setDept('all')}>Clear filter</Button>}
          </Space>
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: token.colorTextSecondary, marginBottom: 4 }}>Headline figure</div>
          <Segmented value={mode} onChange={setMode} options={[{ value: 'used', label: 'Used %' }, { value: 'free', label: 'Free %' }]} />
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 12, color: token.colorTextSecondary }}>
          {[[GREEN, legend[0]], [AMBER, legend[1]], [RED, legend[2]]].map(([c, t]) => (
            <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: c }} />{t}
            </span>
          ))}
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: track, border: `1px solid ${token.colorBorder}` }} />Free
          </span>
        </div>
      </div>

      <div>
        <Title level={5} style={{ margin: '0 0 10px' }}>
          All ESXi hosts combined <Text type="secondary" style={{ fontWeight: 400 }}>· {hosts.length} hosts · {total.vms} VMs</Text>
        </Title>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 16 }}>
          {summary.map(m => (
            <div key={m.key} style={{ ...card, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text strong type="secondary">{m.label}</Text>
                <span style={{ fontSize: 12, fontWeight: 600, color: m.textColor }}>{m.level}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 34, fontWeight: 700, lineHeight: 1 }}>{m.head}</span>
                <Text type="secondary">{m.sub}</Text>
              </div>
              <Bar pctUsed={m.usedPct} fill={m.fill} h={12} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span>Used <b>{m.usedPct}%</b></span><span>Free <b>{m.freePct}%</b></span>
              </div>
              <Text type="secondary" style={{ fontSize: 12 }}>{m.usedTxt} used of {m.capTxt}</Text>
            </div>
          ))}
        </div>
      </div>

      <div>
        <Title level={5} style={{ margin: '0 0 4px' }}>By department</Title>
        <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 10 }}>
          Select a card to filter the host table below. Percentages are summed used ÷ summed capacity per department.
        </Text>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(380px,1fr))', gap: 16 }}>
          {depts.map(d => {
            const sel = dept === d.name;
            return (
              <button key={d.name} type="button" onClick={() => setDept(sel ? 'all' : d.name)}
                style={{
                  ...card, textAlign: 'left', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14,
                  cursor: 'pointer', color: token.colorText,
                  border: `${sel ? 2 : 1}px solid ${sel ? token.colorPrimary : token.colorBorderSecondary}`,
                  boxShadow: sel ? `0 0 0 3px ${token.colorPrimaryBg}` : 'none',
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                  <Text strong style={{ fontSize: 15 }}>{d.name}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{d.hosts} hosts · {d.vms} VMs</Text>
                </div>
                {metricsOf(d.t).map(m => (
                  <div key={m.key} style={{ display: 'flex', flexDirection: 'column', gap: 5, width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <Text strong type="secondary" style={{ fontSize: 12 }}>{m.label}</Text>
                      <span style={{ fontSize: 13 }}><b>{m.head}</b> <Text type="secondary">{m.sub}</Text></span>
                    </div>
                    <Bar pctUsed={m.usedPct} fill={m.fill} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: token.colorTextSecondary }}>
                      <span>Used {m.usedPct}% · {m.usedTxt}</span><span>Free {m.freePct}% · {m.freeTxt}</span>
                    </div>
                  </div>
                ))}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ ...card, padding: '16px 18px 18px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginBottom: 14 }}>
          <Title level={5} style={{ margin: 0 }}>{isUsed ? 'Used %' : 'Free %'} by department: CPU, RAM and Storage</Title>
          <div style={{ display: 'flex', gap: 14, fontSize: 12 }}>
            {METRICS.map(m => (
              <span key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: METRIC_COLORS[m.key] }} />{m.label}
              </span>
            ))}
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 640 }}>
            <div style={{ position: 'relative', height: 236 }}>
              {[0, 25, 50, 75, 100].map(g => (
                <div key={g} style={{ position: 'absolute', left: 0, right: 0, bottom: (g / chartMax) * 200, borderTop: `1px solid ${token.colorBorderSecondary}` }}>
                  <span style={{ position: 'absolute', left: 0, top: -9, background: token.colorBgContainer, paddingRight: 6, fontSize: 11, color: token.colorTextSecondary }}>{g}%</span>
                </div>
              ))}
              <div style={{ position: 'absolute', left: 44, right: 0, top: 0, bottom: 0, display: 'flex' }}>
                {depts.map(d => (
                  <div key={d.name} style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center', alignItems: 'flex-end', gap: 4, height: '100%' }}>
                    {metricsOf(d.t).map(m => {
                      const v = isUsed ? m.usedPct : m.freePct;
                      return (
                        <div key={m.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', width: 22 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}>{v}%</span>
                          <div style={{ width: 22, height: Math.max(2, v * 2), background: METRIC_COLORS[m.key], borderRadius: '3px 3px 0 0' }} />
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', marginLeft: 44, marginTop: 8 }}>
              {depts.map(d => (
                <div key={d.name} style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: 12, fontWeight: 600 }}>{d.name}</div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ ...card, padding: '16px 18px 6px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
          <Title level={5} style={{ margin: 0 }}>
            Host detail <Text type="secondary" style={{ fontWeight: 400 }}>· {dept === 'all' ? 'All departments' : dept} · {rows.length} hosts</Text>
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>Each cell: used % / free %. Click a column heading to sort by highest usage.</Text>
        </div>
        <Table size="small" rowKey={(h) => `${h.vcenter}|${h.name}|${h.ip}`} columns={columns} dataSource={rows}
          pagination={rows.length > 25 ? { pageSize: 25, showSizeChanger: false } : false} scroll={{ x: 'max-content' }} />
        <div style={{ padding: '10px 4px 12px', fontSize: 11, color: token.colorTextSecondary }}>
          Capacity and usage come from the latest VMware discovery. CPU is shown in cores (usage % × core count). Department and Location are taken from the matching
          Physical &amp; ESXi Server record (by IP); hosts without one appear under <Tag style={{ margin: 0 }}>Unassigned</Tag>. Decommissioned servers are ignored.
        </div>
      </div>
    </Space>
  );
}
