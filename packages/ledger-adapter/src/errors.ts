import { HardwareErrorCode, enrichErrorMessage } from '@bytezhang/hardware-wallet-core';

/**
 * DMK locked device status codes:
 *   0x5515 (21781) — primary locked response
 *   0x6982 (27010) — security status not satisfied
 *   0x5303 (21251) — tertiary locked response
 */
const LOCKED_ERROR_CODES = new Set(['5515', '21781', '6982', '27010', '5303', '21251']);

/**
 * DMK user-rejected status codes:
 *   0x6985 (27013) — conditions of use not satisfied (user denied on device)
 */
const USER_REJECTED_CODES = new Set(['6985', '27013']);

/**
 * DMK wrong-app / CLA-not-supported status codes:
 *   0x6e00 (28160) — CLA not supported (wrong app open)
 *   0x6d00 (27904) — INS not supported (wrong app or outdated app)
 *   0x6a83 (27267) — Referenced data not found (wrong app for raw APDU, e.g. TRON)
 */
const WRONG_APP_CODES = new Set(['6e00', '28160', '6d00', '27904', '6a83', '27267']);

/**
 * DMK app-not-installed status codes:
 *   0x6807 (26631) — Unknown application name (app not installed on device)
 */
const APP_NOT_INSTALLED_CODES = new Set(['6807', '26631']);

/** Check if an error (or any error in its chain) represents a locked Ledger device. */
export function isDeviceLockedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  if (e.errorCode != null && LOCKED_ERROR_CODES.has(String(e.errorCode))) return true;
  if (e.statusCode != null && LOCKED_ERROR_CODES.has(String(e.statusCode))) return true;
  if (e._tag === 'DeviceLockedError') return true;
  if (typeof e.message === 'string' && /locked|device exchange error/i.test(e.message)) return true;
  if (e.originalError != null && isDeviceLockedError(e.originalError)) return true;
  if (e.error != null && e._tag && isDeviceLockedError(e.error)) return true;
  return false;
}

/** Check if a status/error code exists in the given set, crawling the error chain. */
function hasStatusCode(err: unknown, codeSet: Set<string>): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  if (e.errorCode != null && codeSet.has(String(e.errorCode))) return true;
  if (e.statusCode != null && codeSet.has(String(e.statusCode))) return true;
  if (e.originalError != null && hasStatusCode(e.originalError, codeSet)) return true;
  if (e.error != null && e._tag && hasStatusCode(e.error, codeSet)) return true;
  return false;
}

/** Check for user rejection (denied on device). */
export function isUserRejectedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  if (e._tag === 'UserRefusedOnDevice') return true;
  if (typeof e.message === 'string' && /denied|rejected|refused/i.test(e.message)) return true;
  if (hasStatusCode(err, USER_REJECTED_CODES)) return true;
  return false;
}

/** Check for wrong app open on the device. */
export function isWrongAppError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  if (e._tag === 'WrongAppOpenedError' || e._tag === 'InvalidStatusWordError') {
    if (hasStatusCode(err, WRONG_APP_CODES)) return true;
  }
  if (
    typeof e.message === 'string' &&
    /wrong app|open the .* app|CLA not supported/i.test(e.message)
  )
    return true;
  if (hasStatusCode(err, WRONG_APP_CODES)) return true;
  return false;
}

/** Check for app not installed on device (OpenAppCommand returns 0x6807). */
export function isAppNotInstalledError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  if (e._tag === 'OpenAppCommandError') return true;
  if (typeof e.message === 'string' && /unknown application/i.test(e.message)) return true;
  if (hasStatusCode(err, APP_NOT_INSTALLED_CODES)) return true;
  return false;
}

/** Check for device disconnected errors. */
export function isDeviceDisconnectedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  if (e._tag === 'DeviceNotRecognizedError' || e._tag === 'DeviceSessionNotFound') return true;
  if (
    typeof e.message === 'string' &&
    /disconnected|not found|no device|unplugged|session.*not.*found|timed out.*locked/i.test(
      e.message
    )
  )
    return true;
  return false;
}

/** Check for timeout errors. */
export function isTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  if (typeof e.message === 'string' && /timeout|timed?\s*out/i.test(e.message)) return true;
  if (e._tag === 'DeviceExchangeTimeoutError') return true;
  return false;
}

/**
 * Map a Ledger DMK error to a HardwareErrorCode and human-readable message
 * with actionable recovery information for the caller.
 */
export function mapLedgerError(err: unknown): { code: HardwareErrorCode; message: string } {
  // Order matters: check more specific errors first

  // Extract the original message for fallback / enrichment
  let originalMessage = 'Unknown Ledger error';
  if (err instanceof Error) {
    originalMessage = err.message;
  } else if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    originalMessage = String(e.message ?? e._tag ?? e.type ?? JSON.stringify(err));
  }

  let code: HardwareErrorCode;

  if (isDeviceLockedError(err)) {
    code = HardwareErrorCode.DeviceLocked;
  } else if (isUserRejectedError(err)) {
    code = HardwareErrorCode.UserRejected;
  } else if (isWrongAppError(err)) {
    code = HardwareErrorCode.WrongApp;
  } else if (isAppNotInstalledError(err)) {
    code = HardwareErrorCode.AppNotOpen;
  } else if (isDeviceDisconnectedError(err)) {
    code = HardwareErrorCode.DeviceDisconnected;
  } else if (isTimeoutError(err)) {
    code = HardwareErrorCode.OperationTimeout;
  } else {
    code = HardwareErrorCode.UnknownError;
  }

  return { code, message: enrichErrorMessage(code, originalMessage) };
}
