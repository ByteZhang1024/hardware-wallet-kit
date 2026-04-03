import { app, BrowserWindow, ipcMain, session } from 'electron';
import { createElectronTrezorBridge } from '@bytezhang/trezor-transport-electron/main';
import path from 'path';

// Trezor USB vendor/product IDs
const TREZOR_VENDOR_IDS = [0x534c, 0x1209];

// Bridge ports: onekeyd (OneKey) or trezord (Trezor)
const BRIDGE_PORTS = [21320, 21325];

function setupDevicePermissions() {
  const ses = session.defaultSession;

  // Auto-grant permission for USB and HID devices.
  // (Reference: OneKey app-monorepo/apps/desktop/app/app.ts:884)
  ses.setDevicePermissionHandler((details) => {
    if (details.deviceType === 'usb' || details.deviceType === 'hid') {
      return true;
    }
    return false;
  });

  // Allow all USB interface classes.
  ses.setUSBProtectedClassesHandler(() => []);

  // Grant permission checks for USB and HID.
  ses.setPermissionCheckHandler((_webContents, permission) => {
    if (permission === 'usb' || permission === 'hid') {
      return true;
    }
    return true;
  });

  // Handle WebUSB device selection — auto-select Trezor.
  ses.on('select-usb-device', (event, details, callback) => {
    event.preventDefault();
    const trezorDevice = details.deviceList.find((d) =>
      TREZOR_VENDOR_IDS.includes(d.vendorId),
    );
    callback(trezorDevice ? trezorDevice.deviceId : undefined);
  });

  // Ledger now uses NodeHID in preload, so WebHID selection is not required.

  // Intercept requests to bridge to inject proper Origin header.
  // Electron renderer at file:// sends Origin: null, which the bridge rejects (403).
  // onekeyd expects Origin containing "onekey", trezord expects "trezor.io".
  const bridgeUrls = BRIDGE_PORTS.map((p) => `http://127.0.0.1:${p}/*`);
  ses.webRequest.onBeforeSendHeaders(
    { urls: bridgeUrls },
    (details, callback) => {
      details.requestHeaders['Origin'] = 'https://electron.onekey.so';
      callback({ requestHeaders: details.requestHeaders });
    },
  );
}

// --- BLE transport (runs in main process via Noble) ---

let bleTransport: any = null;

function setupBleIpc(win: BrowserWindow) {
  ipcMain.handle('ble:init', async () => {
    try {
      const { NodeBleTrezorTransport } = require(
        '@bytezhang/trezor-transport-node-ble',
      );
      bleTransport = new NodeBleTrezorTransport();
      await bleTransport.init();

      // Forward nearby device changes to renderer
      bleTransport.onNearbyDevicesChange((devices: unknown[]) => {
        win.webContents.send('ble:nearbyDevices', devices);
      });

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('ble:startScan', async () => {
    if (!bleTransport) return { success: false, error: 'Not initialized' };
    try {
      bleTransport.startScan();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('ble:stopScan', async () => {
    if (!bleTransport) return;
    bleTransport.stopScan();
    return { success: true };
  });

  ipcMain.handle('ble:connectDevice', async (_event, deviceId: string) => {
    if (!bleTransport) return { success: false, error: 'Not initialized' };
    try {
      await bleTransport.connectBleDevice(deviceId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('ble:disconnectDevice', async (_event, deviceId: string) => {
    if (!bleTransport) return;
    try {
      await bleTransport.disconnectBleDevice(deviceId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('ble:enumerate', async () => {
    if (!bleTransport) return { success: false, error: 'Not initialized' };
    try {
      const devices = await bleTransport.enumerate();
      return { success: true, payload: devices };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle(
    'ble:acquire',
    async (_event, path: string, previous: string | null) => {
      if (!bleTransport) return { success: false, error: 'Not initialized' };
      try {
        const session = await bleTransport.acquire(path, previous);
        return { success: true, payload: session };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  );

  ipcMain.handle('ble:release', async (_event, sessionId: string) => {
    if (!bleTransport) return;
    try {
      await bleTransport.release(sessionId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('ble:call', async (_event, params) => {
    if (!bleTransport) return { success: false, error: 'Not initialized' };
    try {
      const result = await bleTransport.call(params);
      return { success: true, payload: result };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('ble:dispose', async () => {
    if (!bleTransport) return;
    try {
      await bleTransport.dispose();
      bleTransport = null;
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, '../dist-preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs Node.js builtins (https, fs) for Ledger DMK
    },
  });

  createElectronTrezorBridge(win);
  setupBleIpc(win);

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../dist-renderer/index.html'));
  }
}

app.whenReady().then(() => {
  setupDevicePermissions();
  createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
