import { useEffect, useRef, useState } from 'react';

/** Chart colours. Series colours were checked for colour-blind separation; amber and red are kept for limits only. */
export const SERIES = ['#1E8A5F', '#3B6FD4'];
export const LIMIT = { warning: '#B7791F', critical: '#B42318' };
export const GRID = '#ECE8DF';
export const AXIS_TEXT = '#4F5754';

/** Width of an element, kept up to date when the window is resized. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/** About `count` round tick values covering min…max. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

export const short = (n: number) => (Math.abs(n) >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n * 10) / 10));
