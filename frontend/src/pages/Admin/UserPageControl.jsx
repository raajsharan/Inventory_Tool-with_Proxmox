import { useEffect, useState } from 'react';
import {
  App, Avatar, Button, Col, Collapse, Row, Space, Spin, Switch, Tag, Typography, Alert,
} from 'antd';
import {
  LockOutlined, SafetyCertificateOutlined, SaveOutlined,
} from '@ant-design/icons';
import api from '../../api/client';

// ─── page registry ──────────────────────────────────────────────────────────
const PAGE_SECTIONS = [
  {
    title: 'MAIN NAVIGATION',
    pages: [
      { key: 'dashboard',             label: 'Dashboard' },
      { key: 'assets',                label: 'Assets' },
      { key: 'beijing_assets',        label: 'Beijing Assets' },
      { key: 'ext_assets',            label: 'Ext. Assets' },
      { key: 'physical_esxi_servers', label: 'Physical & ESXi Servers' },
      { key: 'reports',               label: 'Report Builder' },
      { key: 'vm-discovery',          label: 'VM Discovery' },
    ],
  },
  {
    title: 'SOFTWARE SERVICES',
    pages: [
      { key: 'software_status', label: 'ManageEngine Status' },
      { key: 'nessus_status',   label: 'Nessus Agent Status' },
      { key: 'tenable_report',  label: 'Tenable Report' },
    ],
  },
  {
    title: 'ADMINISTRATION',
    pages: [
      { key: 'admin/users',              label: 'User Management' },
      { key: 'admin/dropdowns',          label: 'Dropdowns' },
      { key: 'admin/tag-ranges',         label: 'Tag Ranges' },
      { key: 'admin/custom-pages',       label: 'Custom Pages' },
      { key: 'admin/field-visibility',   label: 'Field Customization' },
      { key: 'admin/page-access',        label: 'Page Access (Role-based)' },
      { key: 'admin/user-page-control',  label: 'User Page Control' },
      { key: 'admin/backup',             label: 'Backup / Export & Import' },
      { key: 'admin/branding',           label: 'Branding & Customization' },
      { key: 'admin/recycle-bin',        label: 'Recycle Bin' },
      { key: 'admin/imports',            label: 'Import History' },
      { key: 'admin/audit',              label: 'Audit Log' },
      { key: 'admin/nav-order',          label: 'Menu Order' },
    ],
  },
];

const ROLE_COLOR = { superadmin: 'red', admin: 'blue', asset_manager: 'orange', viewer: 'default' };

// ─── helpers ────────────────────────────────────────────────────────────────
function initUserData(users) {
  const map = {};
  for (const u of users) {
    map[u.id] = {
      can_view_passwords: u.can_view_passwords || false,
      page_access: { ...u.page_access },
      dirty: false,
      saving: false,
    };
  }
  return map;
}

function getAccess(userData, key) {
  if (!userData) return true;
  return Object.prototype.hasOwnProperty.call(userData.page_access, key)
    ? !!userData.page_access[key]
    : true;
}

// ─── panel body ─────────────────────────────────────────────────────────────
function UserPanel({ userId, userData, onChange }) {
  if (!userData) return null;

  const setField = (field, val) => onChange(userId, field, val);
  const setPageKey = (key, val) =>
    onChange(userId, 'page_access', { ...userData.page_access, [key]: val });

  return (
    <div style={{ paddingTop: 4 }}>
      {/* Password visibility */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 14,
          padding: '12px 16px', borderRadius: 8, marginBottom: 20,
          background: userData.can_view_passwords ? '#fffbe6' : '#fafafa',
          border: `1px solid ${userData.can_view_passwords ? '#ffe58f' : '#f0f0f0'}`,
          transition: 'background 0.25s, border-color 0.25s',
        }}
      >
        <Switch
          checked={userData.can_view_passwords}
          onChange={(v) => setField('can_view_passwords', v)}
        />
        <div>
          <Typography.Text strong>
            <LockOutlined style={{ marginRight: 6, color: '#faad14' }} />
            Can view asset passwords
          </Typography.Text>
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
            Allow this user to reveal passwords in Asset Inventory &amp; Extended Inventory
          </Typography.Text>
        </div>
      </div>

      {/* Page sections */}
      {PAGE_SECTIONS.map((section) => (
        <div key={section.title} style={{ marginBottom: 22 }}>
          <Typography.Text
            type="secondary"
            style={{
              display: 'block', marginBottom: 12,
              fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase',
            }}
          >
            {section.title}
          </Typography.Text>
          <Row gutter={[0, 10]}>
            {section.pages.map((page) => (
              <Col xs={24} sm={12} lg={8} key={page.key}>
                <Space size={10} align="center">
                  <Switch
                    checked={getAccess(userData, page.key)}
                    onChange={(v) => setPageKey(page.key, v)}
                  />
                  <Typography.Text style={{ fontSize: 13 }}>{page.label}</Typography.Text>
                </Space>
              </Col>
            ))}
          </Row>
        </div>
      ))}
    </div>
  );
}

// ─── main page ──────────────────────────────────────────────────────────────
export default function UserPageControl() {
  const { message } = App.useApp();
  const [users, setUsers] = useState([]);
  const [usersData, setUsersData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get('/user-page-control');
      setUsers(data.users || []);
      setUsersData(initUserData(data.users || []));
    } catch {
      setError('Failed to load users. Please refresh.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleChange = (userId, field, value) => {
    setUsersData((prev) => ({
      ...prev,
      [userId]: { ...prev[userId], [field]: value, dirty: true },
    }));
  };

  const handleSave = async (userId) => {
    const user = users.find((u) => u.id === userId);
    const ud = usersData[userId];
    if (!ud) return;

    setUsersData((prev) => ({ ...prev, [userId]: { ...prev[userId], saving: true } }));
    try {
      await api.put(`/user-page-control/${userId}`, {
        can_view_passwords: ud.can_view_passwords,
        page_access: ud.page_access,
      });
      message.success(`Saved access settings for ${user?.full_name || user?.email}.`);
      setUsersData((prev) => ({ ...prev, [userId]: { ...prev[userId], saving: false, dirty: false } }));
    } catch {
      message.error('Save failed — please try again.');
      setUsersData((prev) => ({ ...prev, [userId]: { ...prev[userId], saving: false } }));
    }
  };

  const collapseItems = users.map((u) => {
    const ud = usersData[u.id];
    return {
      key: u.id,
      label: (
        <Space size={12} align="center">
          <Avatar
            style={{ background: '#1677ff', flexShrink: 0, fontWeight: 700 }}
            size={38}
          >
            {(u.full_name || u.email || '?')[0].toUpperCase()}
          </Avatar>
          <div style={{ lineHeight: 1.4 }}>
            <Space size={8} wrap={false}>
              <Typography.Text strong style={{ fontSize: 14 }}>
                {u.full_name || u.email}
              </Typography.Text>
              <Tag color={ROLE_COLOR[u.role] || 'default'} style={{ margin: 0, fontSize: 11 }}>
                {u.role}
              </Tag>
              {!u.is_active && <Tag color="error" style={{ margin: 0 }}>Inactive</Tag>}
            </Space>
            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
              {u.email}
            </Typography.Text>
          </div>
        </Space>
      ),
      extra: (
        <Button
          type="primary"
          size="small"
          icon={<SaveOutlined />}
          loading={ud?.saving}
          disabled={!ud?.dirty}
          onClick={(e) => { e.stopPropagation(); handleSave(u.id); }}
          style={{ background: ud?.dirty ? '#52c41a' : undefined, borderColor: ud?.dirty ? '#52c41a' : undefined }}
        >
          Save
        </Button>
      ),
      children: (
        <UserPanel
          userId={u.id}
          userData={ud}
          onChange={handleChange}
        />
      ),
    };
  });

  return (
    <div>
      <Space align="start" style={{ marginBottom: 20 }}>
        <SafetyCertificateOutlined style={{ fontSize: 24, color: '#1677ff', marginTop: 3 }} />
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            Password &amp; Page Control
          </Typography.Title>
          <Typography.Text type="secondary">
            Control password visibility and page access for each user
          </Typography.Text>
        </div>
      </Space>

      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <Spin size="large" />
        </div>
      ) : users.length === 0 ? (
        <Alert type="info" message="No users found." showIcon />
      ) : (
        <Collapse
          accordion={false}
          defaultActiveKey={users[0]?.id ? [users[0].id] : []}
          items={collapseItems}
          style={{ background: 'transparent', border: 'none' }}
          className="user-page-control-collapse"
        />
      )}
    </div>
  );
}
