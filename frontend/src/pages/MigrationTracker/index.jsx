import { useState, useCallback, useEffect } from 'react';
import { Tabs, Button, Select, Space, Typography, theme, Tag, Spin } from 'antd';
import {
  ImportOutlined, DownloadOutlined, DashboardOutlined, HddOutlined,
  DesktopOutlined, SafetyOutlined, ClusterOutlined, ProjectOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../api/client';
import MigrationOverview   from './components/MigrationOverview.jsx';
import HostsTab            from './components/HostsTab.jsx';
import BomgarVMsTab        from './components/BomgarVMsTab.jsx';
import SecurityVMsTab      from './components/SecurityVMsTab.jsx';
import StandaloneESXiTab   from './components/StandaloneESXiTab.jsx';
import ImportModal         from './components/ImportModal.jsx';
import CustomVMsTab        from './components/CustomVMsTab.jsx';
import { TAB_DEFAULTS }    from './tabColumnRegistry.js';

const { Title, Text } = Typography;
const LS_KEY = 'migration_project_id';

export default function MigrationTracker() {
  const { user } = useAuth();
  const { token } = theme.useToken();

  const [activeTab,    setActiveTab]    = useState('overview');
  const [importOpen,   setImportOpen]   = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const [projects,   setProjects]   = useState([]);
  const [projectId,  setProjectId]  = useState(null);
  const [projLoading, setProjLoading] = useState(true);
  const [tabConfig,    setTabConfig]    = useState({});
  const [customTabs,   setCustomTabs]   = useState([]);

  const canEdit  = ['admin', 'superadmin', 'asset_manager'].includes(user?.role);
  const isAdmin  = ['admin', 'superadmin'].includes(user?.role);

  // Load projects + resolve stored selection
  useEffect(() => {
    api.get('/migration/projects')
      .then(r => {
        const list = r.data || [];
        setProjects(list);
        if (list.length === 0) return;

        const stored = localStorage.getItem(LS_KEY);
        const storedId = stored ? parseInt(stored, 10) : null;
        const exists = storedId && list.find(p => p.id === storedId);
        if (exists) {
          setProjectId(storedId);
        } else {
          const def = list.find(p => p.is_default) || list[0];
          setProjectId(def.id);
          localStorage.setItem(LS_KEY, def.id);
        }
      })
      .catch(() => {})
      .finally(() => setProjLoading(false));
  }, []);

  // Load tab config + custom tabs whenever project changes
  useEffect(() => {
    if (!projectId) return;
    Promise.all([
      api.get('/migration/tab-config',  { params: { project_id: projectId } }),
      api.get('/migration/custom-tabs', { params: { project_id: projectId } }),
    ])
      .then(([cfgRes, ctRes]) => {
        setTabConfig(cfgRes.data  || {});
        setCustomTabs((ctRes.data || []).filter(t => t.enabled !== false));
      })
      .catch(() => { setTabConfig({}); setCustomTabs([]); });
  }, [projectId]);

  const handleProjectChange = (val) => {
    setProjectId(val);
    localStorage.setItem(LS_KEY, val);
    setRefreshToken(t => t + 1);
  };

  const handleImported = useCallback(() => {
    setRefreshToken(t => t + 1);
  }, []);

  const jumpToHost = useCallback(() => setActiveTab('hosts'), []);

  const currentProject = projects.find(p => p.id === projectId);

  const cfg = (key) => tabConfig[key] || {};
  const tabLabel = (tabKey, Icon) => {
    const c = cfg(tabKey);
    return <span><Icon /> {c.label || TAB_DEFAULTS[tabKey].label}</span>;
  };

  const vmTabItems = [
    cfg('bomgar_vms').enabled === false ? null : {
      key: 'bomgar-vms',
      label: tabLabel('bomgar_vms', DesktopOutlined),
      children: (
        <BomgarVMsTab
          key={`${refreshToken}-${projectId}`}
          projectId={projectId}
          onJumpToHost={jumpToHost}
          hiddenColumns={cfg('bomgar_vms').hidden_columns || []}
        />
      ),
    },
    cfg('security_vms').enabled === false ? null : {
      key: 'security-vms',
      label: tabLabel('security_vms', SafetyOutlined),
      children: (
        <SecurityVMsTab
          key={`${refreshToken}-${projectId}`}
          projectId={projectId}
          hiddenColumns={cfg('security_vms').hidden_columns || []}
        />
      ),
    },
    cfg('standalone_esxi').enabled === false ? null : {
      key: 'standalone-esxi',
      label: tabLabel('standalone_esxi', ClusterOutlined),
      children: (
        <StandaloneESXiTab
          key={`${refreshToken}-${projectId}`}
          projectId={projectId}
          hiddenColumns={cfg('standalone_esxi').hidden_columns || []}
        />
      ),
    },
  ].filter(Boolean);

  const customTabItems = customTabs.map(ct => ({
    key: `custom-${ct.id}`,
    label: <span><AppstoreOutlined /> {ct.label}</span>,
    children: (
      <CustomVMsTab
        key={`${refreshToken}-${projectId}-${ct.id}`}
        tabId={ct.id}
        projectId={projectId}
        hiddenColumns={ct.hidden_columns || []}
      />
    ),
  }));

  const tabItems = [
    {
      key: 'overview',
      label: <span><DashboardOutlined /> Overview</span>,
      children: <MigrationOverview key={`${refreshToken}-${projectId}`} projectId={projectId} />,
    },
    {
      key: 'hosts',
      label: <span><HddOutlined /> Hosts</span>,
      children: <HostsTab key={`${refreshToken}-${projectId}`} projectId={projectId} refreshToken={refreshToken} />,
    },
    ...vmTabItems,
    ...customTabItems,
  ];

  return (
    <div style={{ padding: '0 0 24px' }}>
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 12, flexWrap: 'wrap', gap: 8,
      }}>
        <Title level={4} style={{ margin: 0 }}>Migration Tracker</Title>
        {canEdit && (
          <Space>
            <Button
              icon={<DownloadOutlined />}
              href={`/api/migration/template${projectId ? `?project_id=${projectId}` : ''}`}
              download="Migration-Tracker-Template.xlsx"
              target="_blank"
            >
              Download Template
            </Button>
            <Button
              type="primary"
              icon={<ImportOutlined />}
              onClick={() => setImportOpen(true)}
              disabled={!projectId}
            >
              Import / Refresh from XLSX
            </Button>
          </Space>
        )}
      </div>

      {/* ── Project selector bar ─────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        background: token.colorFillQuaternary,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadius,
        padding: '8px 14px',
        marginBottom: 16,
        flexWrap: 'wrap',
      }}>
        <Space size={6}>
          <ProjectOutlined style={{ color: token.colorPrimary }} />
          <Text strong style={{ whiteSpace: 'nowrap' }}>Migration Project:</Text>
        </Space>

        {projLoading ? (
          <Spin size="small" />
        ) : projects.length === 0 ? (
          <Text type="secondary">
            No projects found.{' '}
            {isAdmin && <Link to="/admin/migration-config">Create a project</Link>}
          </Text>
        ) : (
          <Select
            style={{ minWidth: 240 }}
            value={projectId}
            onChange={handleProjectChange}
            options={projects.map(p => ({
              value: p.id,
              label: (
                <Space size={4}>
                  {p.name}
                  {p.environment && <Tag style={{ margin: 0 }}>{p.environment}</Tag>}
                  {p.is_default && <Tag color="gold" style={{ margin: 0 }}>Default</Tag>}
                </Space>
              ),
            }))}
          />
        )}

        {isAdmin && (
          <Link to="/admin/migration-config" style={{ marginLeft: 'auto', whiteSpace: 'nowrap', fontSize: 12 }}>
            Manage Projects
          </Link>
        )}
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        type="card"
        size="small"
        items={tabItems}
        destroyInactiveTabPane={false}
        style={{
          background: token.colorBgContainer,
          padding: '0 16px 16px',
          borderRadius: token.borderRadiusLG,
          border: `1px solid ${token.colorBorderSecondary}`,
        }}
      />

      {/* ── Import modal ─────────────────────────────────────────────────── */}
      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={handleImported}
        projectId={projectId}
        projectName={currentProject?.name}
      />
    </div>
  );
}
