// The real API: every function the pages use, sent to the backend server instead of the in-browser sample data.
// Same names, inputs and results as the sample-data API in api.ts, so pages do not change.
// Turned on with VITE_USE_SERVER=1 (see .env.example). The address is VITE_API_URL, default /api/v1 (same site).
import { ApiError } from './apiUtil';
import type { RawApi } from './api';
import type { Session, User } from './types';

const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {});
export const USE_SERVER = env.VITE_USE_SERVER === '1';
const BASE = (env.VITE_API_URL || '/api/v1').replace(/\/$/, '');

// ---------- sign-in token ----------
// The short-lived access token is kept in memory only. The long-lived refresh token is an httpOnly cookie
// the browser keeps and page scripts cannot read; it is used to get a new access token.
let accessToken: string | null = null;
let onSignedOut: (() => void) | null = null;
let refreshing: Promise<Session | null> | null = null;

export function setSignedOutHandler(fn: () => void) {
  onSignedOut = fn;
}

type Query = Record<string, string | number | boolean | null | undefined>;
const qs = (q?: Query) => {
  if (!q) return '';
  const p = Object.entries(q).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return p.length ? `?${p.join('&')}` : '';
};

async function send(method: string, path: string, body?: unknown, auth = true): Promise<Response> {
  return fetch(BASE + path, {
    method,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(auth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function read<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError((data && typeof data.error === 'string' && data.error) || `The server answered ${res.status}. Please try again.`);
  return data as T;
}

/** Calls the API. If the access token has run out, gets a new one once and tries again. */
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await send(method, path, body);
    if (res.status === 401 && path !== '/auth/login') {
      const s = await refresh();
      if (!s) {
        onSignedOut?.();
        throw new ApiError('Your session has ended. Please sign in again.');
      }
      res = await send(method, path, body);
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('Cannot reach the server. Check the internet connection and try again.');
  }
  return read<T>(res);
}
const get = <T>(path: string, q?: Query) => call<T>('GET', path + qs(q));
const post = <T>(path: string, body: unknown = {}) => call<T>('POST', path, body);
const put = <T>(path: string, body: unknown) => call<T>('PUT', path, body);
const del = <T>(path: string) => call<T>('DELETE', path);

// ---------- sign-in, sign-out, passwords ----------
interface AuthReply { accessToken: string; user: User }

/** Gets a new access token with the refresh cookie. Null when not signed in. Several callers share one request. */
export function refresh(): Promise<Session | null> {
  refreshing ??= (async () => {
    try {
      const res = await send('POST', '/auth/refresh', {}, false);
      if (!res.ok) {
        accessToken = null;
        return null;
      }
      const r = (await res.json()) as AuthReply;
      accessToken = r.accessToken;
      return { token: r.accessToken, user: r.user };
    } catch {
      return null;
    } finally {
      setTimeout(() => { refreshing = null; }, 0);
    }
  })();
  return refreshing;
}

export const serverAuth = {
  async login(phone: string, password: string): Promise<Session> {
    const r = await read<AuthReply>(await send('POST', '/auth/login', { phone: phone.trim(), password }, false).catch(() => {
      throw new ApiError('Cannot reach the server. Check the internet connection and try again.');
    }));
    accessToken = r.accessToken;
    return { token: r.accessToken, user: r.user };
  },
  async logout() {
    await send('POST', '/auth/logout', {}, false).catch(() => undefined);
    accessToken = null;
  },
  async logoutAll() {
    await post('/auth/logout-all');
    accessToken = null;
  },
  async changePassword(currentPassword: string, newPassword: string): Promise<Session> {
    const r = await post<AuthReply>('/auth/change-password', { currentPassword, newPassword });
    accessToken = r.accessToken;
    return { token: r.accessToken, user: r.user };
  },
  forgotPassword: async (login: string) => read<{ message: string }>(await fetchNoAuth('/auth/forgot-password', { login })),
  resetPassword: async (token: string, newPassword: string) => read<{ message: string }>(await fetchNoAuth('/auth/reset-password', { token, newPassword })),
};

function fetchNoAuth(path: string, body: unknown): Promise<Response> {
  return send('POST', path, body, false).catch(() => {
    throw new ApiError('Cannot reach the server. Check the internet connection and try again.');
  });
}

// ---------- every page function ----------
const save = <T>(path: string, id: number | undefined, body: unknown) => (id ? put<T>(`${path}/${id}`, body) : post<T>(path, body));

export const serverApi: RawApi = {
  login: serverAuth.login,

  // set-up
  getLab: () => get('/setup/lab'),
  saveLab: (lab) => put('/setup/lab', { name: lab.name, address: lab.address, phone: lab.phone }),
  listAreas: () => get('/setup/areas'),
  saveArea: (a) => save('/setup/areas', a.areaId, { name: a.name, areaType: a.areaType, roomNo: a.roomNo }),
  deleteArea: async (id) => { await del(`/setup/areas/${id}`); },
  listBenches: (areaId) => get('/setup/benches', { areaId }),
  saveBench: (b) => save('/setup/benches', b.benchId, { areaId: b.areaId, code: b.code, capacityTrays: b.capacityTrays }),
  deleteBench: async (id) => { await del(`/setup/benches/${id}`); },
  listUsers: async () => (await get<{ users: User[] }>('/users')).users,
  saveUser: (u, password) => save('/users', u.userId, {
    fullName: u.fullName, role: u.role, phone: u.phone, email: (u as User & { email?: string | null }).email ?? null,
    homeAreaId: u.homeAreaId, zoneIds: u.zoneIds, status: u.status, ...(password ? { password } : {}),
  }),
  listCrops: () => get('/setup/crops'),
  saveCrop: (c) => save('/setup/crops', c.cropId, { name: c.name, variety: c.variety, defaultGrowth: c.defaultGrowth }),
  deleteCrop: async (id) => { await del(`/setup/crops/${id}`); },
  listStages: () => get('/setup/stages'),
  saveStage: (s) => save('/setup/stages', s.stageId, { code: s.code, phase: s.phase, seqNo: s.seqNo, minDays: s.minDays, maxDays: s.maxDays }),
  deleteStage: async (id) => { await del(`/setup/stages/${id}`); },
  listRecipes: () => get('/setup/recipes'),
  saveRecipe: (r) => save('/setup/recipes', r.recipeId, { code: r.code, phase: r.phase, shelfLifeDays: r.shelfLifeDays, notes: r.notes ?? '' }),
  deleteRecipe: async (id) => { await del(`/setup/recipes/${id}`); },
  listAlertRules: () => get('/setup/alert-rules'),
  saveAlertRule: (r) => put(`/setup/alert-rules/${r.ruleId}`, { warnValue: r.warnValue, criticalValue: r.criticalValue }),
  getAlerts: async () => (await get<Awaited<ReturnType<RawApi['listAlerts']>>>('/alerts')).filter((a) => !a.ackAt),

  // production
  listBatches: (_user, includeClosed = false) => get('/batches', { includeClosed: includeClosed ? 1 : undefined }),
  getBatch: (id) => get(`/batches/${id}`),
  createBatch: (input) => post('/batches', input),
  splitBatch: (id, trayIds) => post(`/batches/${id}/split`, { trayIds }),
  closeBatch: async (id) => { await post(`/batches/${id}/close`); },
  listTrays: () => get('/trays'),
  getTrayByQr: (qr) => get(`/trays/qr/${encodeURIComponent(qr.trim())}`),
  getTraysByIds: (ids) => get('/trays/by-ids', { ids: ids.join(',') }),
  subcultureTray: ({ trayId, ...rest }) => post(`/trays/${trayId}/subculture`, rest),
  moveTrays: async (trayIds, toBenchId) => { await post('/trays/move', { trayIds, toBenchId }); },
  benchLoad: () => get('/trays/bench-load'),
  recordLoss: async (input) => { await post('/losses', input); },
  listLosses: () => get('/losses'),
  handledByStage: () => get('/trays/handled-by-stage'),

  // daily work
  getAttendance: (date) => get('/daily/attendance', { date }),
  markAttendance: async (date, marks) => { await post('/daily/attendance', { date, marks }); },
  myAttendance: (_user, month) => get('/daily/my-attendance', { month }),
  assignOptions: (date) => get('/daily/assign-options', { date }),
  listAssignments: (date) => get('/daily/assignments', { date }),
  saveAssignment: ({ assignId, ...input }) => save('/daily/assignments', assignId, input),
  deleteAssignment: async (id) => { await del(`/daily/assignments/${id}`); },
  copyPreviousDay: async (date) => (await post<{ added: number }>('/daily/assignments/copy-previous', { date })).added,
  dailyBoard: (date, _user, areaId) => get('/daily/board', { date, areaId }),
  entryOptions: (date, operatorId) => get('/daily/entry-options', { date, operatorId }),
  bottlesAt: (batchId, stageId) => get('/daily/bottles-at', { batchId, stageId }),
  enterWork: (input) => post('/daily/entries', input),
  listEntries: (_user, f = {}) => get('/daily/entries', { status: f.status, from: f.from, to: f.to }),
  verifyEntries: async (entryIds) => { await post('/daily/entries/verify', { entryIds }); },
  rejectEntry: (id, reason) => post(`/daily/entries/${id}/reject`, { reason }),
  workOutput: (_user, f) => get('/daily/output', { from: f.from, to: f.to, operatorId: f.operatorId, areaId: f.areaId, kind: f.kind, batchId: f.batchId, stageId: f.stageId }),
  myOutput: (_user, days) => get('/daily/my-output', { days }),
  mySentBack: () => get('/daily/my-sent-back'),
  todayAttendance: async () => (await get<{ status: Awaited<ReturnType<RawApi['todayAttendance']>> }>('/daily/today-attendance')).status,

  // stock, media, costs, orders
  listItems: () => get('/stock/items'),
  saveItem: (i) => save('/stock/items', i.itemId, { name: i.name, category: i.category, unit: i.unit, stockQty: i.stockQty, reorderLevel: i.reorderLevel }),
  stockMove: async (itemId, type, qty, note) => { await post('/stock/moves', { itemId, type, qty, note }); },
  listTxns: (_user, days = 30) => get('/stock/txns', { days }),
  listMediaLots: (_user, days = 30) => get('/media/lots', { days }),
  usableLots: (phase) => get('/media/usable', { phase }),
  createMediaLot: (input) => post('/media/lots', input),
  getMonth: (month) => get('/costs/month', { month }),
  saveMonthCosts: async (month, amounts) => { await put('/costs/month', { month, amounts }); },
  monthHistory: (_user, count = 6) => get('/costs/history', { count }),
  batchCosts: () => get('/costs/batches'),
  listOrders: () => get('/orders'),
  checkOrder: (input, _user, excludeOrderId) => post('/orders/check', { ...input, excludeOrderId }),
  createOrder: (input) => post('/orders', input),
  recheckOrder: (id) => post(`/orders/${id}/recheck`),
  cancelOrder: async (id) => { await post(`/orders/${id}/cancel`); },
  hardenedStock: (cropId) => get('/orders/hardened-stock', { cropId }),
  recordDelivery: async (orderId, batchId, plants, sentOn) => { await post(`/orders/${orderId}/deliveries`, { batchId, plants, sentOn }); },
  getSettings: () => get('/setup/settings'),
  saveSettings: (s) => put('/setup/settings', s),

  // results
  listAlerts: () => get('/alerts'),
  acknowledgeAlerts: async (alertIds) => { await post('/alerts/acknowledge', { alertIds }); },
  dashboard: () => get('/dashboard'),
  forecast: () => get('/forecast'),
  room: (hours) => get('/room', { hours }),
  report: (month) => get('/reports/month', { month }),
  dayReport: (date) => get('/reports/day', { date }),
  listAudit: (_user, days = 30) => get('/audit', { days }),
  zoneSummaries: (_user, date) => get('/zones', { date }),
  zoneDetail: (areaId, _user, date) => get(`/zones/${areaId}`, { date }),
};
