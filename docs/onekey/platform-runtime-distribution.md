# OneKey 各平台运行时分布

## 1. Extension (Manifest V3) — 4 个运行时

最复杂的平台，因为 MV3 限制导致层级最多。

### 运行时分布

```
┌─────────────────────────────────────────────────────────────┐
│  运行时 1: Background Service Worker                        │
│  ─────────────────────────────────────────────────────────  │
│  • BackgroundApi（kit-bg 全部业务服务）                       │
│  • ServiceHardware（硬件管理，但不直接碰 USB）                │
│  • ServiceAccount / ServiceNetwork / ... (80+ 服务)         │
│  • 本地数据库 (Realm/IndexedDB)                              │
│  • Jotai 状态 (主源)                                        │
│  • DApp Provider API                                        │
│  限制：❌ 无 WebUSB / WebHID 权限                            │
├─────────────────────────────────────────────────────────────┤
│  运行时 2: Offscreen Document                               │
│  ─────────────────────────────────────────────────────────  │
│  • HardwareSDKLowLevel（真正的 WebUSB/Bluetooth 访问）       │
│  • AdaSdk / KaspaSdk（需要 Web API 的链 SDK）                │
│  权限：✅ 有 WebUSB / WebHID                                │
│  存在原因：MV3 禁止 Service Worker 访问 WebUSB              │
├─────────────────────────────────────────────────────────────┤
│  运行时 3: Popup / SidePanel UI                             │
│  ─────────────────────────────────────────────────────────  │
│  • React UI（Kit 组件）                                      │
│  • Jotai 状态（从 Background 广播同步）                       │
│  • backgroundApiProxy（只是代理，不是真实例）                  │
├─────────────────────────────────────────────────────────────┤
│  运行时 4: Content Script                                   │
│  ─────────────────────────────────────────────────────────  │
│  • 注入 window.onekey provider                              │
│  • DApp ↔ Background 消息桥接                               │
└─────────────────────────────────────────────────────────────┘
```

### 硬件调用链路（3 跳）

```
Popup UI ──(JSBridge)──→ Background ──(JSBridge)──→ Offscreen ──(WebUSB)──→ 设备
```

### 详细通信流

```
硬件方法调用: Popup → Background → Offscreen
  Background: → offscreenApiProxy
            → OffscreenApiProxyBase.callRemoteApi()
            → bridgeExtBg.requestToOffscreen()
  Offscreen:  → offscreenSetup.receiveHandler()
            → offscreenApi.callOffscreenApiMethod()
            → HardwareLowLevelSDK.method()

硬件事件回传: Offscreen → Background → Popup
  Offscreen:  → addHardwareGlobalEventListener()
            → extJsBridgeOffscreenToBg.request()
  Background: → serviceHardware.passHardwareEventsFromOffscreenToBackground()
            → hardwareUiStateAtom.set()
            → bridgeExtBg.requestToAllUi(GLOBAL_STATES_SYNC_BROADCAST)
  Popup:      → jotaiUpdateFromUiByBgBroadcast() → UI 重新渲染
```

### 保活机制

- Background: 20 秒轮询 keepAlive
- Offscreen: 5 秒 interval 检查后台连接，断开则重连

---

## 2. Desktop (Electron) — 2 进程 + Bridge

### 运行时分布

```
┌─────────────────────────────────────────────────────────────┐
│  Main Process (Node.js)                                     │
│  ─────────────────────────────────────────────────────────  │
│  • DesktopApi 实现（system/security/bluetooth/storage）      │
│  • Bridge 进程管理（启动 onekeyd，监听 127.0.0.1:21320）     │
│  • Noble BLE（@stoprocent/noble，原生蓝牙操作）              │
│  • Utility Process：Windows Hello / macOS TouchID           │
│  • 窗口管理、应用生命周期                                     │
├─────────────────────────────────────────────────────────────┤
│  Renderer Process (Chromium)                                │
│  ─────────────────────────────────────────────────────────  │
│  • React UI（Kit 组件 + Tamagui）                            │
│  • BackgroundApi（kit-bg 全部业务服务，直接在 Renderer 跑）   │
│  • ServiceHardware                                          │
│  • HardwareSDK 实例（hd-common-connect-sdk）                 │
│  • WebUSB / WebBLE 访问（Chromium 提供）                     │
│  • Jotai 状态管理                                            │
│  • desktopApiProxy（跨进程调用 Main 的代理）                  │
├─────────────────────────────────────────────────────────────┤
│  Preload Script (桥接层)                                     │
│  ─────────────────────────────────────────────────────────  │
│  • 注入 globalThis.desktopApi 给 Renderer                   │
│  • IPC 通道白名单过滤                                        │
│  • nobleBle API 暴露（enumerate/connect/write/subscribe）    │
├─────────────────────────────────────────────────────────────┤
│  独立进程: onekeyd (Bridge)                                  │
│  ─────────────────────────────────────────────────────────  │
│  • HTTP 服务 127.0.0.1:21320                                │
│  • USB HID 设备直接通信，作为 WebUSB 的降级备选              │
└─────────────────────────────────────────────────────────────┘
```

### 硬件调用链路（0 跳 / 1 跳）

```
USB 签名（0 跳）：Renderer 直接 → WebUSB → 设备
BLE 签名（1 跳）：Renderer → IPC → Main(Noble) → BLE → 设备
```

### IPC 使用场景

Desktop 的 IPC 只用于两种场景：

| 场景 | 方向 | 通道 |
|------|------|------|
| 调用桌面原生 API | Renderer → Main | `CALL_DESKTOP_API` / `REPLY_DESKTOP_API` |
| BLE 蓝牙操作 | Renderer → Main | `ipcRenderer.invoke(NOBLE_BLE_*)` |

**BackgroundApi 和 HardwareSDK 都在 Renderer 进程运行，USB 签名不需要 IPC。**

### 传输方式自动降级

```
Desktop USB 通信：
  WebUSB（默认）→ Bridge 降级 → WebBle

checkBridgeAndFallbackToWebUSB():
  如果 Bridge 不可用 → 自动降级到 WebUSB
  运行时可 switchTransport() 切换
```

---

## 3. Mobile (React Native) — 单进程

最简单的平台，没有 IPC。

### 运行时分布

```
┌─────────────────────────────────────────────────────────────┐
│  JS 线程（Hermes/JSC）                                       │
│  ─────────────────────────────────────────────────────────  │
│  • React UI（Kit 组件）                                      │
│  • BackgroundApi（kit-bg 全部业务服务，同步创建）              │
│  • ServiceHardware                                          │
│  • HardwareSDK 实例（@bytezhang/hd-ble-sdk）                 │
│  • Jotai 状态管理                                            │
│  • react-native-ble-plx（JS 侧 API）                        │
│  ※ 所有业务逻辑都在这一个线程                                 │
├─────────────────────────────────────────────────────────────┤
│  原生线程（iOS CoreBluetooth / Android BluetoothGatt）       │
│  ─────────────────────────────────────────────────────────  │
│  • react-native-ble-plx 原生实现                             │
│    - startDeviceScan() / connectToDevice()                   │
│    - writeCharacteristic() / monitorCharacteristic()         │
│  • @bytezhang/react-native-ble-utils                         │
│    - checkState() / pairDevice() / getConnectedPeripherals() │
│  ※ 通过 React Native Bridge 与 JS 线程通信                   │
└─────────────────────────────────────────────────────────────┘
```

### 硬件调用链路（0 跳）

```
JS 线程内同步调用：
  serviceHardware → HardwareSDK(hd-ble-sdk) → react-native-ble-plx
    ──(RN Bridge)──→ 原生 BLE → 设备
```

### BLE 分块差异

- iOS: 20 字节/包
- Android: 256 字节/包

### 初始化时机

Lazy 初始化 — 仅在用户切换到硬件钱包时触发：
```typescript
// HardwareServiceProvider.tsx
if (accountUtils.isHwWallet({ walletId }) && !isInitialized.current) {
  void backgroundApiProxy.serviceHardware.init()
}
```

---

## 三平台对比

| | Extension | Desktop | Mobile |
|---|---|---|---|
| **进程数** | 4 个运行时 | 2 进程 + Bridge | 单进程 |
| **BackgroundApi 跑在** | Service Worker | Renderer | JS 线程 |
| **HardwareSDK 跑在** | Offscreen | Renderer | JS 线程 |
| **USB 通信** | Offscreen → WebUSB | Renderer → WebUSB | N/A |
| **BLE 通信** | Offscreen → WebBLE | Renderer → IPC → Main → Noble | JS → RN Bridge → 原生 |
| **UI → SDK 跳数** | 3 跳 | 0 跳 | 0 跳 |
| **IPC 机制** | JSBridge (postMessage) | Electron IPC | RN Bridge (仅到原生) |
| **SDK 不能直接跑的原因** | MV3 禁止 SW 访问 WebUSB | 无此限制 | 无此限制 |
| **保活机制** | 20s keepAlive + 5s reconnect | 无需 | 无需 |
