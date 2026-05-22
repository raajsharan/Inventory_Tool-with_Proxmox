import AssetView from '../Assets/AssetView.jsx';

export default function PhysicalEsxiView() {
  return (
    <AssetView
      apiPrefix="/physical-esxi"
      basePath="/physical-esxi"
      entityLabel="Physical / ESXi Server"
      pageKey="physical_esxi_servers"
    />
  );
}
