import type {
  IHardwareWallet,
  IUiHandler,
  IConnector,
  ConnectorDevice,
  DeviceInfo,
  HardwareEventMap,
  DeviceEventListener,
  TransportType,
  ConnectionType,
  Response,
  ChainCapability,
  ChainForFingerprint,
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
} from '@bytezhang/hardware-wallet-core';
import {
  success,
  failure,
  HardwareErrorCode,
  TypedEventEmitter,
  DEVICE,
  UI_REQUEST,
  CHAIN_FINGERPRINT_PATHS,
  deriveDeviceFingerprint,
} from '@bytezhang/hardware-wallet-core';
import { mapLedgerError, isDeviceDisconnectedError, isDeviceLockedError } from '../errors';

/**
 * Ledger hardware wallet adapter that delegates to an IConnector.
 *
 * This is a thin translation layer that:
 * - Accepts a pre-configured IConnector (transport decisions are made at connector creation time)
 * - Translates IHardwareWallet method calls to connector.call() invocations
 * - Maps connector results/errors to our Response<T> format with enriched error messages
 * - Translates connector events to HardwareEventMap events
 * - Integrates with IUiHandler for permission flows
 */
export class LedgerAdapter implements IHardwareWallet {
  readonly vendor = 'ledger' as const;

  private readonly connector: IConnector;
  private readonly emitter = new TypedEventEmitter<HardwareEventMap>();

  private _uiHandler: Partial<IUiHandler> | null = null;

  // Device cache: tracks discovered devices from connector events
  private _discoveredDevices = new Map<string, DeviceInfo>();

  // Session tracking: maps connectId -> sessionId
  private _sessions = new Map<string, string>();

  constructor(connector: IConnector) {
    this.connector = connector;
    this.registerEventListeners();
  }

  // ---------------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------------
  // Transport is decided at connector creation time. These methods
  // satisfy the IHardwareWallet interface with sensible defaults.

  get activeTransport(): TransportType | null {
    return 'hid';
  }

  getAvailableTransports(): TransportType[] {
    return ['hid'];
  }

  async switchTransport(_type: TransportType): Promise<void> {
    // Transport is fixed at connector creation time.
    // To switch transport, create a new LedgerAdapter with a different connector.
  }

  // ---------------------------------------------------------------------------
  // UI handler
  // ---------------------------------------------------------------------------

  setUiHandler(handler: Partial<IUiHandler>): void {
    this._uiHandler = handler;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async init(_config?: unknown): Promise<void> {
    // Connector is injected via constructor, already initialized.
    // Nothing to do here.
  }

  /**
   * Clear cached device/session state without tearing down the adapter.
   * Call before retrying after errors or when the device state may be stale.
   * The next operation will re-discover and re-connect automatically.
   */
  resetState(): void {
    this._discoveredDevices.clear();
    this._sessions.clear();
    this._connectingPromise = null;
  }

  async dispose(): Promise<void> {
    // Cancel any pending device-connect prompt
    this._deviceConnectResolve?.(true);
    this._deviceConnectResolve = null;

    this.unregisterEventListeners();
    this.connector.reset();
    this._uiHandler = null;
    this._discoveredDevices.clear();
    this._sessions.clear();
    this.emitter.removeAllListeners();
  }

  // ---------------------------------------------------------------------------
  // Device management
  // ---------------------------------------------------------------------------

  async searchDevices(): Promise<DeviceInfo[]> {
    await this._ensureDevicePermission();

    const devices = await this.connector.searchDevices();
    console.log('[DMK] adapter.searchDevices raw:', JSON.stringify(devices));

    // Update cache with scan results. connectId is now consistent
    // (BLE: "A58F" from _resolveConnectId, USB: DMK path) across all write points.
    for (const d of devices) {
      if (d.connectId) {
        this._discoveredDevices.set(d.connectId, this.connectorDeviceToDeviceInfo(d));
      }
    }

    // If no devices found, ensure permission (no connectId = search context)
    if (this._discoveredDevices.size === 0) {
      await this._ensureDevicePermission();
    }

    return Array.from(this._discoveredDevices.values());
  }

  async connectDevice(connectId: string): Promise<Response<string>> {
    await this._ensureDevicePermission(connectId);
    try {
      const session = await this.connector.connect(connectId);
      this._sessions.set(connectId, session.sessionId);

      // Update device cache with richer info from session
      if (session.deviceInfo) {
        this._discoveredDevices.set(connectId, session.deviceInfo);
      }

      return success(connectId);
    } catch (err) {
      return this.errorToFailure(err);
    }
  }

  async disconnectDevice(connectId: string): Promise<void> {
    const sessionId = this._sessions.get(connectId);
    if (sessionId) {
      await this.connector.disconnect(sessionId);
      this._sessions.delete(connectId);
    }
  }

  async getDeviceInfo(connectId: string, deviceId: string): Promise<Response<DeviceInfo>> {
    await this._ensureDevicePermission(connectId, deviceId);

    // Look up the device in the cache populated by event handlers / searchDevices.
    // Try connectId first (the USB path), then fall back to scanning by deviceId.
    const cached =
      this._discoveredDevices.get(connectId) ??
      Array.from(this._discoveredDevices.values()).find(d => d.deviceId === deviceId);

    if (cached) {
      return success(cached);
    }

    return failure(
      HardwareErrorCode.DeviceNotFound,
      'Device not found in cache. Call searchDevices() or wait for a device-connected event first.'
    );
  }

  getSupportedChains(): ChainCapability[] {
    return ['evm', 'btc', 'sol', 'tron'];
  }

  // ---------------------------------------------------------------------------
  // Chain call helper
  // ---------------------------------------------------------------------------

  private async callChain<T>(
    connectId: string,
    deviceId: string,
    chain: string,
    method: string,
    params: unknown,
    skipFingerprint = false
  ): Promise<Response<T>> {
    await this._ensureDevicePermission(connectId, deviceId);
    if (
      !skipFingerprint &&
      !(await this._verifyDeviceFingerprint(connectId, deviceId, chain as ChainForFingerprint))
    ) {
      return failure(HardwareErrorCode.DeviceMismatch, 'Wrong device connected');
    }
    try {
      const result = await this.connectorCall(connectId, method, params);
      return success(result as T);
    } catch (err) {
      return this.errorToFailure(err);
    }
  }

  /**
   * Batch version of callChain — checks permission and fingerprint once,
   * then calls the connector for each param sequentially.
   */
  private async callChainBatch<TParam, TResult>(
    connectId: string,
    deviceId: string,
    chain: string,
    method: string,
    params: TParam[],
    onProgress?: ProgressCallback,
    skipFingerprint = false
  ): Promise<Response<TResult[]>> {
    await this._ensureDevicePermission(connectId, deviceId);
    if (
      !skipFingerprint &&
      !(await this._verifyDeviceFingerprint(connectId, deviceId, chain as ChainForFingerprint))
    ) {
      return failure(HardwareErrorCode.DeviceMismatch, 'Wrong device connected');
    }
    const results: TResult[] = [];
    for (let i = 0; i < params.length; i++) {
      try {
        const result = await this.connectorCall(connectId, method, params[i]);
        results.push(result as TResult);
        onProgress?.({ index: i, total: params.length });
      } catch (err) {
        return this.errorToFailure(err);
      }
    }
    return success(results);
  }

  // ---------------------------------------------------------------------------
  // EVM chain methods
  // ---------------------------------------------------------------------------

  evmGetAddress(connectId: string, deviceId: string, params: EvmGetAddressParams) {
    return this.callChain<EvmAddress>(connectId, deviceId, 'evm', 'evmGetAddress', params);
  }

  evmGetAddresses(
    connectId: string,
    deviceId: string,
    params: EvmGetAddressParams[],
    onProgress?: ProgressCallback
  ) {
    return this.callChainBatch<EvmGetAddressParams, EvmAddress>(
      connectId,
      deviceId,
      'evm',
      'evmGetAddress',
      params,
      onProgress
    );
  }

  evmGetPublicKey(connectId: string, deviceId: string, params: EvmGetPublicKeyParams) {
    return this.callChain<EvmPublicKey>(connectId, deviceId, 'evm', 'evmGetAddress', params);
  }

  evmSignTransaction(connectId: string, deviceId: string, params: EvmSignTxParams) {
    return this.callChain<EvmSignedTx>(connectId, deviceId, 'evm', 'evmSignTransaction', params);
  }

  evmSignMessage(connectId: string, deviceId: string, params: EvmSignMsgParams) {
    return this.callChain<EvmSignature>(connectId, deviceId, 'evm', 'evmSignMessage', params);
  }

  evmSignTypedData(connectId: string, deviceId: string, params: EvmSignTypedDataParams) {
    return this.callChain<EvmSignature>(connectId, deviceId, 'evm', 'evmSignTypedData', params);
  }

  // ---------------------------------------------------------------------------
  // BTC chain methods
  // ---------------------------------------------------------------------------

  btcGetAddress(connectId: string, deviceId: string, params: BtcGetAddressParams) {
    return this.callChain<BtcAddress>(connectId, deviceId, 'btc', 'btcGetAddress', params);
  }

  btcGetAddresses(
    connectId: string,
    deviceId: string,
    params: BtcGetAddressParams[],
    onProgress?: ProgressCallback
  ) {
    return this.callChainBatch<BtcGetAddressParams, BtcAddress>(
      connectId,
      deviceId,
      'btc',
      'btcGetAddress',
      params,
      onProgress
    );
  }

  btcGetPublicKey(connectId: string, deviceId: string, params: BtcGetPublicKeyParams) {
    return this.callChain<BtcPublicKey>(connectId, deviceId, 'btc', 'btcGetPublicKey', params);
  }

  btcSignTransaction(connectId: string, deviceId: string, params: BtcSignTxParams) {
    return this.callChain<BtcSignedTx>(connectId, deviceId, 'btc', 'btcSignTransaction', params);
  }

  btcSignMessage(connectId: string, deviceId: string, params: BtcSignMsgParams) {
    return this.callChain<BtcSignature>(connectId, deviceId, 'btc', 'btcSignMessage', params);
  }

  btcGetMasterFingerprint(connectId: string, deviceId: string) {
    return this.callChain<{ masterFingerprint: string }>(
      connectId,
      deviceId,
      'btc',
      'btcGetMasterFingerprint',
      {}
    );
  }

  // ---------------------------------------------------------------------------
  // SOL chain methods
  // ---------------------------------------------------------------------------

  solGetAddress(connectId: string, deviceId: string, params: SolGetAddressParams) {
    return this.callChain<SolAddress>(connectId, deviceId, 'sol', 'solGetAddress', params);
  }

  solGetAddresses(
    connectId: string,
    deviceId: string,
    params: SolGetAddressParams[],
    onProgress?: ProgressCallback
  ) {
    return this.callChainBatch<SolGetAddressParams, SolAddress>(
      connectId,
      deviceId,
      'sol',
      'solGetAddress',
      params,
      onProgress
    );
  }

  solGetPublicKey(connectId: string, deviceId: string, params: SolGetPublicKeyParams) {
    return this.callChain<SolPublicKey>(connectId, deviceId, 'sol', 'solGetAddress', params);
  }

  solSignTransaction(connectId: string, deviceId: string, params: SolSignTxParams) {
    return this.callChain<SolSignedTx>(connectId, deviceId, 'sol', 'solSignTransaction', params);
  }

  solSignMessage(connectId: string, deviceId: string, params: SolSignMsgParams) {
    return this.callChain<SolSignature>(connectId, deviceId, 'sol', 'solSignMessage', params);
  }

  // ---------------------------------------------------------------------------
  // TRON chain methods
  // ---------------------------------------------------------------------------

  tronGetAddress(connectId: string, deviceId: string, params: TronGetAddressParams) {
    return this.callChain<TronAddress>(connectId, deviceId, 'tron', 'tronGetAddress', params, true);
  }

  tronGetAddresses(
    connectId: string,
    deviceId: string,
    params: TronGetAddressParams[],
    onProgress?: ProgressCallback
  ) {
    return this.callChainBatch<TronGetAddressParams, TronAddress>(
      connectId,
      deviceId,
      'tron',
      'tronGetAddress',
      params,
      onProgress,
      true
    );
  }

  tronSignTransaction(connectId: string, deviceId: string, params: TronSignTxParams) {
    return this.callChain<TronSignedTx>(
      connectId,
      deviceId,
      'tron',
      'tronSignTransaction',
      params,
      true
    );
  }

  tronSignMessage(connectId: string, deviceId: string, params: TronSignMsgParams) {
    return this.callChain<TronSignature>(
      connectId,
      deviceId,
      'tron',
      'tronSignMessage',
      params,
      true
    );
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  on<K extends keyof HardwareEventMap>(
    event: K,
    listener: (event: HardwareEventMap[K]) => void
  ): void;
  on(event: string, listener: DeviceEventListener): void;
  on(event: string, listener: (event: any) => void): void {
    this.emitter.on(event, listener);
  }

  off<K extends keyof HardwareEventMap>(
    event: K,
    listener: (event: HardwareEventMap[K]) => void
  ): void;
  off(event: string, listener: DeviceEventListener): void;
  off(event: string, listener: (event: any) => void): void {
    this.emitter.off(event, listener);
  }

  cancel(connectId: string): void {
    const sessionId = this._sessions.get(connectId) ?? connectId;
    void this.connector.cancel(sessionId);
  }

  // ---------------------------------------------------------------------------
  // Chain fingerprint
  // ---------------------------------------------------------------------------

  async getChainFingerprint(
    connectId: string,
    deviceId: string,
    chain: ChainForFingerprint
  ): Promise<Response<string>> {
    console.log(
      '[LedgerAdapter] getChainFingerprint called, chain:',
      chain,
      'connectId:',
      connectId || '(empty)',
      'sessions:',
      this._sessions.size
    );
    await this._ensureDevicePermission(connectId, deviceId);
    console.log(
      '[LedgerAdapter] getChainFingerprint permission ok, calling _deriveAddressForFingerprint'
    );
    try {
      const address = await this._deriveAddressForFingerprint(connectId, chain);
      console.log('[LedgerAdapter] getChainFingerprint address:', address?.substring(0, 20));
      return success(deriveDeviceFingerprint(address));
    } catch (err) {
      console.error(
        '[LedgerAdapter] getChainFingerprint error in _deriveAddressForFingerprint:',
        chain,
        err
      );
      return this.errorToFailure(err);
    }
  }

  /**
   * Verify that the connected device matches the expected fingerprint.
   *
   * - If deviceId is empty, verification is skipped (returns true).
   * - deviceId is used here as the stored fingerprint to compare against.
   */
  private async _verifyDeviceFingerprint(
    connectId: string,
    deviceId: string,
    chain: ChainForFingerprint
  ): Promise<boolean> {
    if (!deviceId) return true;

    try {
      const address = await this._deriveAddressForFingerprint(connectId, chain);
      const fingerprint = deriveDeviceFingerprint(address);
      return fingerprint === deviceId;
    } catch (err) {
      // "App not open" or "wrong app" errors are expected — skip verification
      const mapped = mapLedgerError(err);
      if (
        mapped.code === HardwareErrorCode.WrongApp ||
        mapped.code === HardwareErrorCode.DeviceLocked
      ) {
        return true;
      }
      // Transport/disconnect errors should propagate
      throw err;
    }
  }

  /**
   * Derive an address at the fixed testnet path for fingerprint generation.
   */
  private async _deriveAddressForFingerprint(
    connectId: string,
    chain: ChainForFingerprint
  ): Promise<string> {
    const path = CHAIN_FINGERPRINT_PATHS[chain];

    if (chain === 'evm') {
      const result = (await this.connectorCall(connectId, 'evmGetAddress', {
        path,
        showOnDevice: false,
      })) as { address: string };
      return result.address;
    }

    if (chain === 'btc') {
      // Use btcGetPublicKey instead of btcGetAddress to avoid
      // prepareWalletPolicy which fails on older BTC App versions.
      const result = (await this.connectorCall(connectId, 'btcGetPublicKey', {
        path,
        showOnDevice: false,
      })) as { xpub: string };
      return result.xpub;
    }

    if (chain === 'sol') {
      const result = (await this.connectorCall(connectId, 'solGetAddress', {
        path,
        showOnDevice: false,
      })) as { address: string };
      return result.address;
    }

    if (chain === 'tron') {
      const result = (await this.connectorCall(connectId, 'tronGetAddress', {
        path,
        showOnDevice: false,
      })) as { address: string };
      return result.address;
    }

    throw new Error(`Unsupported chain for fingerprint: ${chain as string}`);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Ensure at least one device is connected and return a valid connectId.
   *
   * - If a session already exists for the given connectId, reuse it.
   * - If ANY session exists (Ledger IDs are ephemeral), reuse it.
   * - Otherwise: search → 1 device: auto-connect, multiple: ask user, 0: throw.
   */
  private static readonly MAX_DEVICE_RETRY = 3;

  // Pending device-connect resolve — set by _waitForDeviceConnect, resolved by uiResponse
  private _deviceConnectResolve: ((cancelled: boolean) => void) | null = null;

  // Mutex for ensureConnected — prevents concurrent calls from establishing duplicate connections
  private _connectingPromise: Promise<string> | null = null;

  private static readonly DEVICE_CONNECT_TIMEOUT_MS = 60_000;

  /**
   * Wait for user to connect and unlock device.
   * Emits 'ui-request' event via the adapter's own emitter.
   * The consumer (monorepo adapter wrapper) listens for this and shows UI.
   * When user confirms, they call adapter.deviceConnectResponse() which resolves this promise.
   * Times out after 60 seconds if no response is received.
   */
  private _waitForDeviceConnect(attempt: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this._deviceConnectResolve = null;
          reject(new Error('Ledger device connect timed out after 60 seconds'));
        }
      }, LedgerAdapter.DEVICE_CONNECT_TIMEOUT_MS);

      this._deviceConnectResolve = (cancelled: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this._deviceConnectResolve = null;
        if (cancelled) {
          reject(
            Object.assign(new Error('User cancelled Ledger connection'), {
              _tag: 'DeviceNotRecognizedError',
            })
          );
        } else {
          resolve();
        }
      };

      // Emit ui-request event — consumer should show "connect and unlock" prompt
      this.emitter.emit('ui-request-device-connect' as any, {
        type: 'ui-request-device-connect',
        payload: {
          message: 'Please connect and unlock your Ledger device',
          retryCount: attempt,
          maxRetries: LedgerAdapter.MAX_DEVICE_RETRY,
        },
      });
    });
  }

  /**
   * Called by consumer to respond to ui-request-device-connect.
   * type='confirm' → retry search, type='cancel' → abort.
   */
  deviceConnectResponse(type: 'confirm' | 'cancel'): void {
    if (this._deviceConnectResolve) {
      this._deviceConnectResolve(type === 'cancel');
    }
  }

  private async ensureConnected(connectId?: string): Promise<string> {
    // 1. Exact match — no mutex needed
    if (connectId && this._sessions.has(connectId)) {
      return connectId;
    }

    // 2. Any existing session (Ledger IDs are temporary, any session is fine)
    if (this._sessions.size > 0) {
      return this._sessions.keys().next().value!;
    }

    // 3. No session — use mutex to prevent concurrent connection attempts
    if (this._connectingPromise) {
      return this._connectingPromise;
    }

    this._connectingPromise = this._doConnect();
    try {
      return await this._connectingPromise;
    } finally {
      this._connectingPromise = null;
    }
  }

  private async _doConnect(): Promise<string> {
    for (let attempt = 0; attempt < LedgerAdapter.MAX_DEVICE_RETRY; attempt++) {
      const devices = await this.searchDevices();

      if (devices.length > 0) {
        // Found device(s), continue to connection below
        return this._connectFirstOrSelect(devices);
      }

      // No device found — prompt user (except on last attempt)
      if (attempt < LedgerAdapter.MAX_DEVICE_RETRY - 1) {
        await this._waitForDeviceConnect(attempt + 1);
      }
    }

    throw Object.assign(
      new Error(
        'No Ledger device found after multiple attempts. Please connect and unlock your device.'
      ),
      { _tag: 'DeviceNotRecognizedError' }
    );
  }

  private async _connectFirstOrSelect(devices: DeviceInfo[]): Promise<string> {
    if (devices.length === 1) {
      const result = await this.connectDevice(devices[0].connectId);
      if (!result.success) {
        throw Object.assign(new Error(result.payload.error), { _tag: 'DeviceNotRecognizedError' });
      }
      return devices[0].connectId;
    }

    // Multiple devices — ask user via UI handler
    if (this._uiHandler?.onSelectDevice) {
      const selectedConnectId = await this._uiHandler.onSelectDevice(devices);
      const result = await this.connectDevice(selectedConnectId);
      if (!result.success) {
        throw Object.assign(new Error(result.payload.error), { _tag: 'DeviceNotRecognizedError' });
      }
      return selectedConnectId;
    }

    // No UI handler — fall back to first device
    const result = await this.connectDevice(devices[0].connectId);
    if (!result.success) {
      throw Object.assign(new Error(result.payload.error), { _tag: 'DeviceNotRecognizedError' });
    }
    return devices[0].connectId;
  }

  /**
   * Call the connector with automatic session resolution and disconnect retry.
   *
   * 1. Resolves a valid connectId via ensureConnected()
   * 2. Looks up sessionId from _sessions
   * 3. Calls connector.call()
   * 4. On disconnect error: clears stale session, re-connects, retries once
   */
  private async connectorCall(
    connectId: string,
    method: string,
    params: unknown
  ): Promise<unknown> {
    console.log('[LedgerAdapter] connectorCall:', method, 'connectId:', connectId || '(empty)');
    const resolvedConnectId = await this.ensureConnected(connectId);
    const sessionId = this._sessions.get(resolvedConnectId);
    console.log(
      '[LedgerAdapter] connectorCall resolved:',
      method,
      'resolvedConnectId:',
      resolvedConnectId,
      'sessionId:',
      sessionId
    );
    if (!sessionId) {
      throw Object.assign(new Error('Auto-connect succeeded but no session found'), {
        _tag: 'DeviceSessionNotFound',
      });
    }

    try {
      return await this.connector.call(sessionId, method, params);
    } catch (err) {
      console.log('[LedgerAdapter] connectorCall error:', method, {
        message: (err as any)?.message,
        _tag: (err as any)?._tag,
        errorCode: (err as any)?.errorCode,
        statusCode: (err as any)?.statusCode,
        isDisconnected: isDeviceDisconnectedError(err),
        isLocked: isDeviceLockedError(err),
      });
      if (isDeviceDisconnectedError(err)) {
        console.log('[LedgerAdapter] disconnected, retrying with fresh connection...');
        this._sessions.delete(resolvedConnectId);
        this._discoveredDevices.clear();
        const retryConnectId = await this.ensureConnected();
        const retrySessionId = this._sessions.get(retryConnectId);
        if (!retrySessionId) {
          throw err;
        }
        return this.connector.call(retrySessionId, method, params);
      }
      if (isDeviceLockedError(err)) {
        await this._waitForDeviceConnect(0);
        return this.connector.call(sessionId, method, params);
      }
      throw err;
    }
  }

  /**
   * Ensure device permission before proceeding.
   * - No connectId (searchDevices): check environment-level permission
   * - With connectId (business methods): check device-level permission
   * If not granted, calls onDevicePermission so the consumer can request access.
   */
  private async _ensureDevicePermission(connectId?: string, deviceId?: string): Promise<void> {
    const transportType: TransportType = 'hid';
    let granted = false;
    let context: Record<string, unknown> | undefined;

    if (this._uiHandler?.checkDevicePermission) {
      try {
        const result = await this._uiHandler.checkDevicePermission({
          transportType,
          connectId,
          deviceId,
        });
        granted = result.granted;
        context = result.context;
      } catch {
        granted = false;
      }
    }

    if (!granted) {
      try {
        await this._uiHandler?.onDevicePermission?.({ transportType, context });
      } catch {
        // UI handler cancelled or failed
      }
    }
  }

  /**
   * Convert a thrown error to a Response failure.
   * Uses mapLedgerError to parse Ledger DMK error codes into HardwareErrorCode values.
   */
  private errorToFailure<T>(err: unknown): Response<T> {
    console.error('[LedgerAdapter] error:', err);

    // If the error carries an explicit HardwareErrorCode (e.g. validation errors
    // thrown by connector chain methods), use it directly.
    if (err && typeof err === 'object' && typeof (err as any).code === 'number') {
      const e = err as { code: number; message?: string };
      return failure(e.code, e.message ?? 'Unknown error');
    }

    const mapped = mapLedgerError(err);

    // DeviceLocked is handled by connectorCall retry logic (_waitForDeviceConnect).
    // Do NOT emit UI events here — it would show UI and return error simultaneously.

    return failure(mapped.code, mapped.message);
  }

  // ---------------------------------------------------------------------------
  // Event translation
  // ---------------------------------------------------------------------------

  private deviceConnectHandler = (data: { device: ConnectorDevice }): void => {
    const deviceInfo = this.connectorDeviceToDeviceInfo(data.device);
    this._discoveredDevices.set(deviceInfo.connectId, deviceInfo);
    this.emitter.emit(DEVICE.CONNECT, {
      type: DEVICE.CONNECT,
      payload: deviceInfo,
    });
  };

  private deviceDisconnectHandler = (data: { connectId: string }): void => {
    this._discoveredDevices.delete(data.connectId);
    this._sessions.delete(data.connectId);
    this.emitter.emit(DEVICE.DISCONNECT, {
      type: DEVICE.DISCONNECT,
      payload: { connectId: data.connectId },
    });
  };

  private uiRequestHandler = (data: { type: string; payload?: unknown }): void => {
    this.handleUiEvent(data);
  };

  private uiEventHandler = (data: { type: string; payload?: unknown }): void => {
    this.handleUiEvent(data);
  };

  private registerEventListeners(): void {
    this.connector.on('device-connect', this.deviceConnectHandler);
    this.connector.on('device-disconnect', this.deviceDisconnectHandler);
    this.connector.on('ui-request', this.uiRequestHandler);
    this.connector.on('ui-event', this.uiEventHandler);
  }

  private unregisterEventListeners(): void {
    this.connector.off('device-connect', this.deviceConnectHandler);
    this.connector.off('device-disconnect', this.deviceDisconnectHandler);
    this.connector.off('ui-request', this.uiRequestHandler);
    this.connector.off('ui-event', this.uiEventHandler);
  }

  private handleUiEvent(event: { type: string; payload?: unknown }): void {
    if (!event.type) return;

    const payload = event.payload as Record<string, unknown> | undefined;
    const deviceInfo = payload ? this.extractDeviceInfoFromPayload(payload) : this.unknownDevice();

    switch (event.type) {
      case 'ui-request_confirmation':
        this.emitter.emit(UI_REQUEST.REQUEST_BUTTON, {
          type: UI_REQUEST.REQUEST_BUTTON,
          payload: { device: deviceInfo },
        });
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Device info mapping
  // ---------------------------------------------------------------------------

  private connectorDeviceToDeviceInfo(device: ConnectorDevice): DeviceInfo {
    // BLE connectId is a stable 4-digit HEX (e.g. "A58F") from device name.
    // USB connectId is an ephemeral UUID. Use this to infer connectionType.
    const isBle = device.connectId && /^[0-9A-Fa-f]{4}$/.test(device.connectId);

    return {
      vendor: 'ledger',
      model: device.model ?? 'unknown',
      firmwareVersion: '',
      deviceId: device.deviceId,
      connectId: device.connectId,
      label: device.name,
      connectionType: isBle ? 'ble' : 'usb',
      capabilities: device.capabilities,
    };
  }

  private extractDeviceInfoFromPayload(payload: Record<string, unknown>): DeviceInfo {
    return {
      vendor: 'ledger',
      model: (payload['model'] as string) ?? 'unknown',
      firmwareVersion: '',
      deviceId: (payload['deviceId'] as string) ?? (payload['id'] as string) ?? '',
      connectId: (payload['connectId'] as string) ?? (payload['path'] as string) ?? '',
      label: payload['label'] as string,
      connectionType: 'usb' as ConnectionType,
    };
  }

  private unknownDevice(): DeviceInfo {
    return {
      vendor: 'ledger',
      model: 'unknown',
      firmwareVersion: '',
      deviceId: '',
      connectId: '',
      connectionType: 'usb',
    };
  }
}
