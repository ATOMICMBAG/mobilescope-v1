import { describe, expect, it } from "vitest";
import { buildHistogram, histogramCsv, niceWidthMs, type HistPoint } from "../src/index.js";

const T0 = Date.UTC(2026, 10, 1, 8, 0, 0);
const pt = (s: number, id: string, rssi: number, source: "WIFI" | "BLE" = "BLE"): HistPoint => ({
  t: T0 + s * 1000,
  id,
  source,
  rssi,
  identity: "UNKNOWN",
});

describe("histogram", () => {
  it("wählt eine runde Bucket-Breite", () => {
    expect(niceWidthMs(60_000, 60)).toBe(1000);
    expect(niceWidthMs(5 * 60_000, 60)).toBe(5000);
    expect(niceWidthMs(60 * 60_000, 60)).toBe(60_000);
  });

  it("teilt Beobachtungen nach Signalstärke auf Farben auf", () => {
    const h = buildHistogram([pt(1, "a", -50), pt(2, "b", -70), pt(3, "c", -90)], {
      windowMs: 60_000,
      end: T0 + 10_000,
      split: "RSSI",
      count: "OBSERVATIONS",
    });
    const sum = (k: string) => h.buckets.reduce((n, b) => n + (b.counts[k] ?? 0), 0);
    expect([sum("strong"), sum("medium"), sum("weak")]).toEqual([1, 1, 1]);
    expect(h.buckets.reduce((n, b) => n + b.total, 0)).toBe(3);
  });

  it("zählt Signale je Bucket nur einmal, mit dem stärksten Empfang", () => {
    const h = buildHistogram([pt(1, "a", -90), pt(1.2, "a", -50), pt(1.4, "a", -70)], {
      windowMs: 10_000,
      end: T0 + 9_000,
      split: "RSSI",
      count: "SIGNALS",
      targetBins: 1,
    });
    expect(h.buckets.reduce((n, b) => n + b.total, 0)).toBe(1);
    expect(h.buckets.reduce((n, b) => n + (b.counts.strong ?? 0), 0)).toBe(1);
  });

  it("ignoriert Punkte außerhalb des Fensters und deckt den Zeitraum lückenlos ab", () => {
    const h = buildHistogram([pt(-500, "old", -50), pt(5, "in", -50)], {
      windowMs: 30_000,
      end: T0 + 30_000,
      split: "SOURCE",
      count: "OBSERVATIONS",
    });
    expect(h.buckets.reduce((n, b) => n + b.total, 0)).toBe(1);
    for (let i = 1; i < h.buckets.length; i++) expect(h.buckets[i]!.start).toBe(h.buckets[i - 1]!.end);
  });

  it("liefert auch ohne Daten ein leeres Histogramm", () => {
    const h = buildHistogram([], { windowMs: null, end: T0, split: "IDENTITY", count: "SIGNALS" });
    expect(h.buckets.length).toBeGreaterThan(0);
    expect(h.maxTotal).toBe(0);
  });

  it("exportiert CSV mit BOM, Kopfzeile und Gesamtspalte", () => {
    const h = buildHistogram([pt(1, "a", -50)], { windowMs: 10_000, end: T0 + 9_000, split: "SOURCE", count: "OBSERVATIONS" });
    const csv = histogramCsv(h);
    expect(csv.startsWith("﻿bucket_start_utc;bucket_end_utc;WLAN;BLE;total")).toBe(true);
    expect(csv.trim().split("\r\n").length).toBe(h.buckets.length + 1);
  });
});
