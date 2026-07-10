/**
 * FieldValueCell — inline editor for a single custom field value.
 * Supports: text | textarea | number | boolean | dropdown | date
 */
import { useState, useRef } from 'react';
import { Input, InputNumber, Switch, Select, DatePicker, Button, Modal, Typography } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

const { Text } = Typography;

export default function FieldValueCell({ fieldDef, value, onSave, readOnly = false }) {
  const { field_type, options } = fieldDef;
  const [textareaOpen, setTextareaOpen] = useState(false);
  const [draftText,    setDraftText]    = useState('');
  const inputRef = useRef(null);

  if (readOnly) {
    if (field_type === 'boolean') return <Text>{value === 'true' ? '✓' : value === 'false' ? '✗' : '—'}</Text>;
    return <Text type={value ? undefined : 'secondary'}>{value ?? '—'}</Text>;
  }

  // ── boolean / toggle ───────────────────────────────────────────────────────
  if (field_type === 'boolean') {
    return (
      <Switch
        size="small"
        checked={value === 'true'}
        onChange={checked => onSave(checked ? 'true' : 'false')}
      />
    );
  }

  // ── dropdown ───────────────────────────────────────────────────────────────
  if (field_type === 'dropdown') {
    const opts = Array.isArray(options) ? options : [];
    return (
      <Select
        size="small"
        value={value || undefined}
        placeholder="—"
        allowClear
        style={{ minWidth: 120, maxWidth: 200 }}
        onChange={val => onSave(val ?? null)}
        options={opts.map(o => ({ value: o, label: o }))}
      />
    );
  }

  // ── number ─────────────────────────────────────────────────────────────────
  if (field_type === 'number') {
    return (
      <InputNumber
        ref={inputRef}
        size="small"
        value={value != null ? Number(value) : null}
        style={{ width: 100 }}
        onBlur={e => {
          const v = e.target.value;
          onSave(v === '' ? null : v);
        }}
        onPressEnter={() => inputRef.current?.blur()}
      />
    );
  }

  // ── date ───────────────────────────────────────────────────────────────────
  if (field_type === 'date') {
    return (
      <DatePicker
        size="small"
        value={value ? dayjs(value) : null}
        format="YYYY-MM-DD"
        style={{ width: 130 }}
        onChange={(_, dateStr) => onSave(dateStr || null)}
      />
    );
  }

  // ── textarea ───────────────────────────────────────────────────────────────
  if (field_type === 'textarea') {
    return (
      <>
        <Button
          size="small"
          type="text"
          icon={<EditOutlined />}
          style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          onClick={() => { setDraftText(value || ''); setTextareaOpen(true); }}
        >
          {value ? <Text ellipsis style={{ maxWidth: 120 }}>{value}</Text> : <Text type="secondary">Add…</Text>}
        </Button>
        <Modal
          open={textareaOpen}
          title={fieldDef.label}
          onCancel={() => setTextareaOpen(false)}
          onOk={() => { onSave(draftText || null); setTextareaOpen(false); }}
          okText="Save"
          width={480}
          destroyOnClose
        >
          <Input.TextArea
            rows={6}
            value={draftText}
            onChange={e => setDraftText(e.target.value)}
            autoFocus
          />
        </Modal>
      </>
    );
  }

  // ── text (default) ─────────────────────────────────────────────────────────
  return (
    <Input
      ref={inputRef}
      size="small"
      defaultValue={value ?? ''}
      placeholder="—"
      style={{ width: 150 }}
      onBlur={e => onSave(e.target.value || null)}
      onPressEnter={() => inputRef.current?.blur()}
    />
  );
}
