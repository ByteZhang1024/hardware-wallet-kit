import { registerTransport } from '../transport/registry';
import type { TransportProvider } from '../types';

export function registerNodeTransport(options?: { logger?: unknown }): void {
  const provider: TransportProvider = {
    create: ({ logger } = {}) => {
      const { DeviceManagementKitBuilder } = require('@ledgerhq/device-management-kit');
      const { nodeHidTransportFactory } = require('@ledgerhq/device-transport-kit-node-hid');

      const builder = new DeviceManagementKitBuilder();
      builder.addTransport(nodeHidTransportFactory);

      const resolvedLogger = logger ?? options?.logger;
      if (resolvedLogger) {
        builder.addLogger(resolvedLogger);
      }

      return { dmk: builder.build() };
    },
  };

  registerTransport('NodeHID', provider);
}
