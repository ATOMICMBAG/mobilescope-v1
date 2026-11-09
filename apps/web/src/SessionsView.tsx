import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseSessionJson,
  rssiAvg,
  summarize,
  type EntityRecord,
  type ProcessedObservation,
  type Session,
} from "@mobilescope/core";
import { EvidenceDialog } from "./EvidenceDialog";
import { ExportDialog } from "./ExportDialog";
import {
  deleteSession,
  listSessions,
  loadSession,
  renameSession,
  saveSession,
  type SessionListItem,
} from "./storage/sessionStore";

const IDENTITY_LABEL = { KNOWN: "Bekannt", PROBABLE: "Wahrscheinlich", UNKNOWN: "Unbekannt" } as const;
const CATEGORY_LABEL: Record<string, string> = {
  NETWORK_EQUIPMENT: "Netzwerkhardware",
  SMARTPHONE: "Smartphone",
  COMPUTER: "Computer",
  SINGLE_BOARD_COMPUTER: "Einplatinenrechner",
  VIRTUAL_MACHINE: "Virtuelle Maschine",
  IOT: "IoT",
  UNKNOWN: "—",
};

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("de-DE");

function duration(a: string, b?: string): string {
  if (!b) return "läuft oder unvollständig beendet";
  const s = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000));
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : m > 0 ? `${m} min ${s % 60} s` : `${s} s`;
}

export function SessionsView({ refreshKey }: { refreshKey: unknown }) {
  const [items, setItems] = useState<SessionListItem[] | null>(null);
  const [open, setOpen] = useState<Session | null>(null);
  const [exporting, setExporting] = useState<Session | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await listSessions());
    } catch (e) {
      setItems([]);
      setMessage({ kind: "error", text: `Speicher nicht lesbar: ${errText(e)}` });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  async function openSession(id: string) {
    const s = await loadSession(id);
    if (s) setOpen(s);
    else setMessage({ kind: "error", text: "Session nicht gefunden." });
  }

  async function startExport(id: string) {
    const s = await loadSession(id);
    if (s) setExporting(s);
  }

  async function remove(item: SessionListItem) {
    if (!window.confirm(`„${item.meta.name}“ endgültig löschen?`)) return;
    await deleteSession(item.meta.id);
    setMessage({ kind: "ok", text: "Session gelöscht." });
    await refresh();
  }

  async function rename(item: SessionListItem) {
    const name = window.prompt("Name der Session", item.meta.name);
    if (name === null) return;
    await renameSession(item.meta.id, name);
    await refresh();
  }

  async function importFile(file: File) {
    try {
      const session = parseSessionJson(await file.text());
      const existing = (await listSessions()).some((i) => i.meta.id === session.meta.id);
      if (existing) {
        session.meta = {
          ...session.meta,
          id: `${session.meta.id}_import_${Date.now().toString(36)}`,
          name: `${session.meta.name} (Import)`,
        };
      }
      await saveSession(session);
      setMessage({ kind: "ok", text: `„${session.meta.name}“ importiert.` });
      await refresh();
    } catch (e) {
      setMessage({ kind: "error", text: `Import fehlgeschlagen: ${errText(e)}` });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (open) {
    return (
      <>
        <SessionDetail session={open} onBack={() => setOpen(null)} onExport={() => setExporting(open)} />
        {exporting && <ExportDialog session={exporting} onClose={() => setExporting(null)} />}
      </>
    );
  }

  return (
    <section className="panel" aria-label="Sessions">
      <div className="panel-head">
        <h2>Gespeicherte Sessions</h2>
        <div className="filters">
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])}
          />
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Importieren (JSON)
          </button>
        </div>
      </div>

      {message && (
        <div className={`banner ${message.kind === "ok" ? "ok" : "error"}`} role={message.kind === "ok" ? "status" : "alert"}>
          {message.text}
        </div>
      )}

      {items === null && <p className="muted">Lade …</p>}
      {items?.length === 0 && (
        <p className="empty">
          Noch keine Session gespeichert. Starte und stoppe eine Beobachtung, sie wird dann lokal gesichert
          (zusätzlich alle 30 s während der Beobachtung).
        </p>
      )}

      <ul className="session-list">
        {items?.map((item) => (
          <li key={item.meta.id} className="session-card">
            <div className="session-main">
              <strong>{item.meta.name}</strong>
              <span className="small">
                {fmtDateTime(item.meta.startedAt)} · {duration(item.meta.startedAt, item.meta.endedAt)}
                {item.meta.device ? ` · ${item.meta.device}` : ""} · {item.meta.scanner === "mock" ? "Demo" : item.meta.scanner}
              </span>
              <span className="small">
                {item.summary.wifi} WLAN · {item.summary.ble} BLE · {item.summary.unknownIdentity} unbekannt ·{" "}
                {item.summary.observations.toLocaleString("de-DE")} Beobachtungen
              </span>
            </div>
            <div className="session-actions">
              <button className="btn small" onClick={() => void openSession(item.meta.id)}>
                Öffnen
              </button>
              <button className="btn small" onClick={() => void startExport(item.meta.id)}>
                Export
              </button>
              <button className="btn small" onClick={() => void rename(item)} title="Umbenennen">
                ✎
              </button>
              <button className="btn small" onClick={() => void remove(item)} title="Löschen">
                🗑
              </button>
            </div>
          </li>
        ))}
      </ul>

      <p className="note">
        Sessions liegen nur lokal in diesem Browser bzw. dieser App. Für Sicherung und Austausch den JSON-Export
        verwenden.
      </p>
      {exporting && <ExportDialog session={exporting} onClose={() => setExporting(null)} />}
    </section>
  );
}

function SessionDetail({
  session,
  onBack,
  onExport,
}: {
  session: Session;
  onBack: () => void;
  onExport: () => void;
}) {
  const [source, setSource] = useState<"ALL" | "WIFI" | "BLE">("ALL");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ProcessedObservation | null>(null);
  const sum = summarize(session);

  const rows = session.entities
    .filter((e) => source === "ALL" || e.source === source)
    .filter((e) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return [e.identifier, e.name, e.classification.manufacturer].some((v) => v?.toLowerCase().includes(q));
    })
    .sort((a, b) => rssiAvg(b) - rssiAvg(a));

  const toProcessed = (e: EntityRecord): ProcessedObservation => ({
    observation: e.last,
    classification: e.classification,
    rules: e.rules,
    alertLevel: e.alertLevel,
  });

  return (
    <section className="panel" aria-label="Session-Details">
      <div className="panel-head">
        <div>
          <h2>{session.meta.name}</h2>
          <p className="small">
            {fmtDateTime(session.meta.startedAt)} · {duration(session.meta.startedAt, session.meta.endedAt)} · App{" "}
            {session.meta.appVersion} · OUI {session.meta.ouiVersion}
          </p>
        </div>
        <div className="filters">
          <button className="btn" onClick={onBack}>
            ← Zurück
          </button>
          <button className="btn primary" onClick={onExport}>
            Export …
          </button>
        </div>
      </div>

      <p className="small">
        {sum.wifi} WLAN · {sum.ble} BLE · {sum.unknownIdentity} unbekannte Identität ·{" "}
        {sum.observations.toLocaleString("de-DE")} Beobachtungen · {sum.events} Ereignisse
      </p>

      <div className="filters">
        <select value={source} onChange={(e) => setSource(e.target.value as typeof source)} aria-label="Quelle">
          <option value="ALL">WLAN + BLE</option>
          <option value="WIFI">Nur WLAN</option>
          <option value="BLE">Nur BLE</option>
        </select>
        <input
          type="search"
          placeholder="Suche: MAC, Name, Hersteller"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Quelle</th>
              <th>Name</th>
              <th>Adresse</th>
              <th>Hersteller</th>
              <th>Kategorie</th>
              <th>Identität</th>
              <th className="num">RSSI min / ∅ / max</th>
              <th>Zeitraum</th>
              <th className="num">Anzahl</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="empty">
                  Keine Signale für diesen Filter.
                </td>
              </tr>
            )}
            {rows.map((e) => (
              <tr key={e.key} className={e.rules.highlight ? "watch" : ""}>
                <td data-label="Quelle" className="c-src">
                  <span className={`tag ${e.source.toLowerCase()}`}>{e.source === "WIFI" ? "WLAN" : "BLE"}</span>
                </td>
                <td data-label="Name" className="c-name">
                  {e.name ?? <span className="muted">(ohne Name)</span>}
                </td>
                <td data-label="Adresse" className="mono c-addr">
                  {e.identifier}
                </td>
                <td data-label="Hersteller">{e.classification.manufacturer ?? <span className="muted">—</span>}</td>
                <td data-label="Kategorie">{CATEGORY_LABEL[e.classification.category]}</td>
                <td data-label="Identität">
                  <span className={`id-state ${e.classification.identityState.toLowerCase()}`}>
                    {IDENTITY_LABEL[e.classification.identityState]}
                  </span>
                </td>
                <td data-label="RSSI" className="num mono">
                  {e.rssiMin} / {Math.round(rssiAvg(e))} / {e.rssiMax} dBm
                </td>
                <td data-label="Zeitraum">
                  {fmtTime(e.firstSeen)} – {fmtTime(e.lastSeen)}
                </td>
                <td data-label="Anzahl" className="num mono">
                  {e.count}
                </td>
                <td className="c-act">
                  <button className="btn small" onClick={() => setSelected(toProcessed(e))}>
                    Warum?
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        RSSI ist keine Entfernungsmessung. Der Zeitraum nennt erste und letzte Beobachtung, nicht Anwesenheit.
      </p>

      {selected && <EvidenceDialog item={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
