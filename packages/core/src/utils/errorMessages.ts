import { HardwareErrorCode } from '../types/errors';

/**
 * Enrich a hardware error message with actionable recovery hints.
 * Shared across adapters (Ledger, Trezor, etc.).
 */
export function enrichErrorMessage(code: HardwareErrorCode, originalMessage: string): string {
  switch (code) {
    case HardwareErrorCode.PinInvalid:
      return `${originalMessage}. Please re-enter your PIN.`;
    case HardwareErrorCode.PinCancelled:
      return `${originalMessage}. PIN entry was cancelled.`;
    case HardwareErrorCode.DeviceBusy:
      return `${originalMessage}. The device is in use by another application. Close other wallet apps and try again.`;
    case HardwareErrorCode.DeviceDisconnected:
      return `${originalMessage}. Please reconnect the device and try again.`;
    case HardwareErrorCode.DeviceLocked:
      return `${originalMessage}. Please unlock your device and try again.`;
    case HardwareErrorCode.UserRejected:
      return `${originalMessage}. The request was rejected on the device.`;
    case HardwareErrorCode.WrongApp:
      return `${originalMessage}. Please open the correct app on your device.`;
    case HardwareErrorCode.AppNotOpen:
      return `${originalMessage}. The required app is not installed on the device.`;
    case HardwareErrorCode.TransportNotAvailable:
      return `${originalMessage}. Ensure the device bridge/transport is available and running.`;
    case HardwareErrorCode.FirmwareTooOld:
      return `${originalMessage}. Please update your device firmware.`;
    case HardwareErrorCode.DeviceNotInitialized:
      return `${originalMessage}. The device may need to be set up first.`;
    case HardwareErrorCode.OperationTimeout:
      return `${originalMessage}. The operation timed out. Please try again.`;
    default:
      return originalMessage;
  }
}
