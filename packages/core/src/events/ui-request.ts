export const UI_EVENT = 'UI_EVENT';

export const UI_REQUEST = {
  REQUEST_PIN: 'ui-request-pin',
  REQUEST_PASSPHRASE: 'ui-request-passphrase',
  REQUEST_PASSPHRASE_ON_DEVICE: 'ui-request-passphrase-on-device',
  REQUEST_BUTTON: 'ui-request-button',
  REQUEST_QR_DISPLAY: 'ui-request-qr-display',
  REQUEST_QR_SCAN: 'ui-request-qr-scan',
  REQUEST_DEVICE_PERMISSION: 'ui-request-device-permission',
  REQUEST_SELECT_DEVICE: 'ui-request-select-device',
  REQUEST_DEVICE_CONNECT: 'ui-request-device-connect',
  CLOSE_UI_WINDOW: 'ui-close',
  DEVICE_PROGRESS: 'ui-device_progress',
  FIRMWARE_PROGRESS: 'ui-firmware-progress',
  FIRMWARE_TIP: 'ui-firmware-tip',
} as const;

export const UI_RESPONSE = {
  RECEIVE_PIN: 'receive-pin',
  RECEIVE_PASSPHRASE: 'receive-passphrase',
  RECEIVE_PASSPHRASE_ON_DEVICE: 'receive-passphrase-on-device',
  RECEIVE_QR_RESPONSE: 'receive-qr-response',
  RECEIVE_SELECT_DEVICE: 'receive-select-device',
  CANCEL: 'cancel',
} as const;
