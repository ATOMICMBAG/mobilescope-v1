import { MockScanner } from "@mobilescope/core";
import type { ScannerAdapter, ScannerHandlers } from "./types";

const INTERVAL_MS = 2000;

export function createMockAdapter(): ScannerAdapter {
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    id: "mock",
    label: "Demo (Mock) – keine echten Funkdaten",
    staleAfterMs: { WIFI: 8000, BLE: 8000 },
    cadenceNote: "Demo-Takt 2 s",
    async start(sessionId: string, h: ScannerHandlers) {
      const scanner = new MockScanner(sessionId);
      const tick = () => h.onObservations(scanner.scan());
      tick();
      timer = setInterval(tick, INTERVAL_MS);
    },
    async stop() {
      clearInterval(timer);
      timer = undefined;
    },
  };
}
