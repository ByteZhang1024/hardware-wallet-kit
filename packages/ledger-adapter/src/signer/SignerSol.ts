import { deviceActionToPromise } from './deviceActionToPromise';

/**
 * SDK SOL signer interface — duck-typed to avoid hard dependency on
 * @ledgerhq/device-signer-kit-solana.
 */
export interface ISdkSignerSol {
  getAddress(derivationPath: string, options?: { checkOnDevice?: boolean }): unknown;
  signTransaction(derivationPath: string, transaction: Uint8Array, options?: unknown): unknown;
  signMessage(derivationPath: string, message: string | Uint8Array, options?: unknown): unknown;
}

/**
 * Wraps Ledger's Solana SDK signer (Observable-based DeviceActions) into
 * a simple async interface returning plain serializable data.
 *
 * The Solana signer's `getAddress` returns a base58-encoded Ed25519 public key,
 * which is also the Solana address.
 */
export class SignerSol {
  onInteraction?: (interaction: string) => void;

  constructor(private readonly _sdk: ISdkSignerSol) {}

  /**
   * Get the Solana address (base58-encoded Ed25519 public key) at the given derivation path.
   */
  async getAddress(derivationPath: string, options?: { checkOnDevice?: boolean }): Promise<string> {
    const action = this._sdk.getAddress(derivationPath, {
      checkOnDevice: options?.checkOnDevice ?? false,
    });
    return deviceActionToPromise<string>(action as any, this.onInteraction);
  }

  /**
   * Sign a Solana transaction.
   */
  async signTransaction(
    derivationPath: string,
    transaction: Uint8Array,
    options?: unknown
  ): Promise<Uint8Array> {
    const action = this._sdk.signTransaction(derivationPath, transaction, options);
    return deviceActionToPromise<Uint8Array>(action as any, this.onInteraction);
  }

  /**
   * Sign a message with the Solana app.
   * DMK returns { signature: string } for signMessage (unlike signTransaction which returns Uint8Array).
   */
  async signMessage(
    derivationPath: string,
    message: string | Uint8Array,
    options?: unknown
  ): Promise<{ signature: string }> {
    const action = this._sdk.signMessage(derivationPath, message, options);
    return deviceActionToPromise<{ signature: string }>(action as any, this.onInteraction);
  }
}
