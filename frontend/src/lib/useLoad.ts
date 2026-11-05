import { useCallback, useEffect, useState } from 'react';

/** Loads data when a page opens. Gives data (null while loading), an error message, and reload(). */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(() => {
    setError('');
    return fn().then(setData).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load data.'));
  }, deps);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, reload };
}
