import { stripHex } from '@bytezhang/hardware-wallet-core';

/** Strip the "m/" prefix from BIP-44 derivation paths. */
export function normalizePath(path: string): string {
  return path.startsWith('m/') ? path.slice(2) : path;
}

/** Convert a hex string (no 0x prefix) to a Uint8Array. */
export function hexToBytes(hex: string): Uint8Array {
  const clean = stripHex(hex);
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Convert a Uint8Array to a hex string (no 0x prefix). */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
