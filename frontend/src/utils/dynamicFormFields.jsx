import { useEffect, useState } from 'react';
import { Input, Select, Switch, InputNumber, DatePicker, Form, Col } from 'antd';
import api from '../api/client';

// Fetches Custom Pages field metadata (labels, groups, input-type overrides,
// hidden fields, admin-added extras) for a built-in inventory page. Shared by
// every Register/Edit form so a change made in Admin > Custom Pages reflects
// automatically wherever this hook is used — no per-form wiring required.
export function useInventoryFieldMeta(pageKey) {
  const [hiddenSet, setHiddenSet] = useState(new Set());
  const [fieldMeta, setFieldMeta] = useState({ fields: [], byKey: {}, groups: [] });

  useEffect(() => {
    if (!pageKey) return;
    api.get(`/field-visibility/${pageKey}`)
      .then(r => setHiddenSet(new Set(r.data.hidden || [])))
      .catch(() => {});
    api.get(`/inventory-fields/${pageKey}`)
      .then(r => {
        const byKey = {};
        for (const f of r.data.fields || []) byKey[f.field_key] = f;
        setFieldMeta({ fields: r.data.fields || [], byKey, groups: r.data.groups || [] });
      })
      .catch(() => {});
  }, [pageKey]);

  const isHidden = (snakeKey) => hiddenSet.has(snakeKey);
  const labelOf = (snakeKey, fallback) => fieldMeta.byKey[snakeKey]?.label || fallback;

  return { hiddenSet, isHidden, fieldMeta, labelOf };
}

// Resolve a field's dropdown options: prefer a linked dropdown_master
// category (auto-created when an admin switches the field to "Dropdown" in
// Change Field Types) over the legacy flat `options` array stored directly
// on the override row.
export function dropdownOptionsFor(f, dd) {
  if (f?.dropdown_category && dd && dd[f.dropdown_category]) {
    return dd[f.dropdown_category].map(d => ({ label: d.value, value: d.value }));
  }
  return (f?.options || []).map(o => ({ label: o, value: o }));
}

// Build a Form.Item that respects an input_type override from the field
// editor. If the field is unchanged from its default, falls back to the
// caller's defaultChild. Used for "plain" built-in widgets — frozen/DB-linked
// fields bypass this and keep their specialized widgets so cascade/validation
// behavior isn't lost.
export function overridableFormItem({ fieldKey, name, label, defaultChild, defaultValuePropName = 'value', rules, extra, fieldMeta, dd }) {
  const f = fieldMeta?.byKey?.[fieldKey];
  const type = f?.input_type;
  const isOverridden = type && type !== f?.default_type;
  let child = defaultChild;
  let valuePropName = defaultValuePropName;
  if (isOverridden) {
    switch (type) {
      case 'textarea': child = <Input.TextArea rows={3} />; valuePropName = 'value'; break;
      case 'number':   child = <InputNumber style={{ width: '100%' }} />; valuePropName = 'value'; break;
      case 'dropdown': child = (
        <Select options={dropdownOptionsFor(f, dd)} allowClear showSearch optionFilterProp="label" />
      ); valuePropName = 'value'; break;
      case 'toggle':   child = <Switch />; valuePropName = 'checked'; break;
      case 'date':     child = <DatePicker style={{ width: '100%' }} />; valuePropName = 'value'; break;
      default:         child = <Input />; valuePropName = 'value';
    }
  }
  return (
    <Form.Item name={name} label={label} rules={rules} extra={extra} valuePropName={valuePropName}>
      {child}
    </Form.Item>
  );
}

export function renderExtraInput(f, dd) {
  switch (f.input_type) {
    case 'textarea': return <Input.TextArea rows={3} />;
    case 'number':   return <InputNumber style={{ width: '100%' }} />;
    case 'dropdown': return <Select options={dropdownOptionsFor(f, dd)} allowClear />;
    case 'toggle':   return <Switch />;
    case 'date':     return <DatePicker style={{ width: '100%' }} />;
    default:         return <Input />;
  }
}

// Renders an admin-added "extra" custom field. Values live under the
// `extras` namespace of the form (submitted as a nested object).
export function renderExtraWidget(f, { isHidden, dd } = {}) {
  if (isHidden && isHidden(f.field_key)) return null;
  return (
    <Col xs={24} md={f.input_type === 'textarea' ? 24 : 8} key={f.field_key}>
      <Form.Item
        name={['extras', f.field_key]}
        label={f.label}
        rules={f.is_required ? [{ required: true, message: `${f.label} is required` }] : []}
        valuePropName={f.input_type === 'toggle' ? 'checked' : 'value'}
      >
        {renderExtraInput(f, dd)}
      </Form.Item>
    </Col>
  );
}

// Groups fields by their section using the latest field meta. Sections are
// rendered in the saved group order (fieldMeta.groups), then any orphan
// sections that exist on fields but not in groups are appended. Fields
// inside each section are ordered by sort_order.
export function buildDynamicSections(fieldMeta) {
  const fields = fieldMeta?.fields || [];
  if (!fields.length) return null;
  const map = new Map();
  for (const g of (fieldMeta.groups || [])) map.set(g, []);
  for (const f of fields) {
    const sec = f.section || 'Other';
    if (!map.has(sec)) map.set(sec, []);
    map.get(sec).push(f);
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }
  return Array.from(map.entries());
}
