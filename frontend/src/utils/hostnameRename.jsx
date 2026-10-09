import { Typography } from 'antd';

// Calls the backend hostname-rename endpoint and shows a result modal before
// resolving, so a form's onFinish can `await` this between saving the record
// and navigating away — the admin sees whether the live server was actually
// renamed, not just that the inventory record was. Never throws: a failed
// rename is reported via the modal, not as a rejected promise, since the
// record itself was already saved successfully by the time this runs.
export async function runHostnameRename({ api, modal, message, source, id }) {
  message.loading({ content: 'Renaming the server’s hostname…', key: 'hostname-rename', duration: 0 });
  try {
    const { data } = await api.post('/hostname-rename', { source, id });
    message.destroy('hostname-rename');
    if (data.succeeded) {
      modal.success({
        title: 'Hostname renamed',
        content: data.rebootRequired
          ? 'The server was renamed. A reboot is needed on the Windows side before the new name fully takes effect.'
          : 'The server was renamed successfully.',
      });
    } else {
      modal.error({
        title: 'Hostname rename failed',
        width: 640,
        content: (
          <div>
            <Typography.Paragraph>{data.error || 'The rename did not complete.'}</Typography.Paragraph>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
              The inventory record was still saved with this hostname — fix connectivity/credentials
              and retry from here, or rename the server manually.
            </Typography.Paragraph>
            {data.output && (
              <pre style={{ maxHeight: 240, overflow: 'auto', background: '#f5f5f5', padding: 8, fontSize: 11 }}>
                {data.output}
              </pre>
            )}
          </div>
        ),
      });
    }
  } catch (e) {
    message.destroy('hostname-rename');
    modal.error({
      title: 'Hostname rename failed',
      content: e.response?.data?.error || 'Request failed — the inventory record was still saved.',
    });
  }
}
