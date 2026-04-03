/**
 * Service Worker for HWK Extension.
 *
 * Trezor: forwards calls to the offscreen document via TrezorOffscreenConnector.
 *         The offscreen document runs @trezor/connect-web in iframe mode
 *         (no importScripts, no CSP issues, no popup).
 *
 * Ledger: relays messages to the offscreen document (LedgerAdapterHost).
 *
 * Store-and-forward: long-running calls (getAddress, sign) are stored
 * in `pendingCallResult`. If the popup closes before sendResponse,
 * the popup can retrieve the result via 'getLastCallResult' on reopen.
 */

console.log('[HWK-SW] Service worker loaded');

// ─── Channel constants (inlined to avoid workspace import chain) ─

const TREZOR_CHANNEL = 'trezor-ext-connect';
const TREZOR_EVENT_CHANNEL = 'trezor-ext-event';

interface TrezorMessage {
  channel: typeof TREZOR_CHANNEL;
  id: string;
  method: 'init' | 'dispose' | 'call' | 'cancel' | 'uiResponse' | 'enumerate' | 'getLastCallResult';
  params?: unknown;
}

interface TrezorResponse {
  channel: typeof TREZOR_CHANNEL;
  id: string;
  result?: unknown;
  error?: string;
}

// ─── Pending call result store ──────────────────────────────
// When a long-running call completes but the popup is closed,
// the result is stored here for retrieval on next popup open.

let pendingCallResult: { method: string; result: unknown } | null = null;

// ─── TrezorOffscreenConnector (lazy import) ─────────────────

import { TrezorOffscreenConnector } from '@examples/shared/ext/trezor';

let trezorConnector: TrezorOffscreenConnector | null = null;
let trezorReady: Promise<void> | null = null;

function ensureTrezor(): Promise<void> {
  if (!trezorReady) {
    trezorReady = (async () => {
      await ensureOffscreen();

      trezorConnector = new TrezorOffscreenConnector({
        offscreenUrl: 'offscreen/index.html',
      });

      // Forward events from the connector to the popup
      for (const eventType of ['DEVICE_EVENT', 'UI_EVENT', 'TRANSPORT_EVENT']) {
        trezorConnector.on(eventType, (event: unknown) => {
          chrome.runtime.sendMessage({
            channel: TREZOR_EVENT_CHANNEL,
            payload: event,
          }).catch(() => {});
        });
      }

      await trezorConnector.init();
      console.log('[HWK-SW] TrezorOffscreenConnector initialized');
    })();
  }
  return trezorReady;
}

// ─── Trezor message handler ─────────────────────────────────

async function handleTrezorMessage(msg: TrezorMessage): Promise<TrezorResponse> {
  await ensureTrezor();
  const { id, method, params } = msg;
  const base = { channel: TREZOR_CHANNEL as typeof TREZOR_CHANNEL, id };
  const tc = trezorConnector!;

  try {
    switch (method) {
      case 'init':
        return { ...base, result: { success: true } };
      case 'dispose':
        tc.dispose();
        trezorConnector = null;
        trezorReady = null;
        return { ...base, result: { success: true } };
      case 'cancel':
        tc.cancel((params as { reason?: string })?.reason);
        return { ...base, result: { success: true } };
      case 'uiResponse':
        tc.uiResponse(params as { type: string; payload: unknown });
        return { ...base, result: { success: true } };
      case 'enumerate':
        return { ...base, result: { devices: await tc.enumerate() } };

      case 'call': {
        const { method: connectMethod, ...connectParams } = params as Record<string, unknown>;
        // Use the connector's typed methods
        const fn = (tc as unknown as Record<string, unknown>)[connectMethod as string];
        if (typeof fn !== 'function') {
          return { ...base, error: `Unknown TrezorConnect method: ${connectMethod}` };
        }
        const result = await (fn as (p: unknown) => Promise<unknown>).call(tc, connectParams);

        // Store result for popup retrieval if sendResponse fails (popup closed)
        pendingCallResult = { method: connectMethod as string, result };

        // Also broadcast — if popup is still open it receives via event listener
        chrome.runtime.sendMessage({
          channel: TREZOR_EVENT_CHANNEL,
          payload: { event: 'CALL_RESULT', type: 'call-result', callResult: result },
        }).catch(() => {});

        return { ...base, result };
      }

      case 'getLastCallResult': {
        const stored = pendingCallResult;
        pendingCallResult = null;
        return { ...base, result: stored };
      }

      default:
        return { ...base, error: `Unknown method: ${method}` };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { ...base, error: message };
  }
}

// ─── Offscreen document management ──────────────────────────

let offscreenReady: Promise<void> | null = null;

function ensureOffscreen(): Promise<void> {
  if (!offscreenReady) {
    offscreenReady = (async () => {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
      });
      if (contexts.length > 0) return;
      await chrome.offscreen.createDocument({
        url: 'offscreen/index.html',
        reasons: ['BLOBS' as chrome.offscreen.Reason],
        justification: 'Hardware wallet USB/HID communication',
      });
      await new Promise(r => setTimeout(r, 200));
    })();
  }
  return offscreenReady;
}

// ─── Message relay ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Trezor: forward via TrezorOffscreenConnector
  if (message?.channel === TREZOR_CHANNEL) {
    handleTrezorMessage(message as TrezorMessage)
      .then(sendResponse)
      .catch((err) => sendResponse({
        channel: TREZOR_CHANNEL,
        id: (message as TrezorMessage).id,
        error: err instanceof Error ? err.message : 'SW Trezor handler failed',
      }));
    return true;
  }

  // Ledger: relay to offscreen
  if (message?.channel === 'hw-ledger-adapter') {
    const senderUrl = sender.url ?? '';
    if (senderUrl.includes('offscreen')) return;
    ensureOffscreen()
      .then(() => chrome.runtime.sendMessage(message))
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err instanceof Error ? err.message : 'relay failed' }));
    return true;
  }
});

// ─── Lifecycle events ───────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => { ensureOffscreen(); });
chrome.runtime.onStartup.addListener(() => { ensureOffscreen(); });
ensureOffscreen();
