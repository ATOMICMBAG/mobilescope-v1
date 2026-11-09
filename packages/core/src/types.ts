export type Source = "WIFI" | "BLE";
export type ScanOrigin = "APP" | "OS_INITIATED" | "UNKNOWN";
export type IdentityState = "KNOWN" | "PROBABLE" | "UNKNOWN";
export type Confidence = "LOW" | "MEDIUM" | "HIGH";
export type AddressType =
  | "PUBLIC"
  | "LOCALLY_ADMINISTERED"
  | "RANDOM_STATIC"
  | "RANDOM_RESOLVABLE"
  | "RANDOM_NON_RESOLVABLE"
  | "UNKNOWN";
export type Category =
  | "NETWORK_EQUIPMENT"
  | "SMARTPHONE"
  | "COMPUTER"
  | "SINGLE_BOARD_COMPUTER"
  | "VIRTUAL_MACHINE"
  | "IOT"
  | "UNKNOWN";
export type AlertLevel = "NORMAL" | "INFORMATIONAL" | "WATCH" | "WARNING" | "CRITICAL";

/** Ein einzelner Empfangsvorgang. Keine Zusammenfassung, keine Interpretation. */
export interface Observation {
  id: string;
  sessionId: string;
  ts: string; // ISO-8601 UTC
  source: Source;
  scanOrigin: ScanOrigin;
  identifier: string; // BSSID bzw. BLE-Adresse
  /** Vom Scanner gemeldeter Adresstyp (BLE), falls verfügbar. */
  addressTypeHint?: AddressType;
  name?: string; // SSID / BLE-Name
  rssi: number;
  frequencyMhz?: number;
  capabilities?: string[];
  bleCompanyId?: number;
  /** Alter des Scanergebnisses laut Betriebssystem (Android liefert teils veraltete Ergebnisse). */
  resultAgeMs?: number;
}

export interface EvidenceSource {
  name: string;
  version: string;
}

export type MatchType = "OUI" | "BLE_COMPANY_ID" | "ADDRESS_TYPE" | "SSID_PATTERN" | "USER_RULE";

/** Begründung einer Aussage. Jede Klassifizierung trägt mindestens einen Datensatz. */
export interface Evidence {
  matchType: MatchType;
  claim: { manufacturer?: string; category?: Category; family?: string };
  identityState: IdentityState;
  confidence: Confidence;
  source: EvidenceSource;
  /** Pflicht: warum die Aussage unsicher oder begrenzt ist. */
  limitations: string[];
  alertEligible: boolean;
  reason: string;
}

export interface Classification {
  addressType: AddressType;
  identityState: IdentityState;
  confidence: Confidence;
  manufacturer?: string;
  category: Category;
  family?: string;
  evidence: Evidence[];
}

export type RuleType = "WATCH" | "MUTE" | "EXCLUDE";

export type LeafField =
  | "MAC_EXACT"
  | "MAC_PREFIX"
  | "OUI"
  | "SSID_EXACT"
  | "SSID_PATTERN"
  | "BLE_NAME"
  | "CATEGORY"
  | "MANUFACTURER";

export type Condition =
  | { field: LeafField; value: string }
  | { op: "AND" | "OR"; conditions: Condition[] };

export interface Rule {
  id: string;
  name: string;
  type: RuleType;
  active: boolean;
  priority: number; // höher = zuerst
  createdAt: string;
  description?: string;
  match: Condition;
}

export type EventType =
  | "NEW_SIGNAL"
  | "SIGNAL_REAPPEARED"
  | "RSSI_SHIFT"
  | "SIGNAL_NOT_SEEN"
  | "STALE_RESULTS_IGNORED"
  | "WATCH_TRIGGERED"
  | "MUTE_APPLIED"
  | "RULE_CONFLICT_RESOLVED"
  | "CLASSIFICATION_UPDATED"
  | "SCAN_THROTTLED"
  | "SCAN_FAILED"
  | "PERMISSION_CHANGED";

export interface MsEvent {
  ts: string;
  type: EventType;
  identifier?: string;
  message: string;
}

export interface RuleOutcome {
  matched: Rule[];
  highlight: boolean; // WATCH
  notify: boolean; // false bei MUTE
  hidden: boolean; // EXCLUDE (nur Anzeige)
  conflict: boolean; // WATCH und MUTE gleichzeitig
}

export interface ProcessedObservation {
  observation: Observation;
  classification: Classification;
  rules: RuleOutcome;
  alertLevel: AlertLevel;
}
