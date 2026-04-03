import type { IConnector } from '@bytezhang/hardware-wallet-core';
import type { IDmk } from '@bytezhang/ledger-adapter';

import { LedgerBleConnector } from './LedgerBleConnector';
import type { LedgerBleConnectorOptions } from './LedgerBleConnector';

export { LedgerBleConnector };
export type { LedgerBleConnectorOptions };

/**
 * Create a LedgerBleConnector.
 *
 * @param dmk - Optional pre-built DMK instance. If omitted, the connector
 *              will lazily create one using `@ledgerhq/device-management-kit`
 *              and `@ledgerhq/device-transport-kit-react-native-ble`.
 */
export function createLedgerBleConnector(dmk?: IDmk): IConnector {
  return new LedgerBleConnector({ dmk });
}
