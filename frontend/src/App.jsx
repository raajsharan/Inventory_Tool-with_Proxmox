import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/Layout/AppLayout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import AssetList from './pages/Assets/AssetList.jsx';
import AssetForm from './pages/Assets/AssetForm.jsx';
import AssetView from './pages/Assets/AssetView.jsx';
import AssetImport from './pages/Assets/AssetImport.jsx';
import BeijingAssetList from './pages/BeijingAssets/BeijingAssetList.jsx';
import BeijingAssetForm from './pages/BeijingAssets/BeijingAssetForm.jsx';
import BeijingAssetView from './pages/BeijingAssets/BeijingAssetView.jsx';
import BeijingAssetImport from './pages/BeijingAssets/BeijingAssetImport.jsx';
import ExtAssetList from './pages/ExtAssets/ExtAssetList.jsx';
import ExtAssetForm from './pages/ExtAssets/ExtAssetForm.jsx';
import ExtAssetView from './pages/ExtAssets/ExtAssetView.jsx';
import ExtAssetImport from './pages/ExtAssets/ExtAssetImport.jsx';
import PhysicalEsxiList from './pages/PhysicalEsxi/PhysicalEsxiList.jsx';
import PhysicalEsxiForm from './pages/PhysicalEsxi/PhysicalEsxiForm.jsx';
import PhysicalEsxiView from './pages/PhysicalEsxi/PhysicalEsxiView.jsx';
import PhysicalEsxiImport from './pages/PhysicalEsxi/PhysicalEsxiImport.jsx';
import CustomPageBuilder from './pages/CustomPages/CustomPageBuilder.jsx';
import CustomPageView from './pages/CustomPages/CustomPageView.jsx';
import CustomPageImport from './pages/CustomPages/CustomPageImport.jsx';
import CustomPageRecordForm from './pages/CustomPages/CustomPageRecordForm.jsx';
import ReportBuilder from './pages/Reports/ReportBuilder.jsx';
import Users from './pages/Admin/Users.jsx';
import Dropdowns from './pages/Admin/Dropdowns.jsx';
import TagRanges from './pages/Admin/TagRanges.jsx';
import AdminCustomPages from './pages/Admin/CustomPages.jsx';
import FieldVisibility from './pages/Admin/FieldVisibility.jsx';
import PageAccess from './pages/Admin/PageAccess.jsx';
import InventoryFields from './pages/Admin/InventoryFields.jsx';
import AuditLogs from './pages/Admin/AuditLogs.jsx';
import ImportHistory from './pages/Admin/ImportHistory.jsx';
import AdminBackup from './pages/Admin/Backup.jsx';
import AdminBranding from './pages/Admin/Branding.jsx';
import Profile from './pages/Profile.jsx';
import RecycleBin from './pages/Admin/RecycleBin.jsx';
import NavOrder from './pages/Admin/NavOrder.jsx';
import UserPageControl from './pages/Admin/UserPageControl.jsx';
import Roles from './pages/Admin/Roles.jsx';
import InstallConfig from './pages/Admin/InstallConfig.jsx';
import VMwareDiscovery from './pages/VMwareDiscovery/index.jsx';
import ProxmoxDiscovery from './pages/ProxmoxDiscovery/index.jsx';
import SoftwareStatus from './pages/SoftwareStatus/index.jsx';
import NessusStatus from './pages/NessusStatus/index.jsx';
import NessusInstallConfig from './pages/Admin/NessusInstallConfig.jsx';
import TenableReport from './pages/TenableReport/index.jsx';

export default function App() {
  return (
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

        <Route path="/admin/users" element={<Users />} />
        <Route path="/admin/dropdowns" element={<Dropdowns />} />
        <Route path="/admin/tag-ranges" element={<TagRanges />} />
        <Route path="/admin/custom-pages" element={<AdminCustomPages />} />
        <Route path="/admin/field-visibility" element={<FieldVisibility />} />
        <Route path="/admin/page-access" element={<PageAccess />} />
        <Route path="/admin/inventory-fields/:pageKey" element={<InventoryFields />} />
        <Route path="/admin/audit" element={<AuditLogs />} />
        <Route path="/admin/imports" element={<ImportHistory />} />
        <Route path="/admin/backup" element={<AdminBackup />} />
        <Route path="/admin/branding" element={<AdminBranding />} />
        <Route path="/admin/recycle-bin" element={<RecycleBin />} />
        <Route path="/admin/nav-order" element={<NavOrder />} />
        <Route path="/admin/user-page-control" element={<UserPageControl />} />
        <Route path="/admin/roles" element={<Roles />} />
        <Route path="/admin/install-config"        element={<InstallConfig />} />
        <Route path="/admin/nessus-install-config" element={<NessusInstallConfig />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
