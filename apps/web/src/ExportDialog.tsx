import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_EXPORT,
  sessionToCsv,
  sessionToJson,
  type CsvDelimiter,
  type ExportOptions,
  type Session,
} from "@mobilescope/core";
import { deliverFile, safeFilename } from "./storage/fileOut";

type Format = "csv" | "json";

export function ExportDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [format, setFormat] = useState<Format>("csv");
  const [opts, setOpts] = useState<ExportOptions>(DEFAULT_EXPORT);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const stamp = session.meta.startedAt.slice(0, 16).replace(/[-:T]/g, "");
      const base = `${safeFilename(session.meta.name)}_${stamp}`;
      const how =
        format === "csv" ?
          await deliverFile(`${base}.csv`, "text/csv", sessionToCsv(session, opts))
        : await deliverFile(`${base}.json`, "application/json", sessionToJson(session, opts));
      setResult(how === "share" ? "Datei bereitgestellt – im Teilen-Menü Ziel wählen." : "Datei heruntergeladen.");
    } catch (e) {
      // Abbrechen des Teilen-Menüs ist kein Fehler.
      const msg = e instanceof Error ? e.message : String(e);
      if (!/cancel/i.test(msg)) setError(`Export fehlgeschlagen: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="dialog-body">
        <header>
          <h2>Session exportieren</h2>
          <button className="btn small" onClick={onClose} aria-label="Schließen">
            ✕
          </button>
        </header>
        <p className="muted">{session.meta.name}</p>

        <fieldset className="fields">
          <legend>Format</legend>
          <label className="check">
            <input type="radio" name="fmt" checked={format === "csv"} onChange={() => setFormat("csv")} />
            CSV – eine Zeile je Signal (Tabellenkalkulation)
          </label>
          <label className="check">
            <input type="radio" name="fmt" checked={format === "json"} onChange={() => setFormat("json")} />
            JSON – vollständig inkl. Evidenz, Ereignisse und RSSI-Verlauf (wieder importierbar)
          </label>
        </fieldset>

        {format === "csv" && (
          <label className="field">
            Trennzeichen
            <select
              value={opts.delimiter}
              onChange={(e) => setOpts({ ...opts, delimiter: e.target.value as CsvDelimiter })}
            >
              <option value=";">Semikolon (deutsches Excel)</option>
              <option value=",">Komma (international)</option>
            </select>
          </label>
        )}

        <fieldset className="fields">
          <legend>Datenschutz</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={opts.anonymizeAddresses}
              onChange={(e) => setOpts({ ...opts, anonymizeAddresses: e.target.checked })}
            />
            Adressen kürzen (letzte 3 Bytes ausblenden, Hersteller bleibt erkennbar)
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={opts.omitNames}
              onChange={(e) => setOpts({ ...opts, omitNames: e.target.checked })}
            />
            SSID und BLE-Namen weglassen
          </label>
          <p className="small">
            Die Daten enthalten Funkkennungen aus deiner Umgebung. Vor dem Weitergeben an Dritte am besten beide
            Optionen aktivieren.
          </p>
        </fieldset>

        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}
        {result && (
          <div className="banner ok" role="status">
            {result}
          </div>
        )}

        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>
            Schließen
          </button>
          <button className="btn primary" onClick={() => void run()} disabled={busy}>
            {busy ? "Exportiere …" : "Exportieren"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
