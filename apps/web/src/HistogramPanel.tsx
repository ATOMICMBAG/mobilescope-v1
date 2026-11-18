import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildHistogram,
  histogramCsv,
  type CountBy,
  type HistPoint,
  type SplitBy,
} from "@mobilescope/core";
import {
  COUNT_LABEL,
  SPLIT_LABEL,
  describeHistogram,
  histogramSvg,
  legendItems,
  paletteFor,
  svgToPng,
} from "./histogramChart";
import { deliverBlob, safeFilename } from "./storage/fileOut";

const WINDOWS = [
  { key: "1", label: "1 min", ms: 60_000 },
  { key: "5", label: "5 min", ms: 5 * 60_000 },
  { key: "15", label: "15 min", ms: 15 * 60_000 },
  { key: "30", label: "30 min", ms: 30 * 60_000 },
  { key: "60", label: "60 min", ms: 60 * 60_000 },
  { key: "all", label: "Alles", ms: null },
] as const;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(el);
    setWidth(Math.max(240, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function HistogramPanel({
  history,
  observationCount,
  running,
  now,
  theme,
  sessionId,
}: {
  history: HistPoint[];
  observationCount: number;
  running: boolean;
  now: number;
  theme: "light" | "dark";
  sessionId: string;
}) {
  const [windowKey, setWindowKey] = useState<(typeof WINDOWS)[number]["key"]>("5");
  const [split, setSplit] = useState<SplitBy>("RSSI");
  const [count, setCount] = useState<CountBy>("SIGNALS");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [boxRef, width] = useWidth<HTMLDivElement>();

  const win = WINDOWS.find((w) => w.key === windowKey)!;
  // Läuft die Beobachtung nicht, bleibt das Fenster am letzten Messpunkt stehen.
  const lastT = history.length ? history[history.length - 1]!.t : now;
  const end = running ? now : lastT;

  const hist = useMemo(
    () => buildHistogram(history, { windowMs: win.ms, end, split, count }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history, observationCount, win.ms, end, split, count],
  );

  const pal = paletteFor(theme);
  const svg = useMemo(
    () => histogramSvg(hist, { width, height: width < 480 ? 190 : 230, palette: pal }),
    [hist, width, pal],
  );

  const base = `mobilescope_signalverlauf_${safeFilename(sessionId)}_${win.key === "all" ? "alles" : `${win.key}min`}`;

  async function savePng() {
    setBusy(true);
    setMsg(null);
    try {
      const W = 1000;
      const H = 460;
      const frameSvg = histogramSvg(hist, {
        width: W,
        height: H,
        palette: pal,
        scale: 1.15,
        frame: {
          title: "mobilescope | maazi.de – Signalverlauf",
          subtitle: describeHistogram(hist, win.label),
          footer: `Session ${sessionId} · erstellt ${new Date().toLocaleString("de-DE")} · RSSI ist keine Entfernungsmessung`,
        },
      });
      const how = await deliverBlob(`${base}.png`, await svgToPng(frameSvg, W, H), "Diagramm teilen");
      setMsg({ kind: "ok", text: how === "share" ? "Bild bereitgestellt – im Teilen-Menü Ziel wählen." : "Bild heruntergeladen." });
    } catch (e) {
      report(e, setMsg);
    } finally {
      setBusy(false);
    }
  }

  async function saveCsv() {
    setBusy(true);
    setMsg(null);
    try {
      const how = await deliverBlob(
        `${base}.csv`,
        new Blob([histogramCsv(hist)], { type: "text/csv;charset=utf-8" }),
        "Datensatz teilen",
      );
      setMsg({ kind: "ok", text: how === "share" ? "Datensatz bereitgestellt – im Teilen-Menü Ziel wählen." : "Datensatz heruntergeladen." });
    } catch (e) {
      report(e, setMsg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel histogram" aria-label="Signalverlauf">
      <div className="panel-head">
        <h2>Signalverlauf</h2>
        <div className="filters">
          <select value={windowKey} onChange={(e) => setWindowKey(e.target.value as typeof windowKey)} aria-label="Zeitfenster">
            {WINDOWS.map((w) => (
              <option key={w.key} value={w.key}>
                {w.key === "all" ? "Ganze Session" : `Letzte ${w.label}`}
              </option>
            ))}
          </select>
          <select value={count} onChange={(e) => setCount(e.target.value as CountBy)} aria-label="Zählung">
            <option value="SIGNALS">Zählung: Signale</option>
            <option value="OBSERVATIONS">Zählung: Beobachtungen</option>
          </select>
          <select value={split} onChange={(e) => setSplit(e.target.value as SplitBy)} aria-label="Farbaufteilung">
            <option value="RSSI">Farben: Signalstärke</option>
            <option value="SOURCE">Farben: Quelle</option>
            <option value="IDENTITY">Farben: Identität</option>
          </select>
        </div>
      </div>

      <div className="chart-card" ref={boxRef} style={{ background: pal.bg, color: pal.fg }}>
        <div dangerouslySetInnerHTML={{ __html: svg }} />
        <ul className="chart-legend" style={{ color: pal.fg }}>
          {legendItems(hist, pal).map((l) => (
            <li key={l.label}>
              <span className="swatch" style={{ background: l.color }} />
              {l.label}
            </li>
          ))}
        </ul>
      </div>

      <div className="chart-foot">
        <p className="small">
          {COUNT_LABEL[count]} je {hist.widthMs >= 60_000 ? `${hist.widthMs / 60_000} min` : `${hist.widthMs / 1000} s`}-Zeitfenster
          {count === "SIGNALS" ? " (jedes Signal einmal je Zeitfenster, mit dem stärksten Empfang)" : ""}. Signalstärke ist keine
          Entfernungsmessung.
        </p>
        <div className="filters">
          <button className="btn small" onClick={() => void savePng()} disabled={busy}>
            Bild (PNG)
          </button>
          <button className="btn small" onClick={() => void saveCsv()} disabled={busy || hist.maxTotal === 0}>
            Datensatz (CSV)
          </button>
        </div>
      </div>
      {msg && (
        <div className={`banner ${msg.kind === "ok" ? "ok" : "error"}`} role={msg.kind === "ok" ? "status" : "alert"}>
          {msg.text}
        </div>
      )}
    </section>
  );
}

function report(e: unknown, set: (m: { kind: "error"; text: string }) => void) {
  const text = e instanceof Error ? e.message : String(e);
  // Abbrechen des Teilen-Menüs ist kein Fehler.
  if (!/cancel/i.test(text)) set({ kind: "error", text: `Export fehlgeschlagen: ${text}` });
}
