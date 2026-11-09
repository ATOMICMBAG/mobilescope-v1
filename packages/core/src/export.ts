import { normalizeMac } from "./address.js";
import { SESSION_SCHEMA, rssiAvg, summarize, type EntityRecord, type Session } from "./session.js";

export type CsvDelimiter = ";" | ",";

export interface ExportOptions {
  /** Letzte drei Bytes der Adresse ausblenden (OUI bleibt erhalten). */
  anonymizeAddresses: boolean;
  /** SSID und BLE-Namen weglassen. */
  omitNames: boolean;
  /** Trennzeichen für CSV; Semikolon öffnet in deutschem Excel direkt in Spalten. */
  delimiter: CsvDelimiter;
}

export const DEFAULT_EXPORT: ExportOptions = {
  anonymizeAddresses: false,
  omitNames: false,
  delimiter: ";",
};

export const EXPORT_DISCLAIMER =
  "Hersteller-, Kategorie- und Identitätsangaben sind Hinweise mit dokumentierten Einschränkungen (siehe evidence/limitations), keine Geräteidentifikation. RSSI ist keine Entfernungsmessung.";

/** AA:BB:CC:DD:EE:FF → AA:BB:CC:xx:xx:xx. Nicht lesbare Adressen werden vollständig maskiert. */
export function maskAddress(address: string): string {
  const mac = normalizeMac(address);
  return mac ? `${mac.slice(0, 8)}:xx:xx:xx` : "xx";
}

function entityForExport(e: EntityRecord, o: ExportOptions): EntityRecord {
  const copy: EntityRecord = { ...e };
  if (o.anonymizeAddresses) {
    copy.identifier = maskAddress(e.identifier);
    copy.key = `${e.source}:${copy.identifier}`;
    copy.last = { ...e.last, identifier: copy.identifier };
  }
  if (o.omitNames) {
    delete copy.name;
    copy.last = { ...copy.last };
    delete copy.last.name;
  }
  return copy;
}

export function sessionToJson(session: Session, options: ExportOptions = DEFAULT_EXPORT, now = new Date()): string {
  const events = session.events.map((ev) => {
    if (!ev.identifier || (!options.anonymizeAddresses && !options.omitNames)) return ev;
    return {
      ...ev,
      identifier: options.anonymizeAddresses ? maskAddress(ev.identifier) : ev.identifier,
      // Meldungstexte enthalten Namen/Adressen; bei Anonymisierung werden sie neutralisiert.
      message: `${ev.type}`,
    };
  });
  const out = {
    format: "mobilescope-session",
    schema: SESSION_SCHEMA,
    exportedAt: now.toISOString(),
    export: { anonymizeAddresses: options.anonymizeAddresses, omitNames: options.omitNames },
    disclaimer: EXPORT_DISCLAIMER,
    session: {
      meta: session.meta,
      summary: summarize(session),
      entities: session.entities.map((e) => entityForExport(e, options)),
      events,
    },
  };
  return JSON.stringify(out, null, 2);
}

/**
 * CSV-Zellen aus fremden Funkdaten (SSID, BLE-Name) können mit =, +, -, @ beginnen und
 * von Tabellenkalkulationen als Formel ausgeführt werden. Textfelder werden daher entschärft.
 */
export function csvText(value: string | undefined, delimiter: CsvDelimiter): string {
  if (value === undefined || value === "") return "";
  let v = value.replace(/\r?\n|\r/g, " ");
  if (/^[=+\-@\t]/.test(v)) v = `'${v}`;
  return v.includes(delimiter) || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
}

const num = (n: number | undefined, digits = 1) =>
  n === undefined ? "" : Number.isInteger(n) ? String(n) : n.toFixed(digits);

export const CSV_COLUMNS = [
  "session_id",
  "source",
  "identifier",
  "name",
  "first_seen_utc",
  "last_seen_utc",
  "observations",
  "rssi_min_dbm",
  "rssi_avg_dbm",
  "rssi_max_dbm",
  "frequency_mhz",
  "address_type",
  "manufacturer",
  "category",
  "family",
  "identity_state",
  "confidence",
  "evidence",
  "limitations",
  "matched_rules",
  "alert_level",
] as const;

export function sessionToCsv(session: Session, options: ExportOptions = DEFAULT_EXPORT): string {
  const d = options.delimiter;
  const rows = [CSV_COLUMNS.join(d)];
  for (const raw of session.entities) {
    const e = entityForExport(raw, options);
    const c = e.classification;
    const evidence = c.evidence.map((ev) => `${ev.matchType} (${ev.source.name} ${ev.source.version})`).join(" | ");
    const limitations = [...new Set(c.evidence.flatMap((ev) => ev.limitations))].join(" | ");
    rows.push(
      [
        csvText(session.meta.id, d),
        e.source,
        csvText(e.identifier, d),
        csvText(e.name, d),
        e.firstSeen,
        e.lastSeen,
        String(e.count),
        num(e.rssiMin),
        num(rssiAvg(e), 1),
        num(e.rssiMax),
        num(e.frequencyMhz),
        c.addressType,
        csvText(c.manufacturer, d),
        c.category,
        csvText(c.family, d),
        c.identityState,
        c.confidence,
        csvText(evidence, d),
        csvText(limitations, d),
        csvText(e.rules.matched.map((r) => `${r.type}:${r.name}`).join(" | "), d),
        e.alertLevel,
      ].join(d),
    );
  }
  // BOM, damit Excel UTF-8 (Umlaute) korrekt erkennt.
  return `﻿${rows.join("\r\n")}\r\n`;
}

/** Liest eine exportierte Session-Datei. Wirft bei unbekanntem oder beschädigtem Format. */
export function parseSessionJson(text: string): Session {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Datei ist kein gültiges JSON.");
  }
  const root = data as { format?: unknown; schema?: unknown; session?: Partial<Session> };
  if (root?.format !== "mobilescope-session") throw new Error("Keine mobilescope-Session-Datei.");
  if (typeof root.schema !== "number" || root.schema > SESSION_SCHEMA) {
    throw new Error(`Session-Format ${String(root.schema)} wird von dieser Version nicht unterstützt.`);
  }
  const s = root.session;
  if (!s || typeof s.meta?.id !== "string" || !Array.isArray(s.entities) || !Array.isArray(s.events)) {
    throw new Error("Session-Datei ist unvollständig.");
  }
  for (const e of s.entities) {
    if (
      typeof e?.identifier !== "string" ||
      (e.source !== "WIFI" && e.source !== "BLE") ||
      typeof e.count !== "number" ||
      !e.classification ||
      !Array.isArray(e.classification.evidence) ||
      !e.rules ||
      !Array.isArray(e.samples)
    ) {
      throw new Error("Session-Datei enthält ungültige Einträge.");
    }
  }
  return { schema: root.schema, meta: s.meta as Session["meta"], entities: s.entities, events: s.events };
}
