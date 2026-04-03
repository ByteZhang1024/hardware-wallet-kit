# Hardware Wallet Kit - Architecture

## 1. Monorepo Package Overview

```
hardware-wallet-kit/
├── packages/
│   ├── core/                        # 核心类型定义、接口、事件、工具类
│   ├── transport-core/              # AbstractProxyClient 跨进程代理基类
│   ├── connector-loader/            # 平台条件加载器 (Web/Ext/Desktop/Native)
│   │
│   ├── ledger-adapter/              # Ledger IHardwareWallet 实现
│   ├── ledger-connector-webhid/     # Ledger WebHID 连接器
│   ├── ledger-connector-ble/        # Ledger BLE 连接器 (React Native)
│   ├── ledger-transport-ext/        # Ledger 浏览器扩展 Host/Client 代理
│   │
│   ├── trezor-adapter/              # Trezor IHardwareWallet 实现
│   ├── trezor-connector/            # Trezor @trezor/connect 鸭子类型桥接
│   ├── trezor-transport-ext/        # Trezor 扩展 Offscreen/ServiceWorker 代理
│   ├── trezor-transport-electron/   # Trezor Electron IPC 代理
│   ├── trezor-connect-iframe/       # 自托管 Trezor Connect v9 iframe (Vercel)
│   │
│   └── keystone-adapter/            # Keystone (仅 dist, 无源码)
│
└── examples/
    ├── web/                         # Web 示例
    ├── ext/                         # 浏览器扩展示例
    ├── desktop/                     # Electron 桌面示例
    └── mobile/                      # React Native 移动端示例
```

---

## 2. 核心接口层次 (core/)

```
IHardwareWallet<TConfig>           # 硬件钱包主接口
  ├── extends IEvmMethods           # EVM 链方法
  ├── extends IBtcMethods           # BTC 链方法
  ├── extends ISolMethods           # SOL 链方法
  └── extends ITronMethods          # TRON 链方法

每条链的方法签名统一:
  {chain}GetAddress(connectId, deviceId, params)        → Response<Address>
  {chain}GetAddresses(connectId, deviceId, params[])    → Response<Address[]>
  {chain}GetPublicKey(connectId, deviceId, params)      → Response<PublicKey>
  {chain}SignTransaction(connectId, deviceId, params)    → Response<SignedTx>
  {chain}SignMessage(connectId, deviceId, params)        → Response<Signature>
  evmSignTypedData(connectId, deviceId, params)          → Response<Signature>  (EVM 独有)
```

### 事件体系

```
HardwareEvent (联合类型)
  │
  ├── DeviceEvent
  │   ├── device-connect      → { payload: DeviceInfo }
  │   ├── device-disconnect   → { payload: { connectId } }
  │   └── device-changed      → { payload: DeviceInfo }
  │
  ├── UiRequestEvent
  │   ├── ui-request-pin                → { device }
  │   ├── ui-request-passphrase         → { device }
  │   ├── ui-request-button             → { device, code? }
  │   ├── ui-request-qr-display         → { device, data }
  │   ├── ui-request-qr-scan            → { device }
  │   ├── ui-request-device-permission  → {}
  │   └── ui-request-select-device      → { devices }
  │
  └── SdkEvent
      ├── device-interaction    → { connectId, action }
      ├── device-stuck          → { connectId }
      ├── device-unresponsive   → { connectId }
      └── device-recovered      → { connectId }
```

### 关键类型

```
DeviceInfo {                         ConnectorDevice {
  vendor: VendorType                   connectId: string
  model: string                        deviceId: string
  firmwareVersion: string              name: string
  deviceId: string                     model?: string
  connectId: string                    capabilities?: DeviceCapabilities
  connectionType: ConnectionType     }
  battery?: number
  capabilities?: DeviceCapabilities  IConnector {
}                                      searchDevices() → ConnectorDevice[]
                                       connect(deviceId?) → ConnectorSession
Response<T> =                          disconnect(sessionId)
  | { success: true,  payload: T }     call(sessionId, method, params)
  | { success: false, payload: {       cancel(sessionId)
      error: string,                   uiResponse(response)
      code: HardwareErrorCode          on/off(event, handler)
    }}                                 reset()
                                     }
```

---

## 3. 全局架构线稿

```
╔═════════════════════════════════════════════════════════════════════════╗
║                         APPLICATION LAYER                              ║
║  (examples/web | examples/ext | examples/desktop | examples/mobile)    ║
╚═══════════════════════════════╤═════════════════════════════════════════╝
                                │
                                │ createLedgerConnector() / createTrezorConnector()
                                │ (connector-loader: 按平台条件加载)
                                │
          ┌─────────────────────┴─────────────────────┐
          │                                           │
          ▼                                           ▼
╔═══════════════════╗                     ╔═══════════════════╗
║   LedgerAdapter   ║                     ║   TrezorAdapter   ║
║ (IHardwareWallet) ║                     ║ (IHardwareWallet) ║
╚════════╤══════════╝                     ╚════════╤══════════╝
         │                                         │
         │ IConnector                              │ IConnector
         │                                         │
    ┌────┴────┬──────────┐               ┌────────┴────────┐
    │         │          │               │                  │
    ▼         ▼          ▼               ▼                  ▼
┌────────┐┌───────┐┌─────────┐    ┌───────────┐    ┌──────────────┐
│WebHID  ││ BLE   ││Desktop  │    │TrezorDirect│    │TrezorOffscreen│
│Connect-││Connect││Bridge   │    │Connector   │    │Connector     │
│or      ││or     ││Connector│    │(鸭子类型)   │    │(Ext/Electron)│
└───┬────┘└──┬────┘└────┬────┘    └──────┬─────┘    └──────┬───────┘
    │        │          │                │                  │
    ▼        ▼          ▼                ▼                  ▼
┌───────────────┐  ┌─────────┐    ┌────────────┐    ┌──────────────┐
│ @ledgerhq/DMK │  │IPC/IHW- │    │@trezor/    │    │@trezor/      │
│ (Device Mgmt  │  │Bridge   │    │connect-web │    │connect       │
│  Kit)         │  │(Electron│    │(直接调用)   │    │(iframe/IPC)  │
└───────┬───────┘  │ main)   │    └──────┬─────┘    └──────┬───────┘
        │          └─────────┘           │                  │
        ▼                                ▼                  ▼
  ┌───────────┐                    ┌───────────┐     ┌───────────┐
  │ WebHID /  │                    │ WebUSB /  │     │ NodeUSB / │
  │ BLE GATT  │                    │ iframe    │     │ IPC       │
  └─────┬─────┘                    └─────┬─────┘     └─────┬─────┘
        │                                │                  │
        └────────────────┬───────────────┘                  │
                         │                                  │
                         ▼                                  ▼
                 ┌──────────────────────────────────────────────┐
                 │              HARDWARE DEVICE                  │
                 │         (Ledger / Trezor / Keystone)         │
                 └──────────────────────────────────────────────┘
```

---

## 4. Ledger 完整调用路径

### 4.1 初始化 + 发现 + 连接

```
App
 │
 │  const connector = await createLedgerConnector()
 │  // connector-loader 按平台返回:
 │  //   Web/Ext → LedgerWebHidConnector
 │  //   Native  → LedgerBleConnector
 │  //   Desktop → createDesktopBridgeConnector('ledger', bridge)
 │
 │  const adapter = new LedgerAdapter(connector)
 │  await adapter.init()    // no-op, connector 已就绪
 │
 │  ┌──────────── searchDevices() ────────────────────────────────────┐
 │  │                                                                  │
 │  │  LedgerAdapter.searchDevices()                                  │
 │  │    └─ connector.searchDevices()                                 │
 │  │       └─ LedgerConnectorBase.searchDevices()                    │
 │  │          ├─ _getDeviceManager()                                 │
 │  │          │  └─ 懒初始化: _getOrCreateDmk()                      │
 │  │          │     └─ DeviceManagementKitBuilder                    │
 │  │          │        .addTransport(webHidTransportFactory)         │
 │  │          │        .build() → IDmk                               │
 │  │          │                                                       │
 │  │          ├─ dm.enumerate()                                       │
 │  │          │  └─ dmk.listenToAvailableDevices()                   │
 │  │          │     └─ Observable → 取第一次发射 → DmkDiscoveredDevice[]│
 │  │          │                                                       │
 │  │          ├─ (如果为空) dm.requestDevice()                        │
 │  │          │  └─ dmk.startDiscovering()                           │
 │  │          │     └─ 触发 WebHID navigator.hid.requestDevice()     │
 │  │          │        或 BLE scan                                    │
 │  │          │                                                       │
 │  │          └─ _registerDeviceId(descriptor) for each device        │
 │  │             ├─ _resolveConnectId(descriptor) → 稳定 ID           │
 │  │             │  ├─ BLE: 从设备名提取 4 位 HEX (如 "Nano X AB12" → "AB12")
 │  │             │  └─ USB: 用 DMK 的 ephemeral UUID                 │
 │  │             └─ 双向映射: _connectIdToPath ↔ _pathToConnectId    │
 │  │                                                                  │
 │  │  返回 → DeviceInfo[]                                             │
 │  └──────────────────────────────────────────────────────────────────┘
 │
 │  ┌──────────── connectDevice(connectId) ───────────────────────────┐
 │  │                                                                  │
 │  │  LedgerAdapter.connectDevice(connectId)                         │
 │  │    ├─ _ensureDevicePermission(connectId)                        │
 │  │    │  └─ uiHandler.checkDevicePermission()                     │
 │  │    │     └─ uiHandler.onDevicePermission() (如果需要)           │
 │  │    │                                                             │
 │  │    └─ connector.connect(connectId)                              │
 │  │       └─ LedgerConnectorBase.connect(connectId)                 │
 │  │          ├─ connectId → DMK path 映射查找                       │
 │  │          ├─ dm.connect(path) → sessionId                        │
 │  │          │  └─ dmk.connect({ device }) → sessionId              │
 │  │          ├─ emit('device-connect', { device })                  │
 │  │          └─ 返回 ConnectorSession { sessionId, deviceInfo }     │
 │  │                                                                  │
 │  │  缓存: _sessions[connectId] = sessionId                         │
 │  │  缓存: _discoveredDevices[connectId] = deviceInfo               │
 │  │  返回 → success(connectId)                                       │
 │  └──────────────────────────────────────────────────────────────────┘
```

### 4.2 EVM 签名调用路径

```
App
 │  adapter.evmSignTransaction(connectId, deviceId, {
 │    path: "m/44'/60'/0'/0/0",
 │    serializedTx: "0xf86c...",
 │    chainId: 1
 │  })
 │
 ▼
LedgerAdapter.evmSignTransaction()
 ├─ _ensureDevicePermission()
 ├─ _verifyDeviceFingerprint()    // 可选: 比对指纹
 └─ connectorCall(connectId, 'evmSignTransaction', params)
    │
    │  查 _sessions[connectId] → sessionId
    │
    ▼
LedgerConnectorBase.call(sessionId, 'evmSignTransaction', params)
 └─ _evmSignTransaction(sessionId, params)
    ├─ _getEthSigner(sessionId)
    │  └─ SignerManager.getOrCreate(sessionId, builderFn)
    │     └─ builderFn({ dmk, sessionId })
    │        ├─ import('@ledgerhq/device-signer-kit-ethereum')
    │        └─ SignerEthBuilder({ dmk, sessionId }).build()
    │           └─ 返回 SignerEth 实例
    │
    └─ signer.signTransaction(path, serializedTxHex)
       │
       ▼
    SignerEth.signTransaction()
     ├─ hex → Uint8Array 转换
     └─ sdk.signTransaction(path, txBytes)
        │
        │  返回 DeviceAction { observable, cancel }
        │
        ▼
     deviceActionToPromise(action, onInteraction, timeoutMs)
      │
      │  订阅 Observable:
      │  ┌──────────────────────────────────────────────┐
      │  │  emission: { status, output, error,           │
      │  │             intermediateValue }               │
      │  │                                               │
      │  │  status='pending'                             │
      │  │  + requiredUserInteraction='SignTransaction'   │
      │  │    → onInteraction('SignTransaction')          │
      │  │    → Adapter emit SDK.DEVICE_INTERACTION      │
      │  │    → App 显示 "请在设备上确认"                  │
      │  │                                               │
      │  │  status='completed'                           │
      │  │    → resolve(output: { r, s, v })             │
      │  │                                               │
      │  │  status='error'                               │
      │  │    → reject(error)                            │
      │  │    → mapLedgerError() 统一错误码              │
      │  └──────────────────────────────────────────────┘
      │
      │  超时: 默认 30s, 交互操作 5min
      │
      ▼
   返回 { r, s, v } → LedgerConnectorBase 包装
    → LedgerAdapter 包装为 Response<EvmSignedTx>
     → App 收到 { success: true, payload: { v, r, s } }
```

### 4.3 TRON 签名 (Raw APDU, 无 DMK Signer Kit)

```
App
 │  adapter.tronSignTransaction(connectId, deviceId, {
 │    path: "m/44'/195'/0'/0/0",
 │    rawTxHex: "0a02..." (protobuf)
 │  })
 │
 ▼
LedgerConnectorBase.call(sessionId, 'tronSignTransaction', params)
 └─ _tronSignTransaction(sessionId, params)
    │
    ├─ _createTronSigner(sessionId)
    │  ├─ 获取 DMK 实例
    │  ├─ 创建 sendApdu 函数: (apdu) => dmk.sendApdu({ sessionId, apdu })
    │  └─ new SignerTron(sendApdu)
    │
    └─ tronSigner.signTransaction(path, rawTxHex)
       │
       ▼
    SignerTron (Raw APDU 协议)
     │
     │  1. 路径序列化: "m/44'/195'/0'/0/0"
     │     → [0x8000002C, 0x800000C3, 0x80000000, 0x00, 0x00]
     │     → 每段 4 字节 big-endian
     │
     │  2. 分块 (CHUNK_SIZE = 250):
     │     ┌─────────────────────────────────────────────────┐
     │     │ Chunk 0 (首块): pathData + tx[0..N]             │
     │     │   P1 = 0x00 (多块首块) 或 0x10 (单块)          │
     │     │                                                  │
     │     │ Chunk 1..N-1 (中间块): tx[N..M]                 │
     │     │   P1 = 0x80                                      │
     │     │                                                  │
     │     │ Chunk N (末块): tx[M..end]                       │
     │     │   P1 = 0x90                                      │
     │     └─────────────────────────────────────────────────┘
     │
     │  3. 每块构造 APDU:
     │     [CLA=0xE0, INS=0x04, P1, P2=0x00, LEN, DATA...]
     │
     │  4. sendApdu(apdu)
     │     └─ dmk.sendApdu({ sessionId, apdu })
     │        └─ DMK 通过 WebHID/BLE 发送到设备
     │
     │  5. 检查 statusCode == 0x9000
     │     ├─ 0x6E00/0x6D00 → Wrong App
     │     │  → _openTronApp(): APDU [0xE0, 0xD8, ...,"Tron"]
     │     │  → 等待 2s → 重试
     │     └─ 0x9000 → 提取 65 字节签名
     │
     ▼
   返回 signature (hex string, 65 bytes)
```

### 4.4 BTC 签名 (含 Taproot PSBT 增强)

```
App
 │  adapter.btcSignTransaction(connectId, deviceId, {
 │    psbt: "70736274ff...",
 │    coin: "btc",
 │    path: "m/86'/0'/0'"           // Taproot
 │  })
 │
 ▼
LedgerConnectorBase._btcSignTransaction(sessionId, params)
 │
 ├─ 1. 从 path 推断钱包模板:
 │     44' → Legacy (P2PKH)
 │     49' → NestedSegwit (P2SH-P2WPKH)
 │     84' → NativeSegwit (P2WPKH)
 │     86' → Taproot (P2TR)
 │
 ├─ 2. 如果 Taproot + inputDerivations:
 │     _enrichTaprootPsbt(psbt, inputDerivations)
 │     ├─ 解析 PSBT 二进制
 │     ├─ 从设备获取 masterFingerprint
 │     ├─ 对每个 Taproot input:
 │     │   ├─ 添加 tapInternalKey (0x17)
 │     │   └─ 添加 tapBip32Derivation (0x16)
 │     └─ 重建增强后的 PSBT
 │
 ├─ 3. 创建 DefaultWallet(path, template)
 │
 └─ 4. btcSigner.signTransaction(wallet, enrichedPsbt)
       └─ DMK SignerBtcBuilder → DeviceAction → Observable → Promise
          → 设备签名 → 返回 signedPsbt hex
```

---

## 5. Trezor 完整调用路径

### 5.1 三种运行模式

```
┌──────────────────────────────────────────────────────────────────────┐
│ 模式 A: Web 直连                                                      │
│                                                                       │
│  App → TrezorAdapter → TrezorDirectConnector → @trezor/connect-web   │
│                                                  │                    │
│                                                  ▼                    │
│                                            WebUSB/iframe             │
│                                                  │                    │
│                                                  ▼                    │
│                                              Device                  │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ 模式 B: Chrome 扩展 (MV3)                                            │
│                                                                       │
│  Popup ──chrome.runtime.sendMessage──> Service Worker ──> Offscreen  │
│  (TrezorExtClient)                    (Router)           (TrezorOff- │
│                                                           screenHost)│
│                                                              │       │
│                                                  @trezor/connect-web │
│                                                  (自托管 iframe)      │
│                                                              │       │
│                                                           WebUSB     │
│                                                              │       │
│                                                           Device     │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ 模式 C: Electron 桌面                                                 │
│                                                                       │
│  Renderer ──ipcRenderer.invoke──> Main Process                       │
│  (TrezorIpcConnect)               (createElectronTrezorBridge)       │
│                                       │                               │
│                               @trezor/connect (Node.js)              │
│                                       │                               │
│                                   NodeUSB                            │
│                                       │                               │
│                                    Device                            │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.2 扩展模式详细调用路径

```
Popup Tab
 │
 │  TrezorExtClient (extends TrezorProxyClient extends AbstractProxyClient)
 │    .sendCall('ethereumSignTransaction', params)
 │
 │  构造消息:
 │  { channel: 'trezor-ext-connect', id: uuid,
 │    method: 'call', params: { method: 'ethereumSignTransaction', ...params } }
 │
 ├─ chrome.runtime.sendMessage(msg)
 │
 ▼
Service Worker (路由层)
 │
 │  收到 channel='trezor-ext-connect'
 │  转发到 TrezorOffscreenConnector
 │
 ├─ ensureOffscreen()
 │  └─ chrome.offscreen.createDocument() (如果不存在)
 │
 ├─ sendToOffscreen(method, params)
 │  { channel: 'trezor-offscreen', id: uuid, method, params }
 │
 ▼
Offscreen Document
 │
 │  TrezorOffscreenHost
 │  收到 channel='trezor-offscreen'
 │
 ├─ 懒初始化: doInit()
 │  ├─ import('@trezor/connect-web')
 │  ├─ TrezorConnect.on(UI_EVENT / DEVICE_EVENT / TRANSPORT_EVENT, handler)
 │  └─ TrezorConnect.init({
 │       connectSrc: 'https://trezor-connect-iframe.vercel.app/',
 │       popup: false,
 │       transports: ['WebUsbTransport']
 │     })
 │
 ├─ TrezorConnect.ethereumSignTransaction(params)
 │  │
 │  ▼
 │  Trezor Connect Iframe (自托管 + 补丁)
 │  ├─ trustedHost = true (绕过白名单)
 │  ├─ SharedWorker 已移除 (不兼容 offscreen)
 │  └─ 通过 WebUSB 与设备通信
 │     │
 │     ▼
 │  Device: 签名 → 返回 { v, r, s }
 │
 │  返回: { success: true, payload: { v, r, s } }
 │
 ├─ 响应: { channel: 'trezor-offscreen-response', id, result }
 │
 ▼
Service Worker
 │  缓存结果 (防止 popup 关闭丢失)
 │  转发响应给 popup
 │
 ▼
Popup Tab
 │  TrezorExtClient.sendCall() resolve
 │  → TrezorDirectConnector.callEvmSignTransaction() 返回
 │  → TrezorAdapter 包装为 Response<EvmSignedTx>
 │  → App 收到结果
```

### 5.3 Electron 模式调用路径

```
Renderer Process
 │
 │  TrezorIpcConnect (extends TrezorProxyClient)
 │    .sendCall('ethereumGetAddress', params)
 │
 ├─ bridge.call('ethereumGetAddress', params)
 │  └─ ipcRenderer.invoke('tc:call', { method, params })
 │
 ▼
Main Process
 │
 │  createElectronTrezorBridge(win)
 │  ipcMain.handle('tc:call')
 │
 ├─ TrezorConnect['ethereumGetAddress'](params)
 │  │  (require('@trezor/connect') — Node.js 版本)
 │  │
 │  ▼
 │  NodeUSB → Device → 签名 → 返回
 │
 ├─ 事件: win.webContents.send('tc:event', event)
 │  └─ Renderer 的 bridge.onEvent(callback) 接收
 │
 ▼
Renderer Process
 │  ipcRenderer.invoke resolve
 │  → TrezorIpcConnect 返回结果
 │  → App 收到
```

---

## 6. Ledger 扩展模式调用路径

```
Popup / Content Script
 │
 │  LedgerAdapterClient (implements IHardwareWallet)
 │
 ├─ 方法调用 (如 evmSignTransaction):
 │  _send('evmSignTransaction', { connectId, deviceId, ...params })
 │  │
 │  │  构造: { channel: 'hw-ledger-adapter', id: 'ledger-client-xxx',
 │  │          method: 'evmSignTransaction', params: {...} }
 │  │
 │  ├─ chrome.runtime.sendMessage(msg)
 │  │
 │  ▼
 │  Background / Offscreen
 │  │
 │  │  LedgerAdapterHost
 │  │  _handleMessage(msg)
 │  │
 │  │  switch(method):
 │  │    'evmSignTransaction' →
 │  │      _adapter.evmSignTransaction(connectId, deviceId, params)
 │  │      │
 │  │      └─ (完整的 LedgerAdapter → Connector → DMK → Device 调用链)
 │  │
 │  │  返回: { channel, id, result: Response<EvmSignedTx> }
 │  │
 │  ▼
 │  Popup 收到响应 → resolve
 │
 ├─ 事件监听 (持久连接):
 │  _connectEventPort()
 │  └─ chrome.runtime.connect({ name: 'hw-ledger-adapter-event' })
 │     │
 │     │  Host → Client: 设备事件流
 │     │  { channel: 'hw-ledger-adapter-event',
 │     │    event: { type: 'device-connect', payload: DeviceInfo } }
 │     │
 │     │  Host → Client: UI 请求 (如 PIN)
 │     │  { type: 'ui-handler-request', id: 'ui-xxx',
 │     │    method: 'onPinRequest', payload: { device } }
 │     │
 │     │  Client → Host: UI 响应
 │     │  { type: 'ui-handler-response', id: 'ui-xxx',
 │     │    result: '1234' }
 │     │
 │     ▼
 │  LedgerAdapterClient._handleUiRequest()
 │  └─ 调用 _uiHandler.onPinRequest(device)
 │     → 用户输入 PIN
 │     → 通过 port 回传给 Host
```

---

## 7. connector-loader 平台条件加载

```
connector-loader/
│
├─ createLedgerConnector(): Promise<IConnector>
│  │
│  │  package.json "exports" 字段 + bundler 别名:
│  │
│  ├─ Web (默认)        → ledger.ts
│  │  └─ import LedgerWebHidConnector
│  │     └─ new LedgerWebHidConnector() → IConnector
│  │
│  ├─ Extension (.ext)  → ledger.ext.ts
│  │  └─ import LedgerWebHidConnector
│  │     └─ new LedgerWebHidConnector() → IConnector
│  │        (MV3 offscreen 支持 WebHID)
│  │
│  ├─ Desktop (.desktop) → ledger.desktop.ts
│  │  └─ globalThis.desktopApiProxy.thirdPartyHardware
│  │     └─ createDesktopBridgeConnector('ledger', bridge) → IConnector
│  │        (IPC 桥接到 main process)
│  │
│  └─ Native (.native)  → ledger.native.ts
│     └─ throw (BLE connector 尚未可用)
│
└─ createTrezorConnector(): Promise<IConnector>
   │
   ├─ Web (默认)        → trezor.ts
   │  └─ import @trezor/connect-web
   │     └─ TrezorConnect.init() + new TrezorDirectConnector(tc) → IConnector
   │
   ├─ Extension (.ext)  → trezor.ext.ts
   │  └─ new TrezorOffscreenConnector()
   │     └─ new TrezorDirectConnector(offscreenConnector) → IConnector
   │
   ├─ Desktop (.desktop) → trezor.desktop.ts
   │  └─ createDesktopBridgeConnector('trezor', bridge) → IConnector
   │
   └─ Native (.native)  → trezor.native.ts
```

---

## 8. DMK 内部架构 (Ledger Device Management Kit)

```
LedgerConnectorBase
 │
 ├─ _getOrCreateDmk()
 │  └─ DeviceManagementKitBuilder()
 │     .addTransport(factory)    // webHidTransportFactory 或 RNBleTransportFactory
 │     .build()
 │     └─ IDmk 实例
 │
 ├─ LedgerDeviceManager (dm)
 │  │
 │  │  封装 DMK Observable API 为 Promise:
 │  │
 │  ├─ enumerate()
 │  │  └─ dmk.listenToAvailableDevices()
 │  │     └─ Observable<DmkDiscoveredDevice[]> → 取首次发射
 │  │
 │  ├─ listen(onChange)
 │  │  └─ dmk.listenToAvailableDevices()
 │  │     └─ 持续监听, diff 设备集合, 发射 connect/disconnect 事件
 │  │
 │  ├─ requestDevice()
 │  │  └─ dmk.startDiscovering()
 │  │     └─ 触发浏览器 WebHID/BLE 选择器弹窗
 │  │
 │  ├─ connect(deviceId) → sessionId
 │  │  └─ dmk.connect({ device }) → sessionId
 │  │
 │  └─ disconnect(sessionId)
 │     └─ dmk.disconnect({ sessionId })
 │
 └─ SignerManager
    │
    │  管理每个 session 的 Signer 实例:
    │
    ├─ ETH: SignerEthBuilder({ dmk, sessionId }).build() → SignerEth
    │  └─ getAddress / signTransaction / signMessage / signTypedData
    │     └─ DeviceAction { observable } → deviceActionToPromise()
    │
    ├─ BTC: SignerBtcBuilder({ dmk, sessionId }).build() → SignerBtc
    │  └─ getWalletAddress / getExtendedPublicKey / signPsbt / signMessage
    │     └─ DeviceAction → deviceActionToPromise()
    │
    ├─ SOL: SignerSolanaBuilder({ dmk, sessionId }).build() → SignerSol
    │  └─ getAddress / signTransaction / signMessage
    │     └─ DeviceAction → deviceActionToPromise()
    │
    └─ TRON: (无 DMK Signer Kit)
       └─ SignerTron(sendApdu)  ← 原始 APDU 协议
          └─ dmk.sendApdu({ sessionId, apdu })
```

---

## 9. 错误处理流

```
硬件设备
  │ 返回 statusCode 或 错误
  ▼
Signer 层
  │ Observable emit error / APDU statusCode != 0x9000
  ▼
LedgerConnectorBase / TrezorDirectConnector
  │
  ├─ Ledger: mapLedgerError(err) → { code: HardwareErrorCode, message }
  │  ├─ 5515/6982/5303 → DeviceLocked
  │  ├─ 6985          → UserRejected
  │  ├─ 6E00/6D00     → WrongApp
  │  ├─ 6807          → AppNotOpen (未安装)
  │  ├─ "not found"   → DeviceDisconnected
  │  └─ "timeout"     → OperationTimeout
  │
  ├─ Trezor: parseErrorCode(message) → HardwareErrorCode
  │  ├─ Failure_ActionCancelled → UserRejected
  │  ├─ Failure_PinInvalid     → PinInvalid
  │  ├─ Device_UsedElsewhere   → DeviceBusy
  │  └─ Transport_Missing      → TransportNotAvailable
  │
  ▼
Adapter 层
  │ 包装为 Response<T>:
  │ { success: false, payload: { error: message, code: HardwareErrorCode } }
  ▼
App 层
  │ 根据 code 展示对应 UI:
  │ DeviceLocked    → "请解锁设备"
  │ UserRejected    → "用户已取消"
  │ WrongApp        → "请打开对应 App"
  │ AppNotOpen      → "请安装 App"
  │ DeviceDisconnected → "设备已断开, 请重连"
```

---

## 10. UI 交互流 (PIN / Passphrase / 设备确认)

```
硬件设备需要用户交互
  │
  ▼
╔═══════════════════════════════════════════════════════╗
║ Ledger 路径:                                          ║
║                                                        ║
║  DMK DeviceAction                                     ║
║    → Observable emit intermediateValue                ║
║      .requiredUserInteraction = 'SignTransaction'     ║
║    → deviceActionToPromise 调用 onInteraction()       ║
║    → LedgerConnectorBase emit 'ui-event'              ║
║    → LedgerAdapter emit SDK.DEVICE_INTERACTION        ║
║    → App 显示 "请在设备上确认交易"                      ║
╚═══════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════╗
║ Trezor 路径:                                          ║
║                                                        ║
║  @trezor/connect                                      ║
║    → UI_EVENT: 'ui-request_pin'                       ║
║    → TrezorAdapter._handleEvent()                     ║
║      ├─ emit UI_REQUEST.REQUEST_PIN                   ║
║      └─ 调用 _uiHandler.onPinRequest(device)          ║
║         → 用户在 App 输入 PIN                          ║
║         → connector.uiResponse({                      ║
║             type: 'receive-pin',                      ║
║             payload: '1234'                           ║
║           })                                          ║
║         → @trezor/connect 继续操作                     ║
╚═══════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════╗
║ 扩展模式 UI 桥接:                                      ║
║                                                        ║
║  Host (background)                                    ║
║    → 需要 PIN                                         ║
║    → _requestFromClient('onPinRequest', payload)      ║
║    → 通过 Port 发送 UiHandlerRequest 到 Client        ║
║                                                        ║
║  Client (popup)                                       ║
║    → _handleUiRequest()                               ║
║    → 调用 _uiHandler.onPinRequest(device)              ║
║    → 用户输入 → 通过 Port 回传 UiHandlerResponse       ║
║                                                        ║
║  Host (background)                                    ║
║    → _pendingUiRequests[id] resolve                   ║
║    → 继续操作                                          ║
╚═══════════════════════════════════════════════════════╝
```

---

## 11. 设备标识策略

```
                    Trezor                         Ledger
              ┌─────────────────┐          ┌─────────────────────┐
 deviceId     │ 固件内置唯一 ID   │          │ 无序列号 (隐私设计)   │
              │ features.device_id│          │                     │
              └─────────────────┘          └─────────────────────┘
                                                     │
                                            三层匹配策略:
                                            │
                                            ├─ 1. connectId (DMK path/BLE HEX)
                                            │     短生命周期, 每次发现可能变化
                                            │
                                            ├─ 2. 设备名 HEX (BLE)
                                            │     如 "Nano X AB12" → "AB12"
                                            │     中等稳定性
                                            │
                                            └─ 3. 地址指纹验证
                                                  deriveDeviceFingerprint()
                                                  用固定路径派生地址
                                                  FNV-1a hash → 16字符 hex
                                                  长期稳定标识

指纹路径:
  evm:  m/44'/60'/0'/0/0
  btc:  m/44'/0'/0'
  sol:  m/44'/501'/0'
  tron: m/44'/195'/0'/0/0
```

---

## 12. DeviceJobQueue (设备操作队列)

```
同一设备的操作必须串行执行:

  enqueue(deviceId, job, options)
  │
  ├─ 如果设备空闲:
  │  └─ 直接执行 job
  │
  ├─ 如果设备忙碌:
  │  ├─ interruptibility = 'none'  → 排队等待
  │  ├─ interruptibility = 'safe'  → 取消当前, 立即执行新任务
  │  └─ interruptibility = 'confirm'
  │     └─ 调用 onPreemptionRequest()
  │        ├─ 'cancel-current' → 取消当前, 执行新的
  │        ├─ 'wait'           → 排队等待
  │        └─ 'reject-new'     → 拒绝新任务
  │
  └─ 卡住恢复: forceCancelActive() 忽略 interruptibility
```
