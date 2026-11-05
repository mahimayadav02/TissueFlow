import { Badge } from '../ui';
import type { Overdue } from '../../lib/productionApi';

/** Colour of a stage code: I = initiation, M = multiplication, R = rooting, PH/SH = hardening. */
export function StageBadge({ code }: { code: string }) {
  const tone = code.startsWith('I') ? 'purple' : code.startsWith('M') ? 'green' : code.startsWith('R') ? 'blue' : 'amber';
  return <Badge tone={tone}>{code}</Badge>;
}

export function OverdueBadge({ level, days }: { level: Overdue; days: number }) {
  if (level === 'OK') return <span className="tabular-nums text-ink-muted">{days} d</span>;
  return <Badge tone={level === 'CRITICAL' ? 'red' : 'amber'}>{days} d · overdue</Badge>;
}
