export enum HardwareErrorCode {
  UnknownError = 0,
  DeviceNotFound = 1,
  DeviceDisconnected = 2,
  UserRejected = 3,
  DeviceBusy = 4,
  FirmwareUpdateRequired = 5,
  AppNotOpen = 6,
  InvalidParams = 7,
  TransportError = 8,
  OperationTimeout = 9,
  MethodNotSupported = 10,

  // PIN / Passphrase
  PinInvalid = 5520,
  PinCancelled = 5521,
  PassphraseRejected = 5522,

  // Device state
  DeviceLocked = 5530,
  DeviceNotInitialized = 5531,
  DeviceInBootloader = 5532,
  FirmwareTooOld = 5533,

  // Ledger specific
  WrongApp = 5540,

  // Device identity
  DeviceMismatch = 5560,

  // Transport
  BridgeNotFound = 5550,
  TransportNotAvailable = 5551,
}
