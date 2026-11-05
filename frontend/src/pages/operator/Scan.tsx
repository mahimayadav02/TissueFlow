import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bug, CheckCircle2, Scissors } from 'lucide-react';
import { TrayFinder } from '../../components/daily/TrayFinder';
import { OverdueBadge, StageBadge } from '../../components/production/badges';
import { LossForm, SubcultureForm } from '../../components/production/TrayForms';
import { Button, Card } from '../../components/ui';
import { api } from '../../lib/api';
import { today } from '../../lib/apiUtil';
import { useAuth } from '../../lib/auth';
import type { TrayRow } from '../../lib/productionApi';
import type { Tray } from '../../lib/types';
import { useLoad } from '../../lib/useLoad';

type Done = null | { kind: 'sub'; code: string; made: Tray[] } | { kind: 'loss'; code: string };

/**
 * Operator phone screen. mode "work": scan a tray, then sub-culture it (or report a loss).
 * mode "loss": scan a tray, then report contaminated bottles straight away.
 */
export default function Scan({ mode = 'work' }: { mode?: 'work' | 'loss' }) {
  const { user } = useAuth();
  const { data, reload } = useLoad(
    () => (user ? Promise.all([api.listAssignments(today(), user), api.listBatches(user), api.listCrops()]) : Promise.reject(new Error('Not logged in'))),
    [user],
  );
  const [tray, setTray] = useState<TrayRow | null>(null);
  const [form, setForm] = useState<null | 'sub' | 'loss'>(null);
  const [done, setDone] = useState<Done>(null);
  const [lines, batches, crops] = data ?? [[], [], []];

  const growth = (t: TrayRow) => {
    const cropId = batches.find((b) => b.batchId === t.batchId)?.cropId;
    return crops.find((c) => c.cropId === cropId)?.defaultGrowth ?? 2.8;
  };
  const line = tray ? lines.find((l) => l.batchId === tray.batchId && l.stageCode === tray.stageCode) : undefined;
  const found = (t: TrayRow) => {
    setTray(t);
    setDone(null);
    if (mode === 'loss') setForm('loss');
  };
  const again = () => {
    setTray(null);
    setDone(null);
    reload();
  };

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <div>
        <h1 className="font-display text-2xl font-semibold">{mode === 'loss' ? 'Report loss' : 'Scan tray'}</h1>
        <p className="text-sm text-ink-muted">{mode === 'loss' ? 'Scan the tray with contaminated or dead bottles.' : 'Scan the label on the tray you are about to sub-culture.'}</p>
      </div>

      {done ? (
        <Card>
          <div className="flex flex-col items-center gap-2 py-2 text-center">
            <CheckCircle2 size={44} className="text-forest-500" />
            <div className="text-lg font-semibold">{done.kind === 'sub' ? `${done.code} saved` : `Loss in ${done.code} recorded`}</div>
            {done.kind === 'sub' && (
              <>
                <p className="text-sm text-ink-muted">Your supervisor will check this entry.</p>
                {done.made.length > 0 && (
                  <div className="mt-2 w-full rounded-lg bg-forest-50 p-3 text-left text-sm">
                    <div className="mb-1 font-semibold">New trays ({done.made.length}) – write or stick these codes:</div>
                    <ul className="font-mono">
                      {done.made.map((m) => <li key={m.trayId}>{m.qrCode} · {m.bottleCount} bottles</li>)}
                    </ul>
                  </div>
                )}
              </>
            )}
            <Button className="mt-3 w-full py-4 text-base" onClick={again}>Scan next tray</Button>
            <Link to="/o" className="text-sm font-semibold text-forest-700 underline">Back to today</Link>
          </div>
        </Card>
      ) : !tray ? (
        <Card><TrayFinder onFound={found} /></Card>
      ) : (
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xl font-bold">{tray.qrCode}</span>
            <StageBadge code={tray.stageCode} />
            <OverdueBadge level={tray.overdue} days={tray.daysInStage} />
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
            <div><dt className="text-xs text-ink-muted">Batch</dt><dd className="font-semibold">{tray.batchCode}</dd></div>
            <div><dt className="text-xs text-ink-muted">Bench</dt><dd className="font-semibold">{tray.benchCode}</dd></div>
            <div><dt className="text-xs text-ink-muted">Bottles</dt><dd className="font-semibold">{tray.bottleCount}</dd></div>
          </dl>
          {line ? (
            <p className="mt-3 rounded-lg bg-forest-50 px-3 py-2 text-sm text-forest-700">Part of today’s work: {line.handled} of {line.targetBottles} bottles done.</p>
          ) : (
            mode === 'work' && <p className="mt-3 rounded-lg bg-amberx-100 px-3 py-2 text-sm text-amberx-700">This tray is not in the work given to you today. You can still enter it; your supervisor will see that.</p>
          )}
          <div className="mt-4 flex flex-col gap-2">
            {mode === 'work' && <Button className="py-4 text-base" onClick={() => setForm('sub')}><Scissors size={18} /> Sub-culture this tray</Button>}
            <Button variant={mode === 'loss' ? 'danger' : 'secondary'} className={mode === 'loss' ? 'py-4 text-base' : 'text-redx-700'} onClick={() => setForm('loss')}><Bug size={16} /> Report loss</Button>
            <Button variant="ghost" onClick={() => setTray(null)}>Scan a different tray</Button>
          </div>
        </Card>
      )}

      {tray && form === 'sub' && (
        <SubcultureForm tray={tray} growth={growth(tray)} onClose={() => setForm(null)} onSaved={(made) => setDone({ kind: 'sub', code: tray.qrCode, made })} />
      )}
      {tray && form === 'loss' && <LossForm tray={tray} onClose={() => setForm(null)} onSaved={() => setDone({ kind: 'loss', code: tray.qrCode })} />}
    </div>
  );
}
