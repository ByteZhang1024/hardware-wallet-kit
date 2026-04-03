/**
 * Fix missing "main" field in Ledger signer kit packages.
 *
 * @ledgerhq/device-signer-kit-ethereum and @ledgerhq/device-signer-kit-solana
 * only have "exports" (no "main"). Metro (React Native) can't resolve packages
 * without a "main" field. This script adds "main": "lib/cjs/index.js" so that
 * both webpack (uses "exports") and Metro (uses "main") can resolve them.
 *
 * Run as part of postinstall.
 */
const fs = require('fs');
const path = require('path');

const PACKAGES_TO_FIX = [
  '@ledgerhq/device-signer-kit-ethereum',
  '@ledgerhq/device-signer-kit-solana',
];

const MAIN_ENTRY = 'lib/cjs/index.js';

for (const pkg of PACKAGES_TO_FIX) {
  const pkgJsonPath = path.join(__dirname, '..', 'node_modules', pkg, 'package.json');

  if (!fs.existsSync(pkgJsonPath)) {
    // Package not installed — skip silently
    continue;
  }

  try {
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));

    if (pkgJson.main) {
      // Already has "main" — nothing to do
      continue;
    }

    // Verify the CJS entry point exists
    const cjsPath = path.join(path.dirname(pkgJsonPath), MAIN_ENTRY);
    if (!fs.existsSync(cjsPath)) {
      console.warn(`[fix-ledger-packages] CJS entry not found for ${pkg}: ${cjsPath}`);
      continue;
    }

    pkgJson.main = MAIN_ENTRY;
    fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n');
    console.log(`[fix-ledger-packages] Added "main": "${MAIN_ENTRY}" to ${pkg}`);
  } catch (err) {
    console.error(`[fix-ledger-packages] Failed to fix ${pkg}:`, err.message);
  }
}
