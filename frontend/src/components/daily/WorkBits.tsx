import { Droplets, FlaskConical, Microscope, Scissors, TestTube } from 'lucide-react';
import { StageBadge } from '../production/badges';
import { fmt } from '../../lib/paths';
import { cn } from '../ui/cn';
import { WORK_LABEL, type WorkKind } from '../../lib/types';
import type { AssignmentRow } from '../../lib/dailyApi';

const ICON: Record<WorkKind, typeof Scissors> = {
  SUBCULTURE: Scissors,
  WASH: Droplets,
  MEDIA: FlaskConical,
  QC_MEDIA: TestTube,
  QC_CULTURE: Microscope,
};

/** Small label for a kind of work, with its icon. */
export function KindTag({ kind, className }: { kind: WorkKind; className?: string }) {
  const I = ICON[kind];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full bg-black/[0.05] px-2 py-0.5 text-xs font-semibold text-ink-muted', className)}>
      <I size={12} aria-hidden /> {WORK_LABEL[kind]}
    </span>
  );
}

/** What a line of work is: batch and stage for sub-culture, the media code and batch code for media, etc. */
export function WorkWhat({ line, showBench = true }: { line: AssignmentRow; showBench?: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      {line.kind === 'SUBCULTURE' ? (
        <>
          <span className="font-semibold">{line.batchCode}</span>
          <StageBadge code={line.stageCode} />
        </>
      ) : line.kind === 'MEDIA' ? (
        <>
          <KindTag kind="MEDIA" />
          <span className="font-semibold">{line.recipeCode}</span>
          <span className="font-mono text-[13px] text-ink-muted">{line.mediaBatchCode}</span>
        </>
      ) : (
        <KindTag kind={line.kind} />
      )}
      {showBench && <span className="text-ink-muted">at {line.benchId ? line.benchCode : 'any bench'}</span>}
    </span>
  );
}

/** "120 of 300 bottles" with the right words for each kind of work. */
export function WorkDone({ line }: { line: AssignmentRow }) {
  if (line.kind === 'WASH') {
    return (
      <span>
        {fmt(line.handled)} of <b>{fmt(line.target)}</b> washed
        {(line.targetContaminated ?? 0) > 0 && <span className="text-ink-muted"> ({fmt(line.contaminated)} of {fmt(line.targetContaminated ?? 0)} contaminated)</span>}
      </span>
    );
  }
  const verb = line.kind === 'MEDIA' ? 'made' : line.kind === 'SUBCULTURE' ? 'bottles' : 'checked';
  return (
    <span>
      {fmt(line.handled)} of <b>{fmt(line.target)}</b> {verb}
      {line.lost > 0 && <span className="text-redx-700"> · {line.lost} {line.kind === 'SUBCULTURE' ? 'lost' : 'failed'}</span>}
    </span>
  );
}

/** Bottles of media ready for each media code (the expert's "Status – media code"). */
export function MediaStatus({ media, picked }: { media: { recipeId: number; code: string; bottles: number }[]; picked?: number | null }) {
  return (
    <div>
      <div className="mb-1.5 text-sm font-semibold">Status – media code</div>
      <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {media.map((m) => (
          <li key={m.recipeId} className={cn('flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-sm', m.recipeId === picked ? 'border-forest-700 bg-forest-50' : 'border-line bg-white')}>
            <span className="font-semibold">{m.code}</span>
            <span className={cn('tabular-nums', m.bottles === 0 ? 'text-redx-700' : 'text-ink-muted')}>{fmt(m.bottles)} bottles</span>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-ink-muted">Bottles of media ready to use (made, not expired, not yet used).</p>
    </div>
  );
}

/** The two wash-area counts side by side, in the place where batch and stage are for sub-culture. */
export function WashStatus({ plain, contaminated, givenPlain = 0, givenContaminated = 0, addedPlain, addedContaminated }: {
  plain: number; contaminated: number; givenPlain?: number; givenContaminated?: number; addedPlain?: number; addedContaminated?: number;
}) {
  const box = (label: string, n: number, given: number, added?: number) => (
    <div className="rounded-lg border border-line bg-white px-3 py-2">
      <div className="text-xs font-semibold text-ink-muted">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{fmt(n)}</div>
      {added !== undefined && <div className="text-xs text-forest-700">+{fmt(added)} added today from sub-culture</div>}
      {given > 0 && <div className="text-xs text-ink-muted">{fmt(given)} already given out today</div>}
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-3">
      {box('Total bottles to be washed', plain, givenPlain, addedPlain)}
      {box('Total contaminated bottles to be washed', contaminated, givenContaminated, addedContaminated)}
    </div>
  );
}
