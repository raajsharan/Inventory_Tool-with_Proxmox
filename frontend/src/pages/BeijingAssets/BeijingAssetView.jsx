import AssetView from '../Assets/AssetView.jsx';

export default function BeijingAssetView() {
  return (
    <AssetView
      apiPrefix="/beijing-assets"
      basePath="/beijing-assets"
      entityLabel="Beijing Asset"
      pageKey="beijing_assets"
    />
  );
}
