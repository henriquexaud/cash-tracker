import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { formatMoney, monthLabel } from "../domain/finance";
import { usePrivacy } from "../privacy";

export interface ChartPoint {
  label: string;
  value: number;
  month: string;
}

const hiddenText: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
};

export function Chart({
  points,
  title,
  color = "var(--chart-line, var(--green))",
  height = 210,
}: {
  points: ChartPoint[];
  title: string;
  color?: string;
  height?: number;
}) {
  const { hidden } = usePrivacy();
  const id = useId().replace(/:/g, "");
  const [activeMonth, setActiveMonth] = useState<string | null>(null);
  const foundIndex = points.findIndex((point) => point.month === activeMonth);
  const activeIndex = foundIndex >= 0 ? foundIndex : null;
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const hasPoints = points.length > 0;
  useEffect(() => {
    if (activeMonth !== null && foundIndex < 0) setActiveMonth(null);
  }, [activeMonth, foundIndex]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () =>
      setWidth(Math.max(280, Math.min(720, element.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasPoints, hidden]);
  if (hidden)
    return (
      <div className="chart-empty privacy-chart" role="status">
        Gráfico oculto enquanto os valores estiverem protegidos.
      </div>
    );
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
  const selectedIndex = activeIndex ?? points.length - 1;
  const selectedPoint = points[selectedIndex];
  const selectedLabel = `${monthLabel(selectedPoint.month, true)}: ${formatMoney(selectedPoint.value)}`;
  const selectPoint = (index: number) =>
    setActiveMonth(
      points[Math.max(0, Math.min(points.length - 1, index))].month,
    );
  const handleKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    let nextIndex: number;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown":
        nextIndex = selectedIndex - 1;
        break;
      case "ArrowRight":
      case "ArrowUp":
        nextIndex = selectedIndex + 1;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = points.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    selectPoint(nextIndex);
  };
  const handlePointer = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    const position = ((event.clientX - bounds.left) / bounds.width) * width;
    selectPoint(Math.round(((position - left) / chartW) * (points.length - 1)));
  };
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
      onPointerLeave={(event) => {
        if (
          event.pointerType === "mouse" &&
          !event.currentTarget.contains(document.activeElement)
        )
          setActiveMonth(null);
      }}
    >
      <span id={`summary-${id}`} style={hiddenText}>
        {points.length} {points.length === 1 ? "registro" : "registros"}. Primeiro valor {formatMoney(points[0].value)}{" "}
        e último valor {formatMoney(points[points.length - 1].value)}.
      </span>
      <span id={`instructions-${id}`} style={hiddenText}>
        Use as setas para explorar os meses, Home para o primeiro e End para o
        último. Também pode tocar no gráfico para consultar um valor.
      </span>
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={hiddenText}
      >
        {activeIndex !== null ? selectedLabel : ""}
      </span>
      {activeIndex !== null && (
        <div className="chart-tooltip" aria-hidden="true">
          <span>{monthLabel(points[activeIndex].month, true)}</span>
          <strong>{formatMoney(points[activeIndex].value)}</strong>
        </div>
      )}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="slider"
        tabIndex={0}
        aria-label={title}
        aria-describedby={`summary-${id} instructions-${id}`}
        aria-orientation="horizontal"
        aria-valuemin={1}
        aria-valuemax={points.length}
        aria-valuenow={selectedIndex + 1}
        aria-valuetext={selectedLabel}
        style={{ touchAction: "pan-y" }}
        onKeyDown={handleKeyDown}
        onFocus={() => selectPoint(selectedIndex)}
        onBlur={() => setActiveMonth(null)}
        onPointerDown={(event) => {
          event.currentTarget.focus();
          handlePointer(event);
        }}
        onPointerMove={(event) => {
          if (event.pointerType === "mouse" || event.buttons > 0)
            handlePointer(event);
        }}
      >
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
                stroke="var(--chart-grid, var(--border))"
                strokeDasharray={i ? "3 5" : undefined}
              />
              <text
                x={left - 12}
                y={y(v) + 4}
                textAnchor="end"
                className="chart-axis"
                style={{ fill: "var(--chart-axis, var(--muted))" }}
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
            style={{ fill: "var(--chart-axis, var(--muted))" }}
          >
            {monthLabel(points[i].month, true)}
          </text>
        ))}
        <circle
          cx={x(selectedIndex)}
          cy={y(selectedPoint.value)}
          r="4.5"
          fill={color}
          stroke="var(--surface)"
          strokeWidth="2"
          pointerEvents="none"
        />
      </svg>
    </div>
  );
}
