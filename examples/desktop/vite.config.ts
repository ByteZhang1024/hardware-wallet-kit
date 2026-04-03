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
  ],
  base: './',
  root: 'renderer',
  resolve: {
    alias: {
      'react-native': 'react-native-web',
      '@bytezhang/hardware-wallet-core': path.resolve(__dirname, '../../packages/core/src'),
      '@bytezhang/trezor-transport-web': path.resolve(__dirname, '../../packages/trezor-transport-web/src'),
      '@bytezhang/trezor-transport-node': path.resolve(__dirname, '../../packages/trezor-transport-node/src'),
      '@bytezhang/ledger-transport-web': path.resolve(__dirname, '../../packages/ledger-transport-web/src'),
      '@bytezhang/hardware-trezor-adapter': path.resolve(__dirname, '../../packages/trezor-adapter/src'),
      '@bytezhang/trezor-adapter': path.resolve(__dirname, '../../packages/trezor-adapter/src'),
      '@bytezhang/ledger-adapter': path.resolve(__dirname, '../../packages/ledger-adapter/src'),
      '@bytezhang/trezor-transport-electron/renderer': path.resolve(__dirname, '../../packages/trezor-transport-electron/src/renderer'),
      '@bytezhang/trezor-transport-electron': path.resolve(__dirname, '../../packages/trezor-transport-electron/src'),
      '@examples/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  define: {
    global: 'globalThis',
  },
  build: {
    outDir: '../dist-renderer',
  },
});
