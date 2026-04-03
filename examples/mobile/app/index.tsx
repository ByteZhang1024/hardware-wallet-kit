import React from 'react';
import { App } from '@examples/shared';
import type { TransportProviders } from '@examples/shared';

const providers: TransportProviders = {
  trezor: {
    transports: [{ type: 'usb', label: 'Trezor Connect' }],
    create: async () => {
      const { TrezorAdapter } = await import(
        '@bytezhang/hardware-trezor-adapter'
      );
      const adapter = new TrezorAdapter();
      await adapter.init({
        transports: [{
          type: 'usb',
          createConnect: async () => {
            // React Native Trezor Connect setup
            const { default: TrezorConnect } = await import(
              '@trezor/connect' as any
            );
            await TrezorConnect.init({
              manifest: { appUrl: 'https://onekey.so', email: 'test@example.com' },
              env: 'react-native',
            });
            return TrezorConnect;
          },
        }],
      });
      return adapter;
    },
  },
  ledger: {
    transports: [{ type: 'ble', label: 'Bluetooth' }],
    create: async () => {
      const { DeviceManagementKitBuilder } = await import(
        '@ledgerhq/device-management-kit'
      );
      const { reactNativeBleTransportFactory } = await import(
        '@ledgerhq/device-transport-kit-react-native-ble' as any
      );
      const { LedgerWebHidConnector } = await import('@bytezhang/ledger-connector-webhid');
      const { LedgerAdapter } = await import('@bytezhang/ledger-adapter');
      const dmk = new DeviceManagementKitBuilder()
        .addTransport(reactNativeBleTransportFactory)
        .build();
      const connector = new LedgerWebHidConnector({ dmk });
      const adapter = new LedgerAdapter(connector);
      return adapter;
    },
  },
};

export default function HomeScreen() {
  return <App providers={providers} />;
}
