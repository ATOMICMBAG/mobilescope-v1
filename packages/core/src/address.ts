import type { AddressType, Observation } from "./types.js";

const MAC_RE = /^[0-9a-f]{2}([:-]?)[0-9a-f]{2}(?:\1[0-9a-f]{2}){4}$/i;

export function normalizeMac(input: string): string | null {
  const s = input.trim();
  if (!MAC_RE.test(s)) return null;
  const hex = s.replace(/[:-]/g, "").toUpperCase();
  return hex.match(/.{2}/g)!.join(":");
}

export function ouiOf(mac: string): string | null {
  const n = normalizeMac(mac);
  return n ? n.slice(0, 8) : null;
}

/**
 * Bestimmt den Adresstyp. OUI-Zuordnung ist nur bei universell administrierten
 * Adressen (Bit 1 des ersten Bytes = 0) sinnvoll.
 * Bei BLE lässt sich der Typ allein aus der Adresse nicht sicher ableiten;
 * ohne Hinweis des Scanners bleibt er UNKNOWN.
 */
export function detectAddressType(
  obs: Pick<Observation, "source" | "identifier" | "addressTypeHint">,
): AddressType {
  const mac = normalizeMac(obs.identifier);
  if (!mac) return "UNKNOWN";
  if (obs.addressTypeHint) return obs.addressTypeHint;
  const first = parseInt(mac.slice(0, 2), 16);
  const locallyAdministered = (first & 0b10) !== 0;
  if (obs.source === "WIFI") return locallyAdministered ? "LOCALLY_ADMINISTERED" : "PUBLIC";
  return "UNKNOWN";
}

export function isUniversal(type: AddressType): boolean {
  return type === "PUBLIC";
}
