import type { IDmk } from '../../types';
import type { SignerManager } from '../../signer/SignerManager';
import type { LedgerDeviceManager } from '../../device/LedgerDeviceManager';

/**
 * Context provided by LedgerConnectorBase to per-chain handlers.
 * Exposes only what chain methods need — no access to raw connector internals.
 */
export interface ConnectorContext {
  emit(event: string, data: unknown): void;
  invalidateSession(sessionId: string): void;
  wrapError(err: unknown): Error;
  getOrCreateDmk(): Promise<IDmk>;
  getDeviceManager(): Promise<LedgerDeviceManager>;
  getSignerManager(): Promise<SignerManager>;
  clearAllSigners(): void;
  importLedgerKit: (pkg: string) => Promise<any>;
}
