import AssetView from '../Assets/AssetView.jsx';

export default function ExtAssetView() {
  return (
    <AssetView
      apiPrefix="/ext-assets"
      basePath="/ext-assets"
      entityLabel="Ext. Asset"
      pageKey="ext_assets"
    />
  );
}
