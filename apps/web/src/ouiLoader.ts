import { OUI_HINTS, OuiDatabase, type CompactOui } from "@mobilescope/core";
import ouiUrl from "@mobilescope/data/oui.json?url";

/** Lädt die vollständige IEEE-Registry (ca. 1,7 MB) erst nach dem ersten Rendern. */
export async function loadOuiDatabase(): Promise<OuiDatabase> {
  const res = await fetch(ouiUrl);
  if (!res.ok) throw new Error(`OUI-Daten nicht ladbar (HTTP ${res.status})`);
  return OuiDatabase.fromCompact((await res.json()) as CompactOui, OUI_HINTS);
}
