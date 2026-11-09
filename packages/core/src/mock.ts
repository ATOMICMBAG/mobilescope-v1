import type { Observation } from "./types.js";

interface MockDevice {
  source: Observation["source"];
  identifier: string;
  name?: string;
  base: number;
  frequencyMhz?: number;
  bleCompanyId?: number;
  capabilities?: string[];
  addressTypeHint?: Observation["addressTypeHint"];
  /** Wahrscheinlichkeit pro Scan, empfangen zu werden. */
  presence: number;
}

const DEVICES: MockDevice[] = [
  { source: "WIFI", identifier: "00:30:44:AA:10:01", name: "FieldRouter-7", base: -58, frequencyMhz: 2437, capabilities: ["WPA2-PSK"], presence: 0.95 },
  { source: "WIFI", identifier: "B8:27:EB:12:34:56", name: "lab-pi", base: -66, frequencyMhz: 5180, capabilities: ["WPA2-PSK"], presence: 0.9 },
  { source: "WIFI", identifier: "02:11:22:33:44:55", name: "PhoneHotspot", base: -74, frequencyMhz: 2462, capabilities: ["WPA2-PSK"], presence: 0.7 },
  { source: "WIFI", identifier: "00:50:56:C0:00:08", name: "VM-Lab-AP", base: -81, frequencyMhz: 2412, capabilities: ["OPEN"], presence: 0.5 },
  { source: "WIFI", identifier: "6A:9B:CC:01:02:03", name: undefined, base: -88, frequencyMhz: 5745, presence: 0.35 },
  { source: "BLE", identifier: "F4:11:22:33:44:55", name: "Moto Tag", base: -62, bleCompanyId: 0x0008, addressTypeHint: "PUBLIC", presence: 0.85 },
  { source: "BLE", identifier: "5A:77:88:99:AA:BB", name: undefined, base: -79, bleCompanyId: 0x004c, addressTypeHint: "RANDOM_RESOLVABLE", presence: 0.6 },
  { source: "BLE", identifier: "C3:DE:AD:BE:EF:01", name: "SensorNode", base: -70, addressTypeHint: "RANDOM_STATIC", presence: 0.75 },
];

/** Deterministischer Zufall (mulberry32), damit Tests und Demos reproduzierbar sind. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Simuliert einen Scanner für Entwicklung am PC. */
export class MockScanner {
  private rand: () => number;
  private n = 0;
  constructor(
    private sessionId: string,
    seed = 42,
  ) {
    this.rand = rng(seed);
  }

  scan(now: Date = new Date()): Observation[] {
    const out: Observation[] = [];
    for (const d of DEVICES) {
      if (this.rand() > d.presence) continue;
      const jitter = Math.round((this.rand() - 0.5) * 8);
      out.push({
        id: `obs_${String(++this.n).padStart(6, "0")}`,
        sessionId: this.sessionId,
        ts: now.toISOString(),
        source: d.source,
        scanOrigin: d.source === "WIFI" ? "OS_INITIATED" : "APP",
        identifier: d.identifier,
        addressTypeHint: d.addressTypeHint,
        name: d.name,
        rssi: d.base + jitter,
        frequencyMhz: d.frequencyMhz,
        capabilities: d.capabilities,
        bleCompanyId: d.bleCompanyId,
        resultAgeMs: Math.round(this.rand() * 2000),
      });
    }
    return out;
  }
}
