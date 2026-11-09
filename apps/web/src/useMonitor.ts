import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SEED_OUI_DB,
  SessionRecorder,
  createState,
  type OuiDatabase,
  processObservation,
  type EngineState,
  type EventType,
  type MsEvent,
  type ProcessedObservation,
  type Rule,
  type SessionMeta,
} from "@mobilescope/core";
import pkg from "../package.json";
import { saveSession } from "./storage/sessionStore";
import { loadOuiDatabase } from "./ouiLoader";
import { createScanner, type DeviceStatus, type ScannerAdapter } from "./scanner";

export const DEMO_RULES: Rule[] = [
  {
    id: "rule_watch_cradlepoint",
    name: "Watch: Cradlepoint-Bereich",
    type: "WATCH",
    active: true,
    priority: 20,
    createdAt: "2026-10-31T00:00:00Z",
    description: "Demo: hebt den OUI-Bereich 00:30:44 hervor",
    match: { field: "OUI", value: "00:30:44" },
  },
  {
    id: "rule_mute_vm",
    name: "Mute: virtuelle Maschinen",
    type: "MUTE",
    active: true,
    priority: 10,
    createdAt: "2026-10-31T00:00:00Z",
    description: "Demo: keine Benachrichtigung für VMware-Adressbereich",
    match: { field: "MANUFACTURER", value: "VMware" },
  },
];

const STATUS_EVENT: Record<string, EventType> = {
  SCAN_THROTTLED: "SCAN_THROTTLED",
  PERMISSION_CHANGED: "PERMISSION_CHANGED",
  STALE_RESULTS_IGNORED: "STALE_RESULTS_IGNORED",
};

export interface Monitor {
  scanner: ScannerAdapter;
  running: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  reset: () => void;
  requestPermissions: () => Promise<void>;
  error: string | null;
  device: DeviceStatus | null;
  rows: ProcessedObservation[];
  events: MsEvent[];
  observationCount: number;
  oui: { name: string; version: string; size: number; full: boolean };
  /** Zeitpunkt der letzten lokalen Speicherung der laufenden Session. */
  savedAt: Date | null;
  sessionId: string;
  rules: Rule[];
}

export function useMonitor(): Monitor {
  const scanner = useMemo(createScanner, []);
  const [running, setRunning] = useState(false);
  const [tick, setTick] = useState(0);
  const [observationCount, setObservationCount] = useState(0);
  const [sessionId, setSessionId] = useState(() => newSessionId());
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<DeviceStatus | null>(null);
  const state = useRef<EngineState>(createState());
  const recorder = useRef<SessionRecorder | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const ouiDb = useRef<OuiDatabase>(SEED_OUI_DB);
  const [oui, setOui] = useState({ name: SEED_OUI_DB.meta.name, version: SEED_OUI_DB.meta.version, size: SEED_OUI_DB.size, full: false });
  const ouiReady = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    ouiReady.current = loadOuiDatabase()
      .then((db) => {
        ouiDb.current = db;
        setOui({ name: db.meta.name, version: db.meta.version, size: db.size, full: true });
      })
      .catch((e) => setError(`IEEE-OUI-Daten nicht geladen, nutze Mini-Seed: ${describe(e)}`));
  }, []);

  const refreshDevice = useCallback(async () => {
    if (!scanner.getStatus) return;
    try {
      setDevice(await scanner.getStatus());
    } catch (e) {
      setError(`Gerätestatus nicht lesbar: ${describe(e)}`);
    }
  }, [scanner]);

  useEffect(() => {
    void refreshDevice();
    const id = setInterval(() => void refreshDevice(), 5000);
    return () => clearInterval(id);
  }, [refreshDevice]);

  const persist = useCallback(
    async (final: boolean) => {
      const rec = recorder.current;
      if (!rec || rec.observationCount === 0) return;
      try {
        await saveSession(rec.snapshot(state.current.events, final ? new Date().toISOString() : undefined));
        setSavedAt(new Date());
      } catch (e) {
        setError(`Session konnte nicht gespeichert werden: ${describe(e)}`);
      }
    },
    [],
  );

  // Autosave während der Beobachtung und beim Verlassen der Seite, damit nach einem Absturz nichts fehlt.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => void persist(false), AUTOSAVE_MS);
    const onHide = () => void persist(false);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(id);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [running, persist]);

  const start = useCallback(async () => {
    setError(null);
    try {
      await ouiReady.current;
      await scanner.requestPermissions?.();
      if (!recorder.current) {
        recorder.current = new SessionRecorder(
          buildMeta(sessionId, scanner.id, device?.device, ouiDb.current, DEMO_RULES),
        );
      }
      await scanner.start(sessionId, {
        onObservations: (items) => {
          for (const o of items) {
            const p = processObservation(state.current, o, DEMO_RULES, { oui: ouiDb.current });
            recorder.current?.add(p);
          }
          setObservationCount((n) => n + items.length);
          setTick((t) => t + 1);
        },
        onStatus: (code, message) => {
          state.current.events.push({
            ts: new Date().toISOString(),
            type: STATUS_EVENT[code] ?? "SCAN_FAILED",
            message,
          });
          setTick((t) => t + 1);
        },
      });
      setRunning(true);
    } catch (e) {
      setError(describe(e));
      await scanner.stop().catch(() => undefined);
    }
    void refreshDevice();
  }, [scanner, sessionId, device?.device, refreshDevice]);

  const stop = useCallback(async () => {
    await scanner.stop();
    setRunning(false);
    await persist(true);
    void refreshDevice();
  }, [scanner, refreshDevice, persist]);

  useEffect(() => () => void scanner.stop(), [scanner]);

  const requestPermissions = useCallback(async () => {
    try {
      await scanner.requestPermissions?.();
    } catch (e) {
      setError(describe(e));
    }
    void refreshDevice();
  }, [scanner, refreshDevice]);

  const reset = useCallback(() => {
    state.current = createState();
    recorder.current = null;
    setSavedAt(null);
    setSessionId(newSessionId());
    setObservationCount(0);
    setTick((t) => t + 1);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => [...state.current.latest.values()], [tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const events = useMemo(() => [...state.current.events].reverse(), [tick]);

  return {
    scanner,
    running,
    start,
    stop,
    reset,
    requestPermissions,
    error,
    device,
    rows,
    events,
    observationCount,
    oui,
    savedAt,
    sessionId,
    rules: DEMO_RULES,
  };
}

const AUTOSAVE_MS = 30_000;

function buildMeta(
  id: string,
  scannerId: string,
  device: string | undefined,
  oui: OuiDatabase,
  rules: Rule[],
): SessionMeta {
  const started = new Date();
  return {
    id,
    name: `Session ${started.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}`,
    startedAt: started.toISOString(),
    scanner: scannerId,
    device,
    appVersion: pkg.version,
    ouiName: oui.meta.name,
    ouiVersion: oui.meta.version,
    activeRules: rules.filter((r) => r.active).length,
  };
}

function describe(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

function newSessionId(): string {
  return `ses_${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
}
