import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@examples/shared';
import type { TransportProviders } from '@examples/shared';
import { TrezorIpcConnect } from '@bytezhang/trezor-transport-electron/renderer';
import type { TrezorConnectBridge } from '@bytezhang/trezor-transport-electron';
import { LedgerIpcClient } from './ledgerIpcClient';
import type { LedgerAdapterBridge } from './ledgerIpcClient';

// Trezor USB filters for navigator.usb.requestDevice()
const TREZOR_USB_FILTERS: USBDeviceFilter[] = [
  { vendorId: 0x534c, productId: 0x0001 },
  { vendorId: 0x1209, productId: 0x53c0 },
  { vendorId: 0x1209, productId: 0x53c1 },
];

const providers: TransportProviders = {
  trezor: {
    transports: [
      { type: 'usb', label: 'USB (Node)' },
      { type: 'bridge', label: 'Bridge' },
    ],
    // In Electron, call navigator.usb.requestDevice() directly in the renderer.
    // Electron's main process auto-selects Trezor via select-usb-device handler.
    pair: async () => {
      try {
        await navigator.usb.requestDevice({ filters: TREZOR_USB_FILTERS });
      } catch {
        // User cancelled or no device found
      }
    },
    create: async () => {
      const { TrezorAdapter } = await import('@bytezhang/hardware-trezor-adapter');
      const bridge = (window as any).trezorConnect as TrezorConnectBridge;

      const adapter = new TrezorAdapter();
      await adapter.init({
        transports: [
          {
            type: 'usb',
            createConnect: () =>
              TrezorIpcConnect.create(bridge, {
                manifest: { appUrl: 'electron://hardware-wallet-kit', email: 'test@example.com' },
                transports: ['NodeUsbTransport'],
              }),
          },
          {
            type: 'bridge',
            createConnect: () =>
              TrezorIpcConnect.create(bridge, {
                manifest: { appUrl: 'electron://hardware-wallet-kit', email: 'test@example.com' },
                transports: ['BridgeTransport'],
              }),
          },
        ],
      });
      return adapter;
    },
  },
  ledger: {
    transports: [{ type: 'hid', label: 'HID' }],
    create: async () => {
      const bridge = (window as any).ledgerAdapter as LedgerAdapterBridge;
      const adapter = new LedgerIpcClient(bridge);
      await adapter.init();
      return adapter;
    },
  },
};

createRoot(document.getElementById('root')!).render(
  <App providers={providers} />
);
