// Wandelt die IEEE-Registry-CSVs (MA-L, MA-M, MA-S) in ein kompaktes JSON um.
// Aufruf: node scripts/build-oui.mjs <ma-l.csv> <ma-m.csv> <ma-s.csv> [YYYY-MM-DD]
// Quellen (öffentliche IEEE Registration Authority):
//   https://standards-oui.ieee.org/oui/oui.csv        (MA-L, 24 Bit)
//   https://standards-oui.ieee.org/oui28/mam.csv      (MA-M, 28 Bit)
//   https://standards-oui.ieee.org/oui36/oui36.csv    (MA-S, 36 Bit)
// Die Eingaben gelten als Daten und werden nur geparst, nie ausgeführt.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [lPath, mPath, sPath, retrieved = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
if (!lPath || !mPath || !sPath) {
  console.error("Aufruf: node scripts/build-oui.mjs <ma-l.csv> <ma-m.csv> <ma-s.csv> [YYYY-MM-DD]");
  process.exit(2);
}

/** Minimaler RFC-4180-CSV-Parser (Anführungszeichen, Komma, mehrzeilige Felder). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const orgs = [];
const orgIndex = new Map();
const entries = [];
const counts = {};

function load(path, registry, hexLen) {
  const rows = parseCsv(readFileSync(path, "utf8").replace(/^﻿/, ""));
  let n = 0;
  for (const r of rows.slice(1)) {
    const [reg, prefix, name] = r;
    if (reg !== registry || !/^[0-9A-F]+$/i.test(prefix ?? "") || prefix.length !== hexLen) continue;
    const org = (name ?? "").replace(/\s+/g, " ").trim();
    if (!org) continue;
    let idx = orgIndex.get(org);
    if (idx === undefined) {
      idx = orgs.push(org) - 1;
      orgIndex.set(org, idx);
    }
    entries.push([prefix.toUpperCase(), idx]);
    n++;
  }
  counts[registry] = n;
}

load(lPath, "MA-L", 6);
load(mPath, "MA-M", 7);
load(sPath, "MA-S", 9);

const out = {
  meta: {
    name: "IEEE Registration Authority – MA-L/MA-M/MA-S",
    version: retrieved,
    source: "https://standards-oui.ieee.org/",
    counts,
    note: "Hersteller-Zuordnung eines Adressbereichs, keine Geräteidentifikation.",
  },
  orgs,
  entries,
};

const target = join(dirname(fileURLToPath(import.meta.url)), "..", "oui.json");
writeFileSync(target, JSON.stringify(out));
console.log(`geschrieben: ${target}`);
console.log(`Einträge: ${entries.length} (${JSON.stringify(counts)}), Organisationen: ${orgs.length}`);
