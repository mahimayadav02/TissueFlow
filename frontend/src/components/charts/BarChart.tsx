import { useState } from 'react';
import { AXIS_TEXT, GRID, SERIES, niceTicks, short, useWidth } from './common';

/**
 * Columns (e.g. bottles handled per day) with an optional comparison line (e.g. target).
 * Hover or touch a column to see its numbers.
 */
export function BarChart({ data, barName, lineName, height = 220, label }: {
  data: { label: string; tip: string; bar: number; line?: number }[];
  barName: string;
  lineName?: string;
  height?: number;
  label: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <div ref={ref} className="py-10 text-center text-sm text-ink-muted">Nothing to show yet.</div>;
  const pad = { l: 40, r: 8, t: 10, b: 24 };
  const W = Math.max(280, width);
  const H = height;
  const max = Math.max(1, ...data.map((d) => Math.max(d.bar, d.line ?? 0)));
  const ticks = niceTicks(0, max, 4);
  const top = Math.max(max, ticks[ticks.length - 1]);
  const slot = (W - pad.l - pad.r) / data.length;
  const bw = Math.max(3, Math.min(28, slot - 2)); // 2px gap between bars
  const y = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const cx = (i: number) => pad.l + slot * i + slot / 2;
  const every = Math.ceil(data.length / Math.max(2, Math.floor(W / 70)));
  const hasLine = data.some((d) => d.line !== undefined);
  const linePath = data.map((d, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)},${y(d.line ?? 0).toFixed(1)}`).join('');
  const h = hover !== null ? data[hover] : null;

  return (
    <div ref={ref} className="relative w-full">
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-ink-muted">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[0] }} />{barName}</span>
        {hasLine && lineName && <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: SERIES[1] }} />{lineName}</span>}
      </div>
      <svg width={W} height={H} role="img" aria-label={label} className="block select-none">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke={GRID} />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill={AXIS_TEXT}>{short(v)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const bh = Math.max(0, H - pad.b - y(d.bar));
          const r = Math.min(4, bw / 2, bh);
          const x0 = cx(i) - bw / 2;
          const yt = y(d.bar);
          return (
            <g key={i} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} onPointerLeave={() => setHover(null)}>
              <rect x={pad.l + slot * i} y={pad.t} width={slot} height={H - pad.t - pad.b} fill={hover === i ? 'rgba(0,0,0,0.04)' : 'transparent'} />
              {bh > 0 && <path d={`M${x0},${H - pad.b}V${yt + r}Q${x0},${yt} ${x0 + r},${yt}H${x0 + bw - r}Q${x0 + bw},${yt} ${x0 + bw},${yt + r}V${H - pad.b}Z`} fill={SERIES[0]} opacity={hover === null || hover === i ? 1 : 0.55} />}
              {i % every === 0 && <text x={cx(i)} y={H - 6} textAnchor="middle" fontSize="11" fill={AXIS_TEXT}>{d.label}</text>}
            </g>
          );
        })}
        {hasLine && <path d={linePath} fill="none" stroke={SERIES[1]} strokeWidth="2" strokeLinejoin="round" pointerEvents="none" />}
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="#C9C2B4" />
      </svg>
      {h && hover !== null && (
        <div className="pointer-events-none absolute top-6 z-10 w-[160px] rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-md" style={{ left: Math.min(Math.max(cx(hover) - 80, 0), W - 160) }}>
          <div className="mb-1 text-ink-muted">{h.tip}</div>
          <div className="flex justify-between gap-2"><span>{barName}</span><b className="tabular-nums">{h.bar.toLocaleString('en-IN')}</b></div>
          {h.line !== undefined && lineName && <div className="flex justify-between gap-2"><span>{lineName}</span><b className="tabular-nums">{h.line.toLocaleString('en-IN')}</b></div>}
        </div>
      )}
    </div>
  );
}

/** Horizontal bars with the value written next to each (e.g. losses by cause). One colour: it shows size, not identity. */
export function HBars({ rows, unit = '' }: { rows: { label: string; value: number }[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="text-sm text-ink-muted">Nothing recorded.</p>;
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.label} className="text-sm">
          <div className="mb-1 flex justify-between gap-2"><span>{r.label}</span><span className="font-semibold tabular-nums">{r.value.toLocaleString('en-IN')}{unit}</span></div>
          <div className="h-2 rounded-full bg-black/[0.06]"><div className="h-2 rounded-full" style={{ width: `${(100 * r.value) / max}%`, background: SERIES[0] }} /></div>
        </li>
      ))}
    </ul>
  );
}
