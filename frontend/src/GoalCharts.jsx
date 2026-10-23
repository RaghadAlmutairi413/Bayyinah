// Charts for the performance screens, drawn with plain SVG (no chart library).
// Ratings and scores live on a 1 to 5 scale.

const MIN = 1;
const MAX = 5;
const DEFAULT_WIDTH = 600;
const H = 280;
const PAD = { left: 38, right: 28, top: 26, bottom: 38 };

function score2(value) {
  return value === null || value === undefined ? '—' : Number(value).toFixed(2);
}

function pointsOf(values, W) {
  const count = values.length;
  const step = count > 1 ? (W - PAD.left - PAD.right) / (count - 1) : 0;
  const offset = count > 1 ? 0 : (W - PAD.left - PAD.right) / 2;
  return values.map((value, index) => (value === null || value === undefined ? null : {
    x: PAD.left + offset + index * step,
    y: PAD.top + ((MAX - value) / (MAX - MIN)) * (H - PAD.top - PAD.bottom),
    value,
    index,
  }));
}

// Runs of consecutive points; a missing value breaks the line.
function segments(points) {
  const runs = [];
  let run = [];
  points.forEach((point) => {
    if (point) {
      run.push(point);
    } else if (run.length) {
      runs.push(run);
      run = [];
    }
  });
  if (run.length) runs.push(run);
  return runs;
}

// Smooth curve that never overshoots the data points.
function curve(run) {
  return run.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;
    const before = run[index - 1];
    const middle = (before.x + point.x) / 2;
    return `${path} C ${middle} ${before.y} ${middle} ${point.y} ${point.x} ${point.y}`;
  }, '');
}

// series = [{ name, values, tone: 'current' | 'previous', area, dashed }]
export function LineChart({ id, categories, series, dark = false, label, width = DEFAULT_WIDTH }) {
  const W = width;
  const baseline = H - PAD.bottom;
  const xs = categories.length > 1
    ? categories.map((_, i) => PAD.left + (i * (W - PAD.left - PAD.right)) / (categories.length - 1))
    : [PAD.left + (W - PAD.left - PAD.right) / 2];
  const hasData = series.some((item) => item.values.some((v) => v !== null && v !== undefined));

  return (
    <figure className={`gl-line${dark ? ' gl-line-dark' : ''}${dark && series.length > 1 ? ' gl-line-multi' : ''}`}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <defs>
          <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={dark ? '#ffffff' : '#ec6a1a'} stopOpacity={dark ? 0.42 : 0.32} />
            <stop offset="100%" stopColor={dark ? '#ffffff' : '#ec6a1a'} stopOpacity="0" />
          </linearGradient>
        </defs>

        {[1, 2, 3, 4, 5].map((tick) => {
          const y = PAD.top + ((MAX - tick) / (MAX - MIN)) * (H - PAD.top - PAD.bottom);
          return (
            <g key={tick}>
              <line x1={PAD.left} x2={W - PAD.right + 8} y1={y} y2={y} className="gl-line-grid" />
              <text x={PAD.left - 12} y={y + 4} textAnchor="end" className="gl-line-tick">{tick}</text>
            </g>
          );
        })}

        {categories.map((name, index) => (
          <text key={name} x={xs[index]} y={H - 10} textAnchor="middle" className="gl-line-cat">{name}</text>
        ))}

        {series.map((item, seriesIndex) => {
          const points = pointsOf(item.values, W);
          return (
            <g key={item.name} className={`gl-series gl-series-${item.tone}`} style={item.color ? { '--c': item.color } : undefined}>
              {segments(points).map((run) => (
                <g key={run[0].index}>
                  {item.area && run.length > 1 && (
                    <path
                      d={`${curve(run)} L ${run[run.length - 1].x} ${baseline} L ${run[0].x} ${baseline} Z`}
                      fill={`url(#${id}-area)`}
                      className="gl-line-area"
                    />
                  )}
                  {run.length > 1 && (
                    <path
                      d={curve(run)}
                      pathLength="1"
                      className={`gl-line-path${item.dashed ? ' gl-line-dashed' : ''}`}
                      style={{ animationDelay: `${seriesIndex * 0.25}s` }}
                    />
                  )}
                </g>
              ))}
              {points.filter(Boolean).map((point, index, all) => (
                <g key={point.index}>
                  <circle cx={point.x} cy={point.y} r={item.tone === 'current' ? 6 : 4.5} className="gl-line-dot">
                    <title>{`${item.name}, ${categories[point.index]}: ${score2(point.value)}`}</title>
                  </circle>
                  {(item.tone === 'current' || item.showValues) && (index === all.length - 1 || all.length <= 5) && (
                    <text x={point.x} y={point.y - 14} textAnchor="middle" className="gl-line-value">
                      {score2(point.value)}
                    </text>
                  )}
                </g>
              ))}
            </g>
          );
        })}

        {!hasData && (
          <text x={W / 2} y={H / 2} textAnchor="middle" className="gl-line-empty">No ratings yet</text>
        )}
      </svg>
      <figcaption className="gl-legend">
        {series.map((item) => (
          <span key={item.name} className="gl-legend-item">
            <i className={`gl-swatch gl-swatch-${item.tone}${item.dashed ? ' gl-swatch-dashed' : ''}`} style={item.color ? { '--c': item.color } : undefined} />
            {item.name}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

// Progress toward a target. Goes past the end of the track when the goal is exceeded.
export function Meter({ percent }) {
  const rounded = Math.round(percent);
  const reached = rounded >= 100;
  return (
    <div className="gl-meter">
      <div className="gl-meter-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(rounded, 100)}>
        <div className={`gl-meter-fill${reached ? ' gl-meter-reached' : ''}`} style={{ width: `${Math.min(rounded, 100)}%` }} />
      </div>
      <span className="gl-meter-value">{rounded}%</span>
    </div>
  );
}
