import { useState, useEffect } from 'react';
import { Modal, Input, Typography, Alert } from 'antd';
import { LockOutlined, ExclamationCircleOutlined } from '@ant-design/icons';

export default function PasswordConfirmModal({
  open, title, danger = true, message, okText = 'Confirm', onCancel, onConfirm,
}) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setPassword(''); setError(''); setLoading(false); }
  }, [open]);

  async function submit() {
    if (!password) { setError('Please enter your password'); return; }
    setLoading(true);
    setError('');
    try {
      await onConfirm(password);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      title={
        <span>
          <ExclamationCircleOutlined style={{ color: danger ? '#dc2626' : '#1677ff', marginRight: 8 }} />
          {title || 'Confirm with your password'}
        </span>
      }
      onCancel={onCancel}
      onOk={submit}
      okText={okText}
      okButtonProps={{ danger, loading }}
      destroyOnClose
    >
      {message && <Alert type={danger ? 'warning' : 'info'} message={message} showIcon style={{ marginBottom: 12 }} />}
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        Re-enter your current account password to continue.
      </Typography.Paragraph>
      <Input.Password
        autoFocus
        prefix={<LockOutlined />}
        placeholder="Your password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onPressEnter={submit}
      />
      {error && <Alert type="error" message={error} style={{ marginTop: 12 }} showIcon />}
    </Modal>
  );
}
