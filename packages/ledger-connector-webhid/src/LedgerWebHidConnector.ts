import type { DeviceDescriptor } from '@bytezhang/hardware-wallet-core';
import type { IDmk } from '@bytezhang/ledger-adapter';
import { LedgerConnectorBase } from '@bytezhang/ledger-adapter';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Extract the stable 4-digit HEX identifier from a Ledger BLE device name.
 * e.g., "Nano X 123A" -> "123A", "Ledger Nano X AB12" -> "AB12"
 * Returns undefined if no valid HEX suffix found.
 */
function extractBleHexId(name?: string): string | undefined {
  if (!name) return undefined;
  const match = name.match(/\b([0-9A-Fa-f]{4})$/);
  return match ? match[1].toUpperCase() : undefined;
}

// ---------------------------------------------------------------------------
// LedgerWebHidConnector
// ---------------------------------------------------------------------------

export interface LedgerWebHidConnectorOptions {
  /**
   * Pre-built DMK instance. If not provided, a DMK will be created
   * lazily on first use via `@ledgerhq/device-management-kit` and
   * `@ledgerhq/device-transport-kit-web-hid`.
   */
  dmk?: IDmk;
}

/**
 * IConnector implementation for Ledger hardware wallets via WebHID.
 *
 * Extends LedgerConnectorBase with the WebHID transport factory.
 * Overrides connectId resolution to handle BLE devices that may appear
 * via a WebHID+BLE combo transport.
 */
export class LedgerWebHidConnector extends LedgerConnectorBase {
  constructor(options?: LedgerWebHidConnectorOptions) {
    super(
      async () => {
        const { webHidTransportFactory } = await import('@ledgerhq/device-transport-kit-web-hid');
        return webHidTransportFactory;
      },
      { connectionType: 'usb', dmk: options?.dmk }
    );
  }

  /**
   * Override connectId resolution for BLE devices discovered via WebHID+BLE combo.
   * For USB devices, the DMK path (ephemeral UUID) is used as-is.
   */
  protected override _resolveConnectId(descriptor: DeviceDescriptor): string {
    if (descriptor.transport === 'BLE') {
      return extractBleHexId(descriptor.name) || descriptor.path;
    }
    return descriptor.path;
  }
}
