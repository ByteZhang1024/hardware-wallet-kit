import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerTransport,
  unregisterTransport,
  getTransportProvider,
  listRegisteredTransports,
  clearRegistry,
} from '../transport/registry';
import type { TransportProvider } from '../types';

function mockProvider(): TransportProvider {
  return { create: () => ({ dmk: {} as any }) };
}

describe('transport registry', () => {
  beforeEach(() => clearRegistry());

  it('should register and retrieve a provider', () => {
    registerTransport('WebHID', mockProvider());
    expect(getTransportProvider('WebHID')).not.toBeNull();
  });

  it('should normalize type names (case-insensitive, trimmed)', () => {
    registerTransport('  WebHID  ', mockProvider());
    expect(getTransportProvider('webhid')).not.toBeNull();
  });

  it('should unregister a provider', () => {
    registerTransport('BLE', mockProvider());
    unregisterTransport('BLE');
    expect(getTransportProvider('BLE')).toBeNull();
  });

  it('should list all registered transport types', () => {
    registerTransport('WebHID', mockProvider());
    registerTransport('BLE', mockProvider());
    expect(listRegisteredTransports()).toEqual(['webhid', 'ble']);
  });

  it('should throw on empty type', () => {
    expect(() => registerTransport('', mockProvider())).toThrow();
  });
});
