import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@examples/shared';
import { WebApiDebugPanel } from './WebApiDebugPanel';
import type { TransportProviders } from '@examples/shared';

const providers: TransportProviders = {
  trezor: {
    transports: [{ type: 'usb', label: 'USB' }],
    create: async () => {
      const { TrezorAdapter } = await import('@bytezhang/hardware-trezor-adapter');
      const adapter = new TrezorAdapter();
      await adapter.init({
        transports: [{
          type: 'usb',
          createConnect: async () => {
            const { default: TrezorConnect } = await import('@trezor/connect-web');
            await TrezorConnect.init({
              manifest: { appUrl: window.location.origin, email: 'test@example.com' },
            });
            return TrezorConnect;
          },
        }],
      });
      return adapter;
    },
  },
  ledger: {
    transports: [{ type: 'hid', label: 'HID' }],
    create: async () => {
      const [
        { LedgerWebHidConnector },
        { LedgerAdapter },
      ] = await Promise.all([
        import('@bytezhang/ledger-connector-webhid'),
        import('@bytezhang/ledger-adapter'),
      ]);
      const connector = new LedgerWebHidConnector();
      const adapter = new LedgerAdapter(connector);
      return adapter;
    },
  },
};

createRoot(document.getElementById('root')!).render(
  <>
    <App providers={providers} />
    <div style={{ padding: '0 24px 24px' }}>
      <WebApiDebugPanel />
    </div>
  </>
);
