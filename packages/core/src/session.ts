import { keyOf } from "./engine.js";
import type {
  AlertLevel,
  Classification,
  MsEvent,
  Observation,
  ProcessedObservation,
  RuleOutcome,
  Source,
} from "./types.js";

/** Version des Session-Dateiformats. Erhöhen bei inkompatiblen Änderungen. */
export const SESSION_SCHEMA = 1;

export interface SessionMeta {
  id: string;
  name: string;
  startedAt: string; // ISO-8601 UTC
  endedAt?: string;
  scanner: string; // z. B. "android" oder "mock"
  device?: string;
  appVersion: string;
  ouiName: string;
  ouiVersion: string;
  activeRules: number;
  notes?: string;
}

/** Zusammenfassung aller Beobachtungen eines Signals innerhalb einer Session. */
export interface EntityRecord {
  key: string; // Quelle:Adresse
  source: Source;
  identifier: string;
  name?: string; // letzter bekannter Name (SSID / BLE-Name)
  firstSeen: string;
  lastSeen: string;
  count: number;
  rssiMin: number;
  rssiMax: number;
  rssiSum: number;
  frequencyMhz?: number;
  /** RSSI-Verlauf, ausgedünnt: [Sekunden seit Sessionstart, dBm]. */
  samples: [number, number][];
  sampleStepSec: number;
  last: Observation;
  classification: Classification;
  rules: RuleOutcome;
  alertLevel: AlertLevel;
}

export interface Session {
  schema: number;
  meta: SessionMeta;
  entities: EntityRecord[];
  events: MsEvent[];
}

export interface SessionSummary {
  wifi: number;
  ble: number;
  observations: number;
  events: number;
  unknownIdentity: number;
}

export function summarize(s: Session): SessionSummary {
  return {
    wifi: s.entities.filter((e) => e.source === "WIFI").length,
    ble: s.entities.filter((e) => e.source === "BLE").length,
    observations: s.entities.reduce((n, e) => n + e.count, 0),
    events: s.events.length,
    unknownIdentity: s.entities.filter((e) => e.classification.identityState === "UNKNOWN").length,
  };
}

export function rssiAvg(e: EntityRecord): number {
  return e.count === 0 ? 0 : e.rssiSum / e.count;
}

const FIRST_SAMPLE_STEP_SEC = 5;
const MAX_SAMPLES = 1000;

/**
 * Sammelt Beobachtungen einer Session zu Signal-Zusammenfassungen.
 * Speichert bewusst nicht jede Rohbeobachtung, sondern Statistik und einen ausgedünnten RSSI-Verlauf.
 */
export class SessionRecorder {
  private entities = new Map<string, EntityRecord>();
  private readonly startMs: number;

  constructor(public meta: SessionMeta) {
    this.startMs = new Date(meta.startedAt).getTime();
  }

  get observationCount(): number {
    let n = 0;
    for (const e of this.entities.values()) n += e.count;
    return n;
  }

  add(p: ProcessedObservation): void {
    const o = p.observation;
    const key = keyOf(o);
    const tSec = Math.max(0, (new Date(o.ts).getTime() - this.startMs) / 1000);
    let e = this.entities.get(key);
    if (!e) {
      e = {
        key,
        source: o.source,
        identifier: o.identifier,
        name: o.name,
        firstSeen: o.ts,
        lastSeen: o.ts,
        count: 0,
        rssiMin: o.rssi,
        rssiMax: o.rssi,
        rssiSum: 0,
        frequencyMhz: o.frequencyMhz,
        samples: [],
        sampleStepSec: FIRST_SAMPLE_STEP_SEC,
        last: o,
        classification: p.classification,
        rules: p.rules,
        alertLevel: p.alertLevel,
      };
      this.entities.set(key, e);
    }
    e.count++;
    e.rssiSum += o.rssi;
    e.rssiMin = Math.min(e.rssiMin, o.rssi);
    e.rssiMax = Math.max(e.rssiMax, o.rssi);
    if (o.ts < e.firstSeen) e.firstSeen = o.ts;
    if (o.ts >= e.lastSeen) {
      e.lastSeen = o.ts;
      e.last = o;
      e.classification = p.classification;
      e.rules = p.rules;
      e.alertLevel = p.alertLevel;
      if (o.name) e.name = o.name;
      if (o.frequencyMhz !== undefined) e.frequencyMhz = o.frequencyMhz;
    }

    const lastSample = e.samples[e.samples.length - 1];
    if (!lastSample || tSec - lastSample[0] >= e.sampleStepSec) {
      e.samples.push([Math.round(tSec * 10) / 10, o.rssi]);
      if (e.samples.length > MAX_SAMPLES) {
        e.samples = e.samples.filter((_, i) => i % 2 === 0);
        e.sampleStepSec *= 2;
      }
    }
  }

  snapshot(events: MsEvent[], endedAt?: string): Session {
    return {
      schema: SESSION_SCHEMA,
      meta: { ...this.meta, endedAt },
      entities: [...this.entities.values()].map((e) => ({ ...e, samples: [...e.samples] })),
      events: [...events],
    };
  }
}
