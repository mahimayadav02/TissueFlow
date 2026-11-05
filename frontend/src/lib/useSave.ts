import { useState, type FormEvent } from 'react';

/** Handles a form submit: calls save, then onSaved and onClose. Gives busy and error for the form. */
export function useSave<T>(save: (v: T) => Promise<unknown>, onSaved: () => void, onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent, value: T) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await save(value);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
}
