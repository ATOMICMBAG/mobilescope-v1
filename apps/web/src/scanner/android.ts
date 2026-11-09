import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { Observation } from "@mobilescope/core";
import type { DeviceStatus, ScannerAdapter, ScannerHandlers } from "./types";

interface NativeObservation {
  source: "WIFI" | "BLE";
  scanOrigin: Observation["scanOrigin"];
  identifier: string;
  name?: string;
  rssi: number;
  frequencyMhz?: number;
  capabilities?: string[];
  bleCompanyId?: number;
  resultAgeMs?: number;
  ts: string;
}

interface RfScannerPlugin {
  getStatus(): Promise<DeviceStatus>;
  checkPermissions(): Promise<Record<string, string>>;
  requestPermissions(): Promise<Record<string, string>>;
  startScan(o: { wifi: boolean; ble: boolean; wifiIntervalMs: number }): Promise<{ started: string[] }>;
  stopScan(): Promise<void>;
  addListener(e: "observations", cb: (d: { items: NativeObservation[] }) => void): Promise<PluginListenerHandle>;
  addListener(e: "status", cb: (d: { code: string; message: string }) => void): Promise<PluginListenerHandle>;
}

const WIFI_INTERVAL_MS = 30_000;
/**
 * Android liefert beim Start auch WLAN-Ergebnisse aus dem Zwischenspeicher, teils Stunden alt.
 * Sie gehören nicht zur laufenden Beobachtung und würden „erste Beobachtung“ vor dem Sessionstart vortäuschen.
 */
const MAX_RESULT_AGE_MS = WIFI_INTERVAL_MS * 2;
const NOTICE_EVERY_MS = 60_000;

export function createAndroidAdapter(): ScannerAdapter {
  const native = registerPlugin<RfScannerPlugin>("RfScanner");
  let handles: PluginListenerHandle[] = [];
  let counter = 0;
  let lastNotice = 0;

  return {
    id: "android",
    label: "Android (nativ): WLAN + BLE",
    // WLAN: Android erlaubt im Vordergrund ca. alle 30 s einen Scan; BLE meldet fortlaufend.
    staleAfterMs: { WIFI: WIFI_INTERVAL_MS * 3, BLE: 20_000 },
    cadenceNote: `WLAN alle ${WIFI_INTERVAL_MS / 1000} s (Android-Drosselung), BLE fortlaufend`,

    getStatus: () => native.getStatus(),

    async requestPermissions() {
      await native.requestPermissions();
    },

    async start(sessionId: string, h: ScannerHandlers) {
      handles.push(
        await native.addListener("observations", ({ items: all }) => {
          const now = Date.now();
          const items = all.filter((n) => (n.resultAgeMs ?? 0) <= MAX_RESULT_AGE_MS);
          const dropped = all.length - items.length;
          if (dropped > 0 && now - lastNotice >= NOTICE_EVERY_MS) {
            lastNotice = now;
            h.onStatus(
              "STALE_RESULTS_IGNORED",
              `${dropped} ältere WLAN-Ergebnisse (> ${MAX_RESULT_AGE_MS / 1000} s) aus dem Android-Zwischenspeicher wurden nicht gewertet.`,
            );
          }
          if (items.length === 0) return;
          h.onObservations(
            items.map((n) => ({
              id: `obs_${String(++counter).padStart(6, "0")}`,
              sessionId,
              ...n,
              // Zeitstempel = tatsächlicher Empfang (Emissionszeit minus Alter laut Betriebssystem)
              ts: new Date(now - (n.resultAgeMs ?? 0)).toISOString(),
            })),
          );
        }),
        await native.addListener("status", ({ code, message }) => h.onStatus(code, message)),
      );
      await native.startScan({ wifi: true, ble: true, wifiIntervalMs: WIFI_INTERVAL_MS });
    },

    async stop() {
      await native.stopScan().catch(() => undefined);
      await Promise.all(handles.map((x) => x.remove()));
      handles = [];
    },
  };
}
