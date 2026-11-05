// In-browser database for the fake API. Starts from SEED and keeps your edits
// in localStorage, so they survive a page refresh. Not used once the backend exists.
import { SEED } from './mockData';

export type DB = typeof SEED;

const KEY = 'tissueflow.db.v4';
// v4 (Phase 6): sample data now includes the sensor node, alert checks and audit log. Older saved data is ignored.

function load(): DB {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...structuredClone(SEED), ...(JSON.parse(raw) as Partial<DB>) };
  } catch {
    /* storage blocked or bad data: fall back to sample data */
  }
  return structuredClone(SEED);
}

export const db: DB = load();

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* ignore */
  }
}

/** Throws away all edits and goes back to the sample data. */
export function resetDb() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  window.location.reload();
}

export function nextId<T>(list: T[], key: keyof T): number {
  return list.reduce((m, x) => Math.max(m, Number(x[key]) || 0), 0) + 1;
}
