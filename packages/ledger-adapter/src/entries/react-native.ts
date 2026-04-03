import { registerTransport } from '../transport/registry';
import type { TransportProvider } from '../types';

export function registerRnBleTransport(options?: { logger?: unknown }): void {
  const provider: TransportProvider = {
    create: ({ logger } = {}) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { DeviceManagementKitBuilder } = require('@ledgerhq/device-management-kit');
      // No "main" field in this package — Metro can't resolve standard imports.
      // CJS deep path works because exports includes "./*".
      /* eslint-disable @typescript-eslint/no-require-imports */
      const {
        rnBleTransportFactory,
      } = require('@ledgerhq/device-transport-kit-react-native-ble/lib/cjs/index.js');
      /* eslint-enable @typescript-eslint/no-require-imports */

      const builder = new DeviceManagementKitBuilder();
      builder.addTransport(rnBleTransportFactory);

      const resolvedLogger = logger ?? options?.logger;
      if (resolvedLogger) {
        builder.addLogger(resolvedLogger);
      }

      return { dmk: builder.build() };
    },
  };

  registerTransport('BLE', provider);
}
