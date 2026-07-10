/**
 * useCustomFields — loads field definitions for a tab and field values for
 * a set of record IDs. Returns extra columns to append to the table and
 * a function to save a value.
 *
 * @param {string}  tabKey      e.g. 'bomgar_vms' | 'custom_1'
 * @param {string}  recordType  e.g. 'bomgar_vm' | 'custom_vm'
 * @param {number}  projectId
 * @param {number[]} recordIds  current page record IDs
 * @param {boolean} canEdit
 * @param {Function} FieldValueCell  (passed as param to avoid circular import issues)
 */
import { useState, useEffect, useCallback } from 'react';
import { message } from 'antd';
import api from '../../../api/client';

export function useCustomFields(tabKey, recordType, projectId, recordIds, canEdit) {
  const [fieldDefs, setFieldDefs] = useState([]);
  const [fieldValues, setFieldValues] = useState({}); // { recordId: { defId: value } }

  // Load field definitions when tab/project changes
  useEffect(() => {
    if (!tabKey || !projectId) return;
    api.get('/migration/field-definitions', { params: { project_id: projectId, tab_key: tabKey } })
      .then(r => setFieldDefs(r.data || []))
      .catch(() => setFieldDefs([]));
  }, [tabKey, projectId]);

  // Load field values when record IDs change
  useEffect(() => {
    if (!recordIds?.length || !recordType) return;
    api.get('/migration/field-values', {
      params: { record_type: recordType, record_ids: recordIds.join(',') },
    })
      .then(r => setFieldValues(r.data || {}))
      .catch(() => {});
  }, [recordIds?.join(','), recordType]);

  const saveValue = useCallback(async (fieldDefId, recordId, value) => {
    try {
      await api.put('/migration/field-values', {
        field_def_id: fieldDefId,
        record_type:  recordType,
        record_id:    recordId,
        value,
      });
      // Optimistic local update
      setFieldValues(prev => ({
        ...prev,
        [recordId]: { ...(prev[recordId] || {}), [fieldDefId]: value },
      }));
    } catch {
      message.error('Failed to save field value');
    }
  }, [recordType]);

  const getValue = (recordId, fieldDefId) => fieldValues[recordId]?.[fieldDefId] ?? null;

  return { fieldDefs, getValue, saveValue };
}
