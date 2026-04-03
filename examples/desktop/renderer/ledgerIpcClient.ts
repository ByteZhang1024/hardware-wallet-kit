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
  ChainCapability,
  ProgressCallback,
} from '@bytezhang/hardware-wallet-core';

export interface LedgerAdapterBridge {
  init(): Promise<void>;
  dispose(): Promise<void>;
  call(method: string, args?: unknown[]): Promise<unknown>;
  onEvent(handler: (event: unknown) => void): void;
  removeEventListeners(): void;
}

/**
 * Electron renderer-side proxy for the real LedgerAdapter running in preload.
 */
export class LedgerIpcClient implements IHardwareWallet {
  readonly vendor = 'ledger' as const;

  private readonly _bridge: LedgerAdapterBridge;
  private readonly _listeners = new Map<string, Set<DeviceEventListener>>();
  private _activeTransport: TransportType | null = null;
  private _uiHandler: Partial<IUiHandler> | null = null;

  constructor(bridge: LedgerAdapterBridge) {
    this._bridge = bridge;
  }

  get activeTransport(): TransportType | null {
    return this._activeTransport;
  }

  async init(_config?: unknown): Promise<void> {
    this._bridge.onEvent((event: unknown) => {
      const e = event as { type?: string };
      if (!e?.type) return;
      const listeners = this._listeners.get(e.type);
      if (!listeners) return;
      for (const listener of listeners) {
        listener(event as any);
      }
    });
    await this._bridge.init();
    this._activeTransport = 'hid';
  }

  async dispose(): Promise<void> {
    this._bridge.removeEventListeners();
    this._listeners.clear();
    this._uiHandler = null;
    this._activeTransport = null;
    await this._bridge.dispose();
  }

  getAvailableTransports(): TransportType[] {
    return this._activeTransport ? [this._activeTransport] : [];
  }

  async switchTransport(type: TransportType): Promise<void> {
    await this._send('switchTransport', [type]);
    this._activeTransport = type;
  }

  getSupportedChains(): ChainCapability[] {
    return ['evm', 'btc', 'sol'];
  }

  async searchDevices(): Promise<DeviceInfo[]> {
    return (await this._send('searchDevices')) as DeviceInfo[];
  }

  async getDeviceInfo(connectId: string, deviceId: string): Promise<Response<DeviceInfo>> {
    return (await this._send('getDeviceInfo', [connectId, deviceId])) as Response<DeviceInfo>;
  }

  async connectDevice(connectId: string): Promise<Response<string>> {
    return (await this._send('connectDevice', [connectId])) as Response<string>;
  }

  async disconnectDevice(connectId: string): Promise<void> {
    await this._send('disconnectDevice', [connectId]);
  }

  cancel(connectId: string): void {
    this._send('cancel', [connectId]).catch(() => {});
  }

  async evmGetAddress(
    connectId: string,
    deviceId: string,
    params: EvmGetAddressParams,
  ): Promise<Response<EvmAddress>> {
    return (await this._send('evmGetAddress', [connectId, deviceId, params])) as Response<EvmAddress>;
  }

  async evmGetAddresses(
    connectId: string,
    deviceId: string,
    params: EvmGetAddressParams[],
    _onProgress?: ProgressCallback,
  ): Promise<Response<EvmAddress[]>> {
    return (await this._send('evmGetAddresses', [connectId, deviceId, params])) as Response<EvmAddress[]>;
  }

  async evmGetPublicKey(
    connectId: string,
    deviceId: string,
    params: EvmGetPublicKeyParams,
  ): Promise<Response<EvmPublicKey>> {
    return (await this._send('evmGetPublicKey', [connectId, deviceId, params])) as Response<EvmPublicKey>;
  }

  async evmSignTransaction(
    connectId: string,
    deviceId: string,
    params: EvmSignTxParams,
  ): Promise<Response<EvmSignedTx>> {
    return (await this._send('evmSignTransaction', [connectId, deviceId, params])) as Response<EvmSignedTx>;
  }

  async evmSignMessage(
    connectId: string,
    deviceId: string,
    params: EvmSignMsgParams,
  ): Promise<Response<EvmSignature>> {
    return (await this._send('evmSignMessage', [connectId, deviceId, params])) as Response<EvmSignature>;
  }

  async evmSignTypedData(
    connectId: string,
    deviceId: string,
    params: EvmSignTypedDataParams,
  ): Promise<Response<EvmSignature>> {
    return (await this._send('evmSignTypedData', [connectId, deviceId, params])) as Response<EvmSignature>;
  }

  async btcGetAddress(
    connectId: string,
    deviceId: string,
    params: BtcGetAddressParams,
  ): Promise<Response<BtcAddress>> {
    return (await this._send('btcGetAddress', [connectId, deviceId, params])) as Response<BtcAddress>;
  }

  async btcGetAddresses(
    connectId: string,
    deviceId: string,
    params: BtcGetAddressParams[],
    _onProgress?: ProgressCallback,
  ): Promise<Response<BtcAddress[]>> {
    return (await this._send('btcGetAddresses', [connectId, deviceId, params])) as Response<BtcAddress[]>;
  }

  async btcGetPublicKey(
    connectId: string,
    deviceId: string,
    params: BtcGetPublicKeyParams,
  ): Promise<Response<BtcPublicKey>> {
    return (await this._send('btcGetPublicKey', [connectId, deviceId, params])) as Response<BtcPublicKey>;
  }

  async btcSignTransaction(
    connectId: string,
    deviceId: string,
    params: BtcSignTxParams,
  ): Promise<Response<BtcSignedTx>> {
    return (await this._send('btcSignTransaction', [connectId, deviceId, params])) as Response<BtcSignedTx>;
  }

  async btcSignMessage(
    connectId: string,
    deviceId: string,
    params: BtcSignMsgParams,
  ): Promise<Response<BtcSignature>> {
    return (await this._send('btcSignMessage', [connectId, deviceId, params])) as Response<BtcSignature>;
  }

  async btcGetMasterFingerprint(
    connectId: string,
    deviceId: string,
    params?: { skipOpenApp?: boolean },
  ): Promise<Response<{ masterFingerprint: string }>> {
    return (await this._send('btcGetMasterFingerprint', [connectId, deviceId, params])) as Response<{ masterFingerprint: string }>;
  }

  async solGetAddress(
    connectId: string,
    deviceId: string,
    params: SolGetAddressParams,
  ): Promise<Response<SolAddress>> {
    return (await this._send('solGetAddress', [connectId, deviceId, params])) as Response<SolAddress>;
  }

  async solGetAddresses(
    connectId: string,
    deviceId: string,
    params: SolGetAddressParams[],
    _onProgress?: ProgressCallback,
  ): Promise<Response<SolAddress[]>> {
    return (await this._send('solGetAddresses', [connectId, deviceId, params])) as Response<SolAddress[]>;
  }

  async solGetPublicKey(
    connectId: string,
    deviceId: string,
    params: SolGetPublicKeyParams,
  ): Promise<Response<SolPublicKey>> {
    return (await this._send('solGetPublicKey', [connectId, deviceId, params])) as Response<SolPublicKey>;
  }

  async solSignTransaction(
    connectId: string,
    deviceId: string,
    params: SolSignTxParams,
  ): Promise<Response<SolSignedTx>> {
    return (await this._send('solSignTransaction', [connectId, deviceId, params])) as Response<SolSignedTx>;
  }

  async solSignMessage(
    connectId: string,
    deviceId: string,
    params: SolSignMsgParams,
  ): Promise<Response<SolSignature>> {
    return (await this._send('solSignMessage', [connectId, deviceId, params])) as Response<SolSignature>;
  }

  setUiHandler(handler: Partial<IUiHandler>): void {
    this._uiHandler = handler;
  }

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

  private _send(method: string, args: unknown[] = []): Promise<unknown> {
    return this._bridge.call(method, args);
  }
}
