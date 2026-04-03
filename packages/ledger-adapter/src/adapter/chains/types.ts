import type { Response } from '@bytezhang/hardware-wallet-core';

/**
 * Shared context that chain method factories need from the adapter.
 * This avoids circular dependencies between chain files and LedgerAdapter.
 */
export interface LedgerAdapterContext {
  ensureDevicePermission(connectId: string, deviceId: string): Promise<void>;
  verifyDeviceFingerprint(connectId: string, deviceId: string, chain: string): Promise<boolean>;
  connectorCall(connectId: string, method: string, params: unknown): Promise<unknown>;
  errorToFailure<T>(err: unknown): Response<T>;
}
