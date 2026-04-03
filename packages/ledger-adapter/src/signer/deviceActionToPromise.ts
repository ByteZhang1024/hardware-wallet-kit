import { DeviceActionStatus } from '@ledgerhq/device-management-kit';
import type { DeviceAction, DeviceActionState } from '../types';

/** Default timeout for non-interactive operations (e.g. getAddress without showOnDevice). */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Convert a DMK DeviceAction (Observable-based) into a Promise.
 * Handles pending -> completed/error state transitions and interaction callbacks.
 *
 * @param timeoutMs  Timeout in ms. Resets each time the Observable emits (device is alive).
 *                   Pass 0 to disable. Default: 30s.
 */
export function deviceActionToPromise<T>(
  action: DeviceAction<T>,
  onInteraction?: (interaction: string) => void,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    // eslint-disable-next-line prefer-const -- assigned once after declaration, but must be declared before use in cleanup
    let sub: { unsubscribe: () => void };
    let timer: ReturnType<typeof setTimeout> | null = null;

    const resetTimer = () => {
      if (timer) clearTimeout(timer);
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            sub?.unsubscribe();
            reject(new Error('Device action timed out — device may be locked or disconnected'));
          }
        }, timeoutMs);
      }
    };

    // Start initial timer
    resetTimer();

    console.log('[DMK-Observable] subscribing to action.observable...');
    sub = action.observable.subscribe({
      next: (state: DeviceActionState<T>) => {
        console.log('[DMK-Observable] next received');
        // Device is alive — reset timeout
        resetTimer();

        console.log(
          '[DMK-Observable] state:',
          JSON.stringify({
            status: state.status,
            intermediateValue:
              state.status === DeviceActionStatus.Pending ? state.intermediateValue : undefined,
            hasOutput: state.status === DeviceActionStatus.Completed,
            hasError: state.status === DeviceActionStatus.Error,
          })
        );
        if (settled) return;
        if (state.status === DeviceActionStatus.Completed) {
          settled = true;
          if (timer) clearTimeout(timer);
          onInteraction?.('interaction-complete');
          sub?.unsubscribe();
          resolve(state.output);
        } else if (state.status === DeviceActionStatus.Error) {
          settled = true;
          if (timer) clearTimeout(timer);
          onInteraction?.('interaction-complete');
          sub?.unsubscribe();
          reject(state.error);
        } else if (state.status === DeviceActionStatus.Pending && onInteraction) {
          const interaction = state.intermediateValue?.requiredUserInteraction;
          if (interaction && interaction !== 'none') {
            onInteraction(String(interaction));
          }
        }
      },
      error: (err: unknown) => {
        if (!settled) {
          settled = true;
          if (timer) clearTimeout(timer);
          sub?.unsubscribe();
          reject(err);
        }
      },
      complete: () => {
        if (!settled) {
          settled = true;
          if (timer) clearTimeout(timer);
          reject(new Error('Device action completed without result'));
        }
      },
    });
  });
}
