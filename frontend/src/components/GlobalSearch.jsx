import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, List, Modal, Tag, Typography, Empty, Tooltip } from 'antd';
import { SearchOutlined, DatabaseOutlined } from '@ant-design/icons';
import api from '../api/client';
import { DASH_CSS } from './DashboardStatCard.jsx';

const SOURCE_META = {
  assets:                 { label: 'MSL Assets',        base: '/assets',        color: 'blue' },
  beijing_assets:         { label: 'Beijing',           base: '/beijing-assets', color: 'purple' },
  ext_assets:             { label: 'Ext. Assets',       base: '/ext-assets',    color: 'cyan' },
  physical_esxi_servers:  { label: 'Physical / ESXi',   base: '/physical-esxi', color: 'orange' },
};

/**
 * Global asset search — header button + Ctrl+K. Finds any VM by name,
 * hostname, or IP across all four inventories and jumps to its detail page.
 */
export default function GlobalSearch() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);
  const inputRef = useRef(null);

  // Ctrl+K / Cmd+K opens; Esc closes (Modal handles Esc).
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) { setQ(''); setItems([]); return; }
    setTimeout(() => inputRef.current?.focus(), 60);
  }, [open]);

  function onChange(value) {
    setQ(value);
    clearTimeout(debounceRef.current);
    if (value.trim().length < 2) { setItems([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get('/search', { params: { q: value.trim() } });
        setItems(data.items || []);
      } catch { setItems([]); }
      finally { setLoading(false); }
    }, 280);
  }

  function goTo(item) {
    const meta = SOURCE_META[item.source] || SOURCE_META.assets;
    setOpen(false);
    nav(`${meta.base}/${item.id}`);
  }

  return (
    <>
      <style>{DASH_CSS}</style>
      <Tooltip title="Search any VM by name, hostname, or IP across every inventory">
        <Button size="small" icon={<SearchOutlined />} onClick={() => setOpen(true)}>
          Search
          <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>Ctrl+K</Typography.Text>
        </Button>
      </Tooltip>

      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={560}
        closable={false}
        destroyOnClose
        styles={{ body: { paddingTop: 8 } }}
      >
        <Input
          ref={inputRef}
          size="large"
          prefix={<SearchOutlined style={{ color: '#8c8c8c' }} />}
          placeholder="Find a VM by name, hostname, or IP…"
          value={q}
          onChange={(e) => onChange(e.target.value)}
          onPressEnter={() => items[0] && goTo(items[0])}
          allowClear
        />
        <div style={{ marginTop: 12, maxHeight: 380, overflowY: 'auto' }}>
          {q.trim().length >= 2 && !loading && items.length === 0 && (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={`No VM matches "${q.trim()}"`} style={{ padding: '20px 0' }} />
          )}
          <List
            loading={loading}
            dataSource={items}
            renderItem={(it, i) => {
              const meta = SOURCE_META[it.source] || SOURCE_META.assets;
              return (
                <List.Item
                  onClick={() => goTo(it)}
                  style={{ cursor: 'pointer', padding: '10px 12px', borderRadius: 8, animationDelay: `${Math.min(i, 10) * 30}ms` }}
                  className="global-search-row dashcard"
                >
                  <List.Item.Meta
                    avatar={
                      <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(91,107,140,0.12)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2 }}>
                        <DatabaseOutlined style={{ fontSize: 16, color: '#5B6B8C' }} />
                      </div>
                    }
                    title={
                      <span>
                        {it.vm_name || it.os_hostname || '(unnamed)'}
                        <Tag color={meta.color} style={{ marginLeft: 8, fontSize: 10 }}>{meta.label}</Tag>
                        {it.decommissioned && (
                          <Tag color="red" style={{ fontSize: 10 }}>Decommissioned</Tag>
                        )}
                      </span>
                    }
                    description={
                      <Typography.Text type="secondary" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        {[it.ip_address, it.os_hostname, it.os_type].filter(Boolean).join(' · ')}
                      </Typography.Text>
                    }
                  />
                </List.Item>
              );
            }}
          />
        </div>
        {items.length > 0 && (
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            Enter opens the first result
          </Typography.Text>
        )}
      </Modal>
    </>
  );
}
