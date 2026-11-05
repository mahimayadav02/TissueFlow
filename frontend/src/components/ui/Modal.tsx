import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** Pop-up window for add / edit forms. Closes on Escape or the X button. */
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-black/40" aria-label="Close" onClick={onClose} />
      <div className={`relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold">{title}</h2>
          <button onClick={onClose} className="focus-ring rounded-lg p-1.5 hover:bg-black/5" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Buttons row at the bottom of a form. */
export function FormActions({ children }: { children: ReactNode }) {
  return <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{children}</div>;
}

/** Red box for a form or load error. */
export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p role="alert" className="mt-3 rounded-lg bg-redx-100 px-3 py-2 text-sm text-redx-700">{children}</p>;
}
