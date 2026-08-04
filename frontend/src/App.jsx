import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import AppLayout from './components/Layout/AppLayout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';

// Every page is its own chunk — the entry bundle only ships the router
// shell, layout, and auth guard. Without this, every user downloads the
// whole app (Assets, VMware/Proxmox/Hyper-V discovery, all Admin pages,
// Reports, etc.) on first paint even if they only ever touch one page.
const Login               = lazy(() => import('./pages/Login.jsx'));
const Dashboard           = lazy(() => import('./pages/Dashboard.jsx'));
const AssetList           = lazy(() => import('./pages/Assets/AssetList.jsx'));
const AssetForm           = lazy(() => import('./pages/Assets/AssetForm.jsx'));
const AssetView           = lazy(() => import('./pages/Assets/AssetView.jsx'));
const AssetImport         = lazy(() => import('./pages/Assets/AssetImport.jsx'));
const BeijingAssetList    = lazy(() => import('./pages/BeijingAssets/BeijingAssetList.jsx'));
const BeijingAssetForm    = lazy(() => import('./pages/BeijingAssets/BeijingAssetForm.jsx'));
const BeijingAssetView    = lazy(() => import('./pages/BeijingAssets/BeijingAssetView.jsx'));
const BeijingAssetImport  = lazy(() => import('./pages/BeijingAssets/BeijingAssetImport.jsx'));
const ExtAssetList        = lazy(() => import('./pages/ExtAssets/ExtAssetList.jsx'));
const ExtAssetForm        = lazy(() => import('./pages/ExtAssets/ExtAssetForm.jsx'));
const ExtAssetView        = lazy(() => import('./pages/ExtAssets/ExtAssetView.jsx'));
const ExtAssetImport      = lazy(() => import('./pages/ExtAssets/ExtAssetImport.jsx'));
const PhysicalEsxiList    = lazy(() => import('./pages/PhysicalEsxi/PhysicalEsxiList.jsx'));
const PhysicalEsxiForm    = lazy(() => import('./pages/PhysicalEsxi/PhysicalEsxiForm.jsx'));
const PhysicalEsxiView    = lazy(() => import('./pages/PhysicalEsxi/PhysicalEsxiView.jsx'));
const PhysicalEsxiImport  = lazy(() => import('./pages/PhysicalEsxi/PhysicalEsxiImport.jsx'));
const CustomPageBuilder      = lazy(() => import('./pages/CustomPages/CustomPageBuilder.jsx'));
const CustomPageView         = lazy(() => import('./pages/CustomPages/CustomPageView.jsx'));
const CustomPageImport       = lazy(() => import('./pages/CustomPages/CustomPageImport.jsx'));
const CustomPageRecordForm   = lazy(() => import('./pages/CustomPages/CustomPageRecordForm.jsx'));
const ReportBuilder          = lazy(() => import('./pages/Reports/ReportBuilder.jsx'));
const Users                  = lazy(() => import('./pages/Admin/Users.jsx'));
const Dropdowns              = lazy(() => import('./pages/Admin/Dropdowns.jsx'));
const TagRanges              = lazy(() => import('./pages/Admin/TagRanges.jsx'));
const AdminCustomPages       = lazy(() => import('./pages/Admin/CustomPages.jsx'));
const FieldVisibility        = lazy(() => import('./pages/Admin/FieldVisibility.jsx'));
const PageAccess             = lazy(() => import('./pages/Admin/PageAccess.jsx'));
const InventoryFields        = lazy(() => import('./pages/Admin/InventoryFields.jsx'));
const AuditLogs              = lazy(() => import('./pages/Admin/AuditLogs.jsx'));
const ImportHistory          = lazy(() => import('./pages/Admin/ImportHistory.jsx'));
const AdminBackup            = lazy(() => import('./pages/Admin/Backup.jsx'));
const AdminBranding          = lazy(() => import('./pages/Admin/Branding.jsx'));
const Profile                = lazy(() => import('./pages/Profile.jsx'));
const RecycleBin             = lazy(() => import('./pages/Admin/RecycleBin.jsx'));
const AssetTransfer          = lazy(() => import('./pages/Admin/AssetTransfer.jsx'));
const RecurringActivities    = lazy(() => import('./pages/Admin/RecurringActivities.jsx'));
const DataHealth             = lazy(() => import('./pages/Admin/DataHealth.jsx'));
const ComplianceConfig       = lazy(() => import('./pages/Admin/ComplianceConfig.jsx'));
const MigrationConfig        = lazy(() => import('./pages/Admin/MigrationConfig.jsx'));
const Decommissioned         = lazy(() => import('./pages/Decommissioned.jsx'));
const NavOrder               = lazy(() => import('./pages/Admin/NavOrder.jsx'));
const UserPageControl        = lazy(() => import('./pages/Admin/UserPageControl.jsx'));
const Roles                  = lazy(() => import('./pages/Admin/Roles.jsx'));
const InstallConfig          = lazy(() => import('./pages/Admin/InstallConfig.jsx'));
const VMwareDiscovery        = lazy(() => import('./pages/VMwareDiscovery/index.jsx'));
const ProxmoxDiscovery       = lazy(() => import('./pages/ProxmoxDiscovery/index.jsx'));
const HyperVDiscovery        = lazy(() => import('./pages/HyperVDiscovery/index.jsx'));
const SoftwareStatus         = lazy(() => import('./pages/SoftwareStatus/index.jsx'));
const NessusStatus           = lazy(() => import('./pages/NessusStatus/index.jsx'));
const NessusInstallConfig    = lazy(() => import('./pages/Admin/NessusInstallConfig.jsx'));
const TenableReport          = lazy(() => import('./pages/TenableReport/index.jsx'));
const DbImport               = lazy(() => import('./pages/Admin/DbImport.jsx'));
const MigrationTracker       = lazy(() => import('./pages/MigrationTracker/index.jsx'));
const EndpointCentral        = lazy(() => import('./pages/EndpointCentral/index.jsx'));
const ServerModels           = lazy(() => import('./pages/Admin/ServerModels.jsx'));
const TeamsNotifications     = lazy(() => import('./pages/Admin/TeamsNotifications.jsx'));

function RouteFallback() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <Spin size="large" />
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />

          <Route path="/assets" element={<AssetList />} />
          <Route path="/assets/new" element={<AssetForm mode="create" />} />
          <Route path="/assets/import" element={<AssetImport />} />
          <Route path="/assets/:id" element={<AssetView />} />
          <Route path="/assets/:id/edit" element={<AssetForm mode="edit" />} />

          <Route path="/beijing-assets" element={<BeijingAssetList />} />
          <Route path="/beijing-assets/new" element={<BeijingAssetForm mode="create" />} />
          <Route path="/beijing-assets/import" element={<BeijingAssetImport />} />
          <Route path="/beijing-assets/:id" element={<BeijingAssetView />} />
          <Route path="/beijing-assets/:id/edit" element={<BeijingAssetForm mode="edit" />} />

          <Route path="/ext-assets" element={<ExtAssetList />} />
          <Route path="/ext-assets/new" element={<ExtAssetForm mode="create" />} />
          <Route path="/ext-assets/import" element={<ExtAssetImport />} />
          <Route path="/ext-assets/:id" element={<ExtAssetView />} />
          <Route path="/ext-assets/:id/edit" element={<ExtAssetForm mode="edit" />} />

          <Route path="/physical-esxi" element={<PhysicalEsxiList />} />
          <Route path="/physical-esxi/new" element={<PhysicalEsxiForm mode="create" />} />
          <Route path="/physical-esxi/import" element={<PhysicalEsxiImport />} />
          <Route path="/physical-esxi/:id" element={<PhysicalEsxiView />} />
          <Route path="/physical-esxi/:id/edit" element={<PhysicalEsxiForm mode="edit" />} />

          <Route path="/custom-pages/new" element={<CustomPageBuilder />} />
          <Route path="/custom-pages/:slug" element={<CustomPageView />} />
          <Route path="/custom-pages/:slug/new" element={<CustomPageRecordForm mode="create" />} />
          <Route path="/custom-pages/:slug/:recordId/edit" element={<CustomPageRecordForm mode="edit" />} />
          <Route path="/custom-pages/:slug/import" element={<CustomPageImport />} />

          <Route path="/reports" element={<ReportBuilder />} />
          <Route path="/software-status"  element={<SoftwareStatus />} />
          <Route path="/nessus-status"    element={<NessusStatus />} />
          <Route path="/tenable-report"   element={<TenableReport />} />
          <Route path="/vmware-discovery"   element={<VMwareDiscovery />} />
          <Route path="/proxmox-discovery"  element={<ProxmoxDiscovery />} />
          <Route path="/hyperv-discovery"   element={<HyperVDiscovery />} />
          <Route path="/migration-tracker"  element={<MigrationTracker />} />
          <Route path="/endpoint-central"   element={<EndpointCentral />} />

          <Route path="/admin/users" element={<Users />} />
          <Route path="/admin/dropdowns" element={<Dropdowns />} />
          <Route path="/admin/tag-ranges" element={<TagRanges />} />
          <Route path="/admin/custom-pages" element={<AdminCustomPages />} />
          <Route path="/admin/field-visibility" element={<FieldVisibility />} />
          <Route path="/admin/page-access" element={<PageAccess />} />
          <Route path="/admin/inventory-fields/:pageKey" element={<InventoryFields />} />
          <Route path="/admin/audit" element={<AuditLogs />} />
          <Route path="/admin/imports" element={<ImportHistory />} />
          <Route path="/admin/db-import" element={<DbImport />} />
          <Route path="/admin/backup" element={<AdminBackup />} />
          <Route path="/admin/branding" element={<AdminBranding />} />
          <Route path="/admin/recycle-bin" element={<RecycleBin />} />
          <Route path="/admin/asset-transfer" element={<AssetTransfer />} />
          <Route path="/admin/recurring-activities" element={<RecurringActivities />} />
          <Route path="/admin/data-health" element={<DataHealth />} />
          <Route path="/admin/compliance-config"  element={<ComplianceConfig />} />
          <Route path="/admin/migration-config"         element={<MigrationConfig />} />
          <Route path="/admin/teams-notifications"      element={<TeamsNotifications />} />
          <Route path="/decommissioned" element={<Decommissioned />} />
          <Route path="/admin/nav-order" element={<NavOrder />} />
          <Route path="/admin/user-page-control" element={<UserPageControl />} />
          <Route path="/admin/roles" element={<Roles />} />
          <Route path="/admin/install-config"        element={<InstallConfig />} />
          <Route path="/admin/nessus-install-config" element={<NessusInstallConfig />} />
          <Route path="/admin/server-models"         element={<ServerModels />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
