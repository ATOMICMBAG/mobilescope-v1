import { Capacitor } from "@capacitor/core";
import { createAndroidAdapter } from "./android";
import { createMockAdapter } from "./mock";
import type { ScannerAdapter } from "./types";

export type { DeviceStatus, ScannerAdapter } from "./types";

export function createScanner(): ScannerAdapter {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android"
    ? createAndroidAdapter()
    : createMockAdapter();
}
