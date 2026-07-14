/**
 * shared.jsx — common components and hooks for all Migration Tracker tabs.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { Tag, Tooltip, Button, Space, Typography, theme, Popover, Checkbox, Divider } from 'antd';
import {
  CheckCircleOutlined, SyncOutlined, ClockCircleOutlined, StopOutlined,
  EyeOutlined, EyeInvisibleOutlined, CopyOutlined, SettingOutlined, HolderOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import api from '../../../api/client';

const { Text } = Typography;

// ── MIGRATION STATUS ──────────────────────────────────────────────────────────
const STATUS_CFG = {
  'Completed':             { color: 'success',    icon: <CheckCircleOutlined /> },
  'Cleaned up':            { color: 'cyan',       icon: <CheckCircleOutlined /> },
  'In Progress':           { color: 'processing', icon: <SyncOutlined spin />   },
  'Awaiting confirmation': { color: 'warning',    icon: <ClockCircleOutlined /> },
  'Not Started':           { color: 'default',    icon: <ClockCircleOutlined /> },
  'Blocked':               { color: 'error',      icon: <StopOutlined />        },
  'To be Deleted':         { color: 'orange',     icon: <DeleteOutlined />      },
  'Deleted':               { color: 'default',    icon: <DeleteOutlined />      },
  'Pending':               { color: 'default',    icon: <ClockCircleOutlined /> },
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
        <div key={label} className="migration-card" style={{
          flex: '1 1 130px', minWidth: 110,
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: token.borderRadiusLG,
          padding: '10px 14px',
        }}>
          <div style={{ fontSize: 11, color: token.colorTextSecondary, marginBottom: 4 }}>{label}</div>
          <div className="migration-card-value" style={{ fontSize: 22, fontWeight: 700, color: color || token.colorText, lineHeight: 1.2 }}>
            <AnimatedValue value={value} />
          </div>
          {sub && <div style={{ fontSize: 11, color: token.colorTextSecondary, marginTop: 2 }}>{sub}</div>}
        </div>
      ))}
    </div>
  );
}

// ── AUTHENTICATED FILE DOWNLOAD HELPER ───────────────────────────────────────
export function downloadBlob(url, filename) {
  const token = localStorage.getItem('token');
  fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.blob();
    })
    .then(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    })
    .catch(() => {});
}

// ── CSV DOWNLOAD HELPER ───────────────────────────────────────────────────────
export function downloadCSV(type, params = {}) {
  const qs = new URLSearchParams(params).toString();
  downloadBlob(`/api/migration/export/${type}${qs ? `?${qs}` : ''}`, `migration-${type}.csv`);
}

// ── CELL EMPTY RENDERER ───────────────────────────────────────────────────────
export function cell(v) {
  if (v == null || v === '') return <Text type="secondary">—</Text>;
  return v;
}

// ── COUNT-UP ANIMATION (data-visualization: "Counter animations accelerate then decelerate") ──
function useCountUp(target, duration = 380) {
  const prevRef = useRef(null);
  const rafRef  = useRef(null);
  const [val, setVal] = useState(typeof target === 'number' ? 0 : target);

  useEffect(() => {
    if (typeof target !== 'number' || isNaN(target)) {
      setVal(target);
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVal(target);
      prevRef.current = target;
      return;
    }
    const from = typeof prevRef.current === 'number' ? prevRef.current : 0;
    prevRef.current = target;
    if (from === target) return;
    let t0 = null;
    const tick = (ts) => {
      if (!t0) t0 = ts;
      const p = Math.min((ts - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(from + (target - from) * eased));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return val;
}

function AnimatedValue({ value }) {
  const display = useCountUp(typeof value === 'number' ? value : null);
  if (typeof value !== 'number' || value == null) return <>{value ?? '—'}</>;
  return <>{display ?? '—'}</>;
}

// ── COLUMN VISIBILITY + ORDER HOOK ───────────────────────────────────────────
export function useColumnVisibility(storageKey, allKeys) {
  const keysRef = useRef(allKeys);

  const [visible, setVisible] = useState(() => {
    try {
      const saved = localStorage.getItem(`col-vis:${storageKey}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        const valid = new Set(parsed.filter(k => keysRef.current.includes(k)));
        if (valid.size > 0) return valid;
      }
    } catch {}
    return new Set(keysRef.current);
  });

  const [order, setOrder] = useState(() => {
    try {
      const saved = localStorage.getItem(`col-ord:${storageKey}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Merge: saved order first, then any new keys appended at end
        const valid = parsed.filter(k => keysRef.current.includes(k));
        const added = keysRef.current.filter(k => !valid.includes(k));
        if (valid.length > 0) return [...valid, ...added];
      }
    } catch {}
    return [...keysRef.current];
  });

  const toggle = (key, checked) => {
    setVisible(prev => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else if (next.size > 1) next.delete(key);
      localStorage.setItem(`col-vis:${storageKey}`, JSON.stringify([...next]));
      return next;
    });
  };

  const reorder = (newOrder) => {
    setOrder(newOrder);
    localStorage.setItem(`col-ord:${storageKey}`, JSON.stringify(newOrder));
  };

  const reset = () => {
    const all = new Set(keysRef.current);
    setVisible(all);
    setOrder([...keysRef.current]);
    localStorage.removeItem(`col-vis:${storageKey}`);
    localStorage.removeItem(`col-ord:${storageKey}`);
  };

  return { visible, toggle, reset, order, reorder };
}

// ── COLUMN TOGGLE BUTTON (with drag-to-reorder) ───────────────────────────────
export function ColumnToggleButton({ columns, visible, onToggle, onReset, order, onReorder }) {
  const [dragKey, setDragKey] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const hiddenCount = columns.filter(c => !visible.has(c.key)).length;

  // Build display list: use persisted order when available, otherwise original order
  const orderedColumns = order
    ? [
        ...order.map(k => columns.find(c => c.key === k)).filter(Boolean),
        ...columns.filter(c => !order.includes(c.key)),
      ]
    : columns;

  const handleDragStart = (e, key) => {
    setDragKey(key);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, key) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!dragKey || dragKey === key) return;
    setDragOver(key);
    if (!onReorder) return;
    const cur = order || columns.map(c => c.key);
    const fromIdx = cur.indexOf(dragKey);
    const toIdx   = cur.indexOf(key);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
    const next = [...cur];
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, dragKey);
    onReorder(next);
  };

  const handleDragEnd = () => { setDragKey(null); setDragOver(null); };

  const content = (
    <div style={{ minWidth: 220, maxHeight: 440, overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 4px 6px' }}>
        <Button size="small" type="link" style={{ padding: 0 }}
          onClick={() => columns.forEach(c => onToggle(c.key, true))}>
          Show all
        </Button>
        <Button size="small" type="link" style={{ padding: 0 }} onClick={onReset}>
          Reset default
        </Button>
      </div>
      <Divider style={{ margin: '0 0 4px' }} />
      {onReorder && (
        <div style={{ fontSize: 11, color: '#8c8c8c', padding: '0 4px 6px', userSelect: 'none' }}>
          Drag <HolderOutlined /> to reorder
        </div>
      )}
      {orderedColumns.map(col => (
        <div
          key={col.key}
          draggable={!!onReorder}
          onDragStart={e => handleDragStart(e, col.key)}
          onDragOver={e => handleDragOver(e, col.key)}
          onDragEnd={handleDragEnd}
          style={{
            padding: '4px 4px',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            borderRadius: 4,
            cursor: onReorder ? 'grab' : 'default',
            background: dragOver === col.key ? 'rgba(22,119,255,0.06)' : undefined,
            borderTop: dragOver === col.key ? '2px solid #1677ff' : '2px solid transparent',
            transition: 'background 100ms ease, border-color 100ms ease',
          }}
        >
          {onReorder && (
            <HolderOutlined style={{ color: '#bfbfbf', fontSize: 13, flexShrink: 0 }} />
          )}
          <Checkbox
            checked={visible.has(col.key)}
            onChange={e => onToggle(col.key, e.target.checked)}
            disabled={visible.size === 1 && visible.has(col.key)}
          >
            <span style={{ fontSize: 13 }}>
              {typeof col.title === 'string' ? col.title : col.key}
            </span>
          </Checkbox>
        </div>
      ))}
    </div>
  );

  return (
    <Popover
      content={content}
      title="Show / hide · Drag to reorder"
      trigger="click"
      placement="bottomRight"
    >
      <Button icon={<SettingOutlined />}>
        Columns{hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ''}
      </Button>
    </Popover>
  );
}
