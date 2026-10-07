import { ComposableMap, Geographies, Geography, Marker, Line } from 'react-simple-maps';
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

// Connects every other plotted location back to whichever one has the
// highest count (almost always the HQ) — a simple hub-and-spoke read of
// "these sites are one connected inventory" rather than a literal network
// topology, since this app has no real inter-site link data to draw from.
export default function WorldLocationMap({ rows, isDark }) {
  const plotted = (rows || []).filter(r => LOCATION_COORDS[r.location]);
  if (!plotted.length) return null;

  const hub = plotted.reduce((a, b) => (b.count > a.count ? b : a), plotted[0]);
  const landFill = isDark ? '#283046' : '#e2e8f5';
  const lineColor = isDark ? '#3b82f6' : '#93c5fd';
  const labelFill = isDark ? '#f0f0f0' : '#262626';

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

      {plotted.filter(r => r.location !== hub.location).map(r => (
        <Line
          key={`line-${r.location}`}
          from={LOCATION_COORDS[hub.location]}
          to={LOCATION_COORDS[r.location]}
          stroke={lineColor}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          fill="none"
        />
      ))}

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
