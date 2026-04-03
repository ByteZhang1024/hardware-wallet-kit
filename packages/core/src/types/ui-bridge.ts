import type { DeviceInfo } from './device';
import type { PreemptionDecision } from '../utils/DeviceJobQueue';

/**
 * Abstraction for UI communication during device interactions.
 * Implementations handle different execution contexts:
 * - DirectUiBridge: same-process event emitter (default)
 * - IframeUiBridge: postMessage-based (future)
 * - ExtensionUiBridge: chrome.runtime.sendMessage (future)
 */
export interface IUiBridge {
  /** Ask the user for PIN entry. Returns the PIN string. */
  requestPin(device: DeviceInfo, signal?: AbortSignal): Promise<string>;

  /** Ask the user for passphrase entry. Returns the passphrase string. */
  requestPassphrase(device: DeviceInfo, signal?: AbortSignal): Promise<string>;

  /** Notify the UI about a button press request on the device. */
  notifyButton(device: DeviceInfo, code?: string): void;

  /**
   * Ask the user whether to preempt the current device operation.
   * Only called for 'confirm'-level operations.
   */
  requestPreemption(
    device: DeviceInfo,
    activeLabel: string,
    newLabel: string
  ): Promise<PreemptionDecision>;
}
