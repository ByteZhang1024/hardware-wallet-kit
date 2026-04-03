import { build } from 'esbuild';
import { builtinModules } from 'module';

// Node.js builtins + their node: prefixed versions
const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map(m => `node:${m}`),
];

await build({
  entryPoints: ['preload/index.ts'],
  bundle: true,
  platform: 'node',
  outfile: 'dist-preload/index.js',
  external: [
    'electron',
    ...nodeBuiltins,
    // Native modules (loaded at runtime via require)
    'usb',
    'node-hid',
  ],
  format: 'cjs',
  logLevel: 'warning',
});
