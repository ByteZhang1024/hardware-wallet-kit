import type { DeviceDescriptor, DeviceChangeEvent } from '@bytezhang/hardware-wallet-core';
import type { IDmk, DmkDiscoveredDevice } from '../types';

/**
 * Manages device discovery, connection, and session tracking.
 * Wraps DMK's Observable APIs into simpler imperative calls.
 */
export class LedgerDeviceManager {
  private readonly _dmk: IDmk;
  private readonly _discovered = new Map<string, DmkDiscoveredDevice>();
  private readonly _sessions = new Map<string, string>(); // deviceId → sessionId
  private readonly _sessionToDevice = new Map<string, string>(); // sessionId → deviceId
  private _listenSub: { unsubscribe: () => void } | null = null;

  constructor(dmk: IDmk) {
    this._dmk = dmk;
  }

  /**
   * One-shot enumeration: subscribe to listenToAvailableDevices,
   * take the first emission, unsubscribe, return DeviceDescriptors.
   */
  enumerate(): Promise<DeviceDescriptor[]> {
    console.log(
      '[DMK] enumerate() called, dmk exists:',
      !!this._dmk,
      'listenToAvailableDevices exists:',
      typeof this._dmk?.listenToAvailableDevices
    );
    return new Promise<DeviceDescriptor[]>(resolve => {
      let resolved = false;
      let syncResult: { id: string; deviceModel: { id: string }; [k: string]: unknown }[] | null =
        null;
      let sub: { unsubscribe: () => void } | null = null;

      sub = this._dmk.listenToAvailableDevices().subscribe({
        next: devices => {
          if (resolved) return;
          resolved = true;
          this._discovered.clear();
          // Log raw DMK discovery data — everything the SDK returns
          console.log(
            '[DMK] enumerate raw devices:',
            JSON.stringify(
              devices.map(d => ({
                id: d.id,
                deviceModel: d.deviceModel,
                transport: (d as any).transport,
                name: (d as any).name,
                rssi: (d as any).rssi,
                // Dump all keys to see what else is available
                _keys: Object.keys(d),
              }))
            )
          );
          for (const d of devices) {
            this._discovered.set(d.id, d);
          }
          // If sub is already assigned (async emission), resolve and unsubscribe immediately
          if (sub) {
            sub.unsubscribe();
            resolve(
              devices.map(d => ({
                path: d.id,
                type: d.deviceModel.id,
                name: (d as any).name,
                transport: (d as any).transport,
              }))
            );
          } else {
            // Synchronous emission — sub not yet assigned, defer to after subscribe()
            syncResult = devices;
          }
        },
        error: () => {
          if (!resolved) {
            resolved = true;
            resolve([]);
          }
        },
      });

      // If BehaviorSubject fired synchronously, sub is now assigned
      if (syncResult !== null) {
        sub.unsubscribe();
        const devices = syncResult as {
          id: string;
          deviceModel: { id: string };
          name?: string;
          transport?: string;
        }[];
        resolve(
          devices.map(d => ({
            path: d.id,
            type: d.deviceModel.id,
            name: (d as any).name,
            transport: (d as any).transport,
          }))
        );
      }
    });
  }

  /**
   * Continuous listening: tracks device connect/disconnect via diffing.
   */
  listen(onChange: (event: DeviceChangeEvent) => void): void {
    this.stopListening();
    let previousIds = new Set<string>();

    this._listenSub = this._dmk.listenToAvailableDevices().subscribe({
      next: devices => {
        const currentIds = new Set(devices.map(d => d.id));

        for (const d of devices) {
          this._discovered.set(d.id, d);
          console.log(
            '[DMK] listen device:',
            JSON.stringify({
              id: d.id,
              deviceModel: d.deviceModel,
              name: (d as any).name,
            })
          );
          if (!previousIds.has(d.id)) {
            onChange({
              type: 'device-connected',
              descriptor: {
                path: d.id,
                type: d.deviceModel.id,
                name: (d as any).name,
                transport: (d as any).transport,
              },
            });
          }
        }
        for (const id of previousIds) {
          if (!currentIds.has(id)) {
            this._discovered.delete(id);
            onChange({ type: 'device-disconnected', descriptor: { path: id } });
          }
        }
        previousIds = currentIds;
      },
    });
  }

  stopListening(): void {
    this._listenSub?.unsubscribe();
    this._listenSub = null;
  }

  /**
   * Trigger browser device selection (WebHID requestDevice).
   * Starts discovery for a short period, then stops.
   */
  /**
   * Start BLE discovery if not already running.
   * Does NOT stop — DMK keeps scanning in the background so that
   * listenToAvailableDevices() always has fresh data.
   */
  private _discoverySub: { unsubscribe: () => void } | null = null;

  requestDevice(): Promise<void> {
    if (this._discoverySub) {
      // Already scanning
      return Promise.resolve();
    }
    console.log('[DMK] requestDevice() starting persistent BLE scan');
    this._discoverySub = this._dmk.startDiscovering().subscribe({
      next: d => {
        console.log('[DMK] BLE discovered:', (d as any).name || d.id);
        this._discovered.set(d.id, d);
      },
      error: err => {
        console.error('[DMK] BLE scan error:', err);
        this._discoverySub = null;
      },
    });
    return Promise.resolve();
  }

  /** Connect to a previously discovered device. Returns sessionId. */
  async connect(deviceId: string): Promise<string> {
    const device = this._discovered.get(deviceId);
    if (!device) {
      throw new Error(`Device "${deviceId}" not found. Call enumerate() or listen() first.`);
    }
    const sessionId = await this._dmk.connect({ device });
    this._sessions.set(deviceId, sessionId);
    this._sessionToDevice.set(sessionId, deviceId);
    return sessionId;
  }

  /** Disconnect a session. */
  async disconnect(sessionId: string): Promise<void> {
    await this._dmk.disconnect({ sessionId });
    const deviceId = this._sessionToDevice.get(sessionId);
    if (deviceId) this._sessions.delete(deviceId);
    this._sessionToDevice.delete(sessionId);
  }

  getSessionId(deviceId: string): string | undefined {
    return this._sessions.get(deviceId);
  }

  getDeviceId(sessionId: string): string | undefined {
    return this._sessionToDevice.get(sessionId);
  }

  /** Get the underlying DMK instance (needed by SignerManager). */
  getDmk(): IDmk {
    return this._dmk;
  }

  stopDiscovery(): void {
    if (this._discoverySub) {
      this._discoverySub.unsubscribe();
      this._discoverySub = null;
      this._dmk.stopDiscovering();
    }
  }

  dispose(): void {
    this.stopListening();
    this.stopDiscovery();
    this._discovered.clear();
    this._sessions.clear();
    this._sessionToDevice.clear();
    this._dmk.close?.();
  }
}
