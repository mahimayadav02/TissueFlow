import { useEffect, useState } from 'react';
import { Badge, Card } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { db } from '../../lib/store';
import type { Alert } from '../../lib/types';

/** Small list of open alerts for the signed-in user (used on the home pages). */
export function AlertList({ title = 'Open alerts' }: { title?: string }) {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<Alert[] | null>(null);

  useEffect(() => {
    if (user) api.getAlerts(user).then(setAlerts);
  }, [user]);

  return (
    <Card title={title}>
      {alerts === null ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : alerts.length === 0 ? (
        <p className="text-sm text-ink-muted">No open alerts.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {alerts.map((a) => (
            <li key={a.alertId} className="flex items-start gap-3 rounded-lg border border-[#EEEAE1] p-3">
              <Badge tone={a.severity === 'CRITICAL' ? 'red' : 'amber'}>{a.severity === 'CRITICAL' ? 'Critical' : 'Warning'}</Badge>
              <div className="min-w-0 text-sm">
                <div>{a.message}</div>
                <div className="mt-0.5 text-xs text-ink-muted">
                  {a.areaId ? db.areas.find((x) => x.areaId === a.areaId)?.name : 'Whole lab'} · {new Date(a.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
