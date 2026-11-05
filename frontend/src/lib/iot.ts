// Sensor readings from the IoT node in the growth room.
// Until the real ESP32 + DHT22 node is connected, readings are SIMULATED here: a daily temperature
// and humidity cycle, lights on 16 hours a day, small random noise, and one warm spell early
// yesterday morning (so the alert history has something real to point to).
// With the backend, the node posts to /api/iot/readings and this file is replaced by a fetch.
import { addDays, today } from './apiUtil';
import type { SensorReading } from './types';

const MIN = 60_000;

/** Same pseudo-random number for the same time slot, so the chart does not jump on reload. */
function noise(slot: number, salt: number) {
  const x = Math.sin(slot * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x) - 0.5; // −0.5 … 0.5
}

/** Start of yesterday's warm spell (02:10) and its length in minutes. */
const spellStart = () => new Date(addDays(today(), -1) + 'T02:10:00').getTime();
const SPELL_MIN = 50;

export function readingAt(ms: number, stepMin = 5): SensorReading {
  const slot = Math.floor(ms / (stepMin * MIN));
  const d = new Date(ms);
  const hour = d.getHours() + d.getMinutes() / 60;
  // Warmest in the afternoon, coolest before dawn.
  let tempC = 24.3 + 0.9 * Math.sin(((hour - 9) / 24) * 2 * Math.PI) + noise(slot, 1) * 0.25;
  let humidityPct = 68 - 4 * Math.sin(((hour - 9) / 24) * 2 * Math.PI) + noise(slot, 2) * 3;
  const lightsOn = hour >= 6 && hour < 22; // 16 h light, 8 h dark
  const lightLux = lightsOn ? 2500 + noise(slot, 3) * 200 : Math.max(0, 5 + noise(slot, 3) * 10);
  const s = spellStart();
  if (ms >= s && ms < s + SPELL_MIN * MIN) {
    // A cooling fault: temperature climbs past 27 °C and comes back once fixed.
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

/** Readings between two times, one every stepMin minutes, newest last. */
export function readings(fromMs: number, toMs: number, stepMin = 5): SensorReading[] {
  const out: SensorReading[] = [];
  const step = stepMin * MIN;
  for (let t = Math.ceil(fromMs / step) * step; t <= toMs; t += step) out.push(readingAt(t, stepMin));
  return out;
}

export function latestReading(stepMin = 5): SensorReading {
  return readingAt(Math.floor(Date.now() / (stepMin * MIN)) * stepMin * MIN, stepMin);
}
