import type { IConnector } from '@bytezhang/hardware-wallet-core';
import type { IDmk } from '@bytezhang/ledger-adapter';

import { LedgerWebHidConnector } from './LedgerWebHidConnector';
import type { LedgerWebHidConnectorOptions } from './LedgerWebHidConnector';

export { LedgerWebHidConnector };
export type { LedgerWebHidConnectorOptions };

/**
 * Create a LedgerWebHidConnector.
 *
 * @param dmk - Optional pre-built DMK instance. If omitted, the connector
 *              will lazily create one using `@ledgerhq/device-management-kit`
 *              and `@ledgerhq/device-transport-kit-web-hid`.
 */
export function createLedgerWebHidConnector(dmk?: IDmk): IConnector {
  return new LedgerWebHidConnector({ dmk });
}
