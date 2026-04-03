import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LedgerNodeBridge } from './ledgerNodeBridge';

function createAdapterMock() {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    searchDevices: vi.fn().mockResolvedValue([{ deviceId: 'hid-1' }]),
    on: vi.fn(),
    off: vi.fn(),
  };
}

function createConnectorMock() {
  return {
    searchDevices: vi.fn().mockResolvedValue([]),
    connect: vi.fn(),
    disconnect: vi.fn(),
    call: vi.fn(),
    cancel: vi.fn(),
    uiResponse: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    reset: vi.fn(),
  };
}

describe('LedgerNodeBridge', () => {
  let adapter: ReturnType<typeof createAdapterMock>;
  let connector: ReturnType<typeof createConnectorMock>;
  let createAdapter: ReturnType<typeof vi.fn>;
  let createConnector: ReturnType<typeof vi.fn>;
  let bridge: LedgerNodeBridge;

  beforeEach(() => {
    adapter = createAdapterMock();
    connector = createConnectorMock();
    createAdapter = vi.fn(() => adapter);
    createConnector = vi.fn().mockResolvedValue(connector);
    bridge = new LedgerNodeBridge({
      createAdapter: createAdapter as any,
      createConnector,
    });
  });

  it('should init adapter with connector from createConnector factory', async () => {
    await bridge.init();

    expect(createConnector).toHaveBeenCalledTimes(1);
    expect(createAdapter).toHaveBeenCalledTimes(1);
    expect(createAdapter).toHaveBeenCalledWith(connector);
    expect(adapter.init).toHaveBeenCalledTimes(1);
  });

  it('should forward method calls to the underlying adapter', async () => {
    await bridge.init();

    const result = await bridge.call('searchDevices');
    expect(adapter.searchDevices).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ deviceId: 'hid-1' }]);
  });

  it('should emit adapter events to registered bridge listeners', async () => {
    const listener = vi.fn();
    bridge.onEvent(listener);
    await bridge.init();

    // The bridge registers a handler for each FORWARDED_EVENTS entry.
    // Find the handler registered for any event type and invoke it.
    expect(adapter.on.mock.calls.length).toBeGreaterThan(0);
    const onCallback = adapter.on.mock.calls[0][1] as (event: unknown) => void;
    const event = { type: 'device-interaction', payload: { action: 'sign-transaction' } };
    onCallback(event);

    expect(listener).toHaveBeenCalledWith(event);
  });
});
