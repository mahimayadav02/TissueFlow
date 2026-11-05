import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import { QrLabel } from '../../components/production/QrLabel';
import { Button } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { basePath, fmtDate } from '../../lib/paths';
import { useLoad } from '../../lib/useLoad';

/** Printable sheet of tray labels. Opens without the sidebar so it prints cleanly on A4. */
export default function TrayLabels() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const ids = (params.get('ids') ?? '').split(',').map(Number).filter(Boolean);
  const { data } = useLoad(() => api.getTraysByIds(ids), [params.get('ids')]);

  return (
    <div className="min-h-full bg-white p-6 print:p-0">
      <div className="mb-5 flex flex-wrap items-center gap-3 print:hidden">
        <Link to={`${basePath(user)}/trays`} className="inline-flex items-center gap-1 text-sm text-forest-700"><ArrowLeft size={15} /> Back</Link>
        <h1 className="font-display text-2xl font-semibold">Tray labels ({data?.length ?? 0})</h1>
        <Button className="ml-auto" onClick={() => window.print()}><Printer size={16} /> Print</Button>
      </div>
      <p className="mb-4 text-sm text-ink-muted print:hidden">Stick one label on each tray. Scanning it shows the batch, stage and bench.</p>
      {!data ? <p className="text-sm text-ink-muted">Loading…</p> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3 print:gap-2">
          {data.map((t) => (
            <QrLabel key={t.trayId} code={t.qrCode} lines={[`Batch ${t.batchCode} · ${t.stageCode}`, `${t.benchCode} · ${t.bottleCount} bottles`, fmtDate(t.placedOn)]} />
          ))}
        </div>
      )}
    </div>
  );
}
