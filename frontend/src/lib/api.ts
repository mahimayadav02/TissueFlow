// FAKE API. Every page gets and saves its data through these functions.
// When the backend is ready, only this file changes: each function will call
// fetch('/api/...') instead of the in-browser database. Pages do not change.
import { db, nextId, save } from './store';
import { ApiError, copy, need, same, wait, type New } from './apiUtil';
import { evaluateAlerts } from './alertEngine';
import { dailyApi } from './dailyApi';
import { resultsApi, writeAudit } from './resultsApi';
import { opsApi } from './opsApi';
import { productionApi } from './productionApi';

export { ApiError, type New };
import type { Alert, AlertRule, Area, Bench, Crop, Lab, MediaRecipe, Session, Stage, User } from './types';

const coreApi = {
  // ---------- login ----------
  async login(phone: string, password: string): Promise<Session> {
    await wait(350);
    const user = db.users.find((u) => u.phone === phone.trim() && u.status === 'ACTIVE');
    if (!user || db.passwords[user.userId] !== password) throw new ApiError('Wrong phone number or password.');
    return { token: `demo-token-${user.userId}`, user: copy(user) };
  },

  // ---------- lab ----------
  async getLab(): Promise<Lab> {
    await wait();
    return copy(db.lab);
  },
  async saveLab(lab: Lab): Promise<Lab> {
    await wait();
    need(lab.name.trim(), 'Lab name is required.');
    db.lab = { ...lab, name: lab.name.trim() };
    save();
    return copy(db.lab);
  },

  // ---------- zones (areas) ----------
  async listAreas(): Promise<Area[]> {
    await wait();
    return copy(db.areas);
  },
  async saveArea(a: New<Area, 'areaId'>): Promise<Area> {
    await wait();
    need(a.name.trim(), 'Zone name is required.');
    need(!db.areas.some((x) => same(x.name, a.name) && x.areaId !== a.areaId), 'A zone with this name already exists.');
    const row: Area = { ...a, name: a.name.trim(), roomNo: a.roomNo.trim(), areaId: a.areaId ?? nextId(db.areas, 'areaId') };
    const i = db.areas.findIndex((x) => x.areaId === row.areaId);
    if (i >= 0) db.areas[i] = row; else db.areas.push(row);
    save();
    return copy(row);
  },
  async deleteArea(areaId: number): Promise<void> {
    await wait();
    need(!db.benches.some((b) => b.areaId === areaId), 'Remove the benches in this zone first.');
    need(!db.users.some((u) => u.status === 'ACTIVE' && (u.homeAreaId === areaId || u.zoneIds.includes(areaId))), 'Some active users work in this zone. Move them first.');
    db.areas = db.areas.filter((x) => x.areaId !== areaId);
    save();
  },

  // ---------- benches ----------
  async listBenches(areaId?: number): Promise<Bench[]> {
    await wait();
    return copy(areaId ? db.benches.filter((b) => b.areaId === areaId) : db.benches);
  },
  async saveBench(b: New<Bench, 'benchId'>): Promise<Bench> {
    await wait();
    need(b.code.trim(), 'Bench code is required.');
    need(b.capacityTrays > 0, 'Capacity must be more than 0 trays.');
    need(!db.benches.some((x) => x.areaId === b.areaId && same(x.code, b.code) && x.benchId !== b.benchId), 'This zone already has a bench with this code.');
    const row: Bench = { ...b, code: b.code.trim().toUpperCase(), benchId: b.benchId ?? nextId(db.benches, 'benchId') };
    const i = db.benches.findIndex((x) => x.benchId === row.benchId);
    if (i >= 0) db.benches[i] = row; else db.benches.push(row);
    save();
    return copy(row);
  },
  async deleteBench(benchId: number): Promise<void> {
    await wait();
    db.benches = db.benches.filter((x) => x.benchId !== benchId);
    save();
  },

  // ---------- users ----------
  async listUsers(): Promise<User[]> {
    await wait();
    return copy(db.users);
  },
  /** Creates or updates a user. A password is needed only for a new user. */
  async saveUser(u: New<User, 'userId'>, password?: string): Promise<User> {
    await wait();
    need(u.fullName.trim(), 'Name is required.');
    need(/^\d{10}$/.test(u.phone), 'Phone must be 10 digits.');
    need(!db.users.some((x) => x.phone === u.phone && x.userId !== u.userId), 'This phone number is already used by another user.');
    if (u.role === 'SUPERVISOR') need(u.zoneIds.length > 0, 'Choose at least one zone for the supervisor.');
    if (u.role === 'OPERATOR') need(u.homeAreaId, 'Choose the zone where the operator works.');
    const isNew = u.userId === undefined;
    if (isNew) need(password && password.length >= 4, 'Password must be at least 4 characters.');
    const row: User = {
      ...u,
      fullName: u.fullName.trim(),
      zoneIds: u.role === 'SUPERVISOR' ? u.zoneIds : [],
      homeAreaId: u.role === 'MANAGER' ? null : u.homeAreaId,
      userId: u.userId ?? nextId(db.users, 'userId'),
    };
    const i = db.users.findIndex((x) => x.userId === row.userId);
    if (i >= 0) db.users[i] = row; else db.users.push(row);
    if (password) db.passwords[row.userId] = password;
    save();
    return copy(row);
  },

  // ---------- masters ----------
  async listCrops(): Promise<Crop[]> {
    await wait();
    return copy(db.crops);
  },
  async saveCrop(c: New<Crop, 'cropId'>): Promise<Crop> {
    await wait();
    need(c.name.trim() && c.variety.trim(), 'Crop name and variety are required.');
    need(c.defaultGrowth >= 1 && c.defaultGrowth <= 6, 'Growth per round should be between 1 and 6.');
    need(!db.crops.some((x) => same(x.name, c.name) && same(x.variety, c.variety) && x.cropId !== c.cropId), 'This crop and variety already exist.');
    const row: Crop = { ...c, name: c.name.trim(), variety: c.variety.trim(), cropId: c.cropId ?? nextId(db.crops, 'cropId') };
    const i = db.crops.findIndex((x) => x.cropId === row.cropId);
    if (i >= 0) db.crops[i] = row; else db.crops.push(row);
    save();
    return copy(row);
  },
  async deleteCrop(cropId: number): Promise<void> {
    await wait();
    db.crops = db.crops.filter((x) => x.cropId !== cropId);
    save();
  },

  async listStages(): Promise<Stage[]> {
    await wait();
    return copy([...db.stages].sort((a, b) => a.seqNo - b.seqNo));
  },
  async saveStage(s: New<Stage, 'stageId'>): Promise<Stage> {
    await wait();
    need(/^[A-Z0-9]{1,4}$/.test(s.code.trim().toUpperCase()), 'Stage code: up to 4 letters or digits, e.g. M9.');
    need(s.minDays > 0 && s.maxDays >= s.minDays, 'Days: minimum must be above 0 and maximum not less than minimum.');
    need(!db.stages.some((x) => same(x.code, s.code) && x.stageId !== s.stageId), 'This stage code already exists.');
    const row: Stage = { ...s, code: s.code.trim().toUpperCase(), stageId: s.stageId ?? nextId(db.stages, 'stageId') };
    const i = db.stages.findIndex((x) => x.stageId === row.stageId);
    if (i >= 0) db.stages[i] = row; else db.stages.push(row);
    save();
    return copy(row);
  },
  async deleteStage(stageId: number): Promise<void> {
    await wait();
    db.stages = db.stages.filter((x) => x.stageId !== stageId);
    save();
  },

  async listRecipes(): Promise<MediaRecipe[]> {
    await wait();
    return copy(db.recipes);
  },
  async saveRecipe(r: New<MediaRecipe, 'recipeId'>): Promise<MediaRecipe> {
    await wait();
    need(/^[A-Z0-9]{2,6}$/.test(r.code.trim().toUpperCase()), 'Recipe code: 2–6 letters or digits, e.g. MU1.');
    need(r.shelfLifeDays > 0, 'Shelf life must be at least 1 day.');
    need(!db.recipes.some((x) => same(x.code, r.code) && x.recipeId !== r.recipeId), 'This recipe code already exists.');
    const row: MediaRecipe = { ...r, code: r.code.trim().toUpperCase(), recipeId: r.recipeId ?? nextId(db.recipes, 'recipeId') };
    const i = db.recipes.findIndex((x) => x.recipeId === row.recipeId);
    if (i >= 0) db.recipes[i] = row; else db.recipes.push(row);
    save();
    return copy(row);
  },
  async deleteRecipe(recipeId: number): Promise<void> {
    await wait();
    db.recipes = db.recipes.filter((x) => x.recipeId !== recipeId);
    save();
  },

  async listAlertRules(): Promise<AlertRule[]> {
    await wait();
    return copy(db.alertRules);
  },
  async saveAlertRule(r: AlertRule): Promise<AlertRule> {
    await wait();
    if (r.criticalValue !== null) {
      need(r.direction === 'ABOVE' ? r.criticalValue >= r.warnValue : r.criticalValue <= r.warnValue,
        r.direction === 'ABOVE' ? 'Critical limit must be the same as or above the warning limit.' : 'Critical limit must be the same as or below the warning limit.');
    }
    const i = db.alertRules.findIndex((x) => x.ruleId === r.ruleId);
    need(i >= 0, 'Rule not found.');
    db.alertRules[i] = { ...r };
    save();
    return copy(r);
  },

  // ---------- alerts ----------
  /** Open (not yet acknowledged) alerts the user may see. Runs the alert checks first. */
  async getAlerts(user: User): Promise<Alert[]> {
    await wait();
    evaluateAlerts();
    const open = db.alerts.filter((a) => !a.ackAt);
    if (user.role === 'MANAGER') return copy(open).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const allowed = user.role === 'SUPERVISOR' ? user.zoneIds : user.homeAreaId ? [user.homeAreaId] : [];
    return copy(open.filter((a) => a.areaId !== null && allowed.includes(a.areaId) && (user.role !== 'OPERATOR' || !a.userId || a.userId === user.userId)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
};

const rawApi = { ...coreApi, ...productionApi, ...dailyApi, ...opsApi, ...resultsApi };

// ---------- audit log ----------
// Every function that changes data is wrapped: after it succeeds, one line goes into the audit log
// (who, what, and the main values). With the backend, the server writes the audit log instead.
const CHANGES = /^(save|create|delete|mark|verify|reject|record|stockMove|subculture|move|split|close|cancel|recheck|copy|acknowledge)/;
const LABEL: Record<string, string> = {
  saveLab: 'Changed lab details', saveArea: 'Saved zone', deleteArea: 'Deleted zone', saveBench: 'Saved bench', deleteBench: 'Deleted bench',
  saveUser: 'Saved user', saveCrop: 'Saved crop', deleteCrop: 'Deleted crop', saveStage: 'Saved stage', deleteStage: 'Deleted stage',
  saveRecipe: 'Saved media recipe', deleteRecipe: 'Deleted media recipe', saveAlertRule: 'Changed alert limit',
  createBatch: 'Started batch', splitBatch: 'Split batch', closeBatch: 'Closed batch', subcultureTray: 'Sub-cultured tray', moveTrays: 'Moved trays',
  recordLoss: 'Recorded loss', markAttendance: 'Marked attendance', saveAssignment: 'Gave work', deleteAssignment: 'Removed work',
  copyPreviousDay: 'Copied previous day’s work', verifyEntries: 'Verified entries', rejectEntry: 'Sent entry back',
  saveItem: 'Saved stock item', stockMove: 'Changed stock', createMediaLot: 'Made media lot', saveMonthCosts: 'Saved monthly costs',
  createOrder: 'Created order', recheckOrder: 'Checked order again', cancelOrder: 'Cancelled order', recordDelivery: 'Recorded plants sent',
  saveSettings: 'Changed forecast assumptions', acknowledgeAlerts: 'Acknowledged alerts',
};
const isUser = (x: unknown): x is User => !!x && typeof x === 'object' && 'userId' in x && 'role' in x && 'phone' in x;
const sessionUserId = (): number | null => {
  try {
    const raw = localStorage.getItem('tissueflow.session');
    return raw ? (JSON.parse(raw) as { user: User }).user.userId : null;
  } catch {
    return null;
  }
};
/** Short readable summary of the values passed, e.g. "trayId 12, bottlesOut 60". */
function describe(args: unknown[]): string {
  const part = (a: unknown): string => {
    if (a === null || a === undefined) return '';
    if (Array.isArray(a)) return a.every((x) => typeof x !== 'object') ? `[${a.slice(0, 8).join(', ')}${a.length > 8 ? ', …' : ''}]` : `${a.length} lines`;
    if (typeof a === 'object') {
      return Object.entries(a as Record<string, unknown>)
        .filter(([k, v]) => v !== null && v !== undefined && v !== '' && typeof v !== 'object' && !/password/i.test(k))
        .slice(0, 6).map(([k, v]) => `${k} ${v}`).join(', ');
    }
    return String(a);
  };
  return args.filter((a) => !isUser(a)).map(part).filter(Boolean).join(' · ').slice(0, 200);
}

function withAudit<T extends Record<string, unknown>>(raw: T): T {
  const out: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(raw)) {
    if (typeof fn !== 'function') { out[name] = fn; continue; }
    if (name === 'login') {
      out[name] = async (...args: unknown[]) => {
        const s = (await (fn as (...a: unknown[]) => Promise<{ user: User }>)(...args));
        writeAudit(s.user.userId, 'Logged in', '');
        return s;
      };
    } else if (CHANGES.test(name)) {
      out[name] = async (...args: unknown[]) => {
        const result = await (fn as (...a: unknown[]) => Promise<unknown>)(...args);
        const who = args.find(isUser);
        writeAudit(who ? who.userId : sessionUserId(), LABEL[name] ?? name, describe(args));
        return result;
      };
    } else out[name] = fn;
  }
  return out as T;
}

export const api = withAudit(rawApi);
