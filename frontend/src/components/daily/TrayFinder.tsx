import { useState, type FormEvent } from 'react';
import { Search } from 'lucide-react';
import { Button, ErrorText, Input } from '../ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { TrayRow } from '../../lib/productionApi';
import { QrScanner } from './QrScanner';

/** Find a tray by scanning its QR label or typing its code. */
export function TrayFinder({ onFound }: { onFound: (t: TrayRow) => void }) {
  const { user } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const look = async (c: string) => {
    if (!user || !c.trim()) return;
    setBusy(true);
    setError('');
    setCode(c);
    try {
      onFound(await api.getTrayByQr(c, user));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Not found.');
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    look(code);
  };

  return (
    <div className="flex flex-col gap-3">
      <QrScanner onScan={look} />
      <div className="flex items-center gap-3 text-xs text-ink-muted"><span className="h-px flex-1 bg-line" /> or type the code <span className="h-px flex-1 bg-line" /></div>
      <form onSubmit={submit} className="flex gap-2">
        <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="B1-26-0004" className="font-mono" aria-label="Tray code" autoCapitalize="characters" />
        <Button type="submit" variant="secondary" disabled={busy}><Search size={16} /> Find</Button>
      </form>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
