import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LedgerIpcClient } from './ledgerIpcClient';

function createBridge() {
  let onEventHandler: ((event: unknown) => void) | null = null;

  return {
    init: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    call: vi.fn(),
    onEvent: vi.fn((handler: (event: unknown) => void) => {
      onEventHandler = handler;
    }),
    removeEventListeners: vi.fn(),
    emit(event: unknown) {
      onEventHandler?.(event);
    },
  };
}

describe('LedgerIpcClient', () => {
  let bridge: ReturnType<typeof createBridge>;
  let client: LedgerIpcClient;

  beforeEach(() => {
    bridge = createBridge();
    client = new LedgerIpcClient(bridge as any);
  });

  it('should init via bridge and cache hid as active transport', async () => {
    await client.init();
    expect(bridge.init).toHaveBeenCalledTimes(1);
    expect(bridge.onEvent).toHaveBeenCalledTimes(1);
    expect(client.activeTransport).toBe('hid');
  });

  it('should forward evmGetAddress to bridge.call', async () => {
    const params = { path: "m/44'/60'/0'/0/0" };
    const response = {
      success: true,
      payload: { address: '0xabc', path: params.path },
    };
    bridge.call.mockResolvedValue(response);

    const result = await client.evmGetAddress('conn-1', 'dev-1', params);
    expect(result).toEqual(response);
    expect(bridge.call).toHaveBeenCalledWith('evmGetAddress', [
      'conn-1',
      'dev-1',
      params,
    ]);
  });

  it('should dispatch bridged events to local listeners', async () => {
    await client.init();
    const listener = vi.fn();
    client.on('device-interaction', listener);

    const event = {
      type: 'device-interaction',
      payload: { connectId: 'conn-1', action: 'sign-transaction' },
    };
    bridge.emit(event);

    expect(listener).toHaveBeenCalledWith(event);
  });
});
