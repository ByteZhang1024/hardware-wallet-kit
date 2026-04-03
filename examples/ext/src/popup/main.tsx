import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@examples/shared';
import { TrezorExtClient } from '@examples/shared/ext/trezor';
import { LedgerAdapterClient } from '@examples/shared/ext/ledger';
import type { TransportProviders } from '@examples/shared';

const providers: TransportProviders = {
  trezor: {
    transports: [{ type: 'usb', label: 'USB (Offscreen Iframe)' }],
    create: async () => {
      const { TrezorAdapter } = await import('@bytezhang/hardware-trezor-adapter');
      const adapter = new TrezorAdapter();
      await adapter.init({
        transports: [{
          type: 'usb',
          createConnect: async () => {
            const client = new TrezorExtClient();
            await client.init({});
            return client;
          },
        }],
      });
      return adapter;
    },
    pair: () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('pairing/index.html') });
    },
  },
  ledger: {
    transports: [{ type: 'hid', label: 'HID (Offscreen)' }],
    create: async () => {
      const client = new LedgerAdapterClient();
      await client.init();
      return client as any;
    },
    pair: () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('pairing/index.html') });
    },
  },
};

createRoot(document.getElementById('root')!).render(<App providers={providers} />);
