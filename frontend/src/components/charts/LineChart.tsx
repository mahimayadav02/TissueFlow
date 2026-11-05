import { useState, type PointerEvent } from 'react';
import { AXIS_TEXT, GRID, LIMIT, SERIES, niceTicks, useWidth } from './common';

export interface LinePoint { t: number; y: number }
export interface Limit { value: number; label: string; tone: 'warning' | 'critical' }

/**
 * Line chart over time. One measure per chart (never two y-scales).
 * Dashed amber / red lines show alert limits. Hover or touch shows the exact reading.
 */
export function LineChart({ series, unit, limits = [], height = 220, formatTime, label }: {
  series: { name: string; points: LinePoint[] }[];
  unit: string;
  limits?: Limit[];
  height?: number;
  formatTime: (t: number) => string;
  label: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pts = series[0]?.points ?? [];
  if (!pts.length) return <div ref={ref} className="py-10 text-center text-sm text-ink-muted">No readings.</div>;

  const pad = { l: 40, r: 76, t: 22, b: 26 };
  const W = Math.max(280, width);
  const H = height;
  const all = series.flatMap((s) => s.points.map((p) => p.y)).concat(limits.map((l) => l.value));
  const lo = Math.floor(Math.min(...all) - 0.5);
  const hi = Math.ceil(Math.max(...all) + 0.5);
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const x = (t: number) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / Math.max(1e-9, hi - lo)) * (H - pad.t - pad.b);
  const yTicks = niceTicks(lo, hi, 4);
  const nx = Math.min(6, Math.max(2, Math.floor(W / 120)));
  const xTicks = Array.from({ length: nx }, (_, i) => t0 + ((t1 - t0) * i) / (nx - 1));
  const path = (ps: LinePoint[]) => ps.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.y).toFixed(1)}`).join('');

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const tx = t0 + ((e.clientX - box.left) / box.width) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i].t - tx) < Math.abs(pts[best].t - tx)) best = i;
    setHover(best);
  };
  const hp = hover !== null ? pts[hover] : null;
  const tipLeft = hp ? Math.min(Math.max(x(hp.t) - 70, 0), W - 150) : 0;

  return (
    <div ref={ref} className="relative w-full">
      {series.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-4 text-xs text-ink-muted">
          {series.map((s, i) => <span key={s.name} className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: SERIES[i] }} />{s.name}</span>)}
        </div>
      )}
      <svg width={W} height={H} role="img" aria-label={label} className="block touch-none select-none">
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke={GRID} />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill={AXIS_TEXT}>{v}</text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={x(t)} y={H - 6} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'} fontSize="11" fill={AXIS_TEXT}>{formatTime(t)}</text>
        ))}
        <text x={pad.l - 6} y={11} textAnchor="end" fontSize="10.5" fill={AXIS_TEXT}>{unit}</text>
        {limits.filter((l) => l.value >= lo && l.value <= hi).map((l) => (
          <g key={l.label}>
            <line x1={pad.l} x2={W - pad.r} y1={y(l.value)} y2={y(l.value)} stroke={LIMIT[l.tone]} strokeWidth="1.5" strokeDasharray="5 4" />
            <text x={W - pad.r + 6} y={y(l.value) + 4} fontSize="10.5" fill={AXIS_TEXT}>{l.label}</text>
          </g>
        ))}
        {series.map((s, i) => <path key={s.name} d={path(s.points)} fill="none" stroke={SERIES[i]} strokeWidth="2" strokeLinejoin="round" />)}
        {hp && (
          <g>
            <line x1={x(hp.t)} x2={x(hp.t)} y1={pad.t} y2={H - pad.b} stroke="#9A9486" strokeWidth="1" />
            {series.map((s, i) => s.points[hover!] && <circle key={s.name} cx={x(s.points[hover!].t)} cy={y(s.points[hover!].y)} r="4.5" fill={SERIES[i]} stroke="#fff" strokeWidth="2" />)}
          </g>
        )}
        <rect x={pad.l} y={pad.t} width={Math.max(0, W - pad.l - pad.r)} height={H - pad.t - pad.b} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {hp && (
        <div className="pointer-events-none absolute top-0 z-10 w-[150px] rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-md" style={{ left: tipLeft }}>
          <div className="mb-1 text-ink-muted">{formatTime(hp.t)}</div>
          {series.map((s) => s.points[hover!] && <div key={s.name} className="flex justify-between gap-2"><span>{s.name}</span><b className="tabular-nums">{s.points[hover!].y} {unit}</b></div>)}
        </div>
      )}
    </div>
  );
}
