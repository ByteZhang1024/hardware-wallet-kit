import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import path from 'path';

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ['@mgcrea/react-native-tailwind/babel'],
      },
    }),
    nodePolyfills({ include: ['buffer', 'process'] }),
    {
      name: 'no-fallback-for-js',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url && /\.(js|mjs|cjs)$/.test(req.url.split('?')[0])) {
            req.url = req.originalUrl;
          }
          next();
        });
      },
    },
  ],
  resolve: {
    alias: {
      'react-native': 'react-native-web',
      '@bytezhang/hardware-wallet-core': path.resolve(__dirname, '../../packages/core/src'),
      '@bytezhang/trezor-protobuf': path.resolve(__dirname, '../../packages/trezor-protobuf/src'),
      '@bytezhang/trezor-protocol': path.resolve(__dirname, '../../packages/trezor-protocol/src'),
      '@bytezhang/trezor-transport-web': path.resolve(__dirname, '../../packages/trezor-transport-web/src'),
      '@bytezhang/ledger-transport-web': path.resolve(__dirname, '../../packages/ledger-transport-web/src'),
      '@bytezhang/trezor-adapter': path.resolve(__dirname, '../../packages/trezor-adapter/src'),
      '@bytezhang/ledger-adapter': path.resolve(__dirname, '../../packages/ledger-adapter/src'),
      '@examples/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  define: {
    global: 'globalThis',
  },
});
