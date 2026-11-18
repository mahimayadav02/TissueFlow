import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import type { Role } from '../../lib/types';
import { Button } from '../ui/Button';

/** Opens the tour from anywhere (e.g. the user menu). */
export const startTour = () => window.dispatchEvent(new Event('tissueflow:tour'));

const KEY = (role: Role) => `tissueflow.tour.${role}.done`;

/** A few short steps per role: what this account is for and where its main tasks live. */
const STEPS: Record<Role, { title: string; text: string }[]> = {
  MANAGER: [
    { title: 'Welcome to TissueFlow', text: 'You see the whole lab: every zone, batch, operator, order and cost. This short tour shows where things are.' },
    { title: 'Start with the dashboard', text: 'The dashboard shows today’s work against target, losses, the growth room, open orders and last month’s profit.' },
    { title: 'Zones', text: 'Zones in the menu gives one page that combines every zone, and a page for each zone with its operators, trays, benches and alerts.' },
    { title: 'Plan ahead', text: 'Forecast and profit shows how many plants each batch will give and when. Orders tells you whether a customer’s order can be met by their date.' },
    { title: 'Help is on every page', text: 'Open “How this page works” under a page title, or the (i) next to a number. The question mark at the top opens the full guide.' },
  ],
  SUPERVISOR: [
    { title: 'Welcome to TissueFlow', text: 'You look after your own zones. This short tour shows your daily routine.' },
    { title: 'Start of the shift', text: 'Mark attendance, then give each present operator their work for their zone: sub-culture, washing, media or checking, with a target in bottles.' },
    { title: 'During the day', text: 'Your zone pages show work done against target, trays on the benches, losses and alerts as they happen.' },
    { title: 'End of the shift', text: 'Check entries: verify each one or send it back with a reason. Work output adds it all up by day, operator, zone, batch and stage.' },
    { title: 'Help is on every page', text: 'Open “How this page works” under a page title. The question mark at the top opens the full guide.' },
  ],
  OPERATOR: [
    { title: 'Welcome to TissueFlow', text: 'This app shows the work your supervisor gave you today and lets you record it.' },
    { title: 'Scan the tray', text: 'Tap Scan tray, point the camera at the label on the tray (or type its code), then enter the new bottles and any lost ones.' },
    { title: 'No label? Record work', text: 'Tap Record work and type the batch, stage and bottles. Washing, media and checking work is entered here too.' },
    { title: 'Report a loss', text: 'Found contaminated bottles? Use Report loss, scan the tray and say how many and why.' },
    { title: 'See your progress', text: 'My work shows all your work, day by day. If your supervisor sends an entry back, the reason shows on your home screen.' },
  ],
};

export function Tour() {
  const { user } = useAuth();
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    try { if (!localStorage.getItem(KEY(user.role))) setStep(0); } catch { /* storage not available: skip the automatic tour */ }
    const open = () => setStep(0);
    window.addEventListener('tissueflow:tour', open);
    return () => window.removeEventListener('tissueflow:tour', open);
  }, [user]);

  if (!user || step === null) return null;
  const steps = STEPS[user.role];
  const s = steps[step];
  const last = step === steps.length - 1;
  const finish = () => {
    try { localStorage.setItem(KEY(user.role), '1'); } catch { /* ignore */ }
    setStep(null);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-end p-4 sm:place-items-center" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <button className="absolute inset-0 bg-forest/40" aria-label="Close the tour" onClick={finish} />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <button onClick={finish} className="focus-ring absolute right-3 top-3 rounded-lg p-1.5 text-ink-muted hover:bg-black/5" aria-label="Close the tour"><X size={18} /></button>
        <div className="mb-3 flex gap-1.5" aria-hidden>
          {steps.map((_, i) => <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-forest-600' : 'bg-[#E1E9E4]'}`} />)}
        </div>
        <p className="text-xs text-ink-muted">Step {step + 1} of {steps.length}</p>
        <h2 id="tour-title" className="mt-1 font-display text-xl font-semibold tracking-tight">{s.title}</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-ink">{s.text}</p>
        <div className="mt-6 flex items-center justify-between gap-2">
          <button onClick={finish} className="focus-ring rounded-md text-sm text-ink-muted hover:text-ink">Skip</button>
          <div className="flex gap-2">
            {step > 0 && <Button variant="ghost" onClick={() => setStep(step - 1)}>Back</Button>}
            <Button onClick={() => (last ? finish() : setStep(step + 1))}>{last ? 'Get started' : 'Next'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
