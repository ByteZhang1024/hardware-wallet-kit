/**
 * Renderer-side BLE proxy transport for Trezor.
 * Communicates with Noble in the main process via IPC (exposed by preload).
 */
import type {
  DeviceDescriptor,
  DeviceChangeEvent,
} from '@bytezhang/hardware-wallet-core';
import { AbsTrezorTransport } from '@bytezhang/trezor-adapter';

/** Shape exposed by preload/index.ts via contextBridge */
interface ElectronBleApi {
  init(): Promise<{ success: boolean; error?: string }>;
  startScan(): Promise<{ success: boolean }>;
  stopScan(): Promise<void>;
  connectDevice(deviceId: string): Promise<{ success: boolean; error?: string }>;
  disconnectDevice(deviceId: string): Promise<void>;
  enumerate(): Promise<{
    success: boolean;
    payload?: Array<Record<string, unknown>>;
    error?: string;
  }>;
  acquire(
    path: string,
    previous: string | null,
  ): Promise<{ success: boolean; payload?: string; error?: string }>;
  release(sessionId: string): Promise<void>;
  call(params: {
    session: string;
    name: string;
    data: Record<string, unknown>;
  }): Promise<{
    success: boolean;
    payload?: { type: string; message: Record<string, unknown> };
    error?: string;
  }>;
  dispose(): Promise<void>;
  onNearbyDevices(callback: (devices: unknown[]) => void): () => void;
  onDeviceChange(callback: (event: unknown) => void): () => void;
}

declare global {
  interface Window {
    electronBle?: ElectronBleApi;
  }
}

function getBleApi(): ElectronBleApi {
  if (!window.electronBle) {
    throw new Error('electronBle not available — not running in Electron');
  }
  return window.electronBle;
}

/**
 * BLE transport that proxies all operations to the Electron main process
 * where Noble handles actual Bluetooth communication.
 */
export class ElectronBleTrezorTransport extends AbsTrezorTransport {
  private removeNearbyListener?: () => void;
  private _sessionCache = new Map<string, string>();

  async init(): Promise<void> {
    const api = getBleApi();
    const result = await api.init();
    if (!result.success) {
      throw new Error(`BLE init failed: ${result.error ?? 'unknown'}`);
    }

    // Auto-scan after init
    await api.startScan();
  }

  async dispose(): Promise<void> {
    const api = getBleApi();
    this.removeNearbyListener?.();
    this._sessionCache.clear();
    await api.stopScan();
    await api.dispose();
  }

  /**
   * Connect to a specific BLE device.
   * Call this after scanning finds a device.
   */
  async connectBleDevice(deviceId: string): Promise<void> {
    const api = getBleApi();
    const result = await api.connectDevice(deviceId);
    if (!result.success) {
      throw new Error(`BLE connect failed: ${result.error}`);
    }
  }

  /**
   * Subscribe to nearby BLE device updates (scan results).
   */
  onNearbyDevices(callback: (devices: unknown[]) => void): () => void {
    const api = getBleApi();
    const remove = api.onNearbyDevices(callback);
    this.removeNearbyListener = remove;
    return remove;
  }

  async enumerate(): Promise<DeviceDescriptor[]> {
    const api = getBleApi();
    const result = await api.enumerate();
    if (!result.success) {
      throw new Error(`BLE enumerate failed: ${result.error}`);
    }
    return (result.payload ?? []).map((raw) => ({
      path: raw.path as string,
      product: raw.product as number | undefined,
      vendor: raw.vendor as number | undefined,
      type: raw.type as string | undefined,
      session: raw.session as string | null | undefined,
    }));
  }

  listen(_onChange: (event: DeviceChangeEvent) => void): void {
    // BLE device changes come through onNearbyDevices / IPC events
  }

  stopListening(): void {
    this.removeNearbyListener?.();
  }

  getCurrentSession(path: string): string | null {
    return this._sessionCache.get(path) ?? null;
  }

  async acquire(path: string, previous: string | null): Promise<string> {
    const api = getBleApi();
    const result = await api.acquire(path, previous);
    if (!result.success || result.payload == null) {
      throw new Error(`BLE acquire failed: ${result.error ?? 'unknown'}`);
    }
    this._sessionCache.set(path, result.payload);
    return result.payload;
  }

  async release(sessionId: string): Promise<void> {
    for (const [path, session] of this._sessionCache) {
      if (session === sessionId) {
        this._sessionCache.delete(path);
        break;
      }
    }
    const api = getBleApi();
    await api.release(sessionId);
  }

  async call(params: {
    session: string;
    name: string;
    data: Record<string, unknown>;
  }): Promise<{ type: string; message: Record<string, unknown> }> {
    const api = getBleApi();
    const result = await api.call(params);
    if (!result.success || !result.payload) {
      throw new Error(`BLE call failed: ${result.error ?? 'unknown'}`);
    }
    return result.payload;
  }
}
