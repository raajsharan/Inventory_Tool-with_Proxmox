import { useEffect, useRef } from 'react';

// Any horizontally-overflowing table on any page gets three things, with
// zero per-page wiring: (1) click-and-drag panning from anywhere inside
// the table, not just the native scrollbar strip, (2) plain mouse-wheel
// scrolls it sideways instead of requiring Shift, and (3) a single
// floating scrollbar pinned to the bottom of the viewport for whichever
// wide table is currently in view, so users never have to scroll the page
// down to the table's own edge to find a horizontal scrollbar. Mounted
// once in AppLayout; a MutationObserver auto-attaches to new tables as
// routes change, so it covers every current and future page.
const SELECTOR = '.ant-table-content, [data-hscroll]';
const DRAG_THRESHOLD = 6;
const INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, .ant-select, .ant-checkbox, .ant-radio, ' +
  '.ant-btn, .ant-switch, [contenteditable], .ant-dropdown-trigger, .ant-picker';

export default function GlobalHorizontalScroll() {
  const trackRef = useRef(null);
  const thumbRef = useRef(null);

  useEffect(() => {
    const managed = new Set();
    const observers = new Map();
    const visibility = new Map();
    const activeRef = { current: null };
    const dragState = { current: null };

    const scrollableWidth = (el) => el.scrollWidth - el.clientWidth;
    const isScrollable = (el) => scrollableWidth(el) > 4;

    function updateThumb() {
      const el = activeRef.current;
      const track = trackRef.current;
      const thumb = thumbRef.current;
      if (!el || !track || !thumb || !document.body.contains(el) || !isScrollable(el)) {
        if (track) track.style.display = 'none';
        return;
      }
      const rect = el.getBoundingClientRect();
      const left = Math.max(rect.left, 0);
      track.style.display = 'block';
      track.style.left = `${left}px`;
      track.style.width = `${Math.max(Math.min(rect.right, window.innerWidth) - left, 40)}px`;
      const ratioPct = Math.max((el.clientWidth / el.scrollWidth) * 100, 8);
      const max = scrollableWidth(el);
      const pos = max > 0 ? el.scrollLeft / max : 0;
      thumb.style.width = `${ratioPct}%`;
      thumb.style.left = `${pos * (100 - ratioPct)}%`;
    }

    function setActive(el) {
      if (activeRef.current === el) return;
      activeRef.current = el;
      updateThumb();
    }

    function pickMostVisible() {
      let best = null;
      let bestRatio = 0;
      visibility.forEach((ratio, el) => {
        if (ratio > bestRatio && isScrollable(el)) { best = el; bestRatio = ratio; }
      });
      if (best) setActive(best);
      else { activeRef.current = null; updateThumb(); }
    }

    function attach(el) {
      if (managed.has(el)) return;
      managed.add(el);
      el.classList.add('hscroll-managed');

      el.addEventListener('scroll', () => { if (activeRef.current === el) updateThumb(); }, { passive: true });

      el.addEventListener('wheel', (e) => {
        if (!isScrollable(el)) return;
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          el.scrollLeft += e.deltaY;
          e.preventDefault();
        }
      }, { passive: false });

      el.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || !isScrollable(el) || e.target.closest(INTERACTIVE_SELECTOR)) return;
        dragState.current = { el, startX: e.clientX, startScroll: el.scrollLeft, moved: false };
        el.classList.add('hscroll-dragging');
      });

      // Capture-phase: swallow the click antd's row/cell handlers would
      // otherwise fire once a drag has actually moved the table, so
      // panning never accidentally triggers "open row" navigation.
      el.addEventListener('click', (e) => {
        if (dragState.current?.el === el && dragState.current.moved) {
          e.stopPropagation();
          e.preventDefault();
        }
      }, true);

      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => visibility.set(entry.target, entry.intersectionRatio));
        pickMostVisible();
      }, { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] });
      io.observe(el);
      observers.set(el, io);
    }

    function scan() {
      document.querySelectorAll(SELECTOR).forEach((el) => { if (isScrollable(el)) attach(el); });
    }

    function onMouseMove(e) {
      const d = dragState.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      if (!d.moved && Math.abs(dx) > DRAG_THRESHOLD) d.moved = true;
      if (d.moved) {
        d.el.scrollLeft = d.startScroll - dx;
        if (activeRef.current === d.el) updateThumb();
      }
    }
    function onMouseUp() {
      const d = dragState.current;
      if (d) d.el.classList.remove('hscroll-dragging');
      // Defer clearing so this element's own click handler (fires right
      // after mouseup) still sees the final `moved` state.
      setTimeout(() => { dragState.current = null; }, 0);
    }

    function onThumbMouseDown(e) {
      const el = activeRef.current;
      const track = trackRef.current;
      if (!el || !track) return;
      e.preventDefault();
      const startX = e.clientX;
      const startLeft = el.scrollLeft;
      const trackWidth = track.clientWidth;
      function move(ev) {
        const dx = ev.clientX - startX;
        el.scrollLeft = Math.min(Math.max(startLeft + (dx / trackWidth) * el.scrollWidth, 0), scrollableWidth(el));
        updateThumb();
      }
      function up() {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      }
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    }

    scan();
    const mo = new MutationObserver(() => scan());
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', updateThumb);
    window.addEventListener('scroll', updateThumb, true);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    const thumbEl = thumbRef.current;
    thumbEl?.addEventListener('mousedown', onThumbMouseDown);

    return () => {
      mo.disconnect();
      observers.forEach((io) => io.disconnect());
      window.removeEventListener('resize', updateThumb);
      window.removeEventListener('scroll', updateThumb, true);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      thumbEl?.removeEventListener('mousedown', onThumbMouseDown);
    };
  }, []);

  return (
    <div ref={trackRef} className="hscroll-float-track" style={{ display: 'none' }}>
      <div ref={thumbRef} className="hscroll-float-thumb" />
    </div>
  );
}
