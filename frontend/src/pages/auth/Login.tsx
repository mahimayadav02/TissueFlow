import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Sprout } from 'lucide-react';
import { Button, Field, Input } from '../../components/ui';
import { HOME_OF, useAuth } from '../../lib/auth';
import { DEMO_PASSWORD, DEMO_USERS } from '../../lib/mockData';
import { ROLE_LABEL } from '../../lib/types';

const DEMO = DEMO_USERS; // one account per role

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={HOME_OF[user.role]} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!/^\d{10}$/.test(phone.trim())) return setError('Enter a 10-digit phone number.');
    if (!password) return setError('Enter your password.');
    setBusy(true);
    try {
      const u = await login(phone, password);
      navigate(HOME_OF[u.role], { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full">
      <div className="hidden w-[42%] flex-col justify-between bg-forest p-10 text-white lg:flex">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#2A6453]"><Sprout size={20} className="text-[#9FD3B8]" /></span>
          <span className="font-display text-xl font-semibold">TissueFlow</span>
        </div>
        <div>
          <h1 className="font-display text-4xl font-semibold leading-tight text-white">Every bottle counted once, from sample to delivery.</h1>
          <p className="mt-4 max-w-md text-[#CFE6DA]">Batch and tray tracking, daily work, losses, stock, forecasts and alerts for the tissue culture lab.</p>
        </div>
        <p className="text-xs text-sage">IoT Enabled Automated Tissue Management System · IGDTUW</p>
      </div>

      <div className="flex flex-1 items-center justify-center p-5">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center gap-2 lg:hidden">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-forest"><Sprout size={20} className="text-[#9FD3B8]" /></span>
            <span className="font-display text-xl font-semibold">TissueFlow</span>
          </div>
          <h2 className="font-display text-2xl font-semibold">Sign in</h2>
          <p className="mt-1 text-sm text-ink-muted">Use the phone number your manager registered.</p>

          <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
            <Field label="Phone number">
              <Input inputMode="numeric" autoComplete="username" maxLength={10} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} placeholder="10-digit number" />
            </Field>
            <Field label="Password">
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error && <p role="alert" className="rounded-lg bg-redx-100 px-3 py-2 text-sm text-redx-700">{error}</p>}
            <Button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
          </form>

          <div className="mt-8 rounded-xl border border-dashed border-[#9A9486] p-4">
            <p className="text-xs font-semibold text-ink-muted">Demo accounts (sample data) · password {DEMO_PASSWORD}</p>
            <div className="mt-3 grid gap-2">
              {DEMO.map((u) => (
                <button
                  key={u.userId}
                  type="button"
                  onClick={() => { setPhone(u.phone); setPassword(DEMO_PASSWORD); setError(''); }}
                  className="focus-ring flex items-center justify-between rounded-lg border border-line bg-white px-3 py-2 text-left text-sm hover:border-forest-500"
                >
                  <span><span className="font-semibold">{ROLE_LABEL[u.role]}</span> · {u.fullName}</span>
                  <span className="text-xs text-ink-muted">{u.phone}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
