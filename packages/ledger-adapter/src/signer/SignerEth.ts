import type { SignerEvmAddress, SignerEvmSignature } from '../types';
import { deviceActionToPromise } from './deviceActionToPromise';

/**
 * SDK signer interface — duck-typed to avoid hard dependency on
 * @ledgerhq/device-signer-kit-ethereum.
 */
export interface ISdkSignerEth {
  getAddress(derivationPath: string, options?: { checkOnDevice?: boolean }): unknown;
  signTransaction(derivationPath: string, transaction: Uint8Array, options?: unknown): unknown;
  signMessage(derivationPath: string, message: string | Uint8Array): unknown;
  signTypedData(derivationPath: string, data: unknown): unknown;
}

/** Convert hex string (with or without 0x) to Uint8Array. */
function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Timeout for user-interactive operations (verify address, sign). */
const INTERACTIVE_TIMEOUT_MS = 5 * 60_000;

/**
 * Wraps Ledger's SDK signer (Observable-based DeviceActions) into
 * a simple async interface returning plain serializable data.
 */
export class SignerEth {
  onInteraction?: (interaction: string) => void;

  constructor(private readonly _sdk: ISdkSignerEth) {}

  async getAddress(
    derivationPath: string,
    options?: { checkOnDevice?: boolean }
  ): Promise<SignerEvmAddress> {
    const checkOnDevice = options?.checkOnDevice ?? false;
    console.log('[DMK] getAddress → DMK:', { derivationPath, checkOnDevice });
    console.log('[DMK] signer instance id:', (this as any)._instanceId ?? 'none');
    const action = this._sdk.getAddress(derivationPath, {
      checkOnDevice,
    });
    console.log(
      '[DMK] getAddress action created:',
      !!action,
      'hasObservable:',
      !!(action as any)?.observable
    );
    // checkOnDevice needs user interaction → long timeout; otherwise default 30s
    const timeout = checkOnDevice ? INTERACTIVE_TIMEOUT_MS : undefined;
    return deviceActionToPromise<SignerEvmAddress>(action as any, this.onInteraction, timeout);
  }

  async signTransaction(
    derivationPath: string,
    serializedTxHex: string
  ): Promise<SignerEvmSignature> {
    const action = this._sdk.signTransaction(derivationPath, hexToBytes(serializedTxHex));
    return deviceActionToPromise<SignerEvmSignature>(
      action as any,
      this.onInteraction,
      INTERACTIVE_TIMEOUT_MS
    );
  }

  async signMessage(derivationPath: string, message: string): Promise<SignerEvmSignature> {
    // DMK treats string as ASCII text (addAsciiStringToData), but we receive
    // hex-encoded message bytes. Decode to Uint8Array so DMK uses
    // addBufferToData — matching the OneKey SDK's behavior.
    const action = this._sdk.signMessage(derivationPath, hexToBytes(message));
    return deviceActionToPromise<SignerEvmSignature>(
      action as any,
      this.onInteraction,
      INTERACTIVE_TIMEOUT_MS
    );
  }

  async signTypedData(derivationPath: string, data: unknown): Promise<SignerEvmSignature> {
    const action = this._sdk.signTypedData(derivationPath, data);
    return deviceActionToPromise<SignerEvmSignature>(
      action as any,
      this.onInteraction,
      INTERACTIVE_TIMEOUT_MS
    );
  }
}
