import { useState, useEffect } from 'react';
import { App, Card, Typography, Button, Space, List, Alert, Tag, Tooltip } from 'antd';
import {
  DashboardOutlined, DatabaseOutlined, GlobalOutlined, CloudServerOutlined,
  HddOutlined, BarChartOutlined, ApartmentOutlined, AppstoreOutlined,
  ArrowUpOutlined, ArrowDownOutlined, MenuOutlined, ReloadOutlined, SaveOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';

export const NAV_STORAGE_KEY = 'inventoryNavOrder';

export const DEFAULT_NAV_ITEMS = [
  { key: '/dashboard',         label: 'Dashboard',                icon: DashboardOutlined,         description: 'Main overview dashboard' },
  { key: 'assets',             label: 'Assets',                   icon: DatabaseOutlined,          description: 'Asset inventory (All Records / Add / Import)' },
  { key: 'beijing-assets',     label: 'Beijing Assets',           icon: GlobalOutlined,            description: 'Beijing asset inventory' },
  { key: 'ext-assets',         label: 'Ext. Assets',              icon: CloudServerOutlined,       description: 'Extended asset inventory' },
  { key: 'physical-esxi',      label: 'Physical & ESXi Servers',  icon: HddOutlined,               description: 'Physical & ESXi server inventory' },
  { key: '__custom__',         label: 'Custom Pages',             icon: AppstoreOutlined,          description: 'Dynamically created custom pages' },
  { key: '/reports',           label: 'Report Builder',           icon: BarChartOutlined,          description: 'Report builder and exports' },
  { key: 'software-services',  label: 'Software Services',        icon: SafetyCertificateOutlined, description: 'ManageEngine, Nessus Agent & Tenable Report' },
  { key: 'vm-discovery',       label: 'VM Discovery',             icon: ApartmentOutlined,         description: 'VMware & Proxmox discovery' },
];

export function loadNavOrder() {
  try {
    const saved = localStorage.getItem(NAV_STORAGE_KEY);
    if (!saved) return null;
    let keys = JSON.parse(saved);
    // Migrate old separate software-status / nessus-status keys → software-services group
    const hasGroup = keys.includes('software-services');
    if (!hasGroup) {
      const oldIdx = keys.findIndex(k => k === '/software-status' || k === '/nessus-status');
      keys = keys.filter(k => k !== '/software-status' && k !== '/nessus-status');
      if (oldIdx !== -1) keys.splice(oldIdx, 0, 'software-services');
      else keys.push('software-services');
      localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify(keys));
    }
    return keys;
  } catch { return null; }
}

export default function NavOrder() {
  const { message } = App.useApp();
  const [items, setItems] = useState(DEFAULT_NAV_ITEMS);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const saved = loadNavOrder();
    if (saved) {
      const ordered = saved
        .map(k => DEFAULT_NAV_ITEMS.find(d => d.key === k))
        .filter(Boolean);
      const missing = DEFAULT_NAV_ITEMS.filter(d => !saved.includes(d.key));
      setItems([...ordered, ...missing]);
    }
  }, []);

  const move = (index, dir) => {
    const next = [...items];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
    setDirty(true);
  };

  const handleSave = () => {
    localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify(items.map(i => i.key)));
    window.dispatchEvent(new CustomEvent('navOrderChanged'));
    setDirty(false);
    message.success('Navigation order saved and applied to the sidebar.');
  };

  const handleReset = () => {
    localStorage.removeItem(NAV_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('navOrderChanged'));
    setItems(DEFAULT_NAV_ITEMS);
    setDirty(false);
    message.success('Navigation order reset to default.');
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <Typography.Title level={4} style={{ marginBottom: 4 }}>
        Menu Navigation Order
      </Typography.Title>
      <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        Reorder the top-level sidebar navigation sections using the arrow buttons.
        The <strong>Administration</strong> menu is always pinned at the bottom.
      </Typography.Text>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 20 }}
        message="Order is saved in this browser's local storage and applies immediately to the sidebar. Use Reset to restore the default order."
      />

      <Card bodyStyle={{ padding: 0 }}>
        <List
          dataSource={items}
          renderItem={(item, index) => {
            const Icon = item.icon;
            return (
              <List.Item
                style={{
                  padding: '14px 20px',
                  borderBottom: index < items.length - 1 ? '1px solid #f5f5f5' : 'none',
                  background: dirty && index === 0 ? 'transparent' : undefined,
                }}
                actions={[
                  <Tooltip title="Move up" key="up">
                    <Button
                      size="small"
                      icon={<ArrowUpOutlined />}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    />
                  </Tooltip>,
                  <Tooltip title="Move down" key="down">
                    <Button
                      size="small"
                      icon={<ArrowDownOutlined />}
                      disabled={index === items.length - 1}
                      onClick={() => move(index, 1)}
                    />
                  </Tooltip>,
                ]}
              >
                <Space size={14} align="center">
                  <MenuOutlined style={{ color: '#ccc', fontSize: 13, cursor: 'default' }} />
                  <span style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: 'rgba(22,119,255,0.1)', color: '#1677ff',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                    flexShrink: 0,
                  }}>
                    <Icon />
                  </span>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Typography.Text strong style={{ fontSize: 14 }}>{item.label}</Typography.Text>
                      <Tag color="default" style={{ fontSize: 11, padding: '0 6px', lineHeight: '18px' }}>
                        #{index + 1}
                      </Tag>
                    </div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {item.description}
                    </Typography.Text>
                  </div>
                </Space>
              </List.Item>
            );
          }}
        />

        {/* Pinned admin row */}
        <div style={{
          padding: '14px 20px',
          background: '#fafafa',
          borderTop: '1px solid #f0f0f0',
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <MenuOutlined style={{ color: '#ddd', fontSize: 13 }} />
          <span style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'rgba(0,0,0,0.04)', color: '#aaa',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
            flexShrink: 0,
          }}>
            <AppstoreOutlined />
          </span>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Typography.Text type="secondary" style={{ fontSize: 14 }}>Administration</Typography.Text>
              <Tag style={{ fontSize: 11, padding: '0 6px', lineHeight: '18px' }}>Pinned</Tag>
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Always shown last — admin-only section
            </Typography.Text>
          </div>
        </div>
      </Card>

      <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button icon={<ReloadOutlined />} onClick={handleReset}>
          Reset to Default
        </Button>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} disabled={!dirty}>
          Save Order
        </Button>
      </div>
    </div>
  );
}
