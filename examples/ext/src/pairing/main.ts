const TREZOR_USB_FILTERS: USBDeviceFilter[] = [
  { vendorId: 0x534c, productId: 0x0001 },
  { vendorId: 0x1209, productId: 0x53c0 },
  { vendorId: 0x1209, productId: 0x53c1 },
];

const status = document.getElementById('status')!;

document.getElementById('trezor-btn')!.addEventListener('click', async () => {
  try {
    const device = await navigator.usb.requestDevice({ filters: TREZOR_USB_FILTERS });
    status.textContent = `Paired: ${device.productName} — you can close this window`;
    status.className = 'status';
    setTimeout(() => window.close(), 1500);
  } catch {
    status.textContent = 'No device selected. Try again.';
    status.className = 'error';
  }
});

const LEDGER_HID_FILTERS: HIDDeviceFilter[] = [{ vendorId: 0x2c97 }];

document.getElementById('ledger-btn')!.addEventListener('click', async () => {
  try {
    const [device] = await navigator.hid.requestDevice({ filters: LEDGER_HID_FILTERS });
    status.textContent = `Paired: ${device.productName} — you can close this window`;
    status.className = 'status';
    setTimeout(() => window.close(), 1500);
  } catch {
    status.textContent = 'No device selected. Try again.';
    status.className = 'error';
  }
});

// ── Debug Panel ──

const debugLog = document.getElementById('debug-log')!;

function dlog(msg: string, data?: unknown) {
  const ts = new Date().toLocaleTimeString();
  const text = data !== undefined
    ? `[${ts}] ${msg}: ${typeof data === 'string' ? data : JSON.stringify(data, null, 2)}`
    : `[${ts}] ${msg}`;
  console.log(`[Debug] ${msg}`, data);
  const div = document.createElement('div');
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordBreak = 'break-all';
  if (text.includes('ERROR')) div.style.color = '#f85149';
  else if (text.includes('→ 0 ') || text.includes('(empty')) div.style.color = '#d29922';
  debugLog.prepend(div);
  div.textContent = text;
}

function fmtHid(d: HIDDevice): string {
  const parts = [
    `vendorId=0x${d.vendorId.toString(16)}`,
    `productId=0x${d.productId.toString(16)}`,
    `productName="${d.productName}"`,
    `opened=${d.opened}`,
  ];
  if (d.collections?.length) {
    parts.push(`collections=${JSON.stringify(d.collections.map(c => ({
      usagePage: '0x' + c.usagePage.toString(16),
      usage: '0x' + c.usage.toString(16),
    })))}`);
  }
  return parts.join(', ');
}

function fmtUsb(d: USBDevice): string {
  return [
    `vendorId=0x${d.vendorId.toString(16)}`,
    `productId=0x${d.productId.toString(16)}`,
    `productName="${d.productName}"`,
    `serialNumber="${d.serialNumber}"`,
    `opened=${d.opened}`,
  ].join(', ');
}

document.getElementById('debug-clear')!.addEventListener('click', () => {
  debugLog.innerHTML = '<div style="color:#484f58">Click buttons above to test browser APIs...</div>';
});

document.getElementById('hid-get')!.addEventListener('click', async () => {
  if (!navigator.hid) { dlog('navigator.hid NOT available'); return; }
  try {
    const devices = await navigator.hid.getDevices();
    dlog(`hid.getDevices() → ${devices.length} device(s)`);
    devices.forEach((d, i) => dlog(`  [${i}] ${fmtHid(d)}`));
    if (!devices.length) dlog('  (empty — no previously authorized HID devices)');
  } catch (e: any) { dlog(`hid.getDevices() ERROR: ${e.message}`); }
});

document.getElementById('hid-req-ledger')!.addEventListener('click', async () => {
  if (!navigator.hid) { dlog('navigator.hid NOT available'); return; }
  try {
    dlog('hid.requestDevice() → opening system picker (Ledger 0x2c97)...');
    const devices = await navigator.hid.requestDevice({ filters: [{ vendorId: 0x2c97 }] });
    dlog(`hid.requestDevice() → selected ${devices.length} device(s)`);
    devices.forEach((d, i) => dlog(`  [${i}] ${fmtHid(d)}`));
  } catch (e: any) { dlog(`hid.requestDevice() ERROR: ${e.message}`); }
});

document.getElementById('hid-req-all')!.addEventListener('click', async () => {
  if (!navigator.hid) { dlog('navigator.hid NOT available'); return; }
  try {
    dlog('hid.requestDevice() → opening system picker (NO filter)...');
    const devices = await navigator.hid.requestDevice({ filters: [] });
    dlog(`hid.requestDevice() → selected ${devices.length} device(s)`);
    devices.forEach((d, i) => dlog(`  [${i}] ${fmtHid(d)}`));
  } catch (e: any) { dlog(`hid.requestDevice() ERROR: ${e.message}`); }
});

document.getElementById('usb-get')!.addEventListener('click', async () => {
  if (!navigator.usb) { dlog('navigator.usb NOT available'); return; }
  try {
    const devices = await navigator.usb.getDevices();
    dlog(`usb.getDevices() → ${devices.length} device(s)`);
    devices.forEach((d, i) => dlog(`  [${i}] ${fmtUsb(d)}`));
    if (!devices.length) dlog('  (empty — no previously authorized USB devices)');
  } catch (e: any) { dlog(`usb.getDevices() ERROR: ${e.message}`); }
});

document.getElementById('usb-req-trezor')!.addEventListener('click', async () => {
  if (!navigator.usb) { dlog('navigator.usb NOT available'); return; }
  try {
    dlog('usb.requestDevice() → opening system picker (Trezor)...');
    const device = await navigator.usb.requestDevice({
      filters: TREZOR_USB_FILTERS,
    });
    dlog(`usb.requestDevice() → selected: ${fmtUsb(device)}`);
  } catch (e: any) { dlog(`usb.requestDevice() ERROR: ${e.message}`); }
});
