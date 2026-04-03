import { registerTransport } from '../transport/registry';
import type { TransportProvider } from '../types';

export function registerWebTransports(options?: { logger?: unknown }): void {
  const provider: TransportProvider = {
    create: ({ logger } = {}) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { DeviceManagementKitBuilder } = require('@ledgerhq/device-management-kit');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { webHidTransportFactory } = require('@ledgerhq/device-transport-kit-web-hid');

      const builder = new DeviceManagementKitBuilder();
      builder.addTransport(webHidTransportFactory);

      const resolvedLogger = logger ?? options?.logger;
      if (resolvedLogger) {
        builder.addLogger(resolvedLogger);
      }

      return { dmk: builder.build() };
    },
  };

  registerTransport('WebHID', provider);
}
