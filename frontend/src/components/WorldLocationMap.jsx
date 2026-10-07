import { ComposableMap, Geographies, Geography, Marker, useMapContext } from 'react-simple-maps';
import landTopo from 'world-atlas/land-110m.json';

// Office locations come from the admin-configured "Locations" dropdown
// (dropdown_master, category='location') — a small, fixed set, so a plain
// lookup here is simpler and lighter than geocoding free text. Add an entry
// here whenever a new location is added to that dropdown and should appear
// on this map. Coordinates are [longitude, latitude], the order d3-geo (and
// so react-simple-maps) expects.
const LOCATION_COORDS = {
  'Beijing':        [116.4074, 39.9042],
  'Burlington':     [-71.1912, 42.5048],
  'Toronto':        [-79.3832, 43.6532],
  'Boston Bomgar':  [-71.0589, 42.3601],
};

// Burlington/Boston Bomgar/Toronto sit within a couple hundred km of each
// other, so at any zoom level that still fits Beijing on the same map their
// dots and default labels collide — nudge each one's label clear of the
// cluster. Falls back to a plain label centered above the dot for any
// location (e.g. a newly added one) not listed here.
const LABEL_OFFSETS = {
  'Beijing':        { dx: 0,   dy: -14, anchor: 'middle' },
  'Burlington':     { dx: 0,   dy: 20,  anchor: 'middle' },
  'Toronto':        { dx: -10, dy: -16, anchor: 'end' },
  'Boston Bomgar':  { dx: 10,  dy: 2,   anchor: 'start' },
};
const DEFAULT_LABEL_OFFSET = { dx: 0, dy: -14, anchor: 'middle' };

// Shared with the donut legend in Dashboard.jsx so a location's dot color
// matches its slice color everywhere it appears on this card.
export const LOCATION_COLORS = [
  '#13a8a8', '#1677ff', '#fa8c16', '#722ed1', '#eb2f96', '#52c41a', '#faad14',
];

// Same "moving dot along an offset-path" technique as the Custom Topology
// canvas's ConnectivityFlowEdge/.ctb-flow-dot — CSS offset-path takes the
// same "M.. Q.." syntax an SVG path's "d" attribute does, so the arc string
// built below works directly as both. Two dots travel hub->spoke and two
// more travel spoke->hub (.reverse just plays the same keyframes backwards),
// staggered at negative delays so the link reads as continuous bidirectional
// traffic from the very first frame rather than four dots bunched up at one
// end and slowly spreading out.
const FLOW_CSS = `
@keyframes wlm-flow { to { offset-distance: 100%; } }
@media (prefers-reduced-motion: no-preference) {
  .wlm-flow-dot { animation: wlm-flow 2.6s linear infinite; }
  .wlm-flow-dot.reverse { animation-direction: reverse; }
}
`;
const DOT_DELAYS = ['0s', '-1.3s'];

// One quadratic-bezier arc between two projected points, bowed toward the
// top of the map — reads as a flight path / live data link rather than the
// straight "ruler line" a plain d3 LineString between two far-apart points
// would otherwise draw.
function arcPath(projection, from, to) {
  const p1 = projection(from);
  const p2 = projection(to);
  if (!p1 || !p2) return null;
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy) || 1;
  const bow = dist * 0.22;
  let cx = (x1 + x2) / 2 - (dy / dist) * bow;
  let cy = (y1 + y2) / 2 + (dx / dist) * bow;
  const my = (y1 + y2) / 2;
  if (cy > my) { // always bow upward, regardless of which way the line runs
    cx = (x1 + x2) / 2 + (dy / dist) * bow;
    cy = (y1 + y2) / 2 - (dx / dist) * bow;
  }
  return `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`;
}

// Rendered inside <ComposableMap> so useMapContext() can resolve lng/lat to
// the map's current projected screen coordinates for the arcs below.
function LiveLinks({ links }) {
  const { projection } = useMapContext();
  return (
    <>
      <style>{FLOW_CSS}</style>
      {links.map(({ key, from, to, color }) => {
        const d = arcPath(projection, from, to);
        if (!d) return null;
        return (
          <g key={key}>
            <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeOpacity={0.55}
              strokeLinecap="round" strokeDasharray="0.5 6" />
            {DOT_DELAYS.map((delay, i) => (
              <circle
                key={`f${i}`} r={2.5} className="wlm-flow-dot" fill={color}
                style={{ offsetPath: `path('${d}')`, animationDelay: delay, filter: `drop-shadow(0 0 3px ${color})` }}
              />
            ))}
            {DOT_DELAYS.map((delay, i) => (
              <circle
                key={`r${i}`} r={2.5} className="wlm-flow-dot reverse" fill={color}
                style={{ offsetPath: `path('${d}')`, animationDelay: delay, filter: `drop-shadow(0 0 3px ${color})` }}
              />
            ))}
          </g>
        );
      })}
    </>
  );
}

// Connects every other plotted location back to whichever one has the
// highest count (almost always the HQ) — a simple hub-and-spoke read of
// "these sites are one connected inventory" rather than a literal network
// topology, since this app has no real inter-site link data to draw from.
// The animated dots are a visual "there's live traffic between these sites"
// cue, not a feed of actual transactions — no such per-site traffic data
// exists anywhere in this app to drive it for real.
export default function WorldLocationMap({ rows, isDark }) {
  const plotted = (rows || []).filter(r => LOCATION_COORDS[r.location]);
  if (!plotted.length) return null;

  const hub = plotted.reduce((a, b) => (b.count > a.count ? b : a), plotted[0]);
  const landFill = isDark ? '#283046' : '#e2e8f5';
  const linkColor = isDark ? '#60a5fa' : '#1677ff';
  const labelFill = isDark ? '#f0f0f0' : '#262626';

  const links = plotted
    .filter(r => r.location !== hub.location)
    .map(r => ({
      key: r.location,
      from: LOCATION_COORDS[hub.location],
      to: LOCATION_COORDS[r.location],
      color: linkColor,
    }));

  return (
    <ComposableMap
      projection="geoEqualEarth"
      projectionConfig={{ scale: 180, center: [15, 25] }}
      width={800}
      height={340}
      style={{ width: '100%', height: 'auto' }}
    >
      <Geographies geography={landTopo}>
        {({ geographies }) =>
          geographies.map(geo => (
            <Geography key={geo.rsmKey} geography={geo} fill={landFill} stroke="none"
              style={{ default: { outline: 'none' }, hover: { outline: 'none' }, pressed: { outline: 'none' } }} />
          ))
        }
      </Geographies>

      <LiveLinks links={links} />

      {plotted.map((r, i) => {
        const { dx, dy, anchor } = LABEL_OFFSETS[r.location] || DEFAULT_LABEL_OFFSET;
        return (
          <Marker key={r.location} coordinates={LOCATION_COORDS[r.location]}>
            <circle r={6} fill={LOCATION_COLORS[i % LOCATION_COLORS.length]} stroke="#fff" strokeWidth={1.5} />
            <text x={dx} y={dy} textAnchor={anchor} style={{ fontSize: 11, fontWeight: 600, fill: labelFill }}>
              {r.location} ({r.count})
            </text>
          </Marker>
        );
      })}
    </ComposableMap>
  );
}
