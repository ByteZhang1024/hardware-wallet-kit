export interface DmkDiscoveredDevice {
  id: string;
  deviceModel: { id: string; productName: string; model: string; name: string };
  transport: string;
  [key: string]: unknown;
}

export interface IDmk {
  startDiscovering(args?: { transport?: string }): {
    subscribe(observer: {
      next: (device: DmkDiscoveredDevice) => void;
      error?: (err: unknown) => void;
    }): { unsubscribe: () => void };
  };
  stopDiscovering(): void;
  listenToAvailableDevices(args?: { transport?: string }): {
    subscribe(observer: {
      next: (devices: DmkDiscoveredDevice[]) => void;
      error?: (err: unknown) => void;
    }): { unsubscribe: () => void };
  };
  connect(params: { device: DmkDiscoveredDevice }): Promise<string>;
  disconnect(params: { sessionId: string }): Promise<void>;
  sendCommand(params: { sessionId: string; command: unknown }): Promise<unknown>;
  /**
   * Send a raw APDU to a connected device.
   * Used for chains without a dedicated DMK signer kit (e.g. TRON).
   */
  sendApdu(params: { sessionId: string; apdu: Uint8Array }): Promise<{
    statusCode: Uint8Array;
    data: Uint8Array;
  }>;
  close?(): void;
}

export interface DeviceActionState<T> {
  status: 'pending' | 'completed' | 'error';
  output?: T;
  error?: unknown;
  intermediateValue?: {
    requiredUserInteraction?: string;
    [key: string]: unknown;
  };
}

export interface SignerEvmAddress {
  address: string;
  publicKey: string;
}

export interface SignerEvmSignature {
  r: string;
  s: string;
  v: number;
}

export interface SignerBtcAddress {
  address: string;
}

export interface TransportProviderOptions {
  logger?: unknown;
}

export interface TransportProviderInstance {
  dmk: IDmk;
  dispose?: () => Promise<void>;
}

export interface TransportProvider {
  create(options?: TransportProviderOptions): TransportProviderInstance;
}
