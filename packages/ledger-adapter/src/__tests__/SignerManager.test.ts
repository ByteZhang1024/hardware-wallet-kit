import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignerManager } from '../signer/SignerManager';
import type { IDmk } from '../types';

describe('SignerManager', () => {
  let mockDmk: IDmk;
  let mockSignerBuilder: any;
  let manager: SignerManager;

  beforeEach(() => {
    mockDmk = {} as IDmk;
    mockSignerBuilder = vi.fn().mockReturnValue({
      build: vi.fn().mockReturnValue({ getAddress: vi.fn() }),
    });
    manager = new SignerManager(mockDmk, mockSignerBuilder);
  });

  it('should create a signer for a new sessionId', async () => {
    const signer = await manager.getOrCreate('session-1');
    expect(signer).toBeDefined();
    expect(mockSignerBuilder).toHaveBeenCalledWith({ dmk: mockDmk, sessionId: 'session-1' });
  });

  it('should create fresh signer each time (DMK signers are not reusable)', async () => {
    const first = await manager.getOrCreate('session-1');
    const second = await manager.getOrCreate('session-1');
    expect(first).not.toBe(second);
    expect(mockSignerBuilder).toHaveBeenCalledTimes(2);
  });

  it('should create new signer for different sessionId', async () => {
    const first = await manager.getOrCreate('session-1');
    const second = await manager.getOrCreate('session-2');
    expect(first).not.toBe(second);
    expect(mockSignerBuilder).toHaveBeenCalledTimes(2);
  });

  it('should clear cache for a specific sessionId', async () => {
    await manager.getOrCreate('session-1');
    manager.invalidate('session-1');
    await manager.getOrCreate('session-1');
    expect(mockSignerBuilder).toHaveBeenCalledTimes(2);
  });

  it('should clear all caches', async () => {
    await manager.getOrCreate('session-1');
    await manager.getOrCreate('session-2');
    manager.clearAll();
    await manager.getOrCreate('session-1');
    expect(mockSignerBuilder).toHaveBeenCalledTimes(3);
  });
});
