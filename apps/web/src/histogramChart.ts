import { formatWidth, type Histogram, type SplitBy } from "@mobilescope/core";

/** Farben des Diagramms. Das Diagramm hat bewusst den umgekehrten Hell/Dunkel-Modus der App. */
export interface ChartPalette {
  bg: string;
  fg: string;
  muted: string;
  grid: string;
  series: Record<SplitBy, string[]>;
}

const LIGHT_CARD: ChartPalette = {
  bg: "#ffffff",
  fg: "#17202b",
  muted: "#5d6b7c",
  grid: "#d5dbe3",
  series: {
    RSSI: ["#0a8f5b", "#c98200", "#c0303c"],
    SOURCE: ["#1560bd", "#6b3fc9"],
    IDENTITY: ["#0a8f5b", "#c98200", "#5d6b7c"],
  },
};

const DARK_CARD: ChartPalette = {
  bg: "#0d1117",
  fg: "#e6edf3",
  muted: "#8b98a8",
  grid: "#28323f",
  series: {
    RSSI: ["#3ddc97", "#f2b233", "#f0616d"],
    SOURCE: ["#4aa3ff", "#b58cff"],
    IDENTITY: ["#3ddc97", "#f2b233", "#8b98a8"],
  },
};

/** Dunkle App → helles Diagramm, helle App → dunkles Diagramm. */
export const paletteFor = (appTheme: "light" | "dark"): ChartPalette => (appTheme === "dark" ? LIGHT_CARD : DARK_CARD);

export const COUNT_LABEL = { OBSERVATIONS: "Beobachtungen", SIGNALS: "Signale" } as const;
export const SPLIT_LABEL = { RSSI: "Signalstärke", SOURCE: "Quelle", IDENTITY: "Identität" } as const;

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Obergrenze der Y-Achse als Vielfaches von 4, damit alle vier Teilstriche ganze Zahlen sind. */
function niceMax(v: number): number {
  const raw = Math.max(1, Math.ceil(v / 4));
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p * 4;
  return 10 * p * 4;
}

function timeLabel(ms: number, withSeconds: boolean): string {
  return new Date(ms).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
  });
}

export interface ChartOptions {
  width: number;
  height: number;
  palette: ChartPalette;
  /** Für den PNG-Export: Titelzeilen oben und Legende/Hinweis unten. */
  frame?: { title: string; subtitle: string; footer: string };
  /** Skaliert Schrift und Ränder (PNG-Export). */
  scale?: number;
}

export function legendItems(h: Histogram, pal: ChartPalette): { label: string; color: string }[] {
  return h.series.map((s, i) => ({ label: s.label, color: pal.series[h.splitBy][i]! }));
}

export function histogramSvg(h: Histogram, o: ChartOptions): string {
  const { width: W, height: H, palette: pal } = o;
  const k = o.scale ?? 1;
  const fs = 11 * k;
  const top = (o.frame ? 62 : 10) * k;
  const bottom = (o.frame ? 78 : 26) * k;
  const left = 38 * k;
  const right = 10 * k;
  const pw = W - left - right;
  const ph = H - top - bottom;
  const yMax = niceMax(h.maxTotal);
  const y = (v: number) => top + ph - (v / yMax) * ph;
  const n = h.buckets.length;
  const slot = pw / n;
  const gap = slot >= 4 * k ? Math.max(1, slot * 0.12) : 0;

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}" font-size="${fs}" role="img" aria-label="Histogramm der Beobachtungen über die Zeit">`,
    `<rect width="${W}" height="${H}" fill="${pal.bg}"/>`,
  );

  if (o.frame) {
    out.push(
      `<text x="${left}" y="${24 * k}" font-size="${16 * k}" font-weight="700" fill="${pal.fg}">${esc(o.frame.title)}</text>`,
      `<text x="${left}" y="${44 * k}" fill="${pal.muted}">${esc(o.frame.subtitle)}</text>`,
    );
  }

  // Y-Achse
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = (yMax / ticks) * i;
    const yy = y(v);
    out.push(
      `<line x1="${left}" x2="${W - right}" y1="${yy}" y2="${yy}" stroke="${pal.grid}" stroke-width="${k}"/>`,
      `<text x="${left - 6 * k}" y="${yy + fs * 0.35}" text-anchor="end" fill="${pal.muted}">${Number.isInteger(v) ? v : v.toFixed(1)}</text>`,
    );
  }

  // Balken (gestapelt, Reihenfolge = Legende)
  h.buckets.forEach((b, i) => {
    let acc = 0;
    h.series.forEach((s, si) => {
      const c = b.counts[s.key] ?? 0;
      if (c === 0) return;
      const y1 = y(acc + c);
      const y0 = y(acc);
      acc += c;
      out.push(
        `<rect x="${(left + i * slot + gap / 2).toFixed(2)}" y="${y1.toFixed(2)}" width="${Math.max(0.5, slot - gap).toFixed(2)}" height="${Math.max(0.5, y0 - y1).toFixed(2)}" fill="${pal.series[h.splitBy][si]}"/>`,
      );
    });
  });

  // X-Achse: etwa 5 bis 6 Marken auf Bucket-Grenzen
  const withSeconds = h.widthMs < 60_000;
  const labelEvery = Math.max(1, Math.ceil(n / (pw / ((withSeconds ? 88 : 66) * k))));
  for (let i = 0; i <= n; i += labelEvery) {
    const xx = left + i * slot;
    const t = h.start + i * h.widthMs;
    out.push(
      `<line x1="${xx}" x2="${xx}" y1="${top + ph}" y2="${top + ph + 4 * k}" stroke="${pal.muted}" stroke-width="${k}"/>`,
      `<text x="${xx}" y="${top + ph + 16 * k}" text-anchor="${i === 0 ? "start" : i + labelEvery > n ? "end" : "middle"}" fill="${pal.muted}">${timeLabel(t, withSeconds)}</text>`,
    );
  }

  if (h.maxTotal === 0) {
    out.push(
      `<text x="${left + pw / 2}" y="${top + ph / 2}" text-anchor="middle" fill="${pal.muted}">Keine Daten in diesem Zeitfenster</text>`,
    );
  }

  if (o.frame) {
    let x = left;
    const ly = H - 32 * k;
    for (const item of legendItems(h, pal)) {
      out.push(
        `<rect x="${x}" y="${ly - 9 * k}" width="${10 * k}" height="${10 * k}" fill="${item.color}"/>`,
        `<text x="${x + 15 * k}" y="${ly}" fill="${pal.fg}">${esc(item.label)}</text>`,
      );
      x += (15 + 8 + item.label.length * 6.4) * k;
    }
    out.push(`<text x="${left}" y="${H - 10 * k}" fill="${pal.muted}">${esc(o.frame.footer)}</text>`);
  }

  out.push("</svg>");
  return out.join("");
}

export function describeHistogram(h: Histogram, windowLabel: string): string {
  return `Fenster: ${windowLabel} · Zeitfenster je Balken: ${formatWidth(h.widthMs)} · Zählung: ${COUNT_LABEL[h.countBy]} · Aufteilung: ${SPLIT_LABEL[h.splitBy]}`;
}

/** Rendert das SVG in ein PNG (zweifache Auflösung). */
export async function svgToPng(svg: string, width: number, height: number, pixelRatio = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Diagramm konnte nicht gerendert werden."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas nicht verfügbar.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG konnte nicht erzeugt werden."))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
