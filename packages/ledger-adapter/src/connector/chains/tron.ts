import { EConnectorInteraction } from '@bytezhang/hardware-wallet-core';
import { normalizePath } from './utils';
import { SignerTron } from '../../signer/SignerTron';
import { isWrongAppError } from '../../errors';
import type { ConnectorContext } from './types';

// ---------------------------------------------------------------------------
// Call param types
// ---------------------------------------------------------------------------

export interface TronGetAddressCallParams {
  path: string;
  showOnDevice?: boolean;
}

export interface TronSignTransactionCallParams {
  path: string;
  /** Protobuf-encoded raw transaction hex (no 0x prefix) */
  rawTxHex: string;
}

export interface TronSignMessageCallParams {
  path: string;
  /** Message hex (no 0x prefix) */
  messageHex: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * TRON App status codes that are legitimate errors (not "wrong app").
 * If we see one of these, the TRON App IS open -- don't try to switch.
 */
const TRON_APP_KNOWN_CODES = new Set([
  0x6985, // user denied
  0x5515, // device locked
  0x6a8a, // invalid BIP32 path
  0x6a8b,
  0x6a8c,
  0x6a8d, // app-specific data errors
  0x6a80, // invalid data
  0x6b00, // wrong parameter
  0x6700, // wrong length
]);

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function tronGetAddress(
  ctx: ConnectorContext,
  sessionId: string,
  params: TronGetAddressCallParams
): Promise<{ address: string; publicKey: string; path: string }> {
  const path = normalizePath(params.path);
  return _withTronAppRetry(ctx, sessionId, async (signer, sid) => {
    if (params.showOnDevice) {
      ctx.emit('ui-event', {
        type: EConnectorInteraction.ConfirmOnDevice,
        payload: { sessionId: sid },
      });
    }
    const result = await signer.getAddress(path, {
      checkOnDevice: params.showOnDevice ?? false,
    });
    ctx.emit('ui-event', {
      type: EConnectorInteraction.InteractionComplete,
      payload: { sessionId: sid },
    });
    return { address: result.address, publicKey: result.publicKey, path: params.path };
  });
}

export async function tronSignTransaction(
  ctx: ConnectorContext,
  sessionId: string,
  params: TronSignTransactionCallParams
): Promise<{ signature: string }> {
  const path = normalizePath(params.path);
  return _withTronAppRetry(ctx, sessionId, async (signer, sid) => {
    ctx.emit('ui-event', {
      type: EConnectorInteraction.ConfirmOnDevice,
      payload: { sessionId: sid },
    });
    const signature = await signer.signTransaction(path, params.rawTxHex);
    ctx.emit('ui-event', {
      type: EConnectorInteraction.InteractionComplete,
      payload: { sessionId: sid },
    });
    return { signature };
  });
}

export async function tronSignMessage(
  ctx: ConnectorContext,
  sessionId: string,
  params: TronSignMessageCallParams
): Promise<{ signature: string }> {
  const path = normalizePath(params.path);
  return _withTronAppRetry(ctx, sessionId, async (signer, sid) => {
    ctx.emit('ui-event', {
      type: EConnectorInteraction.ConfirmOnDevice,
      payload: { sessionId: sid },
    });
    const signature = await signer.signMessage(path, params.messageHex);
    ctx.emit('ui-event', {
      type: EConnectorInteraction.InteractionComplete,
      payload: { sessionId: sid },
    });
    return { signature };
  });
}

// ---------------------------------------------------------------------------
// Internal -- TRON wrong-app detection
// ---------------------------------------------------------------------------

/**
 * Check if a TRON APDU error indicates the wrong app is open.
 * Uses the shared isWrongAppError() for common codes (0x6e00, 0x6d00, 0x6a83),
 * plus TRON-specific exclusion of known TRON App status codes.
 */
function _isTronWrongAppError(err: unknown): boolean {
  // If the shared detector says "wrong app", trust it
  if (isWrongAppError(err)) return true;
  // Otherwise, check if there's a hex status code in the message
  const msg = (err as any)?.message ?? '';
  const match = msg.match(/0x([0-9a-fA-F]{4})/);
  if (!match) return false;
  const sw = parseInt(match[1], 16);
  // Known TRON App errors -> not wrong app
  if (TRON_APP_KNOWN_CODES.has(sw)) return false;
  // Unknown status code -> likely wrong app or dashboard
  return true;
}

// ---------------------------------------------------------------------------
// Internal -- TRON app switch & retry
// ---------------------------------------------------------------------------

/**
 * Send openApp APDU to switch to TRON App, wait for it to start,
 * then reconnect to get a fresh session (old session is invalid after app switch).
 * Returns the new sessionId.
 */
async function _openTronApp(ctx: ConnectorContext, sessionId: string): Promise<string> {
  const dmk = await ctx.getOrCreateDmk();
  const appName = new TextEncoder().encode('Tron');
  const apdu = new Uint8Array(5 + appName.length);
  apdu[0] = 0xe0;
  apdu[1] = 0xd8;
  apdu[2] = 0x00;
  apdu[3] = 0x00;
  apdu[4] = appName.length;
  apdu.set(appName, 5);

  ctx.emit('ui-event', { type: EConnectorInteraction.ConfirmOpenApp, payload: { sessionId } });
  try {
    await dmk.sendApdu({ sessionId, apdu });
  } catch {
    // openApp triggers disconnect -- expected
  }
  // Wait for app to start
  await new Promise(r => setTimeout(r, 2000));

  // Reconnect: old session is invalid after app switch.
  // Reset signers (not DMK) and open a fresh session.
  ctx.clearAllSigners();
  try {
    const dm = await ctx.getDeviceManager();
    const descriptors = await dm.enumerate();
    if (descriptors.length > 0) {
      const newSessionId = await dm.connect(descriptors[0].path);
      ctx.emit('ui-event', {
        type: EConnectorInteraction.InteractionComplete,
        payload: { sessionId: newSessionId },
      });
      return newSessionId;
    }
  } catch {
    // enumerate/connect may fail -- fall through
  }
  ctx.emit('ui-event', { type: EConnectorInteraction.InteractionComplete, payload: { sessionId } });
  return sessionId; // fallback: return old session (retry will likely fail)
}

/**
 * Execute a TRON operation with automatic wrong-app retry.
 * If the first attempt fails because the wrong app is open,
 * opens the TRON App, reconnects, and retries once.
 */
async function _withTronAppRetry<T>(
  ctx: ConnectorContext,
  sessionId: string,
  action: (signer: SignerTron, sid: string) => Promise<T>
): Promise<T> {
  const signer = await _createTronSigner(ctx, sessionId);
  try {
    return await action(signer, sessionId);
  } catch (err) {
    ctx.emit('ui-event', {
      type: EConnectorInteraction.InteractionComplete,
      payload: { sessionId },
    });
    if (_isTronWrongAppError(err)) {
      const newSessionId = await _openTronApp(ctx, sessionId);
      const retrySigner = await _createTronSigner(ctx, newSessionId);
      return await action(retrySigner, newSessionId);
    }
    ctx.invalidateSession(sessionId);
    throw ctx.wrapError(err);
  }
}

// ---------------------------------------------------------------------------
// Internal -- TRON signer creation
// ---------------------------------------------------------------------------

async function _createTronSigner(ctx: ConnectorContext, sessionId: string): Promise<SignerTron> {
  const dmk = await ctx.getOrCreateDmk();
  // TRON has no dedicated DMK signer kit -- communicate via raw APDUs.
  // Note: raw sendApdu does NOT auto-switch apps like DMK signer kits do.
  // The TRON App must be open on the device before calling TRON methods.
  const sendApdu = async (rawApdu: Uint8Array) => {
    const response = await dmk.sendApdu({ sessionId, apdu: rawApdu });
    return response;
  };
  return new SignerTron(sendApdu);
}
