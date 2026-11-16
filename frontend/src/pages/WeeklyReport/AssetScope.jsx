import { Checkbox, Space, Typography } from 'antd';

const { Text } = Typography;

// Keys match the inventory tables used by the report queries.
export const SCOPE_OPTIONS = [
  { value: 'assets',                label: 'Assets' },
  { value: 'ext_assets',            label: 'Ext. Assets' },
  { value: 'beijing_assets',        label: 'Beijing Assets' },
  { value: 'physical_esxi_servers', label: 'Physical Assets' },
];
export const ALL_SCOPE = SCOPE_OPTIONS.map(o => o.value);

// A saved table without asset_scope counts every inventory.
export const scopeOrAll = (v) => (Array.isArray(v) && v.length ? v : ALL_SCOPE);
export const isAllScope = (v) => scopeOrAll(v).length === ALL_SCOPE.length;

// Which inventories a table counts. At least one must stay ticked; an empty
// selection is ignored rather than saved.
export default function AssetScopePicker({ value, onChange, disabled, label = 'Assets', compact = false }) {
  const current = scopeOrAll(value);
  return (
    <Space size={compact ? 8 : 12} wrap align="center">
      {label && <Text type="secondary" style={{ fontSize: compact ? 12 : undefined }}>{label}:</Text>}
      <Checkbox.Group
        disabled={disabled}
        options={SCOPE_OPTIONS}
        value={current}
        onChange={(v) => { if (v.length) onChange(ALL_SCOPE.filter(k => v.includes(k))); }}
      />
    </Space>
  );
}
