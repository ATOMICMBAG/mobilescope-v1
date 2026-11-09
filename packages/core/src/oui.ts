import type { Category } from "./types.js";
import { normalizeMac } from "./address.js";

export interface OuiEntry {
  /** Präfix in Hex, mit oder ohne Doppelpunkte: 24 Bit (MA-L), 28 Bit (MA-M) oder 36 Bit (MA-S). */
  oui: string;
  manufacturer: string;
  categoryHint?: Category;
  familyHint?: string;
}

export interface DatabaseMeta {
  name: string;
  version: string;
  note?: string;
  source?: string;
  counts?: Record<string, number>;
}

/** Kompaktformat aus packages/data/oui.json. */
export interface CompactOui {
  meta: DatabaseMeta;
  orgs: string[];
  entries: [prefix: string, orgIndex: number][];
}

/** Gerätehinweise, die nicht aus der IEEE-Registry stammen, sondern bewusst kuratiert sind. */
export interface OuiHint {
  categoryHint?: Category;
  familyHint?: string;
}

const PREFIX_LENGTHS = [9, 7, 6] as const; // längster Treffer gewinnt (MA-S, MA-M, MA-L)
const PRIVATE_NAME = "private";

export class OuiDatabase {
  private map = new Map<string, OuiEntry>();
  constructor(
    entries: OuiEntry[],
    public readonly meta: DatabaseMeta,
  ) {
    for (const e of entries) this.map.set(e.oui.replace(/:/g, "").toUpperCase(), e);
  }

  static fromCompact(data: CompactOui, hints: Record<string, OuiHint> = {}): OuiDatabase {
    const entries: OuiEntry[] = data.entries.map(([prefix, idx]) => ({
      oui: prefix,
      manufacturer: data.orgs[idx] ?? "",
      ...hints[prefix],
    }));
    return new OuiDatabase(entries, data.meta);
  }

  lookup(mac: string): OuiEntry | undefined {
    const n = normalizeMac(mac);
    if (!n) return undefined;
    const hex = n.replace(/:/g, "");
    for (const len of PREFIX_LENGTHS) {
      const hit = this.map.get(hex.slice(0, len));
      if (hit) return hit;
    }
    return undefined;
  }

  get size(): number {
    return this.map.size;
  }
}

/** IEEE führt nicht öffentlich zugeordnete Bereiche als „Private“. */
export function isPrivateEntry(e: OuiEntry): boolean {
  return e.manufacturer.trim().toLowerCase() === PRIVATE_NAME;
}

/**
 * Kuratierte Hinweise (Kategorie/Familie). Der Hersteller selbst kommt aus der IEEE-Registry.
 * Ein Hinweis ist eine Möglichkeit, keine Identifikation.
 */
export const OUI_HINTS: Record<string, OuiHint> = {
  "003044": { categoryHint: "NETWORK_EQUIPMENT", familyHint: "Mobilfunkrouter (mögliche Produktfamilie)" },
  B827EB: { categoryHint: "SINGLE_BOARD_COMPUTER" },
  DCA632: { categoryHint: "SINGLE_BOARD_COMPUTER" },
  E45F01: { categoryHint: "SINGLE_BOARD_COMPUTER" },
  "005056": { categoryHint: "VIRTUAL_MACHINE" },
  "000C29": { categoryHint: "VIRTUAL_MACHINE" },
  "000569": { categoryHint: "VIRTUAL_MACHINE" },
  "08B657": { categoryHint: "NETWORK_EQUIPMENT", familyHint: "Router/Access Point (mögliche Produktfamilie)" },
  "04B4FE": { categoryHint: "NETWORK_EQUIPMENT", familyHint: "Router/Access Point (mögliche Produktfamilie)" },
};

/**
 * Mini-Seed für Tests und als Rückfall, solange die vollständige Registry noch lädt.
 * KEINE vollständige IEEE-Datenbank.
 */
export const SEED_OUI: OuiEntry[] = [
  { oui: "003044", manufacturer: "Cradlepoint, Inc.", ...OUI_HINTS["003044"] },
  { oui: "000393", manufacturer: "Apple, Inc.", categoryHint: "UNKNOWN" },
  { oui: "B827EB", manufacturer: "Raspberry Pi Foundation", ...OUI_HINTS["B827EB"] },
  { oui: "DCA632", manufacturer: "Raspberry Pi Trading Ltd", ...OUI_HINTS["DCA632"] },
  { oui: "005056", manufacturer: "VMware, Inc.", ...OUI_HINTS["005056"] },
];

export const SEED_OUI_DB = new OuiDatabase(SEED_OUI, {
  name: "mobilescope seed sample",
  version: "seed-0.1",
  note: "Nur Beispielbestand, nicht die IEEE-Registry",
});

/** Auszug der Bluetooth-SIG Company Identifiers (Seed). */
export const SEED_BLE_COMPANIES: Record<number, string> = {
  0x0006: "Microsoft",
  0x0008: "Motorola",
  0x004c: "Apple, Inc.",
  0x0075: "Samsung Electronics Co. Ltd.",
  0x00e0: "Google",
};
