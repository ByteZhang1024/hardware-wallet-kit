import type { IHardwareWallet, TransportType } from '@bytezhang/hardware-wallet-core';

/**
 * Describes a transport that the adapter supports on this platform.
 */
export interface TransportEntry {
  /** Transport type, e.g. 'usb', 'bridge', 'hid', 'ble' */
  type: TransportType;
  /** Display label shown in the UI */
  label: string;
}

/**
 * Per-vendor provider config. Each platform defines which transports
 * are available and how to create the adapter with all of them registered.
 */
export interface VendorProvider {
  /** Available transports on this platform */
  transports: TransportEntry[];
  /** Factory that creates the adapter with ALL transports registered and initialized */
  create: () => Promise<IHardwareWallet>;
  /** Optional: open a device pairing flow (e.g. extension WebUSB permission page) */
  pair?: () => void;
}

/**
 * Each platform provides vendor configs.
 */
export interface TransportProviders {
  trezor: VendorProvider;
  ledger: VendorProvider;
}
