import type { TransportProvider } from '../types';

const registry = new Map<string, TransportProvider>();

function normalizeType(type: string): string {
  return type.trim().toLowerCase();
}

export function registerTransport(type: string, provider: TransportProvider): void {
  const key = normalizeType(type);
  if (!key) throw new Error('Transport type must be a non-empty string');
  registry.set(key, provider);
}

export function unregisterTransport(type: string): void {
  registry.delete(normalizeType(type));
}

export function getTransportProvider(type: string): TransportProvider | null {
  return registry.get(normalizeType(type)) ?? null;
}

export function listRegisteredTransports(): string[] {
  return Array.from(registry.keys());
}

export function clearRegistry(): void {
  registry.clear();
}
