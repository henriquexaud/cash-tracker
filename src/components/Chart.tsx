import { useEffect, useId, useRef, useState } from "react";
import { formatMoney, monthLabel } from "../domain/finance";

export interface ChartPoint {
  label: string;
  value: number;
  month: string;
}

export function Chart({
  points,
  title,
  color = "#3f7357",
  height = 210,
}: {
  points: ChartPoint[];
  title: string;
  color?: string;
  height?: number;
}) {
  const id = useId().replace(/:/g, "");
  const [active, setActive] = useState<number | null>(null);
  const activeIndex = active !== null && active < points.length ? active : null;
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const hasPoints = points.length > 0;
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () =>
      setWidth(Math.max(280, Math.min(720, element.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasPoints]);
  if (!points.length)
    return (
      <div className="chart-empty">
        A evolução aparecerá depois do primeiro registro confirmado.
      </div>
    );
  const left = 52,
    right = 14,
    top = 24,
    bottom = 30;
  const chartW = width - left - right,
    chartH = height - top - bottom;
  const minValue = Math.min(0, ...points.map((p) => p.value));
  const maximum = Math.max(10000, ...points.map((p) => p.value));
  const scale = Math.pow(10, Math.floor(Math.log10(maximum)));
  const maxValue = Math.ceil(maximum / (scale / 2)) * (scale / 2);
  const x = (i: number) =>
    left +
    (points.length === 1 ? chartW / 2 : (i / (points.length - 1)) * chartW);
  const y = (v: number) =>
    top + chartH - ((v - minValue) / (maxValue - minValue)) * chartH;
  const line = points
    .map((p, i) => `${i ? "L" : "M"} ${x(i)} ${y(p.value)}`)
    .join(" ");
  const area = `${line} L ${x(points.length - 1)} ${top + chartH} L ${x(0)} ${top + chartH} Z`;
  const tickIndices =
    points.length <= 3
      ? points.map((_, i) => i)
      : width < 460
        ? [0, Math.round((points.length - 1) / 2), points.length - 1]
        : Array.from(
            new Set([
              0,
              Math.round((points.length - 1) / 4),
              Math.round((points.length - 1) / 2),
              Math.round(((points.length - 1) * 3) / 4),
              points.length - 1,
            ]),
          );
  const axisMoney = (v: number) =>
    Math.abs(v) >= 100000
      ? `${(v / 100000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`
      : `${(v / 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
  return (
    <div
      ref={container}
      className="chart"
      onPointerLeave={() => setActive(null)}
    >
      {activeIndex !== null && (
        <div className="chart-tooltip" role="status">
          <span>{monthLabel(points[activeIndex].month, true)}</span>
          <strong>{formatMoney(points[activeIndex].value)}</strong>
        </div>
      )}
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
        <title>{title}</title>
        <desc>
          {points.length} registros. Primeiro valor{" "}
          {formatMoney(points[0].value)} e último valor{" "}
          {formatMoney(points[points.length - 1].value)}.
        </desc>
        <defs>
          <linearGradient id={`fill-${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".16" />
            <stop offset="100%" stopColor={color} stopOpacity=".015" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((i) => {
          const v = minValue + ((maxValue - minValue) / 3) * i;
          return (
            <g key={i}>
              <line
                x1={left}
                x2={width - right}
                y1={y(v)}
                y2={y(v)}
                stroke="#e5e8e0"
                strokeDasharray={i ? "3 5" : undefined}
              />
              <text
                x={left - 12}
                y={y(v) + 4}
                textAnchor="end"
                className="chart-axis"
              >
                {axisMoney(v)}
              </text>
            </g>
          );
        })}
        <path d={area} fill={`url(#fill-${id})`} />
        <path
          d={line}
          stroke={color}
          strokeWidth="2.5"
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {tickIndices.map((i) => (
          <text
            key={i}
            x={x(i)}
            y={height - 5}
            textAnchor={
              i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"
            }
            className="chart-axis"
          >
            {monthLabel(points[i].month, true)}
          </text>
        ))}
        {points.map((p, i) => (
          <rect
            key={p.month}
            x={x(i) - Math.max(3, chartW / points.length / 2)}
            y={top}
            width={Math.max(6, chartW / points.length)}
            height={chartH}
            fill="transparent"
            onPointerEnter={() => setActive(i)}
          >
            <title>
              {monthLabel(p.month)}: {formatMoney(p.value)}
            </title>
          </rect>
        ))}
        <circle
          cx={x(activeIndex ?? points.length - 1)}
          cy={y(points[activeIndex ?? points.length - 1].value)}
          r="4.5"
          fill={color}
          stroke="#fff"
          strokeWidth="2"
          pointerEvents="none"
        />
      </svg>
    </div>
  );
}
