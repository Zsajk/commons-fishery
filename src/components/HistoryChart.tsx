import type { Station } from "../../shared/game";

const colors = ["#147d73", "#d4513f", "#d29b28", "#3766a6"];

export function HistoryChart({ stations }: { stations: Station[] }) {
  const width = 720;
  const height = 210;
  const pad = 24;
  const maxValue = Math.max(1, ...stations.flatMap((station) => station.history));
  const maxPoints = Math.max(2, ...stations.map((station) => station.history.length));
  const x = (index: number) => pad + (index / (maxPoints - 1)) * (width - pad * 2);
  const y = (value: number) => height - pad - (value / maxValue) * (height - pad * 2);

  return (
    <div className="history-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Fish population by season">
        {[0, 0.5, 1].map((fraction) => (
          <line
            key={fraction}
            x1={pad}
            x2={width - pad}
            y1={y(maxValue * fraction)}
            y2={y(maxValue * fraction)}
            className="chart-gridline"
          />
        ))}
        {stations.map((station, stationIndex) => {
          const points = station.history.map((value, index) => `${x(index)},${y(value)}`).join(" ");
          return (
            <g key={station.id}>
              <polyline
                points={points}
                fill="none"
                stroke={colors[stationIndex % colors.length]}
                strokeWidth="4"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {station.history.map((value, index) => (
                <circle
                  key={index}
                  cx={x(index)}
                  cy={y(value)}
                  r="5"
                  fill={colors[stationIndex % colors.length]}
                />
              ))}
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        {stations.map((station, index) => (
          <span key={station.id}>
            <i style={{ background: colors[index % colors.length] }} />
            {station.name}
          </span>
        ))}
      </div>
    </div>
  );
}
