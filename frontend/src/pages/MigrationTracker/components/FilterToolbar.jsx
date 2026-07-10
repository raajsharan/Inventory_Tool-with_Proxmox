import { Input, Select, Space, Button, Tooltip } from 'antd';
import { SearchOutlined, ClearOutlined, CompressOutlined, ExpandAltOutlined } from '@ant-design/icons';

const { Search } = Input;

/**
 * FilterToolbar — search box + Select dropdowns + density toggle.
 *
 * Props:
 *   search       {string}
 *   onSearch     {fn(val)}
 *   filters      {object}  current filter values keyed by field
 *   onFilter     {fn(key, val)}
 *   filterOpts   {object}  { field: [string, ...] } — available options per field
 *   filterDefs   {Array<{key, label, placeholder?}>}  — which filters to show
 *   density      {'small'|'middle'}
 *   setDensity   {fn}
 *   onClear      {fn}
 *   extra        {ReactNode}  — slots on the right (e.g. export button)
 */
export default function FilterToolbar({
  search, onSearch, filters, onFilter, filterOpts = {},
  filterDefs = [], density, setDensity, onClear, extra,
}) {
  return (
    <Space wrap style={{ marginBottom: 12, width: '100%' }}>
      <Search
        placeholder="Search all columns…"
        allowClear
        value={search}
        onChange={e => onSearch(e.target.value)}
        onSearch={onSearch}
        style={{ width: 240 }}
        prefix={<SearchOutlined />}
      />

      {filterDefs.map(({ key, label, placeholder }) => {
        const opts = filterOpts[key] || [];
        if (!opts.length) return null;
        return (
          <Select
            key={key}
            allowClear
            placeholder={placeholder || label}
            value={filters[key] || undefined}
            onChange={v => onFilter(key, v || '')}
            style={{ minWidth: 160 }}
            showSearch
            filterOption={(input, opt) =>
              String(opt?.label || '').toLowerCase().includes(input.toLowerCase())}
            options={opts.map(o => ({ value: o, label: o || '(blank)' }))}
          />
        );
      })}

      {onClear && (
        <Tooltip title="Clear all filters">
          <Button icon={<ClearOutlined />} onClick={onClear} />
        </Tooltip>
      )}

      <Tooltip title={density === 'small' ? 'Comfortable view' : 'Compact view'}>
        <Button
          icon={density === 'small' ? <ExpandAltOutlined /> : <CompressOutlined />}
          onClick={() => setDensity(d => d === 'small' ? 'middle' : 'small')}
        />
      </Tooltip>

      {extra && <span style={{ marginLeft: 'auto' }}>{extra}</span>}
    </Space>
  );
}
