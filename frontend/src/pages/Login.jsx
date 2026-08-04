import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { Form, Input, Button, Alert } from 'antd';
import { LockOutlined, MailOutlined, ClusterOutlined } from '@ant-design/icons';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Living network topology background — drifting glowing nodes, links between
 * near neighbours, and packets travelling along the links. Pure canvas, no
 * dependencies. Honors prefers-reduced-motion (renders one static frame).
 */
function useTopologyCanvas(canvasRef) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let w = 0, h = 0, raf = 0;
    const mouse = { x: 0.5, y: 0.5 };
    const N = 46;
    const LINK_DIST = 0.17;         // normalized link radius
    const nodes = Array.from({ length: N }, () => ({
      x: Math.random(), y: Math.random(),
      vx: (Math.random() - 0.5) * 0.00042,
      vy: (Math.random() - 0.5) * 0.00042,
      r: 1.4 + Math.random() * 2.2,
      hub: Math.random() < 0.16,    // a few bigger "core" nodes
    }));
    const packets = [];

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function px(n) { // normalized → pixels, with a gentle mouse parallax
      const ox = (mouse.x - 0.5) * 26;
      const oy = (mouse.y - 0.5) * 18;
      return [n.x * w + ox * (n.hub ? 0.5 : 1), n.y * h + oy * (n.hub ? 0.5 : 1)];
    }

    function frame() {
      ctx.clearRect(0, 0, w, h);

      // drift
      if (!reduced) {
        for (const n of nodes) {
          n.x += n.vx; n.y += n.vy;
          if (n.x < -0.02) n.x = 1.02; if (n.x > 1.02) n.x = -0.02;
          if (n.y < -0.02) n.y = 1.02; if (n.y > 1.02) n.y = -0.02;
        }
      }

      // links
      const pairs = [];
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < LINK_DIST) {
            pairs.push([i, j]);
            const alpha = (1 - d / LINK_DIST) * 0.34;
            const [x1, y1] = px(nodes[i]); const [x2, y2] = px(nodes[j]);
            ctx.strokeStyle = `rgba(96, 140, 255, ${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          }
        }
      }

      // packets — bright dots travelling along a live link
      if (!reduced && pairs.length && packets.length < 7 && Math.random() < 0.06) {
        const [i, j] = pairs[(Math.random() * pairs.length) | 0];
        packets.push({ i, j, t: 0, speed: 0.006 + Math.random() * 0.009 });
      }
      for (let k = packets.length - 1; k >= 0; k--) {
        const p = packets[k];
        p.t += p.speed;
        if (p.t >= 1) { packets.splice(k, 1); continue; }
        const [x1, y1] = px(nodes[p.i]); const [x2, y2] = px(nodes[p.j]);
        const x = x1 + (x2 - x1) * p.t, y = y1 + (y2 - y1) * p.t;
        ctx.fillStyle = 'rgba(52, 211, 153, 0.95)';
        ctx.shadowColor = 'rgba(52, 211, 153, 0.9)'; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }

      // nodes
      for (const n of nodes) {
        const [x, y] = px(n);
        const r = n.hub ? n.r + 1.6 : n.r;
        if (n.hub) {
          ctx.fillStyle = 'rgba(122, 165, 255, 0.16)';
          ctx.beginPath(); ctx.arc(x, y, r * 3.4, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = n.hub ? 'rgba(151, 186, 255, 0.95)' : 'rgba(96, 140, 255, 0.75)';
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }

      if (!reduced) raf = requestAnimationFrame(frame);
    }

    function onMouse(e) {
      mouse.x = e.clientX / window.innerWidth;
      mouse.y = e.clientY / window.innerHeight;
    }
    function onVisibility() {
      if (reduced) return;
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(frame);
    }

    resize();
    frame(); // reduced-motion renders exactly one static frame
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', onMouse);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouse);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [canvasRef]);
}

export default function Login() {
  const { login, loading, branding } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState('');
  const canvasRef = useRef(null);
  useTopologyCanvas(canvasRef);

  const sessionExpired = searchParams.get('expired') === '1';
  const returnTo = searchParams.get('from') || loc.state?.from?.pathname || '/dashboard';

  const toolName    = branding?.tool_name    || 'Infrastructure Inventory';
  const companyName = branding?.company_name || '';
  const tagline     = branding?.tagline      || 'Infrastructure';
  const footerHtml  = (branding?.footer_html
    || `© ${new Date().getFullYear()} ${toolName}. All rights reserved.`)
      .replace(/\{year\}/g, new Date().getFullYear())
      .replace(/\{tool\}/g, toolName);

  async function onFinish(values) {
    setError('');
    try {
      await login(values.email, values.password);
      nav(returnTo, { replace: true });
    } catch (e) {
      setError(e.response?.data?.error || 'Sign-in failed — check your email and password');
    }
  }

  // Split the tool name so the last word carries the accent color.
  const words = toolName.trim().split(' ');
  const last  = words.pop();

  return (
    <div className="login-stage">
      <canvas ref={canvasRef} className="login-canvas" aria-hidden="true" />
      <div className="login-stage-inner">
        {/* ── Hero ─────────────────────────────────────────────── */}
        <div className="login-hero">
          <div className="login-logo">
            {branding?.logo_data_url
              ? <img alt="" src={branding.logo_data_url} />
              : <ClusterOutlined style={{ fontSize: 30, color: '#fff' }} />}
          </div>
          <h1 className="login-wordmark">
            {words.join(' ')}{words.length > 0 ? ' ' : ''}<span className="accent">{last}</span>
          </h1>
          <div className="login-tagline">
            {companyName ? `${companyName} · ${tagline}` : tagline}
          </div>
          <div className="login-capabilities">
            <span className="login-cap">Asset inventory</span>
            <span className="login-cap">VM discovery</span>
            <span className="login-cap">Patch compliance</span>
            <span className="login-cap">Agent deployment</span>
          </div>
        </div>

        {/* ── Sign-in card ─────────────────────────────────────── */}
        <div className="login-card">
          <h2 className="login-form-title">Sign in</h2>
          <div className="login-form-sub">Use your inventory account to continue.</div>

          {sessionExpired && !error && (
            <Alert type="info" showIcon style={{ marginBottom: 16 }}
              message="Your session expired — sign in to pick up where you left off." />
          )}
          {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

          <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
            <Form.Item
              name="email" label="Email"
              rules={[{ required: true, type: 'email', message: 'Enter your email address' }]}
            >
              <Input prefix={<MailOutlined />} placeholder="name@company.com" size="large" autoComplete="username" />
            </Form.Item>
            <Form.Item
              name="password" label="Password"
              rules={[{ required: true, message: 'Enter your password' }]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="••••••••" size="large" autoComplete="current-password" />
            </Form.Item>
            <Button className="login-submit" type="primary" htmlType="submit" loading={loading} block size="large">
              Sign in
            </Button>
          </Form>

          <div className="login-footer">
            <span dangerouslySetInnerHTML={{ __html: footerHtml }} />
            <div style={{ marginTop: 4 }}>
              Need an account? drop a mail to{' '}
              <a href="mailto:netbrain-IT@netbraintech.com">netbrain-IT@netbraintech.com</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
