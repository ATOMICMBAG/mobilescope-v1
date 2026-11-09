import { detectAddressType, isUniversal } from "./address.js";
import { SEED_BLE_COMPANIES, isPrivateEntry, type OuiDatabase } from "./oui.js";
import type { Classification, Confidence, Evidence, IdentityState, Observation } from "./types.js";

export interface ClassifyContext {
  oui: OuiDatabase;
}

const BLE_SOURCE = { name: "Bluetooth SIG Company Identifiers (Seed)", version: "seed-0.1" };

/**
 * Pipeline: Adresstyp → OUI / Company-ID → Evidence.
 * Grundsatz: Hersteller ≠ Gerät ≠ Funktion. Aus Herstellerzuordnung allein folgt
 * keine Alarmberechtigung.
 */
export function classify(obs: Observation, ctx: ClassifyContext): Classification {
  const addressType = detectAddressType(obs);
  const evidence: Evidence[] = [];
  let manufacturer: string | undefined;
  let category: Classification["category"] = "UNKNOWN";
  let family: string | undefined;
  let identityState: IdentityState = "UNKNOWN";
  let confidence: Confidence = "LOW";

  const addrLimit =
    addressType === "LOCALLY_ADMINISTERED" || addressType.startsWith("RANDOM")
      ? "Adresse ist lokal administriert bzw. zufällig; eine OUI-Zuordnung ist nicht aussagekräftig."
      : addressType === "UNKNOWN"
        ? "Adresstyp unbekannt; eine OUI-Zuordnung ist unsicher."
        : null;

  evidence.push({
    matchType: "ADDRESS_TYPE",
    claim: {},
    identityState: "UNKNOWN",
    confidence: "HIGH",
    source: { name: "IEEE 802 Adressstruktur", version: "n/a" },
    limitations: addrLimit ? [addrLimit] : ["Der Adresstyp ist ein Merkmal der Adresse, keine Geräteidentifikation."],
    alertEligible: false,
    reason: `Adresstyp: ${addressType}`,
  });

  if (isUniversal(addressType)) {
    const hit = ctx.oui.lookup(obs.identifier);
    if (hit && isPrivateEntry(hit)) {
      evidence.push({
        matchType: "OUI",
        claim: {},
        identityState: "UNKNOWN",
        confidence: "LOW",
        source: { name: ctx.oui.meta.name, version: ctx.oui.meta.version },
        limitations: ["Der Adressbereich ist bei der IEEE als „Private“ eingetragen; der Hersteller ist nicht öffentlich."],
        alertEligible: false,
        reason: "Privater OUI-Eintrag, keine Herstellerzuordnung möglich.",
      });
    } else if (hit) {
      manufacturer = hit.manufacturer;
      category = hit.categoryHint ?? "UNKNOWN";
      family = hit.familyHint;
      identityState = "PROBABLE";
      confidence = "MEDIUM";
      evidence.push({
        matchType: "OUI",
        claim: { manufacturer, category, family },
        identityState,
        confidence,
        source: { name: ctx.oui.meta.name, version: ctx.oui.meta.version },
        limitations: [
          "Der OUI-Treffer belegt nur den zugeordneten Adressbereich, kein konkretes Modell.",
          "Rückschlüsse auf Einsatzzweck oder Betreiber sind nicht zulässig.",
        ],
        alertEligible: false,
        reason: "Hersteller allein reicht für eine Alarmberechtigung nicht aus.",
      });
    } else {
      evidence.push({
        matchType: "OUI",
        claim: {},
        identityState: "UNKNOWN",
        confidence: "LOW",
        source: { name: ctx.oui.meta.name, version: ctx.oui.meta.version },
        limitations: ["Kein Eintrag im verwendeten OUI-Bestand."],
        alertEligible: false,
        reason: "OUI nicht gefunden.",
      });
    }
  }

  if (obs.source === "BLE" && obs.bleCompanyId !== undefined) {
    const company = SEED_BLE_COMPANIES[obs.bleCompanyId];
    if (company) {
      if (!manufacturer) {
        manufacturer = company;
        identityState = "PROBABLE";
        confidence = "LOW";
      }
      evidence.push({
        matchType: "BLE_COMPANY_ID",
        claim: { manufacturer: company },
        identityState: "PROBABLE",
        confidence: "LOW",
        source: BLE_SOURCE,
        limitations: [
          "Die Company-ID im Advertising kann vom Chip-/Stack-Hersteller statt vom Gerätehersteller stammen.",
          "Sie kann von beliebigen Sendern gesetzt werden.",
        ],
        alertEligible: false,
        reason: "Herstellerhinweis aus Advertising-Daten.",
      });
    }
  }

  return { addressType, identityState, confidence, manufacturer, category, family, evidence };
}
