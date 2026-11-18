import type { IdentityState, Source } from "./types.js";
import { csvText, type CsvDelimiter } from "./export.js";

/** Eine einzelne Beobachtung, reduziert auf das, was das Histogramm braucht. */
export interface HistPoint {
  t: number; // ms seit Epoche
  id: string; // Quelle + Adresse
  source: Source;
  rssi: number;
  identity: IdentityState;
}

export type SplitBy = "RSSI" | "SOURCE" | "IDENTITY";
export type CountBy = "OBSERVATIONS" | "SIGNALS";

export interface HistSeries {
  key: string;
  label: string;
}

export interface HistBucket {
  start: number;
  end: number;
  counts: Record<string, number>;
  total: number;
}

export interface Histogram {
  start: number;
  end: number;
  widthMs: number;
  splitBy: SplitBy;
  countBy: CountBy;
  series: HistSeries[];
  buckets: HistBucket[];
  maxTotal: number;
}

export interface HistogramOptions {
  /** Fensterlänge in ms; `null` = ab der ersten Beobachtung. */
  windowMs: number | null;
  /** Ende des Fensters (ms). */
  end: number;
  split: SplitBy;
  count: CountBy;
  targetBins?: number;
}

/** Klassen für die Signalstärke. Sie beschreiben den Empfang an diesem Gerät, keine Entfernung. */
export const RSSI_STRONG_DBM = -60;
export const RSSI_MEDIUM_DBM = -80;

const SERIES: Record<SplitBy, HistSeries[]> = {
  RSSI: [
    { key: "strong", label: `stark (≥ ${RSSI_STRONG_DBM} dBm)` },
    { key: "medium", label: `mittel (${RSSI_STRONG_DBM} … ${RSSI_MEDIUM_DBM} dBm)` },
    { key: "weak", label: `schwach (< ${RSSI_MEDIUM_DBM} dBm)` },
  ],
  SOURCE: [
    { key: "WIFI", label: "WLAN" },
    { key: "BLE", label: "BLE" },
  ],
  IDENTITY: [
    { key: "KNOWN", label: "Bekannt" },
    { key: "PROBABLE", label: "Wahrscheinlich" },
    { key: "UNKNOWN", label: "Unbekannt" },
  ],
};

const NICE_STEPS_S = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];

export function niceWidthMs(windowMs: number, targetBins: number): number {
  const wanted = windowMs / 1000 / targetBins;
  const step = NICE_STEPS_S.find((s) => s >= wanted) ?? NICE_STEPS_S[NICE_STEPS_S.length - 1]!;
  return step * 1000;
}

function seriesKey(split: SplitBy, p: Pick<HistPoint, "rssi" | "source" | "identity">): string {
  if (split === "SOURCE") return p.source;
  if (split === "IDENTITY") return p.identity;
  return p.rssi >= RSSI_STRONG_DBM ? "strong" : p.rssi >= RSSI_MEDIUM_DBM ? "medium" : "weak";
}

export function buildHistogram(points: readonly HistPoint[], o: HistogramOptions): Histogram {
  const targetBins = o.targetBins ?? 60;
  const first = points.length ? Math.min(...points.map((p) => p.t)) : o.end - 60_000;
  const windowStart = o.windowMs === null ? Math.min(first, o.end - 1000) : o.end - o.windowMs;
  const widthMs = niceWidthMs(Math.max(1000, o.end - windowStart), targetBins);

  const first0 = Math.floor(windowStart / widthMs) * widthMs;
  const count = Math.max(1, Math.ceil((o.end - first0) / widthMs));
  const series = SERIES[o.split];

  const buckets: HistBucket[] = Array.from({ length: count }, (_, i) => ({
    start: first0 + i * widthMs,
    end: first0 + (i + 1) * widthMs,
    counts: Object.fromEntries(series.map((s) => [s.key, 0])),
    total: 0,
  }));

  // Für „Signale“: je Bucket jedes Signal einmal, mit seinem stärksten Empfang im Bucket.
  const best: Map<string, HistPoint>[] = o.count === "SIGNALS" ? buckets.map(() => new Map()) : [];

  for (const p of points) {
    if (p.t < first0 || p.t >= first0 + count * widthMs) continue;
    const i = Math.floor((p.t - first0) / widthMs);
    if (o.count === "OBSERVATIONS") {
      const b = buckets[i]!;
      b.counts[seriesKey(o.split, p)]!++;
      b.total++;
    } else {
      const m = best[i]!;
      const prev = m.get(p.id);
      if (!prev || p.rssi > prev.rssi) m.set(p.id, p);
    }
  }
  if (o.count === "SIGNALS") {
    best.forEach((m, i) => {
      const b = buckets[i]!;
      for (const p of m.values()) {
        b.counts[seriesKey(o.split, p)]!++;
        b.total++;
      }
    });
  }

  return {
    start: first0,
    end: first0 + count * widthMs,
    widthMs,
    splitBy: o.split,
    countBy: o.count,
    series,
    buckets,
    maxTotal: Math.max(0, ...buckets.map((b) => b.total)),
  };
}

export function formatWidth(widthMs: number): string {
  const s = widthMs / 1000;
  return s < 60 ? `${s} s` : s < 3600 ? `${s / 60} min` : `${s / 3600} h`;
}

/** Datensatz zum Histogramm: eine Zeile je Zeitfenster, eine Spalte je Farbe. */
export function histogramCsv(h: Histogram, delimiter: CsvDelimiter = ";"): string {
  const head = ["bucket_start_utc", "bucket_end_utc", ...h.series.map((s) => csvText(s.label, delimiter)), "total"];
  const rows = h.buckets.map((b) =>
    [
      new Date(b.start).toISOString(),
      new Date(b.end).toISOString(),
      ...h.series.map((s) => String(b.counts[s.key] ?? 0)),
      String(b.total),
    ].join(delimiter),
  );
  return `﻿${[head.join(delimiter), ...rows].join("\r\n")}\r\n`;
}
