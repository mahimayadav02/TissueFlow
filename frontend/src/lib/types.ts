// Shared data types. These follow the database tables in the system design.

export type Role = 'MANAGER' | 'SUPERVISOR' | 'OPERATOR';
export type Scope = 'ALL' | 'ZONE' | 'OWN';

export const SCOPE_OF: Record<Role, Scope> = {
  MANAGER: 'ALL',
  SUPERVISOR: 'ZONE',
  OPERATOR: 'OWN',
};

export const ROLE_LABEL: Record<Role, string> = {
  MANAGER: 'Manager',
  SUPERVISOR: 'Supervisor',
  OPERATOR: 'Operator',
};

export interface Lab {
  labId: number;
  name: string;
  address: string;
  phone: string;
}

export type AreaType = 'WASH' | 'MEDIA' | 'INOCULATION' | 'INCUBATION' | 'HARDENING' | 'STORE';

export const AREA_TYPE_LABEL: Record<AreaType, string> = {
  WASH: 'Washing',
  MEDIA: 'Media preparation',
  INOCULATION: 'Inoculation',
  INCUBATION: 'Incubation (growth room)',
  HARDENING: 'Hardening',
  STORE: 'Store',
};

export interface Area {
  areaId: number;
  labId: number;
  name: string;
  areaType: AreaType;
  roomNo: string;
}

export interface Bench {
  benchId: number;
  areaId: number;
  code: string;
  capacityTrays: number;
}

export interface User {
  userId: number;
  fullName: string;
  role: Role;
  phone: string;
  homeAreaId: number | null;
  /** Zones a supervisor looks after (user_area). Empty for manager and operator. */
  zoneIds: number[];
  status: 'ACTIVE' | 'LEFT';
}

export interface Crop {
  cropId: number;
  name: string;
  variety: string;
  /** Lab average growth per multiplication round, used until a batch has its own history. */
  defaultGrowth: number;
}

export type Phase = 'INITIATION' | 'MULTIPLICATION' | 'ROOTING' | 'HARDENING';

export const PHASE_LABEL: Record<Phase, string> = {
  INITIATION: 'Initiation',
  MULTIPLICATION: 'Multiplication',
  ROOTING: 'Rooting',
  HARDENING: 'Hardening',
};

export interface Stage {
  stageId: number;
  code: string;
  phase: Phase;
  seqNo: number;
  minDays: number;
  maxDays: number;
}

export interface MediaRecipe {
  recipeId: number;
  code: string;
  phase: Phase;
  shelfLifeDays: number;
  notes: string;
}

export interface AlertRule {
  ruleId: number;
  code: string;
  label: string;
  unit: string;
  /** ABOVE: alert when the value goes above the limit. BELOW: when it falls below. */
  direction: 'ABOVE' | 'BELOW';
  warnValue: number;
  criticalValue: number | null;
  notifyRole: Role;
}

export type Severity = 'WARNING' | 'CRITICAL';

export interface Alert {
  alertId: number;
  code: string;
  areaId: number | null;
  severity: Severity;
  message: string;
  createdAt: string; // ISO date-time
  ackAt: string | null;
  /** Who acknowledged it. */
  ackBy?: number | null;
  /** Same key = same problem, so an open alert is not raised twice. */
  key?: string;
  /** Operator the alert is about (e.g. below target); other operators do not see it. */
  userId?: number | null;
}

/** What the login returns: the user plus a token (fake for now). */
export interface Session {
  token: string;
  user: User;
}

// ---------------- production (Phase 3) ----------------

export type BatchStatus = 'RUNNING' | 'CLOSED';

export interface Batch {
  batchId: number;
  /** B + month number + year, e.g. B1-26 for January 2026. A split part adds a letter: B1-26A. */
  batchCode: string;
  cropId: number;
  parentBatchId: number | null;
  startDate: string; // YYYY-MM-DD
  status: BatchStatus;
}

export interface Sample {
  sampleId: number;
  batchId: number;
  sampleType: string;
  noOfSamples: number;
  sampleSize: number;
  sourceFarm: string;
  collectedAt: string; // ISO date-time
}

/** ACTIVE in the lab · MOVED sub-cultured into new trays · LOST all bottles lost · SENT all plants sent to customers. */
export type TrayStatus = 'ACTIVE' | 'MOVED' | 'LOST' | 'SENT';

export interface Tray {
  trayId: number;
  /** Printed as a QR label on the tray. */
  qrCode: string;
  batchId: number;
  stageId: number;
  benchId: number;
  mediaLotId: number | null;
  bottleCount: number;
  /** Bottles when the tray was made. */
  startBottles?: number;
  placedOn: string; // YYYY-MM-DD, date the tray entered this stage
  status: TrayStatus;
}

export interface TrayMovement {
  movementId: number;
  batchId: number;
  /** The tray that was sub-cultured or moved. */
  trayId: number;
  /** New trays it produced (sub-culture) or the same tray (bench move). */
  newTrayIds: number[];
  fromStageId: number;
  toStageId: number;
  fromBenchId: number;
  toBenchId: number;
  bottlesIn: number;
  bottlesOut: number;
  bottlesLost: number;
  movedBy: number;
  movedAt: string; // ISO date-time
}

export type LossCause = 'LAB' | 'OPERATOR' | 'SEASON' | 'MEDIA';
export type LossType = 'FUNGAL' | 'BACTERIAL' | 'OTHER';

export const CAUSE_LABEL: Record<LossCause, string> = {
  LAB: 'Lab (room, equipment)',
  OPERATOR: 'Operator handling',
  SEASON: 'Season / source plant',
  MEDIA: 'Media lot',
};

export const LOSS_TYPE_LABEL: Record<LossType, string> = {
  FUNGAL: 'Fungal',
  BACTERIAL: 'Bacterial',
  OTHER: 'Other (browning, hyperhydricity …)',
};

export interface Contamination {
  contId: number;
  trayId: number;
  bottlesLost: number;
  cause: LossCause;
  contType: LossType;
  foundOn: string; // YYYY-MM-DD
  reportedBy: number;
  note: string;
}

// ---------------- daily work (Phase 4) ----------------

/** P = present, HD = half day, A = absent. */
export type AttStatus = 'P' | 'HD' | 'A';

export const ATT_LABEL: Record<AttStatus, string> = { P: 'Present', HD: 'Half day', A: 'Absent' };

export interface Attendance {
  attId: number;
  userId: number;
  workDate: string; // YYYY-MM-DD
  status: AttStatus;
  markedBy: number;
}

/** Work a supervisor gives an operator for one day: which batch and stage, at which bench, how many bottles. */
export interface WorkAssignment {
  assignId: number;
  workDate: string;
  operatorId: number;
  batchId: number;
  stageId: number;
  /** Laminar-flow bench (hood) where the operator works. */
  benchId: number | null;
  targetBottles: number;
  assignedBy: number;
}

export type EntryStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

/** One tray an operator sub-cultured. Created automatically when the operator saves a sub-culture. */
export interface ProductionEntry {
  entryId: number;
  assignId: number | null;
  operatorId: number;
  trayId: number;
  /** The stage move this entry came from, so a rejected entry can be undone. */
  movementId: number | null;
  contId: number | null;
  workDate: string;
  bottlesHandled: number;
  bottlesProduced: number;
  bottlesLost: number;
  status: EntryStatus;
  enteredAt: string;
  verifiedBy: number | null;
  verifiedAt: string | null;
  note: string;
}

// ---------------- stock, media, orders, costs (Phase 5) ----------------

export type ItemCategory = 'CHEMICAL' | 'CONSUMABLE' | 'HARDENING' | 'OTHER';

export const CATEGORY_LABEL: Record<ItemCategory, string> = {
  CHEMICAL: 'Chemicals',
  CONSUMABLE: 'Bottles and consumables',
  HARDENING: 'Hardening material',
  OTHER: 'Other',
};

/** Something the lab keeps in stock. Quantities only; prices come in as monthly cost totals. */
export interface Item {
  itemId: number;
  name: string;
  category: ItemCategory;
  unit: string;
  stockQty: number;
  reorderLevel: number;
}

/** IN received · OUT used · ADJ correction after a stock count (qty can be negative). */
export type TxnType = 'IN' | 'OUT' | 'ADJ';

export interface StockTxn {
  txnId: number;
  itemId: number;
  txnType: TxnType;
  qty: number;
  /** Set when the chemical went into a media lot. */
  mediaLotId: number | null;
  txnDate: string;
  doneBy: number;
  note: string;
}

/** One batch of culture medium made from a recipe and poured into bottles. */
export interface MediaLot {
  mediaLotId: number;
  lotCode: string;
  recipeId: number;
  preparedOn: string;
  volumeLitre: number;
  bottlesFilled: number;
  expiresOn: string;
  preparedBy: number;
}

export type CostHeading = 'LABOUR' | 'CHEMICALS' | 'CONSUMABLES' | 'POWER' | 'HARDENING' | 'OTHER';

export const HEADING_LABEL: Record<CostHeading, string> = {
  LABOUR: 'Labour',
  CHEMICALS: 'Chemicals',
  CONSUMABLES: 'Consumables',
  POWER: 'Power',
  HARDENING: 'Hardening',
  OTHER: 'Other',
};

/** A monthly total the manager enters for one cost heading. */
export interface CostEntry {
  costId: number;
  month: string; // YYYY-MM
  heading: CostHeading;
  amount: number;
  enteredBy: number;
}

export type Decision = 'YES' | 'PARTLY' | 'NO';
export type OrderStatus = 'OPEN' | 'DELIVERED' | 'CANCELLED';

export interface SalesOrder {
  orderId: number;
  orderCode: string;
  customerName: string;
  phone: string;
  cropId: number;
  plantsOrdered: number;
  ratePerPlant: number;
  requiredBy: string;
  decision: Decision;
  /** Plants the lab said it can give by the date (all for YES, part for PARTLY, 0 for NO). */
  plantsPromised: number;
  status: OrderStatus;
  createdAt: string;
  createdBy: number;
}

export interface Delivery {
  deliveryId: number;
  orderId: number;
  /** Batch whose hardened plants were sent. */
  batchId: number;
  plantsSent: number;
  sentOn: string;
  enteredBy: number;
}

/** Lab-wide assumptions used by the forecast. The manager can change them. */
export interface Settings {
  /** Share of bottles that survive rooting, 0–1. */
  rootingSurvival: number;
  /** Share of plants that survive hardening, 0–1. */
  hardeningSurvival: number;
  /** Last multiplication stage the lab normally goes to before rooting. */
  lastMultiplicationStage: string;
  /** Sale rate per plant used in the forecast when a crop has no orders yet (₹). */
  defaultRate?: number;
}

// ---------------- results (Phase 6) ----------------

/** The IoT node: ESP32 with a DHT22 (temperature, humidity) and optional BH1750 (light). One node in the growth room. */
export interface SensorDevice {
  deviceId: number;
  name: string;
  areaId: number;
  /** Minutes between readings. */
  intervalMin: number;
}

export interface SensorReading {
  recordedAt: string; // ISO date-time
  tempC: number;
  humidityPct: number;
  lightLux: number;
}

export interface AuditEntry {
  auditId: number;
  at: string;
  userId: number | null;
  action: string;
  detail: string;
}
