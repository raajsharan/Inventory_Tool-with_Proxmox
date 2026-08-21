import { Component } from 'react';
import { useLocation } from 'react-router-dom';
import { Button, Result } from 'antd';

// Catches render/chunk-load errors thrown while navigating so a broken page
// shows a recoverable message instead of leaving the whole app blank.
// Keyed by pathname in the wrapper below, so it remounts (clearing any
// error) on the next navigation rather than sticking around forever.
const CHUNK_ERROR_RE = /dynamically imported module|module script failed|ChunkLoadError|Loading chunk/i;
const RELOAD_GUARD_KEY = 'route-error-reload-attempted';

class ErrorBoundaryInner extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    const message = String(error?.message || '');
    // A stale chunk hash after a new deploy is the most common cause of a
    // blank page on navigation — one automatic reload picks up the fresh
    // bundle. Guarded so a genuinely broken chunk doesn't reload forever.
    if (CHUNK_ERROR_RE.test(message) && !sessionStorage.getItem(RELOAD_GUARD_KEY)) {
      sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
      window.location.reload();
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <Result
          status="warning"
          title="This page couldn't load"
          subTitle="Something went wrong while loading this page. Try again, or reload if it keeps happening."
          extra={
            <Button type="primary" onClick={() => window.location.reload()}>
              Reload page
            </Button>
          }
        />
      );
    }
    return this.props.children;
  }
}

export default function RouteErrorBoundary({ children }) {
  const location = useLocation();
  return <ErrorBoundaryInner key={location.pathname}>{children}</ErrorBoundaryInner>;
}
