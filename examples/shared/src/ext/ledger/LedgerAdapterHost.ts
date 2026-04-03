import type { HardwareEvent, TransportType, QrResponseData, PassphraseResponse, IConnector } from '@bytezhang/hardware-wallet-core';
import { DEVICE, UI_REQUEST, SDK } from '@bytezhang/hardware-wallet-core';
import { LedgerAdapter } from '@bytezhang/ledger-adapter';
import {
  ADAPTER_CHANNEL,
  ADAPTER_EVENT_CHANNEL,
  type AdapterMessage,
  type AdapterResponse,
  type AdapterEvent,
  type UiHandlerRequest,
  type UiHandlerResponse,
} from './types';

/** All event types that LedgerAdapter may emit. */
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
 * Background-process (offscreen / service-worker) side of the Ledger
 * extension proxy.
 *
 * Holds a real LedgerAdapter internally and dispatches chrome.runtime
 * messages to it. Events from the adapter are broadcast to all connected
 * ports (popup / content-script).
 */
export class LedgerAdapterHost {
  private readonly _adapter: LedgerAdapter;
  private readonly _ports = new Set<chrome.runtime.Port>();
  private readonly _pendingUiRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private _messageHandler:
    | ((
        message: unknown,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response: unknown) => void,
      ) => boolean | void)
    | null = null;
  private _connectHandler: ((port: chrome.runtime.Port) => void) | null = null;

  constructor(connector: IConnector) {
    this._adapter = new LedgerAdapter(connector);
  }

  async start(): Promise<void> {
    // Connector is injected via constructor, no init config needed.
    await this._adapter.init();

    // Set up UI handler to bridge requests to client (popup) via ports
    this._adapter.setUiHandler({
      onPinRequest: (device) => this._requestFromClient('onPinRequest', { device }) as Promise<string>,
      onPassphraseRequest: (device) => this._requestFromClient('onPassphraseRequest', { device }) as Promise<string | PassphraseResponse>,
      onQrDisplay: (device, data) => this._requestFromClient('onQrDisplay', { device, data }) as Promise<QrResponseData>,
      onSelectDevice: (devices) => this._requestFromClient('onSelectDevice', { devices }) as Promise<string>,
      onDevicePermission: (params) => this._requestFromClient('onDevicePermission', params) as Promise<void>,
    });

    // Forward adapter events to all connected ports
    for (const eventType of FORWARDED_EVENTS) {
      this._adapter.on(eventType, (event: HardwareEvent) => {
        this._broadcastEvent(event);
      });
    }

    this._messageHandler = (message, _sender, sendResponse) => {
      const msg = message as AdapterMessage;
      if (msg?.channel !== ADAPTER_CHANNEL) return;

      this._handleMessage(msg)
        .then((result) => {
          const resp: AdapterResponse = {
            channel: ADAPTER_CHANNEL,
            id: msg.id,
            result,
          };
          sendResponse(resp);
        })
        .catch((err) => {
          const resp: AdapterResponse = {
            channel: ADAPTER_CHANNEL,
            id: msg.id,
            error: err instanceof Error ? err.message : String(err),
          };
          sendResponse(resp);
        });

      return true; // async response
    };

    this._connectHandler = (port) => {
      if (port.name !== ADAPTER_EVENT_CHANNEL) return;
      this._ports.add(port);
      port.onDisconnect.addListener(() => {
        this._ports.delete(port);
      });
      // Listen for UI handler responses from the client
      port.onMessage.addListener((msg: unknown) => {
        const m = msg as UiHandlerResponse;
        if (m?.channel !== ADAPTER_CHANNEL || m?.type !== 'ui-handler-response') return;
        const pending = this._pendingUiRequests.get(m.id);
        if (pending) {
          this._pendingUiRequests.delete(m.id);
          if (m.error) {
            pending.reject(new Error(m.error));
          } else {
            pending.resolve(m.result);
          }
        }
      });
    };

    chrome.runtime.onMessage.addListener(this._messageHandler);
    chrome.runtime.onConnect.addListener(this._connectHandler);
  }

  async stop(): Promise<void> {
    if (this._messageHandler) {
      chrome.runtime.onMessage.removeListener(this._messageHandler);
      this._messageHandler = null;
    }
    if (this._connectHandler) {
      chrome.runtime.onConnect.removeListener(this._connectHandler);
      this._connectHandler = null;
    }
    for (const port of this._ports) {
      port.disconnect();
    }
    this._ports.clear();
    // Reject any pending UI requests
    for (const [, pending] of this._pendingUiRequests) {
      pending.reject(new Error('Host stopped'));
    }
    this._pendingUiRequests.clear();
    await this._adapter.dispose();
  }

  private _requestFromClient(method: string, payload: unknown): Promise<unknown> {
    const id = `ui-${Date.now()}-${Math.random()}`;
    return new Promise((resolve, reject) => {
      this._pendingUiRequests.set(id, { resolve, reject });
      const msg: UiHandlerRequest = {
        channel: ADAPTER_CHANNEL,
        type: 'ui-handler-request',
        id,
        method: method as UiHandlerRequest['method'],
        payload,
      };
      for (const port of this._ports) {
        try {
          port.postMessage(msg);
        } catch {
          this._ports.delete(port);
        }
      }
    });
  }

  private async _handleMessage(msg: AdapterMessage): Promise<unknown> {
    const p = msg.params as Record<string, unknown> | undefined;

    switch (msg.method) {
      case 'init':
        return true;
      case 'dispose':
        await this._adapter.dispose();
        return true;
      case 'searchDevices':
        return this._adapter.searchDevices();
      case 'getDeviceInfo':
        return this._adapter.getDeviceInfo(
          p!.connectId as string,
          p!.deviceId as string,
        );
      case 'connectDevice':
        return this._adapter.connectDevice(
          p!.connectId as string,
        );
      case 'disconnectDevice':
        await this._adapter.disconnectDevice(
          p!.connectId as string,
        );
        return true;
      case 'cancel':
        this._adapter.cancel(
          p!.connectId as string,
        );
        return true;

      // Transport
      case 'getAvailableTransports':
        return this._adapter.getAvailableTransports();
      case 'switchTransport':
        await this._adapter.switchTransport(p!.type as TransportType);
        return true;

      // EVM
      case 'evmGetAddress':
        return this._adapter.evmGetAddress(
          p!.connectId as string,
          p!.deviceId as string,
          p!.params as any,
        );
      case 'evmGetAddresses':
        return this._adapter.evmGetAddresses(
          p!.connectId as string,
          p!.deviceId as string,
          p!.params as any,
        );
      case 'evmGetPublicKey':
        return this._adapter.evmGetPublicKey(
          p!.connectId as string,
          p!.deviceId as string,
          p!.params as any,
        );
      case 'evmSignTransaction':
        return this._adapter.evmSignTransaction(
          p!.connectId as string,
          p!.deviceId as string,
          p!.params as any,
        );
      case 'evmSignMessage':
        return this._adapter.evmSignMessage(
          p!.connectId as string,
          p!.deviceId as string,
          p!.params as any,
        );
      case 'evmSignTypedData':
        return this._adapter.evmSignTypedData(
          p!.connectId as string,
          p!.deviceId as string,
          p!.params as any,
        );

      // BTC
      case 'btcGetAddress':
        return this._adapter.btcGetAddress(
          p!.connectId as string,
          p!.deviceId as string,
          p!.params as any,
        );
      case 'btcGetAddresses':
        return this._adapter.btcGetAddresses(
          p!.connectId as string,
          p!.deviceId as string,
          p!.params as any,
        );
      case 'btcGetPublicKey':
        return this._adapter.btcGetPublicKey(
          p!.connectId as string,
          p!.deviceId as string,
          p!.params as any,
        );
      case 'btcSignTransaction':
        return this._adapter.btcSignTransaction(
          p!.connectId as string,
          p!.deviceId as string,
          p!.params as any,
        );
      case 'btcSignMessage':
        return this._adapter.btcSignMessage(
          p!.connectId as string,
          p!.deviceId as string,
          p!.params as any,
        );
      case 'btcGetMasterFingerprint':
        return this._adapter.btcGetMasterFingerprint(
          p!.connectId as string,
          p!.deviceId as string,
        );

      // SOL
      case 'solGetAddress':
        return this._adapter.solGetAddress(
          p!.connectId as string,
          p!.deviceId as string,
          p!.params as any,
        );
      case 'solGetAddresses':
        return this._adapter.solGetAddresses(
          p!.connectId as string,
          p!.deviceId as string,
          p!.params as any,
        );
      case 'solGetPublicKey':
        return this._adapter.solGetPublicKey(
          p!.connectId as string,
          p!.deviceId as string,
          p!.params as any,
        );
      case 'solSignTransaction':
        return this._adapter.solSignTransaction(
          p!.connectId as string,
          p!.deviceId as string,
          p!.params as any,
        );
      case 'solSignMessage':
        return this._adapter.solSignMessage(
          p!.connectId as string,
          p!.deviceId as string,
          p!.params as any,
        );

      // TRON
      case 'tronGetAddress':
        return this._adapter.tronGetAddress(
          p!.connectId as string,
          p!.deviceId as string,
          p!.params as any,
        );
      case 'tronGetAddresses':
        return this._adapter.tronGetAddresses(
          p!.connectId as string,
          p!.deviceId as string,
          p!.params as any,
        );
      case 'tronSignTransaction':
        return this._adapter.tronSignTransaction(
          p!.connectId as string,
          p!.deviceId as string,
          p!.params as any,
        );
      case 'tronSignMessage':
        return this._adapter.tronSignMessage(
          p!.connectId as string,
          p!.deviceId as string,
          p!.params as any,
        );

      // Chain fingerprint
      case 'getChainFingerprint':
        return this._adapter.getChainFingerprint(
          p!.connectId as string,
          p!.deviceId as string,
          p!.chain as any,
        );

      default:
        throw new Error(`Unknown method: ${msg.method}`);
    }
  }

  private _broadcastEvent(event: HardwareEvent): void {
    const msg: AdapterEvent = { channel: ADAPTER_EVENT_CHANNEL, event };
    for (const port of this._ports) {
      try {
        port.postMessage(msg);
      } catch {
        this._ports.delete(port);
      }
    }
  }
}
