import { QRCodeSVG } from 'qrcode.react';

/** One tray label: QR code plus the text a person can read without scanning. */
export function QrLabel({ code, lines }: { code: string; lines: string[] }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-[#9A9486] bg-white p-2.5 [break-inside:avoid]">
      <QRCodeSVG value={code} size={84} level="M" marginSize={0} />
      <div className="min-w-0 text-xs leading-snug">
        <div className="font-mono text-sm font-bold">{code}</div>
        {lines.map((l) => <div key={l} className="truncate text-ink-muted">{l}</div>)}
      </div>
    </div>
  );
}
