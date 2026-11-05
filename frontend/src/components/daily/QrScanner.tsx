import { useEffect, useId, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, CameraOff } from 'lucide-react';
import { Button } from '../ui';

/**
 * Reads a tray QR label with the phone or laptop camera.
 * The browser only allows the camera on https:// or on localhost, so on other addresses it explains that and the code can be typed instead.
 */
export function QrScanner({ onScan }: { onScan: (text: string) => void }) {
  const id = 'qr-' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const scanner = useRef<Html5Qrcode | null>(null);
  const [on, setOn] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const stop = async () => {
    const s = scanner.current;
    scanner.current = null;
    setOn(false);
    if (!s) return;
    try {
      if (s.isScanning) await s.stop();
      s.clear();
    } catch {
      /* already stopped */
    }
  };

  const start = async () => {
    setError('');
    if (!window.isSecureContext) {
      setError('The camera works only on https:// or on localhost. Type the code on the label instead.');
      return;
    }
    setStarting(true);
    try {
      const s = new Html5Qrcode(id);
      scanner.current = s;
      await s.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        (text) => {
          stop();
          onScan(text.trim());
        },
        () => { /* no code in this frame yet */ },
      );
      setOn(true);
    } catch (e) {
      scanner.current = null;
      const msg = String(e instanceof Error ? e.message : e);
      setError(/permission|NotAllowed/i.test(msg) ? 'Camera permission was refused. Allow the camera for this site in the browser settings, or type the code.' : 'Could not open the camera. Type the code on the label instead.');
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => () => { stop(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div id={id} className={on ? 'overflow-hidden rounded-xl bg-black' : 'hidden'} />
      {on ? (
        <Button variant="secondary" className="mt-3 w-full" onClick={stop}><CameraOff size={18} /> Stop camera</Button>
      ) : (
        <Button className="w-full py-4 text-base" onClick={start} disabled={starting}><Camera size={20} /> {starting ? 'Opening camera…' : 'Scan with camera'}</Button>
      )}
      {error && <p className="mt-2 rounded-lg bg-amberx-100 px-3 py-2 text-sm text-amberx-700">{error}</p>}
    </div>
  );
}
