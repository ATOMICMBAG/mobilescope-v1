import { describe, expect, it } from "vitest";
import {
  MockScanner,
  OuiDatabase,
  SEED_OUI_DB,
  classify,
  createState,
  detectAddressType,
  evaluateRules,
  normalizeMac,
  processObservation,
  type Condition,
  type Observation,
  type Rule,
} from "../src/index.js";

const ctx = { oui: SEED_OUI_DB };

function obs(p: Partial<Observation>): Observation {
  return {
    id: "obs_1",
    sessionId: "s1",
    ts: "2026-10-31T10:00:00.000Z",
    source: "WIFI",
    scanOrigin: "OS_INITIATED",
    identifier: "00:30:44:AA:10:01",
    rssi: -60,
    ...p,
  };
}

function rule(p: Partial<Rule> & Pick<Rule, "type" | "match">): Rule {
  return { id: "r1", name: "r", active: true, priority: 10, createdAt: "2026-10-31T00:00:00Z", ...p };
}

describe("Adressen", () => {
  it("normalisiert MAC-Schreibweisen", () => {
    expect(normalizeMac("00-30-44-aa-10-01")).toBe("00:30:44:AA:10:01");
    expect(normalizeMac("003044aa1001")).toBe("00:30:44:AA:10:01");
    expect(normalizeMac("nope")).toBeNull();
  });
  it("erkennt lokal administrierte WLAN-Adressen", () => {
    expect(detectAddressType(obs({ identifier: "02:11:22:33:44:55" }))).toBe("LOCALLY_ADMINISTERED");
    expect(detectAddressType(obs({ identifier: "00:30:44:AA:10:01" }))).toBe("PUBLIC");
  });
  it("leitet bei BLE ohne Hinweis keinen Typ ab", () => {
    expect(detectAddressType(obs({ source: "BLE", identifier: "F4:11:22:33:44:55" }))).toBe("UNKNOWN");
  });
});

describe("Klassifizierung (Cradlepoint-Pflichtfall)", () => {
  const c = classify(obs({}), ctx);
  it("ordnet Hersteller und mögliche Kategorie zu", () => {
    expect(c.manufacturer).toBe("Cradlepoint, Inc.");
    expect(c.category).toBe("NETWORK_EQUIPMENT");
    expect(c.identityState).toBe("PROBABLE");
    expect(c.confidence).toBe("MEDIUM");
  });
  it("leitet keine Behörden-/Einsatzfahrzeug-Aussage ab und erlaubt keinen Alarm", () => {
    // Nur die Aussagen (Claims) prüfen; Limitations dürfen diese Begriffe als Abgrenzung nennen.
    const claims = JSON.stringify([c.manufacturer, c.category, c.family, c.evidence.map((e) => e.claim)]).toLowerCase();
    for (const w of ["polizei", "behörde", "einsatzfahrzeug", "police", "government"]) {
      expect(claims).not.toContain(w);
    }
    expect(c.evidence.every((e) => !e.alertEligible)).toBe(true);
  });
  it("jede Evidence hat limitations", () => {
    expect(c.evidence.every((e) => e.limitations.length > 0)).toBe(true);
  });
  it("kein OUI-Treffer bei zufälliger Adresse", () => {
    const r = classify(obs({ identifier: "02:30:44:AA:10:01" }), ctx);
    expect(r.manufacturer).toBeUndefined();
    expect(r.identityState).toBe("UNKNOWN");
    expect(r.evidence.some((e) => e.matchType === "OUI")).toBe(false);
  });
  it("BLE Company-ID liefert nur schwachen Hinweis", () => {
    const r = classify(obs({ source: "BLE", identifier: "F4:11:22:33:44:55", bleCompanyId: 0x0008, addressTypeHint: "PUBLIC" }), ctx);
    expect(r.manufacturer).toBe("Motorola");
    expect(r.evidence.find((e) => e.matchType === "BLE_COMPANY_ID")?.confidence).toBe("LOW");
  });
});

describe("OUI-Datenbank (Präfixlängen)", () => {
  const db = new OuiDatabase(
    [
      { oui: "001122", manufacturer: "Kurzer Bereich AG" },
      { oui: "0011223", manufacturer: "Mittlerer Bereich GmbH" },
      { oui: "001122334", manufacturer: "Kleiner Bereich Ltd" },
      { oui: "AABBCC", manufacturer: "Private" },
    ],
    { name: "test", version: "t" },
  );
  it("längster Präfix gewinnt (MA-S vor MA-M vor MA-L)", () => {
    expect(db.lookup("00:11:22:33:4A:BB")?.manufacturer).toBe("Kleiner Bereich Ltd");
    expect(db.lookup("00:11:22:3F:00:00")?.manufacturer).toBe("Mittlerer Bereich GmbH");
    expect(db.lookup("00:11:22:99:00:00")?.manufacturer).toBe("Kurzer Bereich AG");
    expect(db.lookup("00:11:23:00:00:00")).toBeUndefined();
  });
  it("lädt das Kompaktformat", () => {
    const c = OuiDatabase.fromCompact({ meta: { name: "n", version: "v" }, orgs: ["Acme"], entries: [["ABCDEF", 0]] });
    expect(c.lookup("ab:cd:ef:00:00:01")?.manufacturer).toBe("Acme");
  });
  it("private Einträge liefern keine Herstellerzuordnung", () => {
    const r = classify(obs({ identifier: "AA:BB:CC:00:00:01" }), { oui: db });
    expect(r.manufacturer).toBeUndefined();
    expect(r.identityState).toBe("UNKNOWN");
    expect(r.evidence.every((e) => e.limitations.length > 0)).toBe(true);
  });
});

describe("Regeln", () => {
  const o = obs({});
  const c = classify(o, ctx);
  it("Watch hebt hervor, Mute unterdrückt nur Benachrichtigung, beide bleiben sichtbar", () => {
    const out = evaluateRules(
      [
        rule({ id: "w", type: "WATCH", match: { field: "OUI", value: "00:30:44" } }),
        rule({ id: "m", type: "MUTE", match: { field: "MANUFACTURER", value: "cradle" } }),
      ],
      o,
      c,
    );
    expect(out.highlight).toBe(true);
    expect(out.notify).toBe(false);
    expect(out.hidden).toBe(false);
    expect(out.conflict).toBe(true);
    expect(out.matched).toHaveLength(2);
  });
  it("Exclude versteckt nur in der Anzeige", () => {
    const out = evaluateRules([rule({ type: "EXCLUDE", match: { field: "CATEGORY", value: "NETWORK_EQUIPMENT" } })], o, c);
    expect(out.hidden).toBe(true);
  });
  it("inaktive Regeln greifen nicht; AND/OR und Wildcards funktionieren", () => {
    expect(evaluateRules([rule({ type: "WATCH", active: false, match: { field: "OUI", value: "00:30:44" } })], o, c).matched).toHaveLength(0);
    const o2 = obs({ name: "FieldRouter-7" });
    const m: Condition = { op: "AND", conditions: [{ field: "SSID_PATTERN", value: "Field*" }, { field: "OUI", value: "00:30:44" }] };
    expect(evaluateRules([rule({ type: "WATCH", match: m })], o2, classify(o2, ctx)).highlight).toBe(true);
  });
});

describe("Engine", () => {
  it("erzeugt Events und protokolliert Watch/Mute-Konflikt einmalig", () => {
    const s = createState();
    const rules = [
      rule({ id: "w", type: "WATCH", match: { field: "OUI", value: "00:30:44" } }),
      rule({ id: "m", type: "MUTE", match: { field: "OUI", value: "00:30:44" } }),
    ];
    processObservation(s, obs({}), rules, ctx);
    processObservation(s, obs({ rssi: -40 }), rules, ctx);
    const types = s.events.map((e) => e.type);
    expect(types.filter((t) => t === "NEW_SIGNAL")).toHaveLength(1);
    expect(types.filter((t) => t === "RULE_CONFLICT_RESOLVED")).toHaveLength(1);
    expect(types).toContain("RSSI_SHIFT");
    expect(types).not.toContain("WATCH_TRIGGERED");
  });
  it("Mock-Scanner ist reproduzierbar", () => {
    const a = new MockScanner("s", 1).scan(new Date(0));
    const b = new MockScanner("s", 1).scan(new Date(0));
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });
});
