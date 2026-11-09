import { useEffect, useState } from "react";
import type { ProcessedObservation } from "@mobilescope/core";
import { useMonitor } from "./useMonitor";
import type { DeviceStatus } from "./scanner";
import { EvidenceDialog } from "./EvidenceDialog";
import { applyTheme, readTheme, type Theme } from "./theme";
import { SessionsView } from "./SessionsView";

const IDENTITY_LABEL = {
  KNOWN: "Bekannt",
  PROBABLE: "Wahrscheinlich",
  UNKNOWN: "Unbekannt",
} as const;
const CATEGORY_LABEL: Record<string, string> = {
  NETWORK_EQUIPMENT: "Netzwerkhardware",
  SMARTPHONE: "Smartphone",
  COMPUTER: "Computer",
  SINGLE_BOARD_COMPUTER: "Einplatinenrechner",
  VIRTUAL_MACHINE: "Virtuelle Maschine",
  IOT: "IoT",
  UNKNOWN: "—",
};

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function App() {
  const m = useMonitor();
  const now = useNow();
  const [source, setSource] = useState<"ALL" | "WIFI" | "BLE">("ALL");
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => applyTheme(theme), [theme]);
  const [selected, setSelected] = useState<ProcessedObservation | null>(null);
  const [view, setView] = useState<"live" | "sessions">("live");

  const visible = m.rows
    .filter((r) => showHidden || !r.rules.hidden)
    .filter((r) => source === "ALL" || r.observation.source === source)
    .filter((r) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      const o = r.observation;
      return [o.identifier, o.name, r.classification.manufacturer].some((v) =>
        v?.toLowerCase().includes(q),
      );
    })
    .sort((a, b) => b.observation.rssi - a.observation.rssi);

  const counts = {
    wifi: m.rows.filter((r) => r.observation.source === "WIFI").length,
    ble: m.rows.filter((r) => r.observation.source === "BLE").length,
    watch: m.rows.filter((r) => r.rules.highlight).length,
    unknown: m.rows.filter((r) => r.classification.identityState === "UNKNOWN")
      .length,
  };

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden>
            ◉
          </span>
          <div>
            <h1>mobilescope | maazi.de</h1>
            <p className="sub">Passive Wireless Environment Intelligence</p>
          </div>
        </div>
        <div className="controls">
          {m.running ?
            <button className="btn danger" onClick={() => void m.stop()}>
              ■ Beobachtung stoppen
            </button>
          : <button className="btn primary" onClick={() => void m.start()}>
              ▶ Beobachtung starten
            </button>
          }
          <button
            className="btn"
            onClick={m.reset}
            disabled={m.running}
            title="Neue Session beginnen"
          >
            Neue Session
          </button>
          <button
            className="btn"
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            aria-pressed={theme === "dark"}
            title="Design wechseln"
          >
            {theme === "light" ? "☾ Dunkel" : "☀ Hell"}
          </button>
        </div>
      </header>

      {m.error && (
        <div className="banner error" role="alert">
          {m.error}
        </div>
      )}
      {m.device && m.scanner.id === "android" && (
        <DeviceHints d={m.device} onRequest={m.requestPermissions} />
      )}

      <nav className="tabs" aria-label="Ansicht">
        <button
          className={`tab ${view === "live" ? "active" : ""}`}
          aria-current={view === "live" ? "page" : undefined}
          onClick={() => setView("live")}
        >
          Live
        </button>
        <button
          className={`tab ${view === "sessions" ? "active" : ""}`}
          aria-current={view === "sessions" ? "page" : undefined}
          onClick={() => setView("sessions")}
        >
          Sessions
        </button>
      </nav>

      {view === "sessions" && <SessionsView refreshKey={m.savedAt} />}

      {view === "live" && (
      <>
      <section className="stats" aria-label="Übersicht">
        <Stat label="WLAN" value={counts.wifi} />
        <Stat label="BLE" value={counts.ble} />
        <Stat label="Watch" value={counts.watch} accent />
        <Stat label="Unbekannte Identität" value={counts.unknown} />
        <Stat label="Beobachtungen" value={m.observationCount} />
      </section>

      <main className="layout">
        <section className="panel grow" aria-label="Live Monitor">
          <div className="panel-head">
            <h2>Live Monitor</h2>
            <div className="filters">
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as typeof source)}
                aria-label="Quelle"
              >
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
              <label className="check">
                <input
                  type="checkbox"
                  checked={showHidden}
                  onChange={(e) => setShowHidden(e.target.checked)}
                />
                Exclude-Treffer zeigen
              </label>
            </div>
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
                  <th className="num">RSSI</th>
                  <th>Zuletzt</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={9} className="empty">
                      {m.rows.length === 0 ?
                        "Noch keine Beobachtung. Starte die Beobachtung."
                      : "Keine Treffer für diesen Filter."}
                    </td>
                  </tr>
                )}
                {visible.map((r) => {
                  const o = r.observation;
                  const age = now - new Date(o.ts).getTime();
                  const stale = age > m.scanner.staleAfterMs[o.source];
                  return (
                    <tr
                      key={`${o.source}:${o.identifier}`}
                      className={[
                        r.rules.highlight ? "watch" : "",
                        stale ? "stale" : "",
                        r.rules.hidden ? "excluded" : "",
                      ].join(" ")}
                    >
                      <td data-label="Quelle" className="c-src">
                        <span className={`tag ${o.source.toLowerCase()}`}>
                          {o.source === "WIFI" ? "WLAN" : "BLE"}
                        </span>
                      </td>
                      <td data-label="Name" className="c-name">
                        {o.name ?? <span className="muted">(ohne Name)</span>}
                      </td>
                      <td data-label="Adresse" className="mono c-addr">
                        {o.identifier}
                      </td>
                      <td data-label="Hersteller">
                        {r.classification.manufacturer ?? (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td data-label="Kategorie">
                        {CATEGORY_LABEL[r.classification.category]}
                      </td>
                      <td data-label="Identität">
                        <span
                          className={`id-state ${r.classification.identityState.toLowerCase()}`}
                        >
                          {IDENTITY_LABEL[r.classification.identityState]}
                        </span>
                      </td>
                      <td data-label="RSSI" className="num mono">
                        {o.rssi} dBm
                      </td>
                      <td
                        data-label="Zuletzt"
                        title={
                          stale ?
                            "Nicht mehr empfangen – das heißt nicht, dass das Gerät weg ist."
                          : undefined
                        }
                      >
                        {stale ?
                          "nicht mehr empfangen"
                        : `vor ${Math.max(0, Math.round(age / 1000))} s`}
                      </td>
                      <td className="c-act">
                        <button
                          className="btn small"
                          onClick={() => setSelected(r)}
                        >
                          Warum?
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="note">
            RSSI ist keine Entfernungsmessung. „Nicht mehr empfangen“ bedeutet
            nicht, dass ein Gerät den Ort verlassen hat.
          </p>
        </section>

        <aside className="side">
          <section className="panel" aria-label="Ereignisse">
            <div className="panel-head">
              <h2>Ereignisse</h2>
            </div>
            <ul className="events">
              {m.events.length === 0 && (
                <li className="muted">Noch keine Ereignisse.</li>
              )}
              {m.events.slice(0, 40).map((e, i) => (
                <li key={i}>
                  <span className="ev-type">{e.type}</span>
                  <span className="ev-msg">{e.message}</span>
                  <time>{new Date(e.ts).toLocaleTimeString("de-DE")}</time>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel" aria-label="Diagnose">
            <div className="panel-head">
              <h2>Diagnose</h2>
            </div>
            <dl className="diag">
              <dt>Scanner</dt>
              <dd>{m.scanner.label}</dd>
              <dt>Takt</dt>
              <dd>{m.scanner.cadenceNote}</dd>
              {m.device && (
                <>
                  <dt>Gerät</dt>
                  <dd>
                    {m.device.device} · Android {m.device.androidRelease} (API{" "}
                    {m.device.sdk})
                  </dd>
                  <dt>WLAN / BLE</dt>
                  <dd>
                    {onOff(m.device.wifiEnabled)} /{" "}
                    {onOff(m.device.bluetoothEnabled)}
                  </dd>
                  <dt>Standort (System)</dt>
                  <dd>{onOff(m.device.locationEnabled)}</dd>
                  <dt>Scan-Drosselung</dt>
                  <dd>
                    {m.device.wifiScanThrottleEnabled ?
                      "aktiv (Standard)"
                    : "aus (Entwickleroption)"}
                  </dd>
                  <dt>Berechtigungen</dt>
                  <dd>
                    WLAN {yn(m.device.permNearbyWifi)} · BLE{" "}
                    {yn(m.device.permBluetoothScan)} · Standort{" "}
                    {yn(m.device.permLocation)}
                  </dd>
                </>
              )}
              <dt>Session</dt>
              <dd className="mono">{m.sessionId}</dd>
              <dt>Aktive Regeln</dt>
              <dd>{m.rules.filter((r) => r.active).length}</dd>
              <dt>OUI-Bestand</dt>
              <dd>
                {m.oui.full ?
                  `IEEE ${m.oui.version} (${m.oui.size.toLocaleString("de-DE")} Bereiche)`
                : `${m.oui.version} (${m.oui.size} Einträge, Seed – lädt …)`}
              </dd>
              <dt>Speicherung</dt>
              <dd>
                {m.savedAt ?
                  `lokal gesichert ${m.savedAt.toLocaleTimeString("de-DE")}`
                : "lokal (beim Stoppen und alle 30 s)"}
              </dd>
            </dl>
          </section>
        </aside>
      </main>
      </>
      )}

      {selected && (
        <EvidenceDialog item={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

const onOff = (b: boolean) => (b ? "an" : "aus");
const yn = (b: boolean) => (b ? "✓" : "✗");

function DeviceHints({
  d,
  onRequest,
}: {
  d: DeviceStatus;
  onRequest: () => Promise<void>;
}) {
  const hints: string[] = [];
  if (!d.wifiEnabled)
    hints.push("WLAN ist ausgeschaltet – es gibt keine WLAN-Beobachtung.");
  if (!d.bluetoothEnabled)
    hints.push("Bluetooth ist ausgeschaltet – es gibt keine BLE-Beobachtung.");
  if (!d.locationEnabled)
    hints.push(
      "Der System-Standortschalter ist aus. Android liefert dann keine Scan-Ergebnisse (die App speichert keine Position).",
    );
  const missingPerm =
    !d.permLocation || !d.permNearbyWifi || !d.permBluetoothScan;
  if (missingPerm)
    hints.push(
      "Berechtigungen fehlen: Android verlangt für Funkscans „Geräte in der Nähe“ und Standort. mobilescope liest und speichert keine Position.",
    );
  if (hints.length === 0) return null;
  return (
    <div className="banner warn" role="status">
      <ul>
        {hints.map((h) => (
          <li key={h}>{h}</li>
        ))}
      </ul>
      {missingPerm && (
        <button className="btn small" onClick={() => void onRequest()}>
          Berechtigungen anfordern
        </button>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className={`stat ${accent ? "accent" : ""}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
