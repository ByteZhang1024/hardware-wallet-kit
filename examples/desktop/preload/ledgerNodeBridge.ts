import type { IHardwareWallet, IConnector } from '@bytezhang/hardware-wallet-core';
import { DEVICE, UI_REQUEST, SDK } from '@bytezhang/hardware-wallet-core';

interface BridgeDeps {
  createAdapter: (connector: IConnector) => IHardwareWallet;
  createConnector: () => Promise<IConnector>;
}

const FORWARDED_EVENTS = [
  DEVICE.CONNECT,
  DEVICE.DISCONNECT,
  DEVICE.CHANGED,
  UI_REQUEST.REQUEST_PIN,
  UI_REQUEST.REQUEST_PASSPHRASE,
  UI_REQUEST.REQUEST_PASSPHRASE_ON_DEVICE,
  UI_REQUEST.REQUEST_BUTTON,
  UI_REQUEST.REQUEST_QR_DISPLAY,
  UI_REQUEST.REQUEST_QR_SCAN,
  UI_REQUEST.REQUEST_DEVICE_PERMISSION,
  UI_REQUEST.REQUEST_SELECT_DEVICE,
  SDK.DEVICE_INTERACTION,
  SDK.DEVICE_STUCK,
  SDK.DEVICE_UNRESPONSIVE,
  SDK.DEVICE_RECOVERED,
] as const;

/**
 * Keeps a real LedgerAdapter in preload (Node runtime) and exposes
 * an RPC-like surface for renderer through contextBridge.
 */
export class LedgerNodeBridge {
  private readonly _createAdapter: BridgeDeps['createAdapter'];
  private readonly _createConnector: BridgeDeps['createConnector'];
  private _adapter: IHardwareWallet | null = null;
  private readonly _listeners = new Set<(event: unknown) => void>();
  private readonly _boundAdapterListeners = new Map<string, (event: unknown) => void>();

  constructor(deps: BridgeDeps) {
    this._createAdapter = deps.createAdapter;
    this._createConnector = deps.createConnector;
  }

  async init(): Promise<void> {
    if (this._adapter) return;

    const connector = await this._createConnector();
    const adapter = this._createAdapter(connector);
    await adapter.init();

    for (const eventType of FORWARDED_EVENTS) {
      const handler = (event: unknown) => this._emit(event);
      adapter.on(eventType, handler as any);
      this._boundAdapterListeners.set(eventType, handler);
    }

    this._adapter = adapter;
  }

  async dispose(): Promise<void> {
    const adapter = this._adapter;
    if (!adapter) return;

    for (const [eventType, handler] of this._boundAdapterListeners) {
      adapter.off(eventType, handler as any);
    }
    this._boundAdapterListeners.clear();
    await adapter.dispose();
    this._adapter = null;
  }

  async call(method: string, args: unknown[] = []): Promise<unknown> {
    const adapter = this._adapter;
    if (!adapter) {
      throw new Error('Ledger bridge is not initialized');
    }

    const fn = (adapter as Record<string, unknown>)[method];
    if (typeof fn !== 'function') {
      throw new Error(`Unknown Ledger adapter method: ${method}`);
    }
    return (fn as (...innerArgs: unknown[]) => unknown).call(adapter, ...args);
  }

  onEvent(handler: (event: unknown) => void): void {
    this._listeners.add(handler);
  }

  removeEventListeners(): void {
    this._listeners.clear();
  }

  private _emit(event: unknown): void {
    for (const listener of this._listeners) {
      listener(event);
    }
  }
}
