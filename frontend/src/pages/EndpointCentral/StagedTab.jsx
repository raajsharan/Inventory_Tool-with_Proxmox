import { useCallback, useEffect, useState } from 'react';
import { Alert, Select, Table } from 'antd';
import api from '../../api/client';
import { found, orDash, when } from './common';

/** Computers waiting in Endpoint Central for approval, with whether we know them. */
export default function StagedTab({ reload, onTotal }) {
  const [status, setStatus] = useState(3);
  const [rows, setRows]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr]       = useState('');

  const load = useCallback(async (refresh) => {
    setLoading(true); setErr('');
    try {
      const { data } = await api.get('/endpoint-central/staged', { params: { status, ...(refresh ? { refresh: 1 } : {}) } });
      setRows(data.staged);
      if (status === 3) onTotal?.(data.total);
    } catch (e) {
      setErr(e?.response?.data?.error || 'Failed to load staged computers');
      setRows([]);
    } finally { setLoading(false); }
  }, [status, onTotal]);

  useEffect(() => { load(false); }, [load]);
  useEffect(() => { if (reload) load(true); }, [reload]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      {err && <Alert type="error" showIcon message={err} style={{ marginBottom: 12 }} />}
      <div className="nx-toolbar">
        <Select value={status} onChange={setStatus} style={{ width: 160 }} aria-label="Approval status"
          options={[{ value: 3, label: 'Pending' }, { value: 1, label: 'Approved' }, { value: 2, label: 'Denied' }]} />
      </div>
      <Table rowKey={(r) => r.resource_id ?? `${r.name}-${r.mac_address}`} size="small" loading={loading} dataSource={rows}
        scroll={{ x: 'max-content' }} locale={{ emptyText: 'Nothing here' }}
        pagination={{ defaultPageSize: 25, showSizeChanger: true, pageSizeOptions: [25, 50, 100, 200], hideOnSinglePage: rows.length <= 25 }}
        columns={[
          { title: 'Computer', dataIndex: 'name', render: (v) => (v ? <b>{v}</b> : orDash(v)) },
          { title: 'IP', dataIndex: 'ip_address', render: orDash },
          { title: 'MAC', dataIndex: 'mac_address', render: orDash },
          { title: 'OS', dataIndex: 'os_name', render: (v, r) => orDash(v ?? r.os_platform) },
          { title: 'Domain', dataIndex: 'domain', render: orDash },
          { title: 'Office', dataIndex: 'remote_office', render: orDash },
          { title: 'Discovered', dataIndex: 'discovered_on', render: when },
          { title: 'In your records', render: (_, r) => found(r.in_inventory) },
        ]} />
    </div>
  );
}
