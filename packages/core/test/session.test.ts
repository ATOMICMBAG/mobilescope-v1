import { describe, expect, it } from "vitest";
import {
  CSV_COLUMNS,
  DEFAULT_EXPORT,
  SEED_OUI_DB,
  SESSION_SCHEMA,
  SessionRecorder,
  createState,
  csvText,
  maskAddress,
  parseSessionJson,
  processObservation,
  sessionToCsv,
  sessionToJson,
  summarize,
  type Observation,
  type SessionMeta,
} from "../src/index.js";

const ctx = { oui: SEED_OUI_DB };
const meta: SessionMeta = {
  id: "ses_test",
  name: "Test",
  startedAt: "2026-11-01T10:00:00.000Z",
  scanner: "mock",
  appVersion: "0.0.0",
  ouiName: "seed",
  ouiVersion: "t",
  activeRules: 0,
};

function obs(p: Partial<Observation>): Observation {
  return {
    id: "o",
    sessionId: "ses_test",
    ts: "2026-11-01T10:00:00.000Z",
    source: "WIFI",
    scanOrigin: "OS_INITIATED",
    identifier: "00:30:44:AA:10:01",
    rssi: -60,
    ...p,
  };
}

function record(items: Observation[]) {
  const state = createState();
  const rec = new SessionRecorder(meta);
  for (const o of items) rec.add(processObservation(state, o, [], ctx));
  return { rec, state };
}

describe("SessionRecorder", () => {
  it("fasst Beobachtungen je Signal zusammen", () => {
    const { rec, state } = record([
      obs({ ts: "2026-11-01T10:00:00.000Z", rssi: -60, name: "A" }),
      obs({ ts: "2026-11-01T10:00:10.000Z", rssi: -40 }),
      obs({ ts: "2026-11-01T10:00:20.000Z", rssi: -80 }),
      obs({ identifier: "B8:27:EB:12:34:56", rssi: -70 }),
    ]);
    const s = rec.snapshot(state.events, "2026-11-01T10:01:00.000Z");
    expect(s.entities).toHaveLength(2);
    const e = s.entities.find((x) => x.identifier === "00:30:44:AA:10:01")!;
    expect(e).toMatchObject({ count: 3, rssiMin: -80, rssiMax: -40, name: "A" });
    expect(e.rssiSum / e.count).toBeCloseTo(-60);
    expect(e.firstSeen).toBe("2026-11-01T10:00:00.000Z");
    expect(e.lastSeen).toBe("2026-11-01T10:00:20.000Z");
    expect(summarize(s)).toMatchObject({ wifi: 2, ble: 0, observations: 4 });
    expect(s.meta.endedAt).toBe("2026-11-01T10:01:00.000Z");
  });

  it("dünnt den RSSI-Verlauf aus und begrenzt ihn", () => {
    const items: Observation[] = [];
    for (let i = 0; i < 8000; i++) {
      items.push(obs({ ts: new Date(Date.parse(meta.startedAt) + i * 1000).toISOString(), rssi: -50 - (i % 10) }));
    }
    const { rec } = record(items);
    const e = rec.snapshot([]).entities[0]!;
    expect(e.count).toBe(8000);
    expect(e.samples.length).toBeLessThanOrEqual(1000);
    expect(e.sampleStepSec).toBeGreaterThan(5);
    for (let i = 1; i < e.samples.length; i++) expect(e.samples[i]![0]).toBeGreaterThan(e.samples[i - 1]![0]);
  });

  it("behandelt Quelle+Adresse getrennt", () => {
    const { rec } = record([obs({ source: "WIFI" }), obs({ source: "BLE", addressTypeHint: "PUBLIC" })]);
    expect(rec.snapshot([]).entities).toHaveLength(2);
  });
});

describe("Export", () => {
  const { rec, state } = record([
    obs({ name: "=HYPERLINK(\"http://x\")", rssi: -55 }),
    obs({ identifier: "B8:27:EB:12:34:56", name: "Büro, \"Gast\"", rssi: -66 }),
  ]);
  const session = rec.snapshot(state.events, "2026-11-01T10:01:00.000Z");

  it("entschärft Formelzeichen in Textzellen", () => {
    expect(csvText("=1+1", ";")).toBe("'=1+1");
    expect(csvText("+49", ";")).toBe("'+49");
    expect(csvText("-x", ";")).toBe("'-x");
    expect(csvText("@cmd", ";")).toBe("'@cmd");
    expect(csvText("normal", ";")).toBe("normal");
  });

  it("maskiert Trennzeichen, Anführungszeichen und Zeilenumbrüche", () => {
    expect(csvText('a;b', ";")).toBe('"a;b"');
    expect(csvText('a"b', ";")).toBe('"a""b"');
    expect(csvText("a\nb", ";")).toBe("a b");
    expect(csvText("a;b", ",")).toBe("a;b");
  });

  it("schreibt CSV mit BOM, Kopfzeile und einer Zeile je Signal", () => {
    const csv = sessionToCsv(session);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(CSV_COLUMNS.join(";"));
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/;=HYPERLINK/);
    expect(csv).toContain("Cradlepoint");
  });

  it("anonymisiert Adressen und lässt Namen weg, ohne den Hersteller zu verlieren", () => {
    expect(maskAddress("00:30:44:aa:10:01")).toBe("00:30:44:xx:xx:xx");
    expect(maskAddress("kaputt")).toBe("xx");
    const opts = { ...DEFAULT_EXPORT, anonymizeAddresses: true, omitNames: true };
    const csv = sessionToCsv(session, opts);
    expect(csv).not.toContain("AA:10:01");
    expect(csv).not.toContain("HYPERLINK");
    expect(csv).toContain("00:30:44:xx:xx:xx");
    expect(csv).toContain("Cradlepoint");
    const json = sessionToJson(session, opts);
    expect(json).not.toContain("AA:10:01");
    expect(json).not.toContain("HYPERLINK");
    expect(json).not.toContain("Gast");
  });

  it("JSON-Export lässt sich wieder einlesen", () => {
    const back = parseSessionJson(sessionToJson(session));
    expect(back.schema).toBe(SESSION_SCHEMA);
    expect(back.meta.id).toBe("ses_test");
    expect(back.entities).toHaveLength(2);
    expect(back.entities[0]!.classification.evidence.length).toBeGreaterThan(0);
  });

  it("weist falsche oder beschädigte Dateien ab", () => {
    expect(() => parseSessionJson("kein json")).toThrow(/JSON/);
    expect(() => parseSessionJson('{"format":"x"}')).toThrow(/mobilescope/);
    expect(() => parseSessionJson(JSON.stringify({ format: "mobilescope-session", schema: 99, session: {} }))).toThrow(/nicht unterstützt/);
    expect(() => parseSessionJson(JSON.stringify({ format: "mobilescope-session", schema: 1, session: { meta: { id: "x" }, entities: [{}], events: [] } }))).toThrow(/ungültig/);
  });
});
