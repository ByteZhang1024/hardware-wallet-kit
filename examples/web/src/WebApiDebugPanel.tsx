import React, { useState, useCallback } from 'react';

const LEDGER_VENDOR_ID = 0x2c97;
const TREZOR_VENDOR_ID = 0x1209;
const TREZOR_PRODUCT_IDS = [0x53c0, 0x53c1];

function formatDevice(d: any, api: string): string {
  const fields: string[] = [];
  if (api === 'hid') {
    fields.push(`vendorId=0x${d.vendorId?.toString(16)}`);
    fields.push(`productId=0x${d.productId?.toString(16)}`);
    fields.push(`productName="${d.productName}"`);
    fields.push(`opened=${d.opened}`);
    if (d.collections) {
      fields.push(`collections=${JSON.stringify(d.collections.map((c: any) => ({
        usagePage: `0x${c.usagePage?.toString(16)}`,
        usage: `0x${c.usage?.toString(16)}`,
      })))}`);
    }
  } else {
    fields.push(`vendorId=0x${d.vendorId?.toString(16)}`);
    fields.push(`productId=0x${d.productId?.toString(16)}`);
    fields.push(`productName="${d.productName}"`);
    fields.push(`serialNumber="${d.serialNumber}"`);
    fields.push(`opened=${d.opened}`);
    if (d.configuration) {
      fields.push(`config=${d.configuration.configurationValue}`);
      const ifaces = d.configuration.interfaces?.map((i: any) => ({
        num: i.interfaceNumber,
        alt: i.alternate?.interfaceClass,
      }));
      fields.push(`interfaces=${JSON.stringify(ifaces)}`);
    }
  }
  return fields.join(', ');
}

export function WebApiDebugPanel() {
  const [logs, setLogs] = useState<string[]>([]);

  const log = useCallback((msg: string, data?: unknown) => {
    const ts = new Date().toLocaleTimeString();
    const line = data !== undefined
      ? `[${ts}] ${msg}: ${typeof data === 'string' ? data : JSON.stringify(data, null, 2)}`
      : `[${ts}] ${msg}`;
    console.log(`[Debug] ${msg}`, data);
    setLogs(prev => [line, ...prev]);
  }, []);

  // ── WebHID (Ledger) ──

  const hidGetDevices = useCallback(async () => {
    if (!navigator.hid) { log('navigator.hid NOT available'); return; }
    try {
      const devices = await navigator.hid.getDevices();
      log(`hid.getDevices() → ${devices.length} device(s)`);
      devices.forEach((d, i) => log(`  [${i}] ${formatDevice(d, 'hid')}`));
      if (devices.length === 0) log('  (empty — no previously authorized HID devices)');
    } catch (e: any) {
      log(`hid.getDevices() ERROR: ${e.message}`);
    }
  }, [log]);

  const hidRequestDevice = useCallback(async () => {
    if (!navigator.hid) { log('navigator.hid NOT available'); return; }
    try {
      log('hid.requestDevice() → opening system picker (Ledger vendorId 0x2c97)...');
      const devices = await navigator.hid.requestDevice({
        filters: [{ vendorId: LEDGER_VENDOR_ID }],
      });
      log(`hid.requestDevice() → user selected ${devices.length} device(s)`);
      devices.forEach((d, i) => log(`  [${i}] ${formatDevice(d, 'hid')}`));
    } catch (e: any) {
      log(`hid.requestDevice() ERROR: ${e.message}`);
    }
  }, [log]);

  const hidRequestDeviceNoFilter = useCallback(async () => {
    if (!navigator.hid) { log('navigator.hid NOT available'); return; }
    try {
      log('hid.requestDevice() → opening system picker (NO filter)...');
      const devices = await navigator.hid.requestDevice({ filters: [] });
      log(`hid.requestDevice() → user selected ${devices.length} device(s)`);
      devices.forEach((d, i) => log(`  [${i}] ${formatDevice(d, 'hid')}`));
    } catch (e: any) {
      log(`hid.requestDevice() ERROR: ${e.message}`);
    }
  }, [log]);

  // ── WebUSB (Trezor) ──

  const usbGetDevices = useCallback(async () => {
    if (!navigator.usb) { log('navigator.usb NOT available'); return; }
    try {
      const devices = await navigator.usb.getDevices();
      log(`usb.getDevices() → ${devices.length} device(s)`);
      devices.forEach((d, i) => log(`  [${i}] ${formatDevice(d, 'usb')}`));
      if (devices.length === 0) log('  (empty — no previously authorized USB devices)');
    } catch (e: any) {
      log(`usb.getDevices() ERROR: ${e.message}`);
    }
  }, [log]);

  const usbRequestDevice = useCallback(async () => {
    if (!navigator.usb) { log('navigator.usb NOT available'); return; }
    try {
      log('usb.requestDevice() → opening system picker (Trezor vendorId 0x1209)...');
      const device = await navigator.usb.requestDevice({
        filters: TREZOR_PRODUCT_IDS.map(productId => ({
          vendorId: TREZOR_VENDOR_ID,
          productId,
        })),
      });
      log(`usb.requestDevice() → selected: ${formatDevice(device, 'usb')}`);
    } catch (e: any) {
      log(`usb.requestDevice() ERROR: ${e.message}`);
    }
  }, [log]);

  const clearLogs = useCallback(() => setLogs([]), []);

  const btnClass = 'px-3 py-1.5 rounded text-white text-xs font-mono cursor-pointer';

  return (
    <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 8, padding: 16, marginTop: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ color: '#f0883e', fontWeight: 'bold', fontSize: 14 }}>
          🔧 WebAPI Debug Panel
        </span>
        <button className={btnClass} style={{ background: '#6e7681' }} onClick={clearLogs}>
          Clear Logs
        </button>
      </div>

      {/* WebHID section */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ color: '#8b949e', fontSize: 11, marginBottom: 6 }}>WebHID (Ledger)</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className={btnClass} style={{ background: '#1f6feb' }} onClick={hidGetDevices}>
            hid.getDevices()
          </button>
          <button className={btnClass} style={{ background: '#8957e5' }} onClick={hidRequestDevice}>
            hid.requestDevice(Ledger)
          </button>
          <button className={btnClass} style={{ background: '#6e40c9' }} onClick={hidRequestDeviceNoFilter}>
            hid.requestDevice(no filter)
          </button>
        </div>
      </div>

      {/* WebUSB section */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ color: '#8b949e', fontSize: 11, marginBottom: 6 }}>WebUSB (Trezor)</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className={btnClass} style={{ background: '#1f6feb' }} onClick={usbGetDevices}>
            usb.getDevices()
          </button>
          <button className={btnClass} style={{ background: '#8957e5' }} onClick={usbRequestDevice}>
            usb.requestDevice(Trezor)
          </button>
        </div>
      </div>

      {/* Log output */}
      <div style={{
        background: '#161b22',
        border: '1px solid #30363d',
        borderRadius: 4,
        padding: 8,
        maxHeight: 300,
        overflow: 'auto',
        fontFamily: 'monospace',
        fontSize: 11,
        lineHeight: 1.5,
      }}>
        {logs.length === 0 ? (
          <div style={{ color: '#484f58' }}>Click buttons above to test browser APIs...</div>
        ) : (
          logs.map((line, i) => (
            <div key={i} style={{
              color: line.includes('ERROR') ? '#f85149'
                : line.includes('→ 0 ') || line.includes('(empty') ? '#d29922'
                : '#c9d1d9',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}>
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
