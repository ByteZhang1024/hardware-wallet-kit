export const ADAPTER_CHANNEL = 'hw-ledger-adapter' as const;
export const ADAPTER_EVENT_CHANNEL = 'hw-ledger-adapter-event' as const;

export interface AdapterMessage {
  channel: typeof ADAPTER_CHANNEL;
  id: string;
  method: string;
  params?: unknown;
}

export interface AdapterResponse {
  channel: typeof ADAPTER_CHANNEL;
  id: string;
  result?: unknown;
  error?: string;
}

export interface AdapterEvent {
  channel: typeof ADAPTER_EVENT_CHANNEL;
  event: import('@bytezhang/hardware-wallet-core').HardwareEvent;
}

/** Message sent from host to client requesting UI handler input. */
export interface UiHandlerRequest {
  channel: typeof ADAPTER_CHANNEL;
  type: 'ui-handler-request';
  id: string;
  method: 'onPinRequest' | 'onPassphraseRequest' | 'onQrDisplay' | 'onSelectDevice' | 'onDevicePermission';
  payload: unknown;
}

/** Response sent from client to host with UI handler result. */
export interface UiHandlerResponse {
  channel: typeof ADAPTER_CHANNEL;
  type: 'ui-handler-response';
  id: string;
  result?: unknown;
  error?: string;
}
