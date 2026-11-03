import AssetForm from '../Assets/AssetForm.jsx';

export default function BeijingAssetForm({ mode }) {
  return (
    <AssetForm
      mode={mode}
      apiPrefix="/beijing-assets"
      listPath="/beijing-assets"
      entityLabel="Beijing Asset"
      pageKey="beijing_assets"
      disableAgentInstall
    />
  );
}
