import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ['@ledgerhq/device-management-kit', '@ledgerhq/device-signer-kit-ethereum', 'rxjs'],
});
