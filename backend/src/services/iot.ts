// Room readings from the sensor node in the growth room.
// Real readings come from the ESP32 + DHT22 node (POST /api/v1/iot/readings). Until a device has sent any,
// its readings are SIMULATED exactly as on the website (frontend/src/lib/iot.ts): a daily temperature and
// humidity cycle, lights on 16 hours a day, small noise, and one warm spell early yesterday morning.
// Every response says which kind it is (simulated: true / false).
import { prisma } from '../db/prisma.js';
import { addDays, labHour, labTimeMs, labToday } from '../lib/dates.js';

const MIN = 60_000;

export interface Reading {
  recordedAt: string;
  tempC: number;
  humidityPct: number;
  lightLux: number;
}

function noise(slot: number, salt: number) {
  const x = Math.sin(slot * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x) - 0.5;
}
const spellStart = () => labTimeMs(addDays(labToday(), -1), '02:10');
const SPELL_MIN = 50;

export function simulatedAt(ms: number, stepMin = 5): Reading {
  const slot = Math.floor(ms / (stepMin * MIN));
  const hour = labHour(ms);
  let tempC = 24.3 + 0.9 * Math.sin(((hour - 9) / 24) * 2 * Math.PI) + noise(slot, 1) * 0.25;
  let humidityPct = 68 - 4 * Math.sin(((hour - 9) / 24) * 2 * Math.PI) + noise(slot, 2) * 3;
  const lightsOn = hour >= 6 && hour < 22;
  const lightLux = lightsOn ? 2500 + noise(slot, 3) * 200 : Math.max(0, 5 + noise(slot, 3) * 10);
  const s = spellStart();
  if (ms >= s && ms < s + SPELL_MIN * MIN) {
    const p = (ms - s) / (SPELL_MIN * MIN);
    tempC = 27.2 + 1.4 * Math.sin(p * Math.PI);
    humidityPct -= 4;
  }
  return {
    recordedAt: new Date(slot * stepMin * MIN).toISOString(),
    tempC: Math.round(tempC * 10) / 10,
    humidityPct: Math.round(humidityPct * 10) / 10,
    lightLux: Math.round(lightLux),
  };
}

function simulated(fromMs: number, toMs: number, stepMin: number): Reading[] {
  const out: Reading[] = [];
  const step = stepMin * MIN;
  for (let t = Math.ceil(fromMs / step) * step; t <= toMs; t += step) out.push(simulatedAt(t, stepMin));
  return out;
}

/** Reads one device's readings. Uses real readings once the device has sent any; otherwise the simulation. */
export async function readingSource(deviceId: number, intervalMin: number) {
  const real = (await prisma.sensorReading.count({ where: { deviceId } })) > 0;
  return {
    simulated: !real,
    /** Readings between two times, newest last; real readings are thinned to one per stepMin. */
    async between(fromMs: number, toMs: number, stepMin = intervalMin): Promise<Reading[]> {
      if (!real) return simulated(fromMs, toMs, stepMin);
      const rows = await prisma.sensorReading.findMany({
        where: { deviceId, recordedAt: { gte: new Date(fromMs), lte: new Date(toMs) } },
        orderBy: { recordedAt: 'asc' },
      });
      const out: Reading[] = [];
      let lastSlot = -1;
      for (const r of rows) {
        const slot = Math.floor(r.recordedAt.getTime() / (stepMin * MIN));
        if (slot === lastSlot) continue;
        lastSlot = slot;
        out.push({ recordedAt: r.recordedAt.toISOString(), tempC: r.tempC, humidityPct: r.humidityPct, lightLux: r.lightLux ?? 0 });
      }
      return out;
    },
    async latest(): Promise<Reading | null> {
      if (!real) return simulatedAt(Math.floor(Date.now() / (intervalMin * MIN)) * intervalMin * MIN, intervalMin);
      const r = await prisma.sensorReading.findFirst({ where: { deviceId }, orderBy: { recordedAt: 'desc' } });
      return r ? { recordedAt: r.recordedAt.toISOString(), tempC: r.tempC, humidityPct: r.humidityPct, lightLux: r.lightLux ?? 0 } : null;
    },
  };
}
export type ReadingSource = Awaited<ReturnType<typeof readingSource>>;
