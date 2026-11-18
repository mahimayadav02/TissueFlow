import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ScanLine } from 'lucide-react';
import { EntryBadge } from '../../components/daily/bits';
import { KindTag } from '../../components/daily/WorkBits';
import { WorkEntryForm } from '../../components/daily/WorkEntryForm';
import { Button, Card } from '../../components/ui';
import { api } from '../../lib/api';
import { today } from '../../lib/apiUtil';
import { useAuth } from '../../lib/auth';
import type { EntryRow } from '../../lib/dailyApi';
import { fmt } from '../../lib/paths';
import { useLoad } from '../../lib/useLoad';

/** Operator phone screen: type in the work done (batch, stage, bottles) instead of scanning each tray. */
export default function EnterWork() {
  const { user } = useAuth();
  const [saved, setSaved] = useState<EntryRow | null>(null);
  const [formKey, setFormKey] = useState(0);
  const { data: entries, reload } = useLoad(() => (user ? api.listEntries(user, { from: today() }) : Promise.resolve([])), [user, formKey]);
  if (!user) return null;
  const mine = (entries ?? []).filter((e) => e.status !== 'REJECTED');

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">Record work</h1>
        <p className="text-sm text-ink-muted">Type in what you did, without scanning a tray: the batch, the stage and the bottles. Your supervisor checks it.</p>
      </div>

      {saved ? (
        <Card>
          <div className="flex flex-col items-center gap-2 py-2 text-center">
            <CheckCircle2 size={44} className="text-forest-500" />
            <div className="text-lg font-semibold">Saved: {fmt(saved.bottlesHandled)} bottles · {saved.label}</div>
            {saved.kind === 'SUBCULTURE' && <p className="text-sm text-ink-muted">{fmt(saved.bottlesProduced)} new bottles{saved.bottlesLost ? `, ${saved.bottlesLost} lost` : ''}. New trays were made for them.</p>}
            <Button className="mt-3 w-full py-4 text-base" onClick={() => { setSaved(null); setFormKey((k) => k + 1); reload(); }}>Record more work</Button>
            <Link to="/o" className="text-sm font-semibold text-forest-700 underline">Back to today</Link>
          </div>
        </Card>
      ) : (
        <Card>
          <WorkEntryForm key={formKey} operatorId={user.userId} date={today()} onSaved={(e) => { setSaved(e); reload(); }} />
        </Card>
      )}

      <Link to="/o/scan" className="focus-ring flex items-center justify-center gap-2 rounded-xl border border-[#B5CDBF] bg-white py-3 text-sm font-semibold text-forest-700">
        <ScanLine size={18} /> Scan a tray instead
      </Link>

      {mine.length > 0 && (
        <Card title={`Entered today (${fmt(mine.reduce((n, e) => n + e.bottlesHandled, 0))} bottles)`}>
          <ul className="divide-y divide-[#E6ECE8] text-sm">
            {mine.map((e) => (
              <li key={e.entryId} className="flex items-center justify-between gap-2 py-2">
                <span className="flex flex-wrap items-center gap-1.5">
                  {e.kind === 'SUBCULTURE' ? <span className="font-semibold">{e.label}</span> : <KindTag kind={e.kind} />}
                  <span className="text-ink-muted">{fmt(e.bottlesHandled)}{e.kind === 'SUBCULTURE' ? ` → ${fmt(e.bottlesProduced)}` : ''}{e.source === 'QR' ? ` · ${e.qrCode}` : ' · typed in'}</span>
                </span>
                <EntryBadge status={e.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
