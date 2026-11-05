// Small helpers shared by the fake API files.
export const wait = (ms = 200) => new Promise((r) => setTimeout(r, ms));
export const copy = <T,>(x: T): T => structuredClone(x);

/** Error with a message that can be shown to the user as it is. */
export class ApiError extends Error {}

export const need = (ok: unknown, msg: string) => {
  if (!ok) throw new ApiError(msg);
};
export const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A new record: same as T but the id is optional (filled in when saved). */
export type New<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/** Date as YYYY-MM-DD in the computer's own time zone (not UTC). */
export const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today = () => toIso(new Date());
export const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return toIso(d);
};
export const daysBetween = (fromIso: string, until = today()) =>
  Math.round((new Date(until.slice(0, 10)).getTime() - new Date(fromIso.slice(0, 10)).getTime()) / 86_400_000);
