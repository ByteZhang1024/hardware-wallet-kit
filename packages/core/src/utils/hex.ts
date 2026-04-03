/** Ensure hex string has 0x prefix */
export function ensure0x(hex: string): string {
  return hex.startsWith('0x') ? hex : `0x${hex}`;
}

/** Strip 0x prefix from hex string */
export function stripHex(hex: string): string {
  return hex.startsWith('0x') ? hex.slice(2) : hex;
}

/** Pad hex to 64 chars (32 bytes) with 0x prefix */
export function padHex64(hex: string): string {
  return `0x${stripHex(hex).padStart(64, '0')}`;
}
