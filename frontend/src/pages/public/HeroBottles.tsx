/**
 * The home page's picture: culture bottles multiplying stage by stage.
 * One bottle at initiation becomes 2, 4, 8, 16 over four multiplication rounds (m = 2 here),
 * which is the lab's own rule T = n × m^h from the project brief.
 */
const COLS = [
  { label: 'I1', count: 1 },
  { label: 'M1', count: 2 },
  { label: 'M2', count: 4 },
  { label: 'M3', count: 8 },
  { label: 'M4', count: 16 },
];

function Jar({ x, y }: { x: number; y: number }) {
  // A small culture bottle: neck, body, medium at the bottom, a plantlet with two leaves.
  return (
    <g transform={`translate(${x} ${y}) scale(1.25)`}>
      <rect x="5" y="0" width="8" height="5" rx="1.5" fill="#9FD3B8" opacity="0.55" />
      <rect x="0" y="4" width="18" height="22" rx="4" fill="none" stroke="#CFE6DA" strokeWidth="1.4" />
      <rect x="1.4" y="18" width="15.2" height="6.6" rx="2.6" fill="#E9D9A6" opacity="0.55" />
      <path d="M9 18 V10" stroke="#7CD39F" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9 13 C 6 11, 5 9, 5.5 8 C 7.5 8.5, 9 10.5, 9 13Z" fill="#7CD39F" />
      <path d="M9 11.5 C 12 9.5, 13 8, 12.5 7 C 10.5 7.5, 9 9.5, 9 11.5Z" fill="#A8E6BF" />
    </g>
  );
}

export function HeroBottles() {
  const colW = 96;
  const x0 = 22;
  const baseY = 296;
  return (
    <svg viewBox="0 0 520 400" role="img" aria-label="One culture bottle multiplies to 2, 4, 8 and 16 bottles over four multiplication rounds" className="h-auto w-full">
      <rect width="520" height="400" rx="24" fill="#143A30" />
      <text x="34" y="52" fill="#CFE6DA" fontSize="15" fontWeight="600">One bottle, four rounds, sixteen bottles</text>
      <text x="34" y="74" fill="#8FB3A4" fontSize="12.5">Each sub-culture splits the shoots into new bottles</text>
      {COLS.map((c, i) => {
        const perRow = c.count >= 16 ? 4 : c.count >= 4 ? 2 : 1;
        const rows = Math.ceil(c.count / perRow);
        const cx = x0 + i * colW;
        return (
          <g key={c.label} className="tf-rise" style={{ animationDelay: `${150 + i * 160}ms` }}>
            {Array.from({ length: c.count }, (_, k) => {
              const r = Math.floor(k / perRow);
              const col = k % perRow;
              const w = perRow * 24 - 2;
              return <Jar key={k} x={cx + (92 - w) / 2 + col * 24} y={baseY - (rows - r) * 38} />;
            })}
            <line x1={cx + 8} x2={cx + 84} y1={baseY + 8} y2={baseY + 8} stroke="#2F7A63" />
            <text x={cx + 46} y={baseY + 32} textAnchor="middle" fill="#E6F2EC" fontSize="14" fontWeight="600" fontFamily='"IBM Plex Mono", monospace'>{c.label}</text>
            <text x={cx + 46} y={baseY + 50} textAnchor="middle" fill="#8FB3A4" fontSize="12">{c.count} {c.count === 1 ? 'bottle' : 'bottles'}</text>
          </g>
        );
      })}
      <text x="34" y="378" fill="#9FD3B8" fontSize="14" fontFamily='"IBM Plex Mono", monospace'>T = n × mʰ</text>
      <text x="150" y="378" fill="#8FB3A4" fontSize="12.5">so 10 samples doubling for 9 rounds give 5,120 bottles</text>
    </svg>
  );
}
