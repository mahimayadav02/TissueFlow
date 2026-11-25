import { useState, type FormEvent } from 'react';
import { LogOut, Map } from 'lucide-react';
import { initials } from '../../components/layout/Topbar';
import { startTour } from '../../components/layout/Tour';
import { Badge, Button, Card, Field, Input, PageHeader } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { USE_SERVER } from '../../lib/server';
import { ROLE_LABEL } from '../../lib/types';

/** The signed-in person's own details, password, and a way to see the tour again. */
export default function Profile() {
  const { user, logout, logoutAll, changePassword, lab, areas } = useAuth();
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!user) return null;
  const zones = user.zoneIds.map((id) => areas.find((a) => a.areaId === id)?.name).filter(Boolean) as string[];
  const home = areas.find((a) => a.areaId === user.homeAreaId)?.name;

  const change = async (e: FormEvent) => {
    e.preventDefault();
    if (!current) return setMsg({ ok: false, text: 'Enter your current password.' });
    if (next.length < 8) return setMsg({ ok: false, text: 'The new password needs at least 8 characters.' });
    if (!/[A-Za-z]/.test(next) || !/\d/.test(next)) return setMsg({ ok: false, text: 'Use both letters and numbers in the new password.' });
    if (next !== again) return setMsg({ ok: false, text: 'The two new passwords are not the same.' });
    if (!USE_SERVER) {
      setMsg({ ok: true, text: 'Your new password is valid. On sample data it is not saved: every account keeps the password 1234.' });
      setCurrent(''); setNext(''); setAgain('');
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      setMsg({ ok: true, text: 'Password changed. You stay signed in here; other phones and computers are signed out.' });
      setCurrent(''); setNext(''); setAgain('');
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Could not change the password.' });
    } finally {
      setBusy(false);
    }
  };

  const signOutEverywhere = async () => {
    if (!window.confirm('Sign out on every phone and computer, including this one?')) return;
    try {
      await logoutAll();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Could not sign out everywhere.' });
    }
  };

  const row = (k: string, v: string) => (
    <div className="grid grid-cols-[130px_1fr] gap-3 py-2.5 text-[15px]"><dt className="text-ink-muted">{k}</dt><dd className="font-medium text-ink">{v}</dd></div>
  );

  return (
    <>
      <PageHeader title="My profile" subtitle="Your account details and password." />
      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Card>
          <div className="flex items-center gap-4">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-forest text-lg font-semibold text-white">{initials(user.fullName)}</span>
            <div>
              <div className="text-lg font-semibold">{user.fullName}</div>
              <Badge tone="green">{ROLE_LABEL[user.role]}</Badge>
            </div>
          </div>
          <dl className="mt-4 divide-y divide-[#E6ECE8]">
            {row('Phone', user.phone)}
            {row('Role', ROLE_LABEL[user.role])}
            {user.role === 'SUPERVISOR' && row('Zones', zones.join(', ') || 'None yet')}
            {user.role === 'OPERATOR' && row('Home zone', home ?? 'Not set')}
            {row('Lab', lab?.name ?? '')}
          </dl>
          <p className="mt-3 text-xs text-ink-muted">Your name, phone and zones are set by the manager on the Users page.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={startTour}><Map size={16} /> Take the tour again</Button>
            <Button variant="ghost" onClick={logout} className="text-redx-700"><LogOut size={16} /> Sign out</Button>
            {USE_SERVER && <Button variant="ghost" onClick={signOutEverywhere} className="text-redx-700"><LogOut size={16} /> Sign out on all devices</Button>}
          </div>
        </Card>
        <Card title="Change password">
          <form onSubmit={change} className="flex flex-col gap-4" noValidate>
            <Field label="Current password"><Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
            <Field label="New password" hint="At least 8 characters, with letters and numbers."><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
            <Field label="New password again"><Input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></Field>
            {msg && <p role="status" className={`rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-forest-50 text-forest-700' : 'bg-redx-100 text-redx-700'}`}>{msg.text}</p>}
            <Button type="submit" className="self-start" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
