import { useEffect, useState } from 'react';
import {
  Card, Row, Col, Form, Input, Button, Space, Typography, Upload, Avatar, App, Tag, Alert, Divider,
} from 'antd';
import {
  UserOutlined, CameraOutlined, DeleteOutlined, MailOutlined, IdcardOutlined,
  SaveOutlined, LockOutlined, SafetyOutlined, CalendarOutlined, CrownOutlined,
} from '@ant-design/icons';
import api from '../api/client';
import { useAuth } from '../context/AuthContext.jsx';

const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

export default function Profile() {
  const { message } = App.useApp();
  const { user, refreshMe } = useAuth();
  const [me, setMe] = useState(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [profileForm] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const [avatar, setAvatar] = useState(null);

  useEffect(() => {
    api.get('/auth/me').then(r => {
      setMe(r.data.user);
      profileForm.setFieldsValue({
        firstName: r.data.user.firstName || '',
        lastName:  r.data.user.lastName  || '',
        jobRole:   r.data.user.jobRole   || '',
        username:  r.data.user.email?.split('@')[0],
        email:     r.data.user.email,
      });
      setAvatar(r.data.user.avatarDataUrl || null);
    }).catch(() => {});
  }, []); // eslint-disable-line

  async function onAvatarUpload(file) {
    if (file.size > AVATAR_MAX_BYTES) {
      message.error('Photo must be under 2 MB');
      return false;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setAvatar(dataUrl);
      await api.put('/auth/me', { avatarDataUrl: dataUrl });
      await refreshMe();
      message.success('Profile photo updated');
    } catch (e) {
      message.error(e.response?.data?.error || 'Upload failed');
    }
    return false;
  }

  async function onRemoveAvatar() {
    setAvatar(null);
    try {
      await api.put('/auth/me', { avatarDataUrl: null });
      await refreshMe();
      message.success('Photo removed');
    } catch (e) {
      message.error(e.response?.data?.error || 'Remove failed');
    }
  }

  async function onSaveProfile(values) {
    setSavingProfile(true);
    try {
      await api.put('/auth/me', {
        firstName: values.firstName,
        lastName:  values.lastName,
        jobRole:   values.jobRole,
      });
      await refreshMe();
      const r = await api.get('/auth/me');
      setMe(r.data.user);
      message.success('Profile updated');
    } catch (e) {
      message.error(e.response?.data?.error || 'Save failed');
    } finally { setSavingProfile(false); }
  }

  async function onChangePassword(values) {
    if (values.newPassword !== values.confirmPassword) {
      message.error('New password and confirmation do not match');
      return;
    }
    setSavingPassword(true);
    try {
      await api.post('/auth/me/change-password', {
        currentPassword: values.currentPassword,
        newPassword:     values.newPassword,
      });
      message.success('Password updated');
      passwordForm.resetFields();
    } catch (e) {
      message.error(e.response?.data?.error || 'Password update failed');
    } finally { setSavingPassword(false); }
  }

  const displayName = me?.firstName || me?.lastName
    ? [me.firstName, me.lastName].filter(Boolean).join(' ')
    : me?.fullName || 'User';

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>My Profile</Typography.Title>
      <Typography.Text type="secondary">Manage your personal information and account security</Typography.Text>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} md={8}>
          <Card style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{
              width: 120, height: 120, borderRadius: '50%',
              background: 'conic-gradient(from 0deg, #06b6d4, #f59e0b, #ef4444, #8b5cf6, #06b6d4)',
              padding: 4, margin: '0 auto',
            }}>
              <div style={{
                width: '100%', height: '100%', borderRadius: '50%',
                background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden',
              }}>
                {avatar
                  ? <img alt="avatar" src={avatar} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <UserOutlined style={{ fontSize: 56, color: '#94a3b8' }} />}
              </div>
            </div>
            <Space style={{ marginTop: 16 }}>
              <Upload accept="image/*" beforeUpload={onAvatarUpload} showUploadList={false} maxCount={1}>
                <Button icon={<CameraOutlined />}>Change Photo</Button>
              </Upload>
              <Button danger icon={<DeleteOutlined />} onClick={onRemoveAvatar} disabled={!avatar}>
                Remove
              </Button>
            </Space>
            <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
              PNG, JPG, WebP · max 2 MB
            </Typography.Paragraph>
            <Divider style={{ margin: '12px 0' }} />
            <Typography.Title level={4} style={{ margin: 0 }}>{displayName}</Typography.Title>
            {me?.jobRole && <Typography.Text type="secondary">{me.jobRole}</Typography.Text>}
            <div style={{ marginTop: 8 }}>
              <Tag icon={<CrownOutlined />} color={
                me?.role === 'superadmin' ? 'purple' :
                me?.role === 'admin'      ? 'blue'   :
                me?.role === 'asset_manager' ? 'cyan' : 'default'
              }>
                {me?.role || '—'}
              </Tag>
            </div>
          </Card>

          <Card title="Account Details" size="small">
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <div>
                <Space size={8}>
                  <MailOutlined style={{ color: '#1677ff' }} />
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>Username</Typography.Text>
                    <div><strong>{me?.email?.split('@')[0]}</strong></div>
                  </div>
                </Space>
              </div>
              <div>
                <Space size={8}>
                  <MailOutlined style={{ color: '#16a34a' }} />
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>Email</Typography.Text>
                    <div><strong>{me?.email}</strong></div>
                  </div>
                </Space>
              </div>
              <div>
                <Space size={8}>
                  <CrownOutlined style={{ color: '#7e22ce' }} />
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>Role</Typography.Text>
                    <div><strong style={{ textTransform: 'capitalize' }}>{me?.role}</strong></div>
                  </div>
                </Space>
              </div>
              <div>
                <Space size={8}>
                  <CalendarOutlined style={{ color: '#0891b2' }} />
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>Member Since</Typography.Text>
                    <div><strong>{me?.createdAt ? new Date(me.createdAt).toLocaleDateString() : '—'}</strong></div>
                  </div>
                </Space>
              </div>
            </Space>
          </Card>
        </Col>

        <Col xs={24} md={16}>
          <Card
            style={{ marginBottom: 16 }}
            title={
              <Space>
                <IdcardOutlined style={{ color: '#1677ff' }} />
                <div>
                  <Typography.Title level={5} style={{ margin: 0 }}>Personal Information</Typography.Title>
                  <Typography.Text type="secondary" style={{ fontWeight: 400, fontSize: 13 }}>Update your name and job role</Typography.Text>
                </div>
              </Space>
            }
          >
            <Form form={profileForm} layout="vertical" onFinish={onSaveProfile}>
              <Row gutter={12}>
                <Col xs={24} md={12}>
                  <Form.Item name="firstName" label="First Name">
                    <Input placeholder="First name" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="lastName" label="Last Name">
                    <Input placeholder="Last name" />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="jobRole" label="Job Role / Title" extra="Displayed on your profile card">
                <Input placeholder="e.g. Senior System Engineer" />
              </Form.Item>
              <Row gutter={12}>
                <Col xs={24} md={12}>
                  <Form.Item name="username" label={<><span>Username</span> <Typography.Text type="secondary">(read-only)</Typography.Text></>}>
                    <Input disabled />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="email" label={<><span>Email</span> <Typography.Text type="secondary">(read-only)</Typography.Text></>}>
                    <Input disabled />
                  </Form.Item>
                </Col>
              </Row>
              <div style={{ textAlign: 'right' }}>
                <Button type="primary" icon={<SaveOutlined />} htmlType="submit" loading={savingProfile}>
                  Save Changes
                </Button>
              </div>
            </Form>
          </Card>

          <Card
            title={
              <Space>
                <LockOutlined style={{ color: '#dc2626' }} />
                <div>
                  <Typography.Title level={5} style={{ margin: 0 }}>Change Password</Typography.Title>
                  <Typography.Text type="secondary" style={{ fontWeight: 400, fontSize: 13 }}>Keep your account secure with a strong password</Typography.Text>
                </div>
              </Space>
            }
          >
            <Form form={passwordForm} layout="vertical" onFinish={onChangePassword}>
              <Form.Item name="currentPassword" label="Current Password" rules={[{ required: true }]}>
                <Input.Password placeholder="Enter current password" />
              </Form.Item>
              <Form.Item name="newPassword" label="New Password" rules={[{ required: true, min: 6, message: 'Min 6 characters' }]}>
                <Input.Password placeholder="Min 6 characters" />
              </Form.Item>
              <Form.Item name="confirmPassword" label="Confirm New Password" rules={[{ required: true }]}>
                <Input.Password placeholder="Re-enter new password" />
              </Form.Item>
              <div style={{ textAlign: 'right' }}>
                <Button type="primary" icon={<LockOutlined />} htmlType="submit" loading={savingPassword}>
                  Update Password
                </Button>
              </div>
            </Form>
          </Card>

          <Alert
            style={{ marginTop: 16, background: 'rgba(252,211,77,0.12)', borderColor: '#fde68a' }}
            icon={<SafetyOutlined style={{ color: '#b45309' }} />}
            showIcon
            message={<strong style={{ color: '#854d0e' }}>Security Tips</strong>}
            description={
              <ul style={{ marginBottom: 0, paddingLeft: 18, color: '#854d0e' }}>
                <li>Use a unique password not used on other sites</li>
                <li>Include uppercase letters, numbers, and symbols</li>
                <li>Avoid using your name or username in your password</li>
                <li>Change your password regularly — at least every 90 days</li>
              </ul>
            }
          />
        </Col>
      </Row>
    </div>
  );
}
