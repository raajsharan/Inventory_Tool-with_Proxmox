import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Badge, Button, Empty, List, Popover, Space, Tag, Tooltip, Typography } from 'antd';
import {
  BellOutlined, KeyOutlined, DisconnectOutlined, ReloadOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import api from '../api/client';

// Each page's "Hosts & Credentials" tab is internal tab state, not its own
// route, so clicking an alert can only jump to the integration's page —
// the user picks the Hosts tab from there.
const INTEGRATION_META = {
  vmware:  { color: 'purple',   hostsPath: '/vmware-discovery' },
  proxmox: { color: 'geekblue', hostsPath: '/proxmox-discovery' },
  hyperv:  { color: 'blue',     hostsPath: '/hyperv-discovery' },
};

// Bell icon + badge in the app header. A WebSocket pushes an "alerts:changed"
// signal the moment any discovery run fails or recovers, so the badge and a
// pop-up notification appear immediately for every logged-in user with the
// app open — no waiting on the next poll. The 60s poll stays as a fallback
// in case the socket is down (proxy misconfigured, connection drop, etc).
export default function AlertBell() {
  const nav = useNavigate();
  const { notification } = App.useApp();
  const [alerts,  setAlerts]  = useState([]);
  const [loading, setLoading] = useState(false);
  const [open,    setOpen]    = useState(false);
  const alertsRef    = useRef([]);
  const firstLoadRef = useRef(true);
  const wsRef         = useRef(null);
  const reconnectRef  = useRef(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/alerts')
      .then(r => {
        const next = r.data.alerts || [];
        // Only pop a notification for entries that weren't there last time —
        // otherwise every page load would re-announce every existing alert.
        if (!firstLoadRef.current) {
          const prevKeys = new Set(alertsRef.current.map(a => `${a.integration}:${a.hostId}`));
          for (const a of next) {
            if (prevKeys.has(`${a.integration}:${a.hostId}`)) continue;
            notification.error({
              message: `${a.label} discovery failed — ${a.host}`,
              description: a.errorMessage,
              placement: 'topRight',
              duration: 8,
            });
          }
        }
        firstLoadRef.current = false;
        alertsRef.current = next;
        setAlerts(next);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [notification]);

  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    function connect() {
      const token = localStorage.getItem('token');
      if (!token) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws/alerts?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;
      ws.onmessage = (evt) => {
        try {
          if (JSON.parse(evt.data)?.type === 'alerts:changed') load();
        } catch { /* ignore malformed frame */ }
      };
      ws.onclose = () => { if (!cancelled) reconnectRef.current = setTimeout(connect, 5000); };
      ws.onerror = () => ws.close();
    }
    connect();
    return () => {
      cancelled = true;
      clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [load]);

  function goToHost(alert) {
    setOpen(false);
    const meta = INTEGRATION_META[alert.integration];
    if (meta) nav(meta.hostsPath);
  }

  const content = (
    <div style={{ width: 380, maxHeight: 420, overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Typography.Text strong>Discovery Alerts</Typography.Text>
        <Button size="small" type="text" icon={<ReloadOutlined />} loading={loading} onClick={load} />
      </div>
      {alerts.length === 0 ? (
        <Empty
          image={<CheckCircleOutlined style={{ fontSize: 32, color: '#52c41a' }} />}
          description="All integrations are healthy"
          style={{ padding: '16px 0' }}
        />
      ) : (
        <List
          size="small"
          dataSource={alerts}
          renderItem={(a) => (
            <List.Item
              style={{ cursor: 'pointer' }}
              onClick={() => goToHost(a)}
            >
              <List.Item.Meta
                avatar={a.isAuthError
                  ? <KeyOutlined style={{ color: '#faad14' }} />
                  : <DisconnectOutlined style={{ color: '#ff4d4f' }} />}
                title={
                  <Space size={6} wrap>
                    <Tag color={INTEGRATION_META[a.integration]?.color}>{a.label}</Tag>
                    <Typography.Text strong>{a.host}</Typography.Text>
                    {a.isAuthError && <Tag color="warning">Credential error</Tag>}
                  </Space>
                }
                description={
                  <Tooltip title={a.errorMessage}>
                    <Typography.Paragraph
                      type="secondary"
                      style={{ margin: 0, fontSize: 12 }}
                      ellipsis={{ rows: 2 }}
                    >
                      {a.errorMessage}
                    </Typography.Paragraph>
                  </Tooltip>
                }
              />
            </List.Item>
          )}
        />
      )}
    </div>
  );

  return (
    <Popover
      content={content}
      title={null}
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="bottomRight"
    >
      <Tooltip title="Discovery alerts">
        <Badge count={alerts.length} size="small" offset={[-2, 2]}>
          <Button
            size="small"
            shape="circle"
            icon={<BellOutlined style={{ color: alerts.length ? '#ff4d4f' : undefined }} />}
          />
        </Badge>
      </Tooltip>
    </Popover>
  );
}
