import { normalizeMac, ouiOf } from "./address.js";
import type { Classification, Condition, Observation, Rule, RuleOutcome } from "./types.js";

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

export function matchCondition(cond: Condition, obs: Observation, cls: Classification): boolean {
  if ("op" in cond) {
    const results = cond.conditions.map((c) => matchCondition(c, obs, cls));
    return cond.op === "AND" ? results.length > 0 && results.every(Boolean) : results.some(Boolean);
  }
  const mac = normalizeMac(obs.identifier);
  const v = cond.value;
  switch (cond.field) {
    case "MAC_EXACT":
      return mac !== null && mac === normalizeMac(v);
    case "MAC_PREFIX":
      return mac !== null && mac.startsWith(v.toUpperCase().replace(/-/g, ":"));
    case "OUI":
      return ouiOf(obs.identifier) === v.toUpperCase().replace(/-/g, ":");
    case "SSID_EXACT":
      return obs.source === "WIFI" && obs.name === v;
    case "SSID_PATTERN":
      return obs.source === "WIFI" && obs.name !== undefined && wildcardToRegExp(v).test(obs.name);
    case "BLE_NAME":
      return obs.source === "BLE" && obs.name !== undefined && wildcardToRegExp(v).test(obs.name);
    case "CATEGORY":
      return cls.category === v;
    case "MANUFACTURER":
      return cls.manufacturer !== undefined && cls.manufacturer.toLowerCase().includes(v.toLowerCase());
  }
}

/**
 * Regelauswertung.
 * - WATCH hebt hervor, MUTE unterdrückt nur Benachrichtigungen, EXCLUDE blendet nur in der Anzeige aus.
 * - Keine Regel löscht eine Beobachtung.
 * - WATCH + MUTE gleichzeitig: beide gelten, `conflict` wird gesetzt (wird als Event protokolliert).
 */
export function evaluateRules(rules: Rule[], obs: Observation, cls: Classification): RuleOutcome {
  const matched = rules
    .filter((r) => r.active && matchCondition(r.match, obs, cls))
    .sort((a, b) => b.priority - a.priority);
  const has = (t: Rule["type"]) => matched.some((r) => r.type === t);
  const highlight = has("WATCH");
  const muted = has("MUTE");
  return {
    matched,
    highlight,
    notify: !muted,
    hidden: has("EXCLUDE"),
    conflict: highlight && muted,
  };
}
