import type {
  IHardwareWallet,
  IUiHandler,
  DeviceInfo,
  DeviceEventListener,
  HardwareEventMap,
  TransportType,
  Response,
  EvmGetAddressParams,
  EvmAddress,
  EvmGetPublicKeyParams,
  EvmPublicKey,
  EvmSignTxParams,
  EvmSignedTx,
  EvmSignMsgParams,
  EvmSignTypedDataParams,
  EvmSignature,
  ProgressCallback,
  BtcGetAddressParams,
  BtcAddress,
  BtcGetPublicKeyParams,
  BtcPublicKey,
  BtcSignTxParams,
  BtcSignedTx,
  BtcSignMsgParams,
  BtcSignature,
  SolGetAddressParams,
  SolAddress,
  SolGetPublicKeyParams,
  SolPublicKey,
  SolSignTxParams,
  SolSignedTx,
  SolSignMsgParams,
  SolSignature,
  TronGetAddressParams,
  TronAddress,
  TronSignTxParams,
  TronSignedTx,
  TronSignMsgParams,
  TronSignature,
  ChainCapability,
  ChainForFingerprint,
} from '@bytezhang/hardware-wallet-core';
import {
  ADAPTER_CHANNEL,
  ADAPTER_EVENT_CHANNEL,
  type AdapterMessage,
  type AdapterResponse,
  type AdapterEvent,
  type UiHandlerRequest,
  type UiHandlerResponse,
} from './types';

let nextId = 0;
function genId(): string {
  return `ledger-client-${++nextId}-${Date.now()}`;
}

/**
 * UI-process (popup) side of the Ledger extension proxy.
 *
 * Implements IHardwareWallet by forwarding every call to the
 * LedgerAdapterHost running in the background/offscreen process
 * via chrome.runtime messaging.
 */
export class LedgerAdapterClient implements IHardwareWallet {
  readonly vendor = 'ledger' as const;

  private _port: chrome.runtime.Port | null = null;
  private readonly _listeners = new Map<string, Set<DeviceEventListener>>();
  private _uiHandler: Partial<IUiHandler> | null = null;
  private _activeTransport: TransportType | null = null;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  get activeTransport(): TransportType | null {
    return this._activeTransport;
  }

  async init(): Promise<void> {
    this._connectEventPort();
    await this._send('init');
    // After init, cache the default transport type
    this._activeTransport = 'hid';
  }

  async dispose(): Promise<void> {
    this._disconnectEventPort();
    this._listeners.clear();
    this._uiHandler = null;
    this._activeTransport = null;
    await this._send('dispose');
  }

  // ---------------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------------

  getAvailableTransports(): TransportType[] {
    // Synchronous — return cached value. For accurate data, use async proxy.
    // In most extension scenarios, the host only has 'hid'.
    return this._activeTransport ? [this._activeTransport] : [];
  }

  async switchTransport(type: TransportType): Promise<void> {
    await this._send('switchTransport', { type });
    this._activeTransport = type;
  }

  // ---------------------------------------------------------------------------
  // Device discovery & management
  // ---------------------------------------------------------------------------

  getSupportedChains(): ChainCapability[] {
    return ['evm', 'btc', 'sol', 'tron'];
  }

  async searchDevices(): Promise<DeviceInfo[]> {
    return (await this._send('searchDevices')) as DeviceInfo[];
  }

  async getDeviceInfo(
    connectId: string,
    deviceId: string,
  ): Promise<Response<DeviceInfo>> {
    return (await this._send('getDeviceInfo', { connectId, deviceId })) as Response<DeviceInfo>;
  }

  async connectDevice(connectId: string): Promise<Response<string>> {
    return (await this._send('connectDevice', { connectId })) as Response<string>;
  }

  async disconnectDevice(connectId: string): Promise<void> {
    await this._send('disconnectDevice', { connectId });
  }

  cancel(connectId: string): void {
    this._send('cancel', { connectId }).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // EVM chain methods
  // ---------------------------------------------------------------------------

  evmGetAddress(connectId: string, deviceId: string, params: EvmGetAddressParams) {
    return this._send('evmGetAddress', { connectId, deviceId, params }) as Promise<Response<EvmAddress>>;
  }
  evmGetAddresses(connectId: string, deviceId: string, params: EvmGetAddressParams[], _onProgress?: ProgressCallback) {
    return this._send('evmGetAddresses', { connectId, deviceId, params }) as Promise<Response<EvmAddress[]>>;
  }
  evmGetPublicKey(connectId: string, deviceId: string, params: EvmGetPublicKeyParams) {
    return this._send('evmGetPublicKey', { connectId, deviceId, params }) as Promise<Response<EvmPublicKey>>;
  }
  evmSignTransaction(connectId: string, deviceId: string, params: EvmSignTxParams) {
    return this._send('evmSignTransaction', { connectId, deviceId, params }) as Promise<Response<EvmSignedTx>>;
  }
  evmSignMessage(connectId: string, deviceId: string, params: EvmSignMsgParams) {
    return this._send('evmSignMessage', { connectId, deviceId, params }) as Promise<Response<EvmSignature>>;
  }
  evmSignTypedData(connectId: string, deviceId: string, params: EvmSignTypedDataParams) {
    return this._send('evmSignTypedData', { connectId, deviceId, params }) as Promise<Response<EvmSignature>>;
  }

  // ---------------------------------------------------------------------------
  // BTC chain methods
  // ---------------------------------------------------------------------------

  btcGetAddress(connectId: string, deviceId: string, params: BtcGetAddressParams) {
    return this._send('btcGetAddress', { connectId, deviceId, params }) as Promise<Response<BtcAddress>>;
  }
  btcGetAddresses(connectId: string, deviceId: string, params: BtcGetAddressParams[], _onProgress?: ProgressCallback) {
    return this._send('btcGetAddresses', { connectId, deviceId, params }) as Promise<Response<BtcAddress[]>>;
  }
  btcGetPublicKey(connectId: string, deviceId: string, params: BtcGetPublicKeyParams) {
    return this._send('btcGetPublicKey', { connectId, deviceId, params }) as Promise<Response<BtcPublicKey>>;
  }
  btcSignTransaction(connectId: string, deviceId: string, params: BtcSignTxParams) {
    return this._send('btcSignTransaction', { connectId, deviceId, params }) as Promise<Response<BtcSignedTx>>;
  }
  btcSignMessage(connectId: string, deviceId: string, params: BtcSignMsgParams) {
    return this._send('btcSignMessage', { connectId, deviceId, params }) as Promise<Response<BtcSignature>>;
  }
  btcGetMasterFingerprint(connectId: string, deviceId: string) {
    return this._send('btcGetMasterFingerprint', { connectId, deviceId }) as Promise<Response<{ masterFingerprint: string }>>;
  }

  // ---------------------------------------------------------------------------
  // SOL chain methods
  // ---------------------------------------------------------------------------

  solGetAddress(connectId: string, deviceId: string, params: SolGetAddressParams) {
    return this._send('solGetAddress', { connectId, deviceId, params }) as Promise<Response<SolAddress>>;
  }
  solGetAddresses(connectId: string, deviceId: string, params: SolGetAddressParams[], _onProgress?: ProgressCallback) {
    return this._send('solGetAddresses', { connectId, deviceId, params }) as Promise<Response<SolAddress[]>>;
  }
  solGetPublicKey(connectId: string, deviceId: string, params: SolGetPublicKeyParams) {
    return this._send('solGetPublicKey', { connectId, deviceId, params }) as Promise<Response<SolPublicKey>>;
  }
  solSignTransaction(connectId: string, deviceId: string, params: SolSignTxParams) {
    return this._send('solSignTransaction', { connectId, deviceId, params }) as Promise<Response<SolSignedTx>>;
  }
  solSignMessage(connectId: string, deviceId: string, params: SolSignMsgParams) {
    return this._send('solSignMessage', { connectId, deviceId, params }) as Promise<Response<SolSignature>>;
  }

  // ---------------------------------------------------------------------------
  // TRON chain methods
  // ---------------------------------------------------------------------------

  tronGetAddress(connectId: string, deviceId: string, params: TronGetAddressParams) {
    return this._send('tronGetAddress', { connectId, deviceId, params }) as Promise<Response<TronAddress>>;
  }
  tronGetAddresses(connectId: string, deviceId: string, params: TronGetAddressParams[], _onProgress?: ProgressCallback) {
    return this._send('tronGetAddresses', { connectId, deviceId, params }) as Promise<Response<TronAddress[]>>;
  }
  tronSignTransaction(connectId: string, deviceId: string, params: TronSignTxParams) {
    return this._send('tronSignTransaction', { connectId, deviceId, params }) as Promise<Response<TronSignedTx>>;
  }
  tronSignMessage(connectId: string, deviceId: string, params: TronSignMsgParams) {
    return this._send('tronSignMessage', { connectId, deviceId, params }) as Promise<Response<TronSignature>>;
  }

  // ---------------------------------------------------------------------------
  // Chain fingerprint
  // ---------------------------------------------------------------------------

  async getChainFingerprint(
    connectId: string,
    deviceId: string,
    chain: ChainForFingerprint,
  ): Promise<Response<string>> {
    return (await this._send('getChainFingerprint', { connectId, deviceId, chain })) as Response<string>;
  }

  // ---------------------------------------------------------------------------
  // UI handler
  // ---------------------------------------------------------------------------

  setUiHandler(handler: Partial<IUiHandler>): void {
    this._uiHandler = handler;
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  on<K extends keyof HardwareEventMap>(event: K, listener: (event: HardwareEventMap[K]) => void): void;
  on(event: string, listener: DeviceEventListener): void;
  on(event: string, listener: (event: any) => void): void {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event)!.add(listener);
  }

  off<K extends keyof HardwareEventMap>(event: K, listener: (event: HardwareEventMap[K]) => void): void;
  off(event: string, listener: DeviceEventListener): void;
  off(event: string, listener: (event: any) => void): void {
    this._listeners.get(event)?.delete(listener);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private _connectEventPort(): void {
    this._disconnectEventPort();
    this._port = chrome.runtime.connect({ name: ADAPTER_EVENT_CHANNEL });
    this._port.onMessage.addListener((msg: unknown) => {
      // Handle adapter events
      const adapterEvent = msg as AdapterEvent;
      if (adapterEvent?.channel === ADAPTER_EVENT_CHANNEL && adapterEvent.event) {
        const listeners = this._listeners.get(adapterEvent.event.type);
        if (listeners) {
          for (const listener of listeners) {
            listener(adapterEvent.event);
          }
        }
        return;
      }

      // Handle UI handler requests from host
      const uiRequest = msg as UiHandlerRequest;
      if (uiRequest?.channel === ADAPTER_CHANNEL && uiRequest?.type === 'ui-handler-request') {
        this._handleUiRequest(uiRequest);
      }
    });
  }

  private async _handleUiRequest(request: UiHandlerRequest): Promise<void> {
    const payload = request.payload as Record<string, unknown>;
    let result: unknown;
    let error: string | undefined;

    try {
      const handler = this._uiHandler;
      switch (request.method) {
        case 'onPinRequest':
          result = await handler?.onPinRequest?.(payload.device as DeviceInfo);
          break;
        case 'onPassphraseRequest':
          result = await handler?.onPassphraseRequest?.(payload.device as DeviceInfo);
          break;
        case 'onQrDisplay':
          result = await handler?.onQrDisplay?.(payload.device as DeviceInfo, payload.data as any);
          break;
        case 'onSelectDevice':
          result = await handler?.onSelectDevice?.(payload.devices as DeviceInfo[]);
          break;
        case 'onDevicePermission':
          result = await handler?.onDevicePermission?.(payload as { transportType: any });
          break;
        default:
          error = `Unknown UI handler method: ${request.method}`;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    const response: UiHandlerResponse = {
      channel: ADAPTER_CHANNEL,
      type: 'ui-handler-response',
      id: request.id,
      result,
      error,
    };

    // Send response back to host via the port
    try {
      this._port?.postMessage(response);
    } catch {
      // Port may have disconnected
    }
  }

  private _disconnectEventPort(): void {
    this._port?.disconnect();
    this._port = null;
  }

  private _send(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const msg: AdapterMessage = {
        channel: ADAPTER_CHANNEL,
        id: genId(),
        method: method as AdapterMessage['method'],
        params,
      };
      chrome.runtime.sendMessage(msg, (response: AdapterResponse) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message ?? 'Adapter send failed'));
          return;
        }
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response.result);
        }
      });
    });
  }
}
