import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Empty, List, Popover, Space, Tag, Tooltip, Typography } from 'antd';
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

// Bell icon + badge in the app header. Polls the alerts endpoint so the
// count stays current without a full page reload; clicking opens a popover
// listing every host currently in a failed discovery state.
export default function AlertBell() {
  const nav = useNavigate();
  const [alerts,  setAlerts]  = useState([]);
  const [loading, setLoading] = useState(false);
  const [open,    setOpen]    = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/alerts')
      .then(r => setAlerts(r.data.alerts || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
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
