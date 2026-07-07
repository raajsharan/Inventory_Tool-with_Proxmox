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
  CloudDownloadOutlined, BgColorsOutlined, IdcardOutlined,
  RestOutlined, ApartmentOutlined, ClusterOutlined, MenuOutlined, KeyOutlined,
  MenuFoldOutlined, MenuUnfoldOutlined, HeartOutlined, PoweroffOutlined,
} from '@ant-design/icons';
import { useAuth } from '../../context/AuthContext.jsx';
import { useAppTheme } from '../../context/ThemeContext.jsx';
import api from '../../api/client';
import GlobalSearch from '../GlobalSearch.jsx';
import { NAV_STORAGE_KEY, loadNavOrder } from '../../pages/Admin/NavOrder.jsx';

const { Sider, Header, Content, Footer } = Layout;

const DEFAULT_NAV_KEYS = [
  '/dashboard', 'assets', 'beijing-assets', 'ext-assets',
  'physical-esxi', '__custom__', '/reports', 'software-services', 'vm-discovery',
];

export default function AppLayout() {
  const { user, logout, canSee, getPageLabel, branding } = useAuth();
  const { mode, toggleMode, fontPx, increaseFont, decreaseFont, canIncrease, canDecrease } = useAppTheme();
  const nav = useNavigate();
  const loc = useLocation();
  const [customPages, setCustomPages] = useState([]);
  const [navOrder, setNavOrder] = useState(() => loadNavOrder() || DEFAULT_NAV_KEYS);
  const [buildCommit, setBuildCommit] = useState(null);
  // Sidebar collapse — remembered across sessions.
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sider-collapsed') === '1');
  const toggleSider = (v) => {
    setCollapsed(v);
    localStorage.setItem('sider-collapsed', v ? '1' : '0');
  };

  useEffect(() => {
    api.get('/custom-pages').then(r => setCustomPages(r.data.items || [])).catch(() => {});
    // Which backend build is live — answers "did the deploy take?" at a glance.
    fetch('/health').then(r => r.json())
      .then(h => { if (h?.commit && h.commit !== 'unknown') setBuildCommit(h.commit); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handler = () => setNavOrder(loadNavOrder() || DEFAULT_NAV_KEYS);
    window.addEventListener('navOrderChanged', handler);
    return () => window.removeEventListener('navOrderChanged', handler);
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

  const getNavSection = (key) => {
    switch (key) {
      case '/dashboard':
        return can('dashboard')
          ? [{ key: '/dashboard', icon: <DashboardOutlined />, label: <Link to="/dashboard">Dashboard</Link> }]
          : [];
      case 'assets':
        return [inventoryGroup('assets', 'assets', <DatabaseOutlined />, 'Assets', '/assets', 'Add Asset')].filter(Boolean);
      case 'beijing-assets':
        return [inventoryGroup('beijing-assets', 'beijing_assets', <GlobalOutlined />, 'Beijing Assets', '/beijing-assets', 'Add Asset')].filter(Boolean);
      case 'ext-assets':
        return [inventoryGroup('ext-assets', 'ext_assets', <CloudServerOutlined />, 'Ext. Assets', '/ext-assets', 'Add Asset')].filter(Boolean);
      case 'physical-esxi': {
        const physical = inventoryGroup('physical-esxi', 'physical_esxi_servers', <HddOutlined />, 'Physical & ESXi', '/physical-esxi', 'Add Server');
        const decom = can('decommissioned')
          ? { key: '/decommissioned', icon: <PoweroffOutlined />, label: <Link to="/decommissioned">Decommissioned</Link> }
          : null;
        return [physical, decom].filter(Boolean);
      }
      case '__custom__':
        return customPages
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
          }));
      case '/reports':
        return can('reports')
          ? [{ key: '/reports', icon: <BarChartOutlined />, label: <Link to="/reports">Report Builder</Link> }]
          : [];
      case 'software-services': {
        const meItem      = can('software_status') && { key: '/software-status', icon: <SafetyCertificateOutlined />, label: <Link to="/software-status">ManageEngine Status</Link> };
        const nessusItem  = can('nessus_status')   && { key: '/nessus-status',   icon: <SafetyCertificateOutlined />, label: <Link to="/nessus-status">Nessus Agent Status</Link> };
        const tenableItem = can('tenable_report')  && { key: '/tenable-report',  icon: <SafetyCertificateOutlined />, label: <Link to="/tenable-report">Tenable Report</Link> };
        const children    = [meItem, nessusItem, tenableItem].filter(Boolean);
        return children.length
          ? [{ key: 'software-services', icon: <SafetyCertificateOutlined />, label: 'Software Services', children }]
          : [];
      }
      case 'vm-discovery':
        return [{
          key: 'vm-discovery', icon: <CloudServerOutlined />, label: 'VM Discovery',
          children: [
            { key: '/vmware-discovery',  icon: <ApartmentOutlined />, label: <Link to="/vmware-discovery">VMware Discovery</Link> },
            { key: '/proxmox-discovery', icon: <ClusterOutlined />,   label: <Link to="/proxmox-discovery">Proxmox Discovery</Link> },
          ],
        }];
      default:
        return [];
    }
  };

  // Apply saved order; any key not in saved order appended at end
  const orderedKeys = [
    ...navOrder,
    ...DEFAULT_NAV_KEYS.filter(k => !navOrder.includes(k)),
  ];
  const mainItems = orderedKeys.flatMap(k => getNavSection(k));

  const adminItem = isAdmin && {
    key: 'admin', icon: <SettingOutlined />, label: 'Administration',
    children: [
      can('admin/users')            && { key: '/admin/users',             icon: <TeamOutlined />,              label: <Link to="/admin/users">Users</Link> },
      can('admin/dropdowns')        && { key: '/admin/dropdowns',         icon: <SettingOutlined />,           label: <Link to="/admin/dropdowns">Dropdowns</Link> },
      can('admin/tag-ranges')       && { key: '/admin/tag-ranges',        icon: <TagsOutlined />,              label: <Link to="/admin/tag-ranges">Tag Ranges</Link> },
      can('admin/custom-pages')     && { key: '/admin/custom-pages',      icon: <AppstoreAddOutlined />,       label: <Link to="/admin/custom-pages">Custom Pages</Link> },
      can('admin/field-visibility') && { key: '/admin/field-visibility',  icon: <EyeOutlined />,               label: <Link to="/admin/field-visibility">Field Customization</Link> },
      can('admin/page-access')      && { key: '/admin/page-access',       icon: <SafetyCertificateOutlined />, label: <Link to="/admin/page-access">Page Access</Link> },
      can('admin/backup')           && { key: '/admin/backup',            icon: <CloudDownloadOutlined />,     label: <Link to="/admin/backup">Backup / Export &amp; Import</Link> },
      can('admin/branding')         && { key: '/admin/branding',          icon: <BgColorsOutlined />,          label: <Link to="/admin/branding">Branding &amp; Customization</Link> },
      can('admin/recycle-bin')      && { key: '/admin/recycle-bin',       icon: <RestOutlined />,              label: <Link to="/admin/recycle-bin">Recycle Bin</Link> },
      can('admin/data-health')      && { key: '/admin/data-health',       icon: <HeartOutlined />,             label: <Link to="/admin/data-health">Data Health</Link> },
      can('admin/imports')          && { key: '/admin/imports',           icon: <HistoryOutlined />,           label: <Link to="/admin/imports">Import History</Link> },
      can('admin/imports')          && { key: '/admin/db-import',         icon: <DatabaseOutlined />,          label: <Link to="/admin/db-import">DB Import</Link> },
      can('admin/audit')            && { key: '/admin/audit',             icon: <FileSearchOutlined />,        label: <Link to="/admin/audit">Audit Log</Link> },
      can('admin/nav-order')            && { key: '/admin/nav-order',          icon: <MenuOutlined />,              label: <Link to="/admin/nav-order">Menu Order</Link> },
      can('admin/user-page-control')    && { key: '/admin/user-page-control',  icon: <SafetyCertificateOutlined />, label: <Link to="/admin/user-page-control">User Page Control</Link> },
      can('admin/roles')                && { key: '/admin/roles',              icon: <KeyOutlined />,               label: <Link to="/admin/roles">Role Management</Link> },
      isAdmin                           && { key: '/admin/install-config',        icon: <CloudDownloadOutlined />,      label: <Link to="/admin/install-config">ME Install Config</Link> },
      isAdmin                           && { key: '/admin/nessus-install-config', icon: <CloudDownloadOutlined />,      label: <Link to="/admin/nessus-install-config">Nessus Install Config</Link> },
    ].filter(Boolean),
  };

  const items = [...mainItems, adminItem].filter(Boolean);

  const crumbs = loc.pathname.split('/').filter(Boolean).map((seg, i, arr) => ({
    title: <Link to={'/' + arr.slice(0, i + 1).join('/')}>{seg.replace(/-/g,' ').replace(/^./, c => c.toUpperCase())}</Link>,
  }));

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={240}
        breakpoint="lg"
        collapsedWidth={64}
        theme="dark"
        collapsible
        collapsed={collapsed}
        onCollapse={toggleSider}
        style={{ position: 'relative' }}
      >
        {/* Collapsed rail is one big "expand" control — no hover popups;
            clicking any icon simply opens the sidebar. */}
        {collapsed && (
          <div
            role="button"
            aria-label="Expand menu"
            title="Expand menu"
            style={{ position: 'absolute', inset: 0, zIndex: 10, cursor: 'pointer' }}
            onClick={() => toggleSider(false)}
          />
        )}
        <div className="logo-title" style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: collapsed ? 'center' : 'flex-start' }}>
          {branding?.logo_data_url && (
            <span style={{
              width: 28, height: 28, borderRadius: 6, background: 'white',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
              flexShrink: 0,
            }}>
              <img alt="logo" src={branding.logo_data_url} style={{ maxWidth: '100%', maxHeight: '100%' }} />
            </span>
          )}
          {!collapsed && (
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {branding?.tool_name || 'INVENTORY · IT'}
            </span>
          )}
          {collapsed && !branding?.logo_data_url && <ClusterOutlined style={{ fontSize: 20 }} />}
        </div>
        <Menu
          key={`menu-${customPages.length}-${navOrder.join(',')}`}
          theme="dark"
          mode="inline"
          selectedKeys={[loc.pathname]}
          defaultOpenKeys={[
            ...['/vmware-discovery', '/proxmox-discovery'].includes(loc.pathname) ? ['vm-discovery'] : [],
            ...['/software-status', '/nessus-status', '/tenable-report'].includes(loc.pathname) ? ['software-services'] : [],
          ]}
          items={items}
        />
      </Sider>
      <Layout>
        <Header className="app-header">
          <Space size="middle">
            <Tooltip title={collapsed ? 'Expand menu' : 'Collapse menu'}>
              <Button
                size="small"
                type="text"
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => toggleSider(!collapsed)}
              />
            </Tooltip>
            <Breadcrumb items={[{ title: <Link to="/">Home</Link> }, ...crumbs]} />
          </Space>
          <Space size="middle">
            <GlobalSearch />
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
                  { key: 'profile', icon: <IdcardOutlined />, label: 'My Profile', onClick: () => nav('/profile') },
                  { type: 'divider' },
                  { key: 'logout', icon: <LogoutOutlined />, label: 'Sign out', onClick: () => { logout(); nav('/login'); } },
                ],
              }}
            >
              <Space style={{ cursor: 'pointer' }}>
                <Avatar size="small" src={user?.avatarDataUrl} icon={!user?.avatarDataUrl && <UserOutlined />} />
                {user?.fullName}
              </Space>
            </Dropdown>
          </Space>
        </Header>
        <Content className="page-shell">
          <Outlet />
        </Content>
        <Footer style={{ textAlign: 'center', padding: '12px 24px', fontSize: 12 }}>
          <span dangerouslySetInnerHTML={{
            __html: (branding?.footer_html
              || `© ${new Date().getFullYear()} ${branding?.tool_name || 'Inventory IT'}. All rights reserved.`)
              .replace(/\{year\}/g, new Date().getFullYear())
              .replace(/\{tool\}/g, branding?.tool_name || 'Inventory IT')
          }} />
          {buildCommit && (
            <Typography.Text type="secondary" style={{ marginLeft: 10, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
              build {buildCommit}
            </Typography.Text>
          )}
        </Footer>
      </Layout>
    </Layout>
  );
}
