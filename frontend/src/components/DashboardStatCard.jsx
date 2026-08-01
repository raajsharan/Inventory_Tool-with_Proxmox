import { useEffect, useRef, useState } from 'react';
import { Card, Collapse, Typography } from 'antd';
import { CaretRightOutlined } from '@ant-design/icons';

const { Text } = Typography;

// Shared "attractive dashboard" building blocks for the discovery summary
// tabs (VMware/Proxmox/Hyper-V Dashboard): count-up stat cards with colored
// icon badges, staggered fade-in, and a proportional mini-bar for breakdown
// tables. Inject DASH_CSS once per page via <style>{DASH_CSS}</style>.
export const DASH_CSS = `
@keyframes dashcard-fadein { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
.dashcard { animation: dashcard-fadein 0.45s cubic-bezier(0.22,1,0.36,1) both;
  transition: transform 0.2s ease, box-shadow 0.2s ease; }
.dashcard:hover { transform: translateY(-3px); box-shadow: 0 8px 20px rgba(0,0,0,0.09); }
.dashcard-row { transition: background 0.15s ease; }
.dashcard-minibar-fill { transition: width 0.6s cubic-bezier(0.22,1,0.36,1); }

/* Make the Collapse used by ExpandableTableCard read like the size="small"
   Cards it sits next to, instead of antd's default Collapse chrome. */
.dashcard-collapse.ant-collapse { background: #fff; border-radius: 8px; border: 1px solid #f0f0f0; }
.dashcard-collapse .ant-collapse-item { border-bottom: none; }
.dashcard-collapse .ant-collapse-header { padding: 9px 12px !important; align-items: center !important; }
.dashcard-collapse .ant-collapse-content-box { padding: 0 !important; }
`;

// Counts up from 0 to the target value with an ease-out curve — small bit of
// life on load instead of numbers just appearing.
export function useCountUp(target, duration = 700) {
  const [value, setValue] = useState(0);
  const raf = useRef(null);
  useEffect(() => {
    const start = performance.now();
    const to = Number(target) || 0;
    function step(ts) {
      const progress = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(to * eased));
      if (progress < 1) raf.current = requestAnimationFrame(step);
    }
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration]);
  return value;
}

export function StatCard({ icon, color, bg, title, value, index = 0 }) {
  const animated = useCountUp(value);
  return (
    <Card size="small" className="dashcard" style={{ animationDelay: `${index * 70}ms` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, background: bg, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ color, fontSize: 18, display: 'flex' }}>{icon}</span>
        </div>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>{title}</Text>
          <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1.3 }}>
            {animated.toLocaleString()}
          </div>
        </div>
      </div>
    </Card>
  );
}

// Small colored bar proportional to count/max — a lightweight visual cue
// alongside a raw number in a breakdown table.
export function MiniBar({ count, max, color, width = 80 }) {
  const pct = max ? Math.max(4, Math.round((count / max) * 100)) : 0;
  return (
    <div style={{ width, height: 6, borderRadius: 3, background: 'rgba(140,140,140,0.18)' }}>
      <div className="dashcard-minibar-fill" style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: color }} />
    </div>
  );
}

// Single-row stacked bar for a set of named counts against a shared total —
// e.g. running/stopped/paused proportion for one host, at a glance.
export function SplitBar({ segments, total, width = 100 }) {
  if (!total) return null;
  return (
    <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', width }}>
      {segments.filter(s => s.value > 0).map(s => (
        <div key={s.color} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
      ))}
    </div>
  );
}

// A Card-styled, single-panel Collapse — click the title (or the caret) to
// expand/collapse the table underneath, caret rotates 90° when open. Uses
// antd's built-in Collapse animation rather than a custom height transition.
export function ExpandableTableCard({ title, extra, defaultOpen = true, index = 0, children }) {
  return (
    <Collapse
      className="dashcard dashcard-collapse"
      style={{ animationDelay: `${index * 40}ms` }}
      defaultActiveKey={defaultOpen ? ['1'] : []}
      expandIcon={({ isActive }) => <CaretRightOutlined rotate={isActive ? 90 : 0} />}
      items={[{
        key: '1',
        label: <Text strong>{title}</Text>,
        extra,
        children,
      }]}
    />
  );
}
