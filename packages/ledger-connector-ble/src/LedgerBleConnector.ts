import type { DeviceDescriptor } from '@bytezhang/hardware-wallet-core';
import type { IDmk } from '@bytezhang/ledger-adapter';
import { LedgerConnectorBase } from '@bytezhang/ledger-adapter';

function extractBleHexId(name?: string): string | undefined {
  if (!name) return undefined;
  const match = name.match(/\b([0-9A-Fa-f]{4})$/);
  return match ? match[1].toUpperCase() : undefined;
}

export interface LedgerBleConnectorOptions {
  dmk?: IDmk;
}

export class LedgerBleConnector extends LedgerConnectorBase {
  constructor(options?: LedgerBleConnectorOptions) {
    super(
      async () => {
        const { RNBleTransportFactory } =
          await import('@ledgerhq/device-transport-kit-react-native-ble');
        return RNBleTransportFactory;
      },
      { connectionType: 'ble', dmk: options?.dmk }
    );
  }

  protected override _resolveConnectId(descriptor: DeviceDescriptor): string {
    return extractBleHexId(descriptor.name) || descriptor.path;
  }
}
