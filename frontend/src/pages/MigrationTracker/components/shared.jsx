/**
 * shared.jsx — common components and hooks for all Migration Tracker tabs.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { Tag, Tooltip, Button, Space, Typography, theme } from 'antd';
import {
  CheckCircleOutlined, SyncOutlined, ClockCircleOutlined, StopOutlined,
  EyeOutlined, EyeInvisibleOutlined, CopyOutlined,
} from '@ant-design/icons';
import api from '../../../api/client';

const { Text } = Typography;

// ── MIGRATION STATUS ──────────────────────────────────────────────────────────
const STATUS_CFG = {
  'Completed':   { color: 'success',   icon: <CheckCircleOutlined /> },
  'In Progress': { color: 'processing', icon: <SyncOutlined spin />  },
  'Not Started': { color: 'default',   icon: <ClockCircleOutlined /> },
  'Blocked':     { color: 'error',     icon: <StopOutlined />        },
  'Pending':     { color: 'default',   icon: <ClockCircleOutlined /> },
};

export function MigrationStatusBadge({ status }) {
  const s = status || 'Not Started';
  const cfg = STATUS_CFG[s] || STATUS_CFG['Not Started'];
  return (
    <Tag icon={cfg.icon} color={cfg.color} style={{ margin: 0 }}>
      {s}
    </Tag>
  );
}

// ── STAGE PILL (for vms_vacate / proxmox_install / vm_migration_back) ─────────
const STAGE_CFG = {
  'Completed':   { color: '#52c41a', bg: '#f6ffed', border: '#b7eb8f' },
  'In Progress': { color: '#1677ff', bg: '#e6f4ff', border: '#91caff' },
  'Pending':     { color: '#8c8c8c', bg: '#fafafa', border: '#d9d9d9' },
};

export function StagePill({ value, label, onChange, canEdit }) {
  const { token } = theme.useToken();
  const s = value || 'Pending';
  const cfg = STAGE_CFG[s] || STAGE_CFG['Pending'];
  const stages = ['Pending', 'In Progress', 'Completed'];
  const next = stages[(stages.indexOf(s) + 1) % stages.length];

  const pill = (
    <div style={{
      display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
      gap: 2, fontSize: 11, lineHeight: '16px',
    }}>
      {label && <span style={{ color: token.colorTextSecondary, whiteSpace: 'nowrap' }}>{label}</span>}
      <Tag
        style={{
          margin: 0, cursor: canEdit ? 'pointer' : 'default',
          color: cfg.color, background: cfg.bg, borderColor: cfg.border,
          fontWeight: 500, userSelect: 'none',
        }}
        onClick={canEdit ? () => onChange(next) : undefined}
      >
        {s}
      </Tag>
    </div>
  );

  return canEdit
    ? <Tooltip title={`Click to advance to "${next}"`}>{pill}</Tooltip>
    : pill;
}

// ── POWERSTATE BADGE ──────────────────────────────────────────────────────────
export function PowerstateBadge({ state }) {
  if (!state) return <Text type="secondary">—</Text>;
  const s = state.toLowerCase();
  if (s === 'poweredon')  return <Tag color="success">On</Tag>;
  if (s === 'poweredoff') return <Tag color="default">Off</Tag>;
  if (s === 'suspended')  return <Tag color="warning">Suspended</Tag>;
  return <Tag>{state}</Tag>;
}

// ── GUEST STATE BADGE ─────────────────────────────────────────────────────────
export function GuestStateBadge({ state }) {
  if (!state) return <Text type="secondary">—</Text>;
  const s = state.toLowerCase();
  if (s === 'running')    return <Tag color="success">Running</Tag>;
  if (s === 'notrunning') return <Tag color="warning">Not Running</Tag>;
  return <Tag>{state}</Tag>;
}

// ── DISK SIZE FORMATTER ───────────────────────────────────────────────────────
export function DiskSize({ mib }) {
  if (mib == null) return <Text type="secondary">—</Text>;
  const n = Number(mib);
  if (isNaN(n)) return <Text type="secondary">—</Text>;
  if (n >= 1024 * 1024) {
    return <Tooltip title={`${n.toLocaleString()} MiB`}>{(n / 1048576).toFixed(1)} TiB</Tooltip>;
  }
  if (n >= 1024) {
    return <Tooltip title={`${n.toLocaleString()} MiB`}>{(n / 1024).toFixed(1)} GiB</Tooltip>;
  }
  return <span>{n} MiB</span>;
}

// ── MASKED FIELD (iDRAC credentials) ─────────────────────────────────────────
export function MaskedField({ hostId, fieldName, canReveal, onRevealLog }) {
  const [revealed, setRevealed] = useState(false);
  const [value,    setValue]    = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [copied,   setCopied]   = useState(false);

  const reveal = useCallback(async () => {
    if (revealed) { setRevealed(false); return; }
    setLoading(true);
    try {
      const r = await api.get(`/migration/hosts/${hostId}/credentials`);
      setValue(fieldName === 'username' ? r.data.idrac_username : r.data.idrac_password);
      setRevealed(true);
      onRevealLog?.({ hostId, field: fieldName });
    } catch {
      /* permission error shown inline by api interceptor */
    } finally {
      setLoading(false);
    }
  }, [hostId, fieldName, revealed, onRevealLog]);

  const copy = () => {
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (!canReveal) return <Text type="secondary">••••••</Text>;

  return (
    <Space size={4}>
      {revealed
        ? <Text code style={{ fontSize: 12 }}>{value || '—'}</Text>
        : <Text type="secondary">••••••</Text>}
      <Button
        type="text" size="small" loading={loading}
        icon={revealed ? <EyeInvisibleOutlined /> : <EyeOutlined />}
        onClick={reveal}
        title={revealed ? 'Hide' : 'Reveal'}
      />
      {revealed && value && (
        <Button
          type="text" size="small"
          icon={<CopyOutlined />}
          onClick={copy}
          title={copied ? 'Copied!' : 'Copy'}
        />
      )}
    </Space>
  );
}

// ── TRUNCATED UUID ────────────────────────────────────────────────────────────
export function TruncatedUUID({ value }) {
  if (!value) return <Text type="secondary">—</Text>;
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <Tooltip title={
      <Space>
        <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{value}</span>
        <Button size="small" type="text" icon={<CopyOutlined />} onClick={copy} style={{ color: 'white' }}>
          {copied ? 'Copied' : ''}
        </Button>
      </Space>
    }>
      <Text style={{ fontFamily: 'monospace', fontSize: 11, cursor: 'pointer' }} onClick={copy}>
        {value.length > 12 ? `${value.slice(0, 8)}…` : value}
      </Text>
    </Tooltip>
  );
}

// ── TABLE STATE HOOK ──────────────────────────────────────────────────────────
/**
 * useMigrTable — encapsulates pagination, search, filter, sort, density, and
 * data fetching for all 4 migration tabs.
 *
 * @param {string} endpoint   - API path, e.g. '/migration/hosts'
 * @param {object} extraParams - additional static query params
 */
export function useMigrTable(endpoint, extraParams = {}) {
  const [page,      setPage]      = useState(1);
  const [pageSize,  setPageSize]  = useState(20);
  const [search,    setSearch]    = useState('');
  const [filters,   setFilters]   = useState({});
  const [data,      setData]      = useState({ items: [], total: 0 });
  const [loading,   setLoading]   = useState(false);
  const [density,   setDensity]   = useState('small'); // 'small' | 'middle'
  const [filterOpts,setFilterOpts]= useState({});
  const abortRef = useRef(null);

  const extraKey = JSON.stringify(extraParams);
  const load = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    try {
      const params = { page, pageSize, ...extraParams };
      if (search) params.search = search;
      Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
      const r = await api.get(endpoint, { params, signal: abortRef.current.signal });
      setData(r.data);
    } catch (e) {
      if (e?.code !== 'ERR_CANCELED') console.error('Migration fetch error', e);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, page, pageSize, search, filters, extraKey]);

  useEffect(() => { load(); }, [load]);

  // Load filter options scoped to current project
  useEffect(() => {
    const type = endpoint.replace('/migration/', '');
    api.get(`/migration/filter-options/${type}`, { params: extraParams })
      .then(r => setFilterOpts(r.data))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, extraKey]);

  const onSearch = useCallback((v) => { setSearch(v); setPage(1); }, []);
  const onFilter = useCallback((key, val) => { setFilters(f => ({ ...f, [key]: val })); setPage(1); }, []);
  const clearFilters = useCallback(() => { setFilters({}); setSearch(''); setPage(1); }, []);
  const reload = useCallback(() => load(), [load]);

  const pagination = {
    current: page,
    pageSize,
    total: data.total,
    showSizeChanger: true,
    pageSizeOptions: [10, 20, 50, 100],
    onChange: (p, ps) => { setPage(p); setPageSize(ps); },
    showTotal: (total) => `${total.toLocaleString()} rows`,
  };

  return {
    data, loading, pagination, density, setDensity,
    search, onSearch, filters, onFilter, clearFilters, filterOpts,
    reload,
  };
}

// ── SUMMARY CARD ROW ──────────────────────────────────────────────────────────
export function SummaryCards({ cards }) {
  const { token } = theme.useToken();
  return (
    <div style={{
      display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16,
    }}>
      {cards.map(({ label, value, color, sub }) => (
        <div key={label} style={{
          flex: '1 1 130px', minWidth: 110,
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: token.borderRadiusLG,
          padding: '10px 14px',
        }}>
          <div style={{ fontSize: 11, color: token.colorTextSecondary, marginBottom: 4 }}>{label}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: color || token.colorText, lineHeight: 1.2 }}>{value ?? '—'}</div>
          {sub && <div style={{ fontSize: 11, color: token.colorTextSecondary, marginTop: 2 }}>{sub}</div>}
        </div>
      ))}
    </div>
  );
}

// ── CSV DOWNLOAD HELPER ───────────────────────────────────────────────────────
export function downloadCSV(type, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `/api/migration/export/${type}${qs ? `?${qs}` : ''}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = `migration-${type}.csv`;
  a.click();
}

// ── CELL EMPTY RENDERER ───────────────────────────────────────────────────────
export function cell(v) {
  if (v == null || v === '') return <Text type="secondary">—</Text>;
  return v;
}
