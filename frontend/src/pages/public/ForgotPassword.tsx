import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, MailCheck } from 'lucide-react';
import { Button, Field, Input } from '../../components/ui';
import { PublicLayout } from './PublicLayout';

/**
 * Forgot password. With the server (phase B2) this sends a one-time reset link by email.
 * Until then the form only explains that; the demo accounts all use the password 1234.
 */
export default function ForgotPassword() {
  const [value, setValue] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!/^\d{10}$/.test(v) && !/^\S+@\S+\.\S+$/.test(v)) {
      setError('Enter your 10-digit phone number or your email address.');
      return;
    }
    setError('');
    setSent(true);
  };
  return (
    <PublicLayout>
      <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
        <Link to="/login" className="inline-flex items-center gap-1 text-sm font-semibold text-forest-700 hover:underline"><ArrowLeft size={15} /> Back to sign in</Link>
        <div className="mt-4 rounded-2xl border border-line bg-white p-6 sm:p-8">
          {sent ? (
            <div className="text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-forest-50 text-forest-700"><MailCheck size={24} /></span>
              <h1 className="mt-4 text-xl font-semibold">Check your email</h1>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                If an account uses <span className="font-semibold text-ink">{value.trim()}</span>, a link to set a new password is on its way. The link works once and for 30 minutes.
              </p>
              <p className="mt-4 rounded-lg bg-amberx-100 px-3 py-2 text-sm text-amberx-700">This demo runs on sample data and sends no email. Every demo account uses the password 1234.</p>
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <div>
                <h1 className="text-xl font-semibold">Forgot your password?</h1>
                <p className="mt-1 text-sm text-ink-muted">Enter the phone number or email on your account. We’ll send a link to set a new password.</p>
              </div>
              <Field label="Phone number or email">
                <Input value={value} onChange={(e) => setValue(e.target.value)} autoComplete="username" autoFocus />
              </Field>
              {error && <p className="text-sm text-redx-700">{error}</p>}
              <Button type="submit">Send reset link</Button>
              <p className="text-xs text-ink-muted">No email on your account? Ask your manager to reset your password.</p>
            </form>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}
