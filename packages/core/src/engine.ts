import { classify, type ClassifyContext } from "./classify.js";
import { evaluateRules } from "./rules.js";
import type { AlertLevel, MsEvent, Observation, ProcessedObservation, Rule } from "./types.js";

export interface EngineState {
  /** Letzter Stand je Quelle+Identifier. */
  latest: Map<string, ProcessedObservation>;
  events: MsEvent[];
}

export function createState(): EngineState {
  return { latest: new Map(), events: [] };
}

const RSSI_SHIFT_DB = 15;

export function keyOf(o: Observation): string {
  return `${o.source}:${o.identifier.toUpperCase()}`;
}

/**
 * Verarbeitet eine Observation: klassifizieren, Regeln auswerten, Ereignisse erzeugen.
 * Reine Funktion bis auf die übergebene State-Struktur; keine Plattform-APIs.
 */
export function processObservation(
  state: EngineState,
  obs: Observation,
  rules: Rule[],
  ctx: ClassifyContext,
): ProcessedObservation {
  const classification = classify(obs, ctx);
  const outcome = evaluateRules(rules, obs, classification);
  const key = keyOf(obs);
  const prev = state.latest.get(key);
  const ev = (type: MsEvent["type"], message: string) =>
    state.events.push({ ts: obs.ts, type, identifier: obs.identifier, message });
  const label = obs.name ? `${obs.name} (${obs.identifier})` : obs.identifier;

  if (!prev) {
    ev("NEW_SIGNAL", `Neues ${obs.source}-Signal: ${label}`);
  } else {
    if (Math.abs(prev.observation.rssi - obs.rssi) >= RSSI_SHIFT_DB) {
      ev("RSSI_SHIFT", `Signalstärke ${prev.observation.rssi} → ${obs.rssi} dBm: ${label}`);
    }
    if (prev.classification.manufacturer !== classification.manufacturer) {
      ev("CLASSIFICATION_UPDATED", `Herstellerzuordnung geändert: ${label}`);
    }
  }
  if (outcome.highlight && outcome.notify && !prev?.rules.highlight) {
    ev("WATCH_TRIGGERED", `Watch-Regel „${outcome.matched.find((r) => r.type === "WATCH")!.name}“: ${label}`);
  }
  if (!outcome.notify && !prev?.rules.matched.length) {
    ev("MUTE_APPLIED", `Benachrichtigung unterdrückt (Mute): ${label}`);
  }
  if (outcome.conflict && !prev?.rules.conflict) {
    ev("RULE_CONFLICT_RESOLVED", `Watch und Mute treffen zu: Hervorhebung bleibt, Benachrichtigung unterdrückt: ${label}`);
  }

  const alertLevel: AlertLevel = outcome.highlight ? "WATCH" : classification.identityState === "UNKNOWN" ? "NORMAL" : "INFORMATIONAL";
  const processed: ProcessedObservation = { observation: obs, classification, rules: outcome, alertLevel };
  state.latest.set(key, processed);
  return processed;
}
