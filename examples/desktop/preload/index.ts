import { contextBridge, ipcRenderer } from 'electron';
import { exposeTrezorConnectApi } from '@bytezhang/trezor-transport-electron/preload';
import { LedgerNodeBridge } from './ledgerNodeBridge';

// Trezor Connect IPC bridge — delegates to the shared package
exposeTrezorConnectApi();

/**
 * BLE API bridge — exposes main-process Noble BLE operations to the renderer.
 * All methods return Promises resolved via IPC.
 */
contextBridge.exposeInMainWorld('electronBle', {
  init: () => ipcRenderer.invoke('ble:init'),
  startScan: () => ipcRenderer.invoke('ble:startScan'),
  stopScan: () => ipcRenderer.invoke('ble:stopScan'),
  connectDevice: (deviceId: string) =>
    ipcRenderer.invoke('ble:connectDevice', deviceId),
  disconnectDevice: (deviceId: string) =>
    ipcRenderer.invoke('ble:disconnectDevice', deviceId),
  enumerate: () => ipcRenderer.invoke('ble:enumerate'),
  acquire: (path: string, previous: string | null) =>
    ipcRenderer.invoke('ble:acquire', path, previous),
  release: (sessionId: string) =>
    ipcRenderer.invoke('ble:release', sessionId),
  call: (params: { session: string; name: string; data: Record<string, unknown> }) =>
    ipcRenderer.invoke('ble:call', params),
  dispose: () => ipcRenderer.invoke('ble:dispose'),

  // Event listeners
  onNearbyDevices: (callback: (devices: unknown[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, devices: unknown[]) =>
      callback(devices);
    ipcRenderer.on('ble:nearbyDevices', listener);
    return () => ipcRenderer.removeListener('ble:nearbyDevices', listener);
  },
  onDeviceChange: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: unknown) =>
      callback(data);
    ipcRenderer.on('ble:deviceChange', listener);
    return () => ipcRenderer.removeListener('ble:deviceChange', listener);
  },
});

const ledgerBridge = new LedgerNodeBridge({
  createAdapter: (connector) => {
    const { LedgerAdapter } = require('@bytezhang/ledger-adapter');
    return new LedgerAdapter(connector);
  },
  createConnector: async () => {
    const [
      { DeviceManagementKitBuilder, ConsoleLogger, LogLevel },
      { nodeHidTransportFactory },
    ] = await Promise.all([
      import('@ledgerhq/device-management-kit'),
      import('@ledgerhq/device-transport-kit-node-hid'),
    ]);
    const { LedgerWebHidConnector } = await import('@bytezhang/ledger-connector-webhid');

    const dmk = new DeviceManagementKitBuilder()
      .addTransport(nodeHidTransportFactory)
      .addLogger(new ConsoleLogger(LogLevel.Debug))
      .build();

    return new LedgerWebHidConnector({ dmk });
  },
});

/**
 * Ledger NodeHID bridge — keeps LedgerAdapter in preload (Node runtime).
 * Renderer only performs RPC-style calls through this bridge.
 */
contextBridge.exposeInMainWorld('ledgerAdapter', {
  init: () => ledgerBridge.init(),
  dispose: () => ledgerBridge.dispose(),
  call: (method: string, args: unknown[] = []) => ledgerBridge.call(method, args),
  onEvent: (callback: (event: unknown) => void) => ledgerBridge.onEvent(callback),
  removeEventListeners: () => ledgerBridge.removeEventListeners(),
});
