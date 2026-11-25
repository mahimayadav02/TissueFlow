// Dates as the lab sees them. The server may run in another time zone (Render runs in UTC),
// so "today" is worked out in the lab's own time zone.
const TZ = process.env.LAB_TZ || 'Asia/Kolkata';
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Today in the lab, as YYYY-MM-DD. */
export const labToday = (now = new Date()) => fmt.format(now);
/** The lab's calendar date of a moment in time, as YYYY-MM-DD. */
export const labDate = (d: Date) => fmt.format(d);
/** A YYYY-MM-DD string as the value stored in a date column. */
export const dbDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
/** A date column's value as YYYY-MM-DD. */
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => isoDate(new Date(dbDate(iso).getTime() + n * 86_400_000));
export const daysBetween = (fromIso: string, untilIso = labToday()) =>
  Math.round((dbDate(untilIso).getTime() - dbDate(fromIso).getTime()) / 86_400_000);
export const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(dbDate(s).getTime()) && isoDate(dbDate(s)) === s;
