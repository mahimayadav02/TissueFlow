import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { Button, Field, Input } from '../../components/ui';
import { USE_SERVER, serverAuth } from '../../lib/server';
import { PublicLayout } from './PublicLayout';

/** Opened from the link in the reset email: choose a new password. The link works once, for 30 minutes. */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next.length < 8) return setError('The new password needs at least 8 characters.');
    if (!/[A-Za-z]/.test(next) || !/\d/.test(next)) return setError('Use both letters and numbers in the new password.');
    if (next !== again) return setError('The two passwords are not the same.');
    setError('');
    setBusy(true);
    try {
      await serverAuth.resetPassword(token, next);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set the password.');
    } finally {
      setBusy(false);
    }
  };

  const problem = !USE_SERVER ? 'This demo runs on sample data, so reset links are not used. Every demo account uses the password 1234.'
    : !token ? 'This link is not complete. Open the link from the email again, or ask for a new one.' : '';

  return (
    <PublicLayout>
      <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
        <Link to="/login" className="inline-flex items-center gap-1 text-sm font-semibold text-forest-700 hover:underline"><ArrowLeft size={15} /> Back to sign in</Link>
        <div className="mt-4 rounded-2xl border border-line bg-white p-6 sm:p-8">
          {done ? (
            <div className="text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-forest-50 text-forest-700"><CheckCircle2 size={24} /></span>
              <h1 className="mt-4 text-xl font-semibold">Password changed</h1>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">Sign in with your new password. You have been signed out on every other phone and computer.</p>
              <Link to="/login" className="mt-5 inline-block font-semibold text-forest-700 hover:underline">Go to sign in</Link>
            </div>
          ) : problem ? (
            <div>
              <h1 className="text-xl font-semibold">Set a new password</h1>
              <p className="mt-2 text-sm text-ink-muted">{problem}</p>
              <Link to="/forgot-password" className="mt-4 inline-block text-sm font-semibold text-forest-700 hover:underline">Ask for a new link</Link>
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
              <div>
                <h1 className="text-xl font-semibold">Set a new password</h1>
                <p className="mt-1 text-sm text-ink-muted">At least 8 characters, with letters and numbers.</p>
              </div>
              <Field label="New password"><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} autoFocus /></Field>
              <Field label="New password again"><Input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></Field>
              {error && <p className="text-sm text-redx-700">{error}</p>}
              <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</Button>
            </form>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}
