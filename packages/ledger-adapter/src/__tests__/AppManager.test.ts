import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppManager } from '../app/AppManager';

function createMockDmk() {
  return {
    startDiscovering: vi.fn(),
    stopDiscovering: vi.fn(),
    listenToAvailableDevices: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendCommand: vi.fn(),
  };
}

describe('AppManager', () => {
  let dmk: ReturnType<typeof createMockDmk>;
  let appManager: AppManager;

  beforeEach(() => {
    dmk = createMockDmk();
    appManager = new AppManager(dmk as any, { waitMs: 10, maxRetries: 3 });
  });

  describe('getAppName (static)', () => {
    it('maps ETH to Ethereum', () => {
      expect(AppManager.getAppName('ETH')).toBe('Ethereum');
    });

    it('maps BTC to Bitcoin', () => {
      expect(AppManager.getAppName('BTC')).toBe('Bitcoin');
    });

    it('maps SOL to Solana', () => {
      expect(AppManager.getAppName('SOL')).toBe('Solana');
    });

    it('maps TRX to Tron', () => {
      expect(AppManager.getAppName('TRX')).toBe('Tron');
    });

    it('maps XRP to XRP', () => {
      expect(AppManager.getAppName('XRP')).toBe('XRP');
    });

    it('maps ADA to Cardano', () => {
      expect(AppManager.getAppName('ADA')).toBe('Cardano');
    });

    it('maps DOT to Polkadot', () => {
      expect(AppManager.getAppName('DOT')).toBe('Polkadot');
    });

    it('maps ATOM to Cosmos', () => {
      expect(AppManager.getAppName('ATOM')).toBe('Cosmos');
    });

    it('returns undefined for unknown chain', () => {
      expect(AppManager.getAppName('UNKNOWN')).toBeUndefined();
    });
  });

  describe('ensureAppOpen', () => {
    it('returns immediately if correct app is already open', async () => {
      (dmk.sendCommand as ReturnType<typeof vi.fn>).mockResolvedValue({
        name: 'Ethereum',
      });

      await appManager.ensureAppOpen('session-1', 'Ethereum');

      // sendCommand should only be called once (getCurrentApp)
      expect(dmk.sendCommand).toHaveBeenCalledTimes(1);
    });

    it('opens the target app if a different app is running', async () => {
      let callCount = 0;
      (dmk.sendCommand as ReturnType<typeof vi.fn>).mockImplementation(
        async (params: { command: { type: string } }) => {
          const commandType = params.command.type;

          if (commandType === 'get-app-and-version') {
            callCount++;
            // First call: wrong app, second call: dashboard, third call: target app
            if (callCount === 1) {
              return { name: 'Bitcoin' };
            }
            if (callCount === 2) {
              return { name: 'BOLOS' };
            }
            return { name: 'Ethereum' };
          }

          // close-app and open-app return void
          return undefined;
        }
      );

      await appManager.ensureAppOpen('session-1', 'Ethereum');

      // Should have called: getCurrentApp, closeApp, getCurrentApp (dashboard), openApp, getCurrentApp (Ethereum)
      expect(dmk.sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1',
          command: expect.objectContaining({ type: 'close-app' }),
        })
      );
      expect(dmk.sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1',
          command: expect.objectContaining({ type: 'open-app', appName: 'Ethereum' }),
        })
      );
    });

    it('opens the target app directly from dashboard', async () => {
      let callCount = 0;
      (dmk.sendCommand as ReturnType<typeof vi.fn>).mockImplementation(
        async (params: { command: { type: string } }) => {
          const commandType = params.command.type;

          if (commandType === 'get-app-and-version') {
            callCount++;
            if (callCount === 1) {
              return { name: 'BOLOS' };
            }
            return { name: 'Ethereum' };
          }

          return undefined;
        }
      );

      await appManager.ensureAppOpen('session-1', 'Ethereum');

      // Should NOT have called close-app since we're on dashboard
      const closeAppCalls = (dmk.sendCommand as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: any[]) => call[0].command.type === 'close-app'
      );
      expect(closeAppCalls).toHaveLength(0);

      expect(dmk.sendCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1',
          command: expect.objectContaining({ type: 'open-app', appName: 'Ethereum' }),
        })
      );
    });

    it('throws if the target app fails to open after max retries', async () => {
      (dmk.sendCommand as ReturnType<typeof vi.fn>).mockImplementation(
        async (params: { command: { type: string } }) => {
          const commandType = params.command.type;

          if (commandType === 'get-app-and-version') {
            return { name: 'BOLOS' };
          }

          return undefined;
        }
      );

      await expect(appManager.ensureAppOpen('session-1', 'Ethereum')).rejects.toThrow(
        /failed to open/i
      );
    });
  });
});
