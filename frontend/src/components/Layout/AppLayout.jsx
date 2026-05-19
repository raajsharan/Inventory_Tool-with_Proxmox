import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import { Layout, Menu, Avatar, Dropdown, Breadcrumb, Space, Typography, Button, Tooltip } from 'antd';
import {
  DashboardOutlined, DatabaseOutlined, PlusOutlined, UploadOutlined,
  AppstoreAddOutlined, AppstoreOutlined, UnorderedListOutlined,
  UserOutlined, TeamOutlined, FileSearchOutlined,
  SettingOutlined, LogoutOutlined, HistoryOutlined, TagsOutlined,
  GlobalOutlined, BarChartOutlined, EyeOutlined, CloudServerOutlined,
  HddOutlined, SafetyCertificateOutlined,
  SunOutlined, MoonOutlined, FontSizeOutlined, MinusOutlined,
} from '@ant-design/icons';
import { useAuth } from '../../context/AuthContext.jsx';
import { useAppTheme } from '../../context/ThemeContext.jsx';
import api from '../../api/client';

const { Sider, Header, Content } = Layout;

export default function AppLayout() {
  const { user, logout, canSee, getPageLabel } = useAuth();
  const { mode, toggleMode, fontPx, increaseFont, decreaseFont, canIncrease, canDecrease } = useAppTheme();
  const nav = useNavigate();
  const loc = useLocation();
  const [customPages, setCustomPages] = useState([]);

  useEffect(() => {
    api.get('/custom-pages').then(r => setCustomPages(r.data.items || [])).catch(() => {});
  }, []);

  const isAdmin = ['admin', 'superadmin'].includes(user?.role);
  const canWrite = ['admin', 'superadmin', 'asset_manager'].includes(user?.role);
  const can = (pageKey, roleOk = true) => roleOk && (canSee ? canSee(pageKey) : true);

  const inventoryGroup = (key, pageKey, icon, defaultLabel, base, addLabel = 'Add') => {
    if (!can(pageKey)) return null;
    const label = getPageLabel ? getPageLabel(pageKey, defaultLabel) : defaultLabel;
    return {
      key, icon, label,
      children: [
        { key: `${base}`, label: <Link to={base}>All Records</Link> },
        canWrite && { key: `${base}/new`, icon: <PlusOutlined />, label: <Link to={`${base}/new`}>{addLabel}</Link> },
        canWrite && { key: `${base}/import`, icon: <UploadOutlined />, label: <Link to={`${base}/import`}>Import</Link> },
      ].filter(Boolean),
    };
  };

  const items = [
    can('dashboard') && { key: '/dashboard', icon: <DashboardOutlined />, label: <Link to="/dashboard">Dashboard</Link> },
    inventoryGroup('assets',          'assets',                <DatabaseOutlined />,    'Assets',           '/assets',         'Add Asset'),
    inventoryGroup('beijing-assets',  'beijing_assets',        <GlobalOutlined />,      'Beijing Assets',   '/beijing-assets', 'Add Asset'),
    inventoryGroup('ext-assets',      'ext_assets',            <CloudServerOutlined />, 'Ext. Assets',      '/ext-assets',     'Add Asset'),
    inventoryGroup('physical-esxi',   'physical_esxi_servers', <HddOutlined />,         'Physical & ESXi',  '/physical-esxi',  'Add Server'),
    ...customPages
      .filter(p => can(`custom:${p.slug}`))
      .map((p) => ({
        key: `custom-${p.slug}`,
        icon: <AppstoreOutlined />,
        label: p.name,
        children: [
          { key: `/custom-pages/${p.slug}`, icon: <UnorderedListOutlined />, label: <Link to={`/custom-pages/${p.slug}`}>All Records</Link> },
          canWrite && { key: `/custom-pages/${p.slug}/new`, icon: <PlusOutlined />, label: <Link to={`/custom-pages/${p.slug}/new`}>Add Record</Link> },
          canWrite && { key: `/custom-pages/${p.slug}/import`, icon: <UploadOutlined />, label: <Link to={`/custom-pages/${p.slug}/import`}>Import</Link> },
        ].filter(Boolean),
      })),
    can('reports') && { key: '/reports', icon: <BarChartOutlined />, label: <Link to="/reports">Report Builder</Link> },
    isAdmin && {
      key: 'admin', icon: <SettingOutlined />, label: 'Administration',
      children: [
        can('admin/users')            && { key: '/admin/users',             icon: <TeamOutlined />,           label: <Link to="/admin/users">Users</Link> },
        can('admin/dropdowns')        && { key: '/admin/dropdowns',         icon: <SettingOutlined />,        label: <Link to="/admin/dropdowns">Dropdowns</Link> },
        can('admin/tag-ranges')       && { key: '/admin/tag-ranges',        icon: <TagsOutlined />,           label: <Link to="/admin/tag-ranges">Tag Ranges</Link> },
        can('admin/custom-pages')     && { key: '/admin/custom-pages',      icon: <AppstoreAddOutlined />,    label: <Link to="/admin/custom-pages">Custom Pages</Link> },
        can('admin/field-visibility') && { key: '/admin/field-visibility',  icon: <EyeOutlined />,            label: <Link to="/admin/field-visibility">Field Customization</Link> },
        can('admin/page-access')      && { key: '/admin/page-access',       icon: <SafetyCertificateOutlined />, label: <Link to="/admin/page-access">Page Access</Link> },
        can('admin/imports')          && { key: '/admin/imports',           icon: <HistoryOutlined />,        label: <Link to="/admin/imports">Import History</Link> },
        can('admin/audit')            && { key: '/admin/audit',             icon: <FileSearchOutlined />,     label: <Link to="/admin/audit">Audit Log</Link> },
      ].filter(Boolean),
    },
  ].filter(Boolean);

  const crumbs = loc.pathname.split('/').filter(Boolean).map((seg, i, arr) => ({
    title: <Link to={'/' + arr.slice(0, i + 1).join('/')}>{seg.replace(/-/g,' ').replace(/^./, c => c.toUpperCase())}</Link>,
  }));

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={240} breakpoint="lg" collapsedWidth={64} theme="dark">
        <div className="logo-title">INVENTORY · IT</div>
        <Menu
          key={`menu-${customPages.length}`}
          theme="dark"
          mode="inline"
          selectedKeys={[loc.pathname]}
          defaultOpenKeys={['assets', 'beijing-assets', 'ext-assets', 'physical-esxi', 'admin', ...customPages.map(p => `custom-${p.slug}`)]}
          items={items}
        />
      </Sider>
      <Layout>
        <Header className="app-header">
          <Breadcrumb items={[{ title: <Link to="/">Home</Link> }, ...crumbs]} />
          <Space size="middle">
            <Space.Compact>
              <Tooltip title="Decrease font size">
                <Button size="small" icon={<MinusOutlined />} onClick={decreaseFont} disabled={!canDecrease} />
              </Tooltip>
              <Tooltip title={`Current: ${fontPx}px`}>
                <Button size="small" icon={<FontSizeOutlined />} style={{ pointerEvents: 'none', minWidth: 56 }}>
                  {fontPx}
                </Button>
              </Tooltip>
              <Tooltip title="Increase font size">
                <Button size="small" icon={<PlusOutlined />} onClick={increaseFont} disabled={!canIncrease} />
              </Tooltip>
            </Space.Compact>
            <Tooltip title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
              <Button
                size="small"
                shape="circle"
                icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
                onClick={toggleMode}
              />
            </Tooltip>
            <Typography.Text type="secondary">{user?.role?.replace('_',' ')}</Typography.Text>
            <Dropdown
              menu={{
                items: [
                  { key: 'logout', icon: <LogoutOutlined />, label: 'Sign out', onClick: () => { logout(); nav('/login'); } },
                ],
              }}
            >
              <Space style={{ cursor: 'pointer' }}>
                <Avatar size="small" icon={<UserOutlined />} />
                {user?.fullName}
              </Space>
            </Dropdown>
          </Space>
        </Header>
        <Content className="page-shell">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
