/**
 * Offscreen document — Ledger + Trezor.
 *
 * Ledger: uses LedgerAdapterHost with DMK + WebHID.
 * Trezor: uses TrezorOffscreenHost with @trezor/connect-web in iframe mode.
 *         The iframe loads from a self-hosted Trezor Connect deployment.
 */
import { LedgerAdapterHost } from '@examples/shared/ext/ledger';
import { TrezorOffscreenHost } from '@examples/shared/ext/trezor';
import { LedgerWebHidConnector } from '@bytezhang/ledger-connector-webhid';

async function main() {
  // ── Ledger ──
  const connector = new LedgerWebHidConnector();
  const ledgerHost = new LedgerAdapterHost(connector);
  await ledgerHost.start();

  // ── Trezor ──
  const trezorHost = new TrezorOffscreenHost({
    connectSrc: 'https://trezor-connect-iframe.vercel.app/',
    manifest: {
      email: 'test@example.com',
      appUrl: 'https://hwk-demo.example.com',
      appName: 'HWK Demo',
    },
    debug: true,
  });
  await trezorHost.start();
}

main().catch(console.error);

// Keep-alive
setInterval(() => {
  chrome.runtime.sendMessage({ type: 'keep-alive' }).catch(() => {});
}, 20_000);
