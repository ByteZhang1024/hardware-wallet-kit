import { useState, useRef, useCallback, useMemo } from 'react';
import type { IHardwareWallet, TransportType } from '@bytezhang/hardware-wallet-core';
import { UI_REQUEST, SDK } from '@bytezhang/hardware-wallet-core';
import type { TransportProviders } from './types';

const ETH_PATH = "m/44'/60'/0'/0/0";
const BTC_PATH_SEGWIT = "m/84'/0'/0'/0/0";
const BTC_ACCOUNT_PATH = "m/84'/0'/0'";
const SOL_PATH = "m/44'/501'/0'/0'";

export interface VendorOps {
  init: () => Promise<void>;
  switchTransport: (type: string) => Promise<void>;
  search: () => Promise<void>;
  // EVM
  evmGetAddress: () => Promise<void>;
  evmGetPublicKey: () => Promise<void>;
  evmBatchGetAddresses: () => Promise<void>;
  evmSignTx: () => Promise<void>;
  evmSignMessage: () => Promise<void>;
  evmSignTypedData: () => Promise<void>;
  // BTC
  btcGetAddress: () => Promise<void>;
  btcGetPublicKey: () => Promise<void>;
  btcSignTx: () => Promise<void>;
  btcSignMessage: () => Promise<void>;
  // SOL
  solGetAddress: () => Promise<void>;
  solSignTx: () => Promise<void>;
  // Device management
  connectDevice: () => Promise<void>;
  disconnectDevice: () => Promise<void>;
  getDeviceInfo: () => Promise<void>;
}

export interface UseHardwareWalletResult {
  logs: string[];
  trezor: VendorOps;
  ledger: VendorOps;
}

export function useHardwareWallet(providers: TransportProviders): UseHardwareWalletResult {
  const [logs, setLogs] = useState<string[]>([]);
  const trezorRef = useRef<IHardwareWallet | null>(null);
  const ledgerRef = useRef<IHardwareWallet | null>(null);
  const trezorDeviceRef = useRef<{ connectId: string; deviceId: string } | null>(null);
  const ledgerDeviceRef = useRef<{ connectId: string; deviceId: string } | null>(null);

  const log = useCallback((msg: string, data?: unknown) => {
    const line = data ? `${msg}:\n${JSON.stringify(data, null, 2)}` : msg;
    setLogs((prev) => [line, ...prev]);
    console.log(msg, data);
  }, []);

  const withDevice = useCallback(
    async (
      ref: { current: IHardwareWallet | null },
      deviceRef: { current: { connectId: string; deviceId: string } | null },
      vendor: string,
      op: (adapter: IHardwareWallet, connectId: string, deviceId: string) => Promise<void>,
    ) => {
      const adapter = ref.current;
      if (!adapter) { log(`Init ${vendor} first`); return; }
      try {
        const devices = await adapter.searchDevices();
        if (devices.length) {
          const { connectId, deviceId } = devices[0];
          deviceRef.current = { connectId, deviceId };
        }
        // Use cached device or empty string (connect-web popup mode handles device selection)
        const connectId = deviceRef.current?.connectId ?? '';
        const deviceId = deviceRef.current?.deviceId ?? '';
        await op(adapter, connectId, deviceId);
      } catch (e: any) {
        log(`${vendor} error: ${e.message}`);
      }
    },
    [log],
  );

  // --- Trezor init ---
  const initTrezor = useCallback(async () => {
    try {
      const adapter = await providers.trezor.create();
      adapter.setUiHandler({
        onPinRequest: async () => {
          log('Trezor PIN requested — enter on device');
          return '';
        },
        onPassphraseRequest: async () => {
          log('Trezor passphrase requested');
          return '';
        },
        checkDevicePermission: async ({ transportType, connectId }) => {
          if (transportType === 'usb') {
            // Business method with known device: USB authorization doesn't expire,
            // device was already accessible during search — skip re-check.
            if (connectId) return { granted: true };
            // searchDevices: check if any USB device is paired
            try {
              const devices = await navigator.usb?.getDevices?.();
              return { granted: (devices?.length ?? 0) > 0 };
            } catch {
              return { granted: false };
            }
          }
          if (transportType === 'ble') {
            // All methods: check BLE environment
            return { granted: false, context: { reason: 'ble-not-supported-in-web' } };
          }
          return { granted: false };
        },
        onDevicePermission: async ({ transportType, context }) => {
          log(`Trezor device permission requested (${transportType})`, context);
          providers.trezor.pair?.();
        },
      });
      adapter.on(UI_REQUEST.REQUEST_BUTTON, (event) => {
        log('Trezor button-request — confirm on device', event);
      });
      trezorRef.current = adapter;
      log('Trezor initialized');
    } catch (e: any) {
      log('Trezor init error: ' + e.message);
    }
  }, [log, providers.trezor]);

  // --- Ledger init ---
  const initLedger = useCallback(async () => {
    try {
      const adapter = await providers.ledger.create();
      adapter.setUiHandler({
        onPinRequest: async () => {
          log('Ledger PIN requested — enter on device');
          return '';
        },
        onPassphraseRequest: async () => {
          log('Ledger passphrase requested');
          return '';
        },
        checkDevicePermission: async ({ transportType, connectId }) => {
          if (transportType === 'hid' || transportType === 'usb') {
            // Business method with known device: authorization doesn't expire
            if (connectId) return { granted: true };
            // searchDevices: check if any device is paired
            try {
              const api = transportType === 'hid' ? navigator.hid : navigator.usb;
              const devices = await (api as any)?.getDevices?.();
              return { granted: (devices?.length ?? 0) > 0 };
            } catch {
              return { granted: false };
            }
          }
          if (transportType === 'ble') {
            return { granted: false, context: { reason: 'ble-not-supported-in-web' } };
          }
          return { granted: false };
        },
        onDevicePermission: async ({ transportType, context }) => {
          log(`Ledger device permission requested (${transportType})`, context);
          providers.ledger.pair?.();
        },
        onSelectDevice: async (devices) => {
          log('Ledger select device', devices);
          return devices[0]?.deviceId ?? '';
        },
      });
      adapter.on(UI_REQUEST.REQUEST_BUTTON, (event: any) => {
        log('Ledger button-request', event);
      });
      adapter.on(SDK.DEVICE_INTERACTION, (event: any) => {
        const interaction = event?.payload?.action;
        const messages: Record<string, string> = {
          'unlock-device': 'Please unlock your Ledger device',
          'confirm-open-app': 'Please confirm opening the app on your Ledger',
          'verify-address': 'Please verify the address on your Ledger',
          'sign-transaction': 'Please confirm the transaction on your Ledger',
          'sign-message': 'Please confirm the message on your Ledger',
          'sign-typed-data': 'Please confirm the typed data on your Ledger',
        };
        log(messages[interaction] ?? `Ledger interaction: ${interaction}`);
      });
      ledgerRef.current = adapter;
      log('Ledger initialized');
    } catch (e: any) {
      log('Ledger init error: ' + e.message);
    }
  }, [log, providers.ledger]);

  // --- Chain operations factory ---
  const createOps = useCallback(
    (
      ref: { current: IHardwareWallet | null },
      deviceRef: { current: { connectId: string; deviceId: string } | null },
      vendor: string,
    ) => {
      const run = (
        op: (a: IHardwareWallet, cid: string, did: string) => Promise<void>,
      ) => withDevice(ref, deviceRef, vendor, op);

      return {
        switchTransport: async (type: string) => {
          const adapter = ref.current;
          if (!adapter) { log(`Init ${vendor} first`); return; }
          try {
            await adapter.switchTransport(type as TransportType);
            log(`${vendor} switched transport to ${type}`);
          } catch (e: any) {
            log(`${vendor} switchTransport error: ${e.message}`);
          }
        },

        search: async () => {
          const adapter = ref.current;
          if (!adapter) { log(`Init ${vendor} first`); return; }
          try {
            const devices = await adapter.searchDevices();
            log(`${vendor} devices`, devices);
            if (devices.length) {
              deviceRef.current = {
                connectId: devices[0].connectId,
                deviceId: devices[0].deviceId,
              };
            }
          } catch (e: any) {
            log(`${vendor} search error: ${e.message}`);
          }
        },

        // --- EVM (Cycles 1-4) ---
        evmGetAddress: () => run(async (a, cid, did) => {
          log(`${vendor} ETH address`, await a.evmGetAddress(cid, did, { path: ETH_PATH }));
        }),
        evmGetPublicKey: () => run(async (a, cid, did) => {
          log(`${vendor} ETH publicKey`, await a.evmGetPublicKey(cid, did, { path: ETH_PATH }));
        }),
        evmBatchGetAddresses: () => run(async (a, cid, did) => {
          const paths = Array.from({ length: 10 }, (_, i) => ({
            path: `m/44'/60'/0'/0/${i}`,
          }));
          log(`${vendor} batch ETH addresses`, await a.evmGetAddresses(cid, did, paths, (p) => {
            log(`${vendor} progress: ${p.index + 1}/${p.total}`);
          }));
        }),
        evmSignTx: () => run(async (a, cid, did) => {
          log(`${vendor} ETH signTx`, await a.evmSignTransaction(cid, did, {
            path: ETH_PATH,
            to: '0x0000000000000000000000000000000000000000',
            value: '0x0',
            gasLimit: '0x5208',
            gasPrice: '0x4A817C800',
            nonce: '0x0',
            chainId: 1,
          }));
        }),
        // Cycle 1: EVM signMessage
        evmSignMessage: () => run(async (a, cid, did) => {
          log(`${vendor} ETH signMessage`, await a.evmSignMessage(cid, did, {
            path: ETH_PATH,
            message: 'Hello OneKey',
          }));
        }),
        // Cycle 2: EVM signTypedData (Uniswap Permit2 example)
        evmSignTypedData: () => run(async (a, cid, did) => {
          log(`${vendor} ETH signTypedData`, await a.evmSignTypedData(cid, did, {
            path: ETH_PATH,
            mode: 'full',
            data: {
              domain: {
                name: 'Uniswap V2',
                version: '1',
                chainId: 1,
                verifyingContract: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
              },
              types: {
                EIP712Domain: [
                  { name: 'name', type: 'string' },
                  { name: 'version', type: 'string' },
                  { name: 'chainId', type: 'uint256' },
                  { name: 'verifyingContract', type: 'address' },
                ],
                PermitSingle: [
                  { name: 'details', type: 'PermitDetails' },
                  { name: 'spender', type: 'address' },
                  { name: 'sigDeadline', type: 'uint256' },
                ],
                PermitDetails: [
                  { name: 'token', type: 'address' },
                  { name: 'amount', type: 'uint160' },
                  { name: 'expiration', type: 'uint48' },
                  { name: 'nonce', type: 'uint48' },
                ],
              },
              primaryType: 'PermitSingle',
              message: {
                details: {
                  token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
                  amount: '1461501637330902918203684832716283019655932542975',
                  expiration: '1709596800',
                  nonce: '0',
                },
                spender: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
                sigDeadline: '1709596800',
              },
            },
          }));
        }),

        // --- BTC (Cycles 5-7) ---
        btcGetAddress: () => run(async (a, cid, did) => {
          log(`${vendor} BTC address (segwit)`, await a.btcGetAddress(cid, did, {
            path: BTC_PATH_SEGWIT,
            scriptType: 'p2wpkh',
            coin: 'btc',
          }));
        }),
        btcGetPublicKey: () => run(async (a, cid, did) => {
          log(`${vendor} BTC publicKey (xpub + fingerprint)`, await a.btcGetPublicKey(cid, did, {
            path: BTC_ACCOUNT_PATH,
            coin: 'btc',
          }));
        }),
        btcSignTx: () => run(async (a, cid, did) => {
          log(`${vendor} BTC signTx`, await a.btcSignTransaction(cid, did, {
            coin: 'btc',
            inputs: [{
              path: BTC_PATH_SEGWIT,
              prevHash: 'e5040e1bc1ae7667ffb9e5248e90b2fb93cd9150234151ce90e14ab2f5933bcd',
              prevIndex: 0,
              amount: '100000',
            }],
            outputs: [{
              address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
              amount: '90000',
            }],
          }));
        }),
        btcSignMessage: () => run(async (a, cid, did) => {
          log(`${vendor} BTC signMessage`, await a.btcSignMessage(cid, did, {
            path: BTC_PATH_SEGWIT,
            message: 'Hello OneKey BTC',
            coin: 'btc',
          }));
        }),

        // --- SOL (Cycles 8-9) ---
        solGetAddress: () => run(async (a, cid, did) => {
          log(`${vendor} SOL address`, await a.solGetAddress(cid, did, { path: SOL_PATH }));
        }),
        solSignTx: () => run(async (a, cid, did) => {
          // Mock serialized Solana transaction (base64-encoded)
          log(`${vendor} SOL signTx`, await a.solSignTransaction(cid, did, {
            path: SOL_PATH,
            serializedTx: 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAEDE',
          }));
        }),

        // --- Device management (Cycle 10) ---
        connectDevice: async () => {
          const adapter = ref.current;
          if (!adapter) { log(`Init ${vendor} first`); return; }
          const d = deviceRef.current;
          if (!d) { log(`Search ${vendor} devices first`); return; }
          try {
            log(`${vendor} connectDevice`, await adapter.connectDevice(d.connectId));
          } catch (e: any) {
            log(`${vendor} connect error: ${e.message}`);
          }
        },
        disconnectDevice: async () => {
          const adapter = ref.current;
          if (!adapter) { log(`Init ${vendor} first`); return; }
          const d = deviceRef.current;
          if (!d) { log(`Search ${vendor} devices first`); return; }
          try {
            await adapter.disconnectDevice(d.connectId);
            log(`${vendor} disconnected`);
          } catch (e: any) {
            log(`${vendor} disconnect error: ${e.message}`);
          }
        },
        getDeviceInfo: async () => {
          const adapter = ref.current;
          if (!adapter) { log(`Init ${vendor} first`); return; }
          const d = deviceRef.current;
          if (!d) { log(`Search ${vendor} devices first`); return; }
          try {
            log(`${vendor} deviceInfo`, await adapter.getDeviceInfo(d.connectId, d.deviceId));
          } catch (e: any) {
            log(`${vendor} getDeviceInfo error: ${e.message}`);
          }
        },
      };
    },
    [withDevice, log],
  );

  const trezorOps = useMemo(
    () => createOps(trezorRef, trezorDeviceRef, 'Trezor'),
    [createOps],
  );
  const ledgerOps = useMemo(
    () => createOps(ledgerRef, ledgerDeviceRef, 'Ledger'),
    [createOps],
  );

  const trezor: VendorOps = useMemo(
    () => ({ init: initTrezor, ...trezorOps }),
    [initTrezor, trezorOps],
  );
  const ledger: VendorOps = useMemo(
    () => ({ init: initLedger, ...ledgerOps }),
    [initLedger, ledgerOps],
  );

  return { logs, trezor, ledger };
}
