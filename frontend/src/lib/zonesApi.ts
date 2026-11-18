// FAKE API: zones. One summary per zone (for the "All zones" page) and everything about one zone (for its own page).
// Manager sees every zone; a supervisor sees only the zones they look after.
import { evaluateAlerts } from './alertEngine';
import { addDays, copy, daysBetween, need, today, wait } from './apiUtil';
import { dailyApi, type BoardRow, type Level } from './dailyApi';
import { latestReading, readings } from './iot';
import { overdueLevel, visibleAreas, type Overdue } from './productionApi';
import { db } from './store';
import type { Alert, AreaType, LossCause, SensorReading, Severity, User } from './types';
import { assignArea, entryArea, liveEntry, targetOf, washPool, workZones } from './work';

const stageCode = (id: number) => db.stages.find((s) => s.stageId === id)?.code ?? '—';
const batchCode = (id: number) => db.batches.find((b) => b.batchId === id)?.batchCode ?? '—';

/** What each kind of zone is for, shown on its page. */
export const ZONE_PURPOSE: Record<AreaType, string> = {
  WASH: 'Bottles and glassware are washed and dried here before media is poured.',
  MEDIA: 'Culture media is prepared, poured into bottles and sterilised here.',
  INOCULATION: 'Operators sub-culture bottles under the laminar flow hoods here.',
  INCUBATION: 'Trays of cultures grow on racks here under controlled light and temperature.',
  QC: 'Media bottles and culture bottles are checked here before they are used or moved on.',
  HARDENING: 'Rooted plants are moved to cocopeat and polybags and slowly get used to outside conditions.',
  STORE: 'Chemicals, bottles and other material are kept here.',
};

function myZones(user: User) {
  need(user.role !== 'OPERATOR', 'Only a supervisor or manager can see zones.');
  const allowed = visibleAreas(user);
  return db.areas.filter((a) => allowed === null || allowed.includes(a.areaId));
}

function roomStatus(r: SensorReading): Severity | null {
  const rule = (c: string) => db.alertRules.find((x) => x.code === c);
  const hi = rule('ROOM_TEMP_HIGH');
  const lo = rule('ROOM_TEMP_LOW');
  const hum = rule('HUMIDITY_HIGH');
  const levels: (Severity | null)[] = [
    hi ? (hi.criticalValue !== null && r.tempC > hi.criticalValue ? 'CRITICAL' : r.tempC > hi.warnValue ? 'WARNING' : null) : null,
    lo ? (lo.criticalValue !== null && r.tempC < lo.criticalValue ? 'CRITICAL' : r.tempC < lo.warnValue ? 'WARNING' : null) : null,
    hum ? (hum.criticalValue !== null && r.humidityPct > hum.criticalValue ? 'CRITICAL' : r.humidityPct > hum.warnValue ? 'WARNING' : null) : null,
  ];
  return levels.includes('CRITICAL') ? 'CRITICAL' : levels.includes('WARNING') ? 'WARNING' : null;
}

// ---------- shapes returned to pages ----------
export interface ZoneSummary {
  areaId: number;
  name: string;
  areaType: AreaType;
  roomNo: string;
  supervisors: string[];
  operators: number;
  present: number;
  marked: number;
  target: number;
  handled: number;
  pct: number | null;
  trays: number;
  bottles: number;
  overdueTrays: number;
  benches: number;
  capacity: number;
  lost30: number;
  openAlerts: number;
  criticalAlerts: number;
  room: { tempC: number; humidityPct: number; status: Severity | null } | null;
  /** Media zone only: usable media lots and bottles of media ready. */
  media: { lots: number; bottles: number; lowStock: number } | null;
  /** Washing zone only: bottles waiting to be washed (emptied at sub-culture) and contaminated bottles waiting. */
  wash: { plain: number; contaminated: number } | null;
}

export interface ZoneDetail extends ZoneSummary {
  purpose: string;
  board: BoardRow[];
  byStage: { batchId: number; batchCode: string; stage: string; trays: number; bottles: number; oldestDays: number; overdue: Overdue }[];
  benchLoad: { benchId: number; code: string; trays: number; capacity: number }[];
  lossByCause: { cause: LossCause; bottles: number }[];
  daily: { date: string; handled: number; target: number }[];
  alerts: (Alert & { label: string })[];
  roomSeries: SensorReading[];
  mediaLots: { lotCode: string; recipe: string; bottlesLeft: number; expiresOn: string }[];
  lowStock: { name: string; stockQty: number; unit: string; reorderLevel: number }[];
  level: Level;
}

function summary(areaId: number, date: string): ZoneSummary {
  const area = db.areas.find((a) => a.areaId === areaId)!;
  // Operators who work here (as home zone or second zone); target and work count where the work was done.
  const ops = db.users.filter((u) => u.role === 'OPERATOR' && u.status === 'ACTIVE' && workZones(u).includes(areaId));
  const opIds = new Set(ops.map((o) => o.userId));
  const att = db.attendance.filter((a) => a.workDate === date && opIds.has(a.userId));
  const target = db.assignments.filter((a) => a.workDate === date && assignArea(a) === areaId).reduce((n, a) => n + targetOf(a), 0);
  const handled = db.entries.filter((e) => e.workDate === date && entryArea(e) === areaId && liveEntry(e)).reduce((n, e) => n + e.bottlesHandled, 0);
  const benches = db.benches.filter((b) => b.areaId === areaId);
  const benchIds = new Set(benches.map((b) => b.benchId));
  const trays = db.trays.filter((t) => t.status === 'ACTIVE' && benchIds.has(t.benchId));
  const from30 = addDays(today(), -30);
  const trayIdsHere = new Set(db.trays.filter((t) => benchIds.has(t.benchId)).map((t) => t.trayId));
  const open = db.alerts.filter((a) => a.areaId === areaId && !a.ackAt);
  const dev = db.devices.find((d) => d.areaId === areaId);
  const r = dev ? latestReading(dev.intervalMin) : null;
  let media: ZoneSummary['media'] = null;
  if (area.areaType === 'MEDIA') {
    const usable = db.mediaLots.filter((l) => today() <= l.expiresOn).map((l) => {
      const used = db.trays.filter((t) => t.mediaLotId === l.mediaLotId).reduce((n, t) => n + (t.startBottles ?? t.bottleCount), 0);
      return Math.max(0, l.bottlesFilled - used);
    }).filter((left) => left > 0);
    media = { lots: usable.length, bottles: usable.reduce((n, x) => n + x, 0), lowStock: db.items.filter((i) => i.stockQty <= i.reorderLevel).length };
  }
  return {
    areaId, name: area.name, areaType: area.areaType, roomNo: area.roomNo,
    supervisors: db.users.filter((u) => u.role === 'SUPERVISOR' && u.status === 'ACTIVE' && u.zoneIds.includes(areaId)).map((u) => u.fullName),
    operators: ops.length,
    present: att.filter((a) => a.status !== 'A').length,
    marked: att.length,
    target, handled, pct: target ? Math.round((100 * handled) / target) : null,
    trays: trays.length,
    bottles: trays.reduce((n, t) => n + t.bottleCount, 0),
    overdueTrays: trays.filter((t) => overdueLevel(daysBetween(t.placedOn)) !== 'OK' && db.stages.find((s) => s.stageId === t.stageId)?.phase !== 'HARDENING').length,
    benches: benches.length,
    capacity: benches.reduce((n, b) => n + b.capacityTrays, 0),
    lost30: db.contaminations.filter((c) => c.foundOn >= from30 && trayIdsHere.has(c.trayId)).reduce((n, c) => n + c.bottlesLost, 0),
    openAlerts: open.length,
    criticalAlerts: open.filter((a) => a.severity === 'CRITICAL').length,
    room: r ? { tempC: r.tempC, humidityPct: r.humidityPct, status: roomStatus(r) } : null,
    media,
    wash: area.areaType === 'WASH' ? washPool() : null,
  };
}

export const zonesApi = {
  /** One summary per zone the user looks after, for the "All zones" page. */
  async zoneSummaries(user: User, date = today()): Promise<ZoneSummary[]> {
    await wait();
    evaluateAlerts();
    return myZones(user).map((a) => summary(a.areaId, date));
  },

  /** Everything about one zone, for its own page. */
  async zoneDetail(areaId: number, user: User, date = today()): Promise<ZoneDetail> {
    await wait();
    evaluateAlerts();
    const area = myZones(user).find((a) => a.areaId === areaId);
    need(area, 'Zone not found, or not one of your zones.');
    const s = summary(areaId, date);
    const benches = db.benches.filter((b) => b.areaId === areaId);
    const benchIds = new Set(benches.map((b) => b.benchId));
    const active = db.trays.filter((t) => t.status === 'ACTIVE' && benchIds.has(t.benchId));

    const groups = new Map<string, ZoneDetail['byStage'][number]>();
    const hardening = new Set(db.stages.filter((x) => x.phase === 'HARDENING').map((x) => x.stageId));
    for (const t of active) {
      const k = `${t.batchId}:${t.stageId}`;
      const days = daysBetween(t.placedOn);
      const g = groups.get(k) ?? { batchId: t.batchId, batchCode: batchCode(t.batchId), stage: stageCode(t.stageId), trays: 0, bottles: 0, oldestDays: 0, overdue: 'OK' as Overdue };
      g.trays++;
      g.bottles += t.bottleCount;
      g.oldestDays = Math.max(g.oldestDays, days);
      if (!hardening.has(t.stageId)) g.overdue = overdueLevel(g.oldestDays);
      groups.set(k, g);
    }
    const seq = (code: string) => db.stages.find((x) => x.code === code)?.seqNo ?? 0;

    const from30 = addDays(today(), -30);
    const trayIdsHere = new Set(db.trays.filter((t) => benchIds.has(t.benchId)).map((t) => t.trayId));
    const causes = new Map<LossCause, number>();
    for (const c of db.contaminations) if (c.foundOn >= from30 && trayIdsHere.has(c.trayId)) causes.set(c.cause, (causes.get(c.cause) ?? 0) + c.bottlesLost);

    const ops = new Set(db.users.filter((u) => u.role === 'OPERATOR' && workZones(u).includes(areaId)).map((u) => u.userId));
    const daily: ZoneDetail['daily'] = [];
    for (let i = 13; i >= 0; i--) {
      const d = addDays(date, -i);
      const target = db.assignments.filter((a) => a.workDate === d && assignArea(a) === areaId).reduce((n, a) => n + targetOf(a), 0);
      const handled = db.entries.filter((e) => e.workDate === d && entryArea(e) === areaId && liveEntry(e)).reduce((n, e) => n + e.bottlesHandled, 0);
      if (target || handled) daily.push({ date: d, handled, target });
    }

    const labels = Object.fromEntries(db.alertRules.map((r) => [r.code, r.label]));
    const dev = db.devices.find((d) => d.areaId === areaId);
    const now = Date.now();
    const board = (await dailyApi.dailyBoard(date, user, areaId)).filter((r) => ops.has(r.operatorId));
    const pct = s.pct;
    const lowOut = db.alertRules.find((r) => r.code === 'LOW_OUTPUT');
    const level: Level = pct === null || date >= today() ? 'NONE' : lowOut && lowOut.criticalValue !== null && pct < lowOut.criticalValue ? 'CRITICAL' : lowOut && pct < lowOut.warnValue ? 'WARNING' : 'OK';

    return {
      ...s,
      purpose: ZONE_PURPOSE[area!.areaType] ?? '',
      board,
      byStage: [...groups.values()].sort((a, b) => a.batchCode.localeCompare(b.batchCode) || seq(a.stage) - seq(b.stage)),
      benchLoad: benches.map((b) => ({ benchId: b.benchId, code: b.code, trays: active.filter((t) => t.benchId === b.benchId).length, capacity: b.capacityTrays })),
      lossByCause: [...causes.entries()].map(([cause, bottles]) => ({ cause, bottles })).sort((a, b) => b.bottles - a.bottles),
      daily,
      alerts: db.alerts.filter((a) => a.areaId === areaId && !a.ackAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((a) => ({ ...copy(a), label: labels[a.code] ?? a.code })),
      roomSeries: dev ? readings(now - 24 * 3_600_000, now, dev.intervalMin) : [],
      mediaLots: area!.areaType === 'MEDIA'
        ? db.mediaLots.filter((l) => today() <= l.expiresOn).map((l) => {
          const used = db.trays.filter((t) => t.mediaLotId === l.mediaLotId).reduce((n, t) => n + (t.startBottles ?? t.bottleCount), 0);
          return { lotCode: l.lotCode, recipe: db.recipes.find((r) => r.recipeId === l.recipeId)?.code ?? '—', bottlesLeft: Math.max(0, l.bottlesFilled - used), expiresOn: l.expiresOn };
        }).filter((l) => l.bottlesLeft > 0)
        : [],
      lowStock: area!.areaType === 'MEDIA' ? db.items.filter((i) => i.stockQty <= i.reorderLevel).map((i) => ({ name: i.name, stockQty: i.stockQty, unit: i.unit, reorderLevel: i.reorderLevel })) : [],
      level,
    };
  },
};

