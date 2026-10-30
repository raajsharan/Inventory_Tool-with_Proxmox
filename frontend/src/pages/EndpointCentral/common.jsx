import dayjs from 'dayjs';
import {
  CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, MinusCircleFilled, QuestionCircleFilled,
} from '@ant-design/icons';

// Status is always an icon plus text, never colour alone.
export const LIVE = {
  1: { label: 'Live',    cls: 'ok',   icon: <CheckCircleFilled /> },
  2: { label: 'Down',    cls: 'bad',  icon: <CloseCircleFilled /> },
  3: { label: 'Unknown', cls: 'idle', icon: <QuestionCircleFilled /> },
};
export const INSTALL = {
  21: { label: 'Yet to install',      cls: 'warn', icon: <MinusCircleFilled /> },
  22: { label: 'Installed',           cls: 'ok',   icon: <CheckCircleFilled /> },
  23: { label: 'Uninstalled',         cls: 'idle', icon: <MinusCircleFilled /> },
  24: { label: 'Yet to uninstall',    cls: 'warn', icon: <MinusCircleFilled /> },
  29: { label: 'Installation failed', cls: 'bad',  icon: <ExclamationCircleFilled /> },
};

export const Pill = ({ s, children }) => <span className={`nx-pill ${s.cls}`}>{s.icon}{children || s.label}</span>;
export const Dash = () => <span className="nx-dim">-</span>;

// The backend uses '—' / null / '' for "no value"
export const isBlank = (v) => v === null || v === undefined || v === '' || v === '—' || v === '--';
export const orDash = (v) => (isBlank(v) ? <Dash /> : v);

const valid = (v) => v && dayjs(v).isValid();
export const when = (v) => (valid(v) ? dayjs(v).format('D MMM HH:mm') : <Dash />);

/** Last contact: older than a week is highlighted. */
export const contact = (v) => {
  if (isBlank(v)) return <Dash />;
  if (!valid(v)) return v;
  return (
    <span className={dayjs().diff(v, 'day') > 7 ? 'nx-stale' : ''} title={dayjs(v).format('D MMM YYYY HH:mm')}>
      {dayjs(v).format('D MMM HH:mm')}
    </span>
  );
};

export const found = (yes) => (
  <Pill s={yes
    ? { label: 'Found',     cls: 'ok',   icon: <CheckCircleFilled /> }
    : { label: 'Not found', cls: 'warn', icon: <QuestionCircleFilled /> }} />
);
