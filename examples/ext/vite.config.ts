import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import path from 'path';

/**
 * Vite config for the extension.
 *
 * Trezor: uses @trezor/connect-web in iframe mode inside the offscreen document.
 *         The SW only contains a thin message proxy (TrezorOffscreenConnector).
 *         No importScripts or heavy dependency bundling needed in the SW.
 *
 * Offscreen document handles both Ledger (DMK + WebHID) and Trezor
 * (@trezor/connect-web iframe mode).
 */

/**
 * Build the service worker with esbuild.
 * The SW is lightweight now — no TrezorConnect UMD bundle, just the proxy.
 */
function buildServiceWorker(): Plugin {
  return {
    name: 'build-service-worker',
    apply: 'build',
    async closeBundle() {
      const esbuild = await import('esbuild');
      await esbuild.build({
        entryPoints: [path.resolve(__dirname, 'src/background/service-worker.ts')],
        bundle: true,
        outfile: path.resolve(__dirname, 'dist/service-worker.js'),
        format: 'iife',
        platform: 'browser',
        target: 'chrome115',
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ['@mgcrea/react-native-tailwind/babel'],
      },
    }),
    nodePolyfills({ include: ['buffer', 'process'] }),
    buildServiceWorker(),
  ],
  resolve: {
    alias: {
      'react-native': 'react-native-web',
      '@bytezhang/hardware-wallet-core': path.resolve(__dirname, '../../packages/core/src'),
      '@bytezhang/hardware-transport-core': path.resolve(__dirname, '../../packages/transport-core/src'),
      '@bytezhang/hardware-trezor-adapter': path.resolve(__dirname, '../../packages/trezor-adapter/src'),
      '@bytezhang/trezor-adapter': path.resolve(__dirname, '../../packages/trezor-adapter/src'),
      '@bytezhang/ledger-adapter': path.resolve(__dirname, '../../packages/ledger-adapter/src'),
      '@examples/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
  define: {
    global: 'globalThis',
  },
  base: './',
  build: {
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, 'popup/index.html'),
        tab: path.resolve(__dirname, 'tab/index.html'),
        offscreen: path.resolve(__dirname, 'offscreen/index.html'),
        pairing: path.resolve(__dirname, 'pairing/index.html'),
      },
      output: {
        entryFileNames: '[name].js',
      },
    },
    outDir: 'dist',
  },
});
