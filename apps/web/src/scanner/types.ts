import type { Observation } from "@mobilescope/core";

export interface DeviceStatus {
  device: string;
  androidRelease: string;
  sdk: number;
  wifiEnabled: boolean;
  bluetoothEnabled: boolean;
  bleSupported: boolean;
  locationEnabled: boolean;
  wifiScanThrottleEnabled: boolean;
  permLocation: boolean;
  permNearbyWifi: boolean;
  permBluetoothScan: boolean;
  scanning: boolean;
}

export interface ScannerHandlers {
  onObservations: (items: Observation[]) => void;
  onStatus: (code: string, message: string) => void;
}

export interface ScannerAdapter {
  readonly id: "mock" | "android";
  readonly label: string;
  /** Erwartetes Intervall, nach dem ein Signal als „nicht mehr empfangen“ gilt. */
  readonly staleAfterMs: { WIFI: number; BLE: number };
  /** Hinweis zum Scanintervall für die Diagnose. */
  readonly cadenceNote: string;
  start(sessionId: string, handlers: ScannerHandlers): Promise<void>;
  stop(): Promise<void>;
  /** Nur nativ verfügbar. */
  getStatus?(): Promise<DeviceStatus>;
  requestPermissions?(): Promise<void>;
}
