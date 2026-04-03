# OneKey Hardware-JS-SDK 架构分层

## 包结构总览

SDK 是一个 Lerna 单体仓库（版本 1.1.24-alpha.2），分 4 层。

```
┌───────────────────────────────────────────────┐
│  高层 SDK（平台入口）                           │
│  ├─ hd-web-sdk         Web (iframe 隔离)       │
│  ├─ hd-ble-sdk         React Native BLE        │
│  └─ hd-common-connect-sdk  通用连接 SDK         │
├───────────────────────────────────────────────┤
│  hd-core — 业务逻辑                             │
│  ├─ DeviceList / DevicePool  设备管理           │
│  ├─ RequestQueue  命令队列（串行化）             │
│  ├─ CoreApi  公开 API                           │
│  └─ inject.ts  各链方法注入                      │
├───────────────────────────────────────────────┤
│  平台传输适配器                                  │
│  ├─ hd-transport-http         HTTP Bridge       │
│  ├─ hd-transport-web-device   WebUSB/WebBle    │
│  ├─ hd-transport-react-native  RN BLE          │
│  ├─ hd-transport-electron      Node BLE        │
│  └─ hd-transport-emulator      模拟器           │
├───────────────────────────────────────────────┤
│  hd-transport — 底层协议                         │
│  ├─ Protobuf 编解码 (messages.json)             │
│  └─ OneKey Wire Protocol (64字节分块)           │
└───────────────────────────────────────────────┘
```

## OneKey Wire Protocol

### 分块格式（64 字节包）

**首包（Header）：**
```
[0:3]   '?##'            magic marker
[3:5]   message_type     BE uint16 (Protobuf 消息类型 ID)
[5:9]   message_size     BE uint32 (完整消息字节数)
[9:64]  payload[55]      消息前 55 字节 (用 0 填充)
```

**后续包：**
```
[0:1]   '?'              continuation marker
[1:64]  payload[63]      接下来 63 字节
```

### 通信流程

```
JSON → Protobuf 编码 → 添加协议头 → 64字节分块 → 传输层发送
                                                    ↓
JSON ← Protobuf 解码 ← 反分块 ← 传输层接收 ← 设备响应
```

## 平台特定传输

### Web (hd-web-sdk)
- **iframe 沙箱隔离** — parent window ↔ iframe 双向通信
- **JSBridge 模式** — 基于 `@bytezhang/cross-inpage-provider-core`
- 数据流：外部网页 → postMessage → iframe → JsBridgeIframe → 硬件通信

### React Native (hd-transport-react-native)
- 使用 `react-native-ble-plx`
- 分块大小：iOS 20 字节，Android 256 字节
- 扫描超时 3000ms 或找到 5+ 设备时返回

### Electron (hd-transport-electron)
- 使用 `@stoprocent/noble` 实现 BLE
- 通过 WebContents IPC 向 preload 脚本注入 BLE 能力

### HTTP Bridge (hd-transport-http)
- 连接 OneKey Bridge 应用（onekeyd）
- 无状态 REST API：`POST /enumerate`、`POST /call/{session}`

## 传输适配器选择机制

```typescript
// hd-common-connect-sdk
const getTransport = (env) => {
  if (env === 'desktop-web-ble') return ElectronBleTransport
  if (env === 'webusb' || env === 'desktop-webusb') return WebUsbTransport
  if (env === 'lowlevel') return LowlevelTransport
  if (env === 'emulator') return EmulatorTransport
  return HttpTransport  // 默认
}
```

运行时可通过 `switchTransport(env)` 动态切换。

## 公开 API 表面

```typescript
CoreApi {
  init(settings, lowLevelSDK): Promise<void>
  dispose(): void
  searchDevices(): Promise<SearchDevice[]>
  getFeatures(connectId, deviceId): Promise<Features>

  // 各链签名
  evmSignTransaction(connectId, deviceId, params): Promise<EVMSignedTx>
  evmSignMessage(connectId, deviceId, params): Promise<SignMessage>
  // ...50+ 方法

  // 事件
  on(event, listener)
  emit(event, data)
}
```

## 数据流总览

```
App 调用 sdk.evmSignTransaction(...)
  ↓
CoreApi → RequestQueue（串行化）→ Device.run()
  ↓
TransportManager.call() → 选择传输方式
  ↓
HttpTransport / BleTransport / WebUsbTransport
  ↓
buildBuffers(): JSON → Protobuf → 64字节分块
  ↓
USB/BLE 发送 → 硬件设备
  ↓
设备响应 → receiveOne(): 反分块 → Protobuf 解码 → JSON
  ↓
返回给 App
```
