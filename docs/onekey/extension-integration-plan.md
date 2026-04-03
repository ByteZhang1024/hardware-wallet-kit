# hardware-wallet-kit Extension 三层集成方案

## 总览：各层引入什么

```
┌── Popup UI ──────────────────────────────────────────────────┐
│  引入：                                                       │
│  • @onekeyhq/kit (React UI)                                  │
│  • backgroundApiProxy (RPC 代理，不持有真实实例)               │
│                                                               │
│  职责：只做 UI 渲染 + 调用 Background                          │
│  限制：❌ 无 WebUSB / WebHID                                  │
├──────────────────────────────────────────────────────────────┤
│  引入：                                                       │
│  ├─ Trezor 侧:                                               │
│  │  • TrezorAdapter          ← 业务逻辑+callLoop 跑这里      │
│  │  • ProxyTrezorTransport   ← transport.call() 转发到 Offscreen│
│  │  • DeviceJobQueue         ← 任务队列跑这里                 │
│  │  • DirectUiBridge         ← PIN/Passphrase 事件从这里发出  │
│  │                                                            │
│  └─ Ledger 侧:                                               │
│     • LedgerAdapterClient    ← 整个 adapter 调用都转发到 Offscreen│
│                                                               │
│  职责：业务逻辑 (Trezor) / 纯转发 (Ledger)                    │
│  限制：❌ 无 WebUSB / WebHID                                  │
├──────────────────────────────────────────────────────────────┤
│  引入：                                                       │
│  ├─ Trezor 侧:                                               │
│  │  • TrezorTransportHost    ← 监听 RPC，分发给真实 transport  │
│  │  • WebUsbTrezorTransport  ← 真实 USB 通信                  │
│  │  • trezor-protobuf        ← Protobuf 编解码                │
│  │  • trezor-protocol        ← 分块协议                       │
│  │                                                            │
│  └─ Ledger 侧:                                               │
│     • LedgerAdapterHost      ← 监听 RPC                       │
│     • LedgerAdapter          ← 完整 adapter 实例               │
│     • LedgerDeviceManager    ← 设备发现/会话管理               │
│     • SignerManager + SignerEth  ← 签名器                     │
│     • DMK (@ledgerhq/device-management-kit)  ← Observable runtime│
│     • webHidTransportFactory ← WebHID 工厂                    │
│                                                               │
│  职责：所有需要 WebUSB/WebHID 的操作                           │
│  权限：✅ 有 WebUSB / WebHID                                  │
└──────────────────────────────────────────────────────────────┘
```

## Trezor vs Ledger 切割位置不同

```
Trezor: 只有 transport 层在 Offscreen（切得细）
  Background 持有: Adapter → callLoop → ProxyTransport ──→ Offscreen 只做 USB 收发

Ledger: 整个 adapter 在 Offscreen（切得粗）
  Background 只是: AdapterClient 代理 ──→ Offscreen 持有完整 Adapter + DMK
```

**为什么 Ledger 要整个搬过去？**

DMK 不是简单的 transport，它是 Observable runtime + session state holder。
`SignerEth` 通过 DMK `sendCommand()` 发 APDU，而 `sendCommand` 需要 Command 对象实例
（有 `getApdu()` / `parseResponse()` 方法），不能序列化跨进程传递。
所以 DMK 和使用它的全部代码必须在同一个运行时。

---

## Trezor 执行流推演

### evmSignTransaction 完整链路

```
Popup UI
  │ 用户点击"签名"
  │ backgroundApiProxy.serviceHardware.evmSignTransaction(connectId, params)
  │
  │ ──(JSBridge: extJsBridgeUiToBg.request)──→
  ↓
Background Service Worker
  │
  │ TrezorAdapter._executeMethod('evmSignTransaction', params)
  │   ├─ method = createMethod('evmSignTransaction')
  │   ├─ method.init(params)  // 参数校验
  │   └─ _jobQueue.enqueue(connectId, async (signal) => { ... })
  │
  │  ════ 第1步：获取会话 ════
  │
  │  ProxyTrezorTransport.acquire(path, null)
  │    │ ──(chrome.runtime.sendMessage { channel:'hw-transport' })──→
  │    ↓
  │  Offscreen: TrezorTransportHost._handleMessage('acquire')
  │    │ real_transport.acquire(path, null) → WebUSB → 设备
  │    │ return session_id = "1"
  │    │ ──(sendResponse)──→
  │    ↓
  │  Background: 拿到 session = "1"
  │
  │  ════ 第2步：Initialize 设备 ════
  │
  │  callLoop({
  │    transport: ProxyTrezorTransport,
  │    session: "1",
  │    name: 'Initialize',
  │    expectedTypes: ['Features'],
  │    ...callbacks
  │  })
  │    │ transport.call() → sendMessage → Offscreen
  │    │ Offscreen: Protobuf 编码 → WebUSB → 设备 → 响应 → Protobuf 解码
  │    │ ← sendResponse { type:'Features', message:{...} }
  │    ↓
  │  拿到 Features → 更新 DeviceSessionCache
  │
  │  ════ 第3步：发送签名请求 + callLoop 状态机 ════
  │
  │  callLoop({
  │    name: 'EthereumSignTxEIP1559',
  │    data: { address_n, nonce, gas_limit, ... },
  │    expectedTypes: ['EthereumTxRequest'],
  │    onPinRequest, onPassphraseRequest, onButtonRequest, onResponseTimeout
  │  })
  │
  │  ┌─── callLoop while(true) ─────────────────────────────────┐
  │  │                                                           │
  │  │  // 第一轮：发送签名命令                                   │
  │  │  transport.call({name:'EthereumSignTxEIP1559', data})     │
  │  │    → Offscreen → WebUSB → 设备                            │
  │  │    ← { type:'ButtonRequest', message:{code} }             │
  │  │                                                           │
  │  │  // 收到 ButtonRequest → 通知 UI                          │
  │  │  onButtonRequest(message)                                 │
  │  │    → _uiBridge.notifyButton()                             │
  │  │    → _emitter.emit(UI_REQUEST.REQUEST_BUTTON)             │
  │  │    → ──(广播到 Popup: "请在设备上确认")──→                 │
  │  │                                                           │
  │  │  // 自动回复 ButtonAck                                    │
  │  │  name = 'ButtonAck'; data = {}                            │
  │  │                                                           │
  │  │  // 第二轮：发送 ButtonAck                                │
  │  │  transport.call({name:'ButtonAck', data:{}})              │
  │  │    → Offscreen → WebUSB → 设备                            │
  │  │                                                           │
  │  │  // ★ 等待用户在设备上按确认键                             │
  │  │  // 45 秒 responseTimeout 定时器在跑                      │
  │  │                                                           │
  │  │  如果 45 秒未按：                                         │
  │  │    onResponseTimeout({sentMessage:'ButtonAck', elapsed:45000})│
  │  │    → emit(SDK.DEVICE_STUCK) → 广播到 Popup                │
  │  │    ※ 不中止！继续等待                                     │
  │  │                                                           │
  │  │  用户按了确认：                                            │
  │  │    ← { type:'EthereumTxRequest', message:{v,r,s} }       │
  │  │    → 匹配 expectedTypes → 退出循环 ✅                     │
  │  └───────────────────────────────────────────────────────────┘
  │
  │  return { v, r, s }
  │
  │ ──(JSBridge response)──→
  ↓
Popup UI: 收到签名结果 → 构建交易 → 广播上链
```

### callLoop PIN 交互流（跨 3 层）

最关键的跨进程回调链：

```
callLoop (Background)
  │ transport.call() → Offscreen → USB → 设备
  │ ← 设备返回 { type: 'PinMatrixRequest' }
  │
  │ pin = await onPinRequest(signal)
  │   │
  │   │ _uiBridge.requestPin(deviceInfo, signal)
  │   │   │
  │   │   │ // DirectUiBridge 内部：
  │   │   │ return new Promise((resolve) => {
  │   │   │   _emitter.emit(UI_REQUEST.REQUEST_PIN, { device })
  │   │   │   //    ↓ 事件广播到 Popup
  │   │   │
  │   │   │   _pendingResolve = resolve  // ← Promise 挂起
  │   │   │ })
  │   │   │
  │   │   │ // ★★★ callLoop 暂停在 await ★★★
  │   │   │ // Service Worker 没有阻塞，可以处理其他消息
  │   ↓

Popup UI
  │ 收到 UI_REQUEST.REQUEST_PIN 事件
  │ → 弹出 PIN 输入对话框
  │ → 用户输入 PIN: "1234"
  │ → backgroundApi.serviceHardware.uiResponse({
  │     type: RECEIVE_PIN, payload: "1234"
  │   })
  │
  │ ──(JSBridge)──→
  ↓

Background Service Worker
  │ adapter.uiResponse({ type: RECEIVE_PIN, payload: "1234" })
  │   → DirectUiBridge._pendingResolve("1234")  // ← Promise 解决！
  │
  │ // callLoop 恢复执行
  │ pin = "1234"
  │ name = 'PinMatrixAck'
  │ data = { pin: "1234" }
  │ // 继续 while 循环 → transport.call() → Offscreen → 设备
```

### 消息协议

```typescript
// UI → Background（一次性 RPC）
interface TransportMessage {
  channel: 'hw-transport';
  id: string;              // 唯一 ID: "trezor-proxy-1-12345"
  method: 'init' | 'enumerate' | 'acquire' | 'call' | ...;
  params?: unknown;
}

// Background → UI（一次性响应）
interface TransportResponse {
  channel: 'hw-transport';
  id: string;
  result?: unknown;
  error?: string;
}

// Background → UI（长连接事件推送）
interface TransportEvent {
  channel: 'hw-transport-event';
  event: DeviceChangeEvent;
}
```

---

## Ledger 执行流推演

### evmGetAddress 完整链路

```
Popup UI
  │ 用户点击"获取地址"
  │ backgroundApiProxy.serviceHardware.evmGetAddress(connectId, params)
  │
  │ ──(JSBridge)──→
  ↓
Background Service Worker
  │
  │ LedgerAdapterClient.evmGetAddress(connectId, deviceId, params)
  │   │
  │   │ // Client 做的事情极其简单：打包 → 发送
  │   │ chrome.runtime.sendMessage({
  │   │   channel: 'hw-ledger-adapter',
  │   │   id: 'ledger-1-xxx',
  │   │   method: 'evmGetAddress',
  │   │   params: { connectId, deviceId, params }
  │   │ })
  │   │
  │   │ ──(chrome.runtime.sendMessage)──→
  │   ↓
Offscreen Document
  │
  │ LedgerAdapterHost._messageHandler(msg)
  │   ↓
  │ LedgerAdapter.evmGetAddress(connectId, deviceId, params)
  │   ↓
  │ _jobQueue.enqueue(deviceId, async () => {
  │
  │   // 1. 获取/创建 DMK 会话
  │   sessionId = _deviceManager.getSessionId(deviceId)
  │   if (!sessionId) {
  │     sessionId = await _deviceManager.connect(deviceId)
  │       → DMK.connect({ device }) → WebHID → USB 设备
  │   }
  │
  │   // 2. 获取/创建签名器
  │   signer = _signerManager.getOrCreate(sessionId)
  │     → SignerEthBuilder({ dmk, sessionId }).build()
  │     → 返回 SignerEth 实例
  │
  │   // 3. 执行命令
  │   result = await signer.getAddress(path, { checkOnDevice: true })
  │     │
  │     │ // SignerEth 内部：
  │     │ action = _sdk.getAddress(path)   // 返回 DeviceAction
  │     │ return deviceActionToPromise(action, onInteraction)
  │     │   │
  │     │   │ // 订阅 Observable
  │     │   │ action.observable.subscribe({
  │     │   │   next(state) {
  │     │   │     if (state.requiredUserInteraction) {
  │     │   │       onInteraction('confirm-on-device')
  │     │   │       // ★ 事件广播：Host → Port → Background → Popup
  │     │   │     }
  │     │   │     if (state.status === 'completed') {
  │     │   │       resolve(state.output)
  │     │   │     }
  │     │   │   }
  │     │   │ })
  │     │   │
  │     │   │ // DMK 内部：
  │     │   │ → sendCommand(getAddressCommand)
  │     │   │ → WebHID.write(APDU) → 设备显示地址
  │     │   │ → 用户在设备上确认
  │     │   │ → WebHID.read() → APDU 响应
  │     │   │ → parseResponse() → { address, publicKey }
  │     │   ↓
  │     │ return { address: "0x...", publicKey: "04..." }
  │     ↓
  │   return result
  │ })
  │
  │ sendResponse({
  │   channel: 'hw-ledger-adapter',
  │   id: 'ledger-1-xxx',
  │   result: { address: "0x..." }
  │ })
  │
  │ ──(sendResponse)──→
  ↓
Background: LedgerAdapterClient 收到响应
  │ ──(JSBridge response)──→
  ↓
Popup UI: 显示地址 0x...
```

### 事件广播流

```typescript
// Offscreen: LedgerAdapterHost 订阅 adapter 事件
for (const eventType of FORWARDED_EVENTS) {
  adapter.on(eventType, (event) => {
    // 广播给所有连接的 Port
    for (const port of this._ports) {
      port.postMessage({
        channel: 'hw-ledger-adapter-event',
        event
      })
    }
  })
}

// Background: LedgerAdapterClient 接收事件
this._port = chrome.runtime.connect({ name: 'hw-ledger-adapter-event' })
this._port.onMessage.addListener((msg) => {
  const listeners = this._listeners.get(msg.event.type)
  for (const listener of listeners) {
    listener(msg.event)
  }
})
```

### 消息协议

```typescript
// Background → Offscreen（一次性 RPC）
interface AdapterMessage {
  channel: 'hw-ledger-adapter';
  id: string;
  method: 'init' | 'searchDevices' | 'evmGetAddress' | ...;
  params?: unknown;
}

// Offscreen → Background（一次性响应）
interface AdapterResponse {
  channel: 'hw-ledger-adapter';
  id: string;
  result?: unknown;
  error?: string;
}

// Offscreen → Background（长连接事件推送）
interface AdapterEvent {
  channel: 'hw-ledger-adapter-event';
  event: DeviceEvent;
}
```

---

## 可行性分析

### Trezor 侧：✅ 可以工作

| 要求 | 满足 | 说明 |
|------|------|------|
| `transport.call()` 可跨进程 | ✅ | ProxyTrezorTransport 已实现 RPC |
| PIN callback 可异步等待 | ✅ | Promise 挂起不阻塞 Service Worker |
| Button 事件可广播到 UI | ✅ | 通过 emitter → JSBridge 广播 |
| responseTimeout 可通知 UI | ✅ | emit SDK.DEVICE_STUCK |
| session 管理跨进程一致 | ✅ | 会话由 Offscreen 的真实 transport 持有 |

### Ledger 侧：✅ 可以工作

| 要求 | 满足 | 说明 |
|------|------|------|
| DMK Observable 不跨进程 | ✅ | DMK 整个在 Offscreen |
| Command 对象不序列化 | ✅ | 在 Offscreen 内部构造和使用 |
| WebHID 在 Offscreen | ✅ | Offscreen 有权限 |
| 事件广播到 UI | ✅ | Host 通过 Port 广播 |

### 潜在风险

#### 1. Service Worker 保活（关键）

```
callLoop 等待设备确认 → 可能 30+ 秒
→ Service Worker 被杀 → callLoop 中断 → 操作失败

解决：keepAlive 轮询（和 OneKey 一样，20 秒 interval）
```

#### 2. Offscreen Document 生命周期

```
Offscreen 可能被浏览器回收
→ DMK 会话丢失 → 签名器缓存丢失

解决：
  - 检测 Offscreen 断开时重建
  - LedgerAdapterHost / TrezorTransportHost 需要重新 init
  - 重连机制（OneKey 用 5 秒 interval 检查）
```

#### 3. 消息路由冲突

```
Trezor Host 和 Ledger Host 都在 Offscreen 监听 chrome.runtime.onMessage
→ 必须用 channel 字段过滤：
   'hw-transport'       → TrezorTransportHost
   'hw-ledger-adapter'  → LedgerAdapterHost
```

---

## 最终架构图

```
┌── Popup ─────────────────────────────────────┐
│  React UI                                     │
│  ├─ 显示设备列表、地址、签名结果               │
│  ├─ PIN 输入对话框 (Trezor)                   │
│  └─ "请在设备上确认" 提示 (两者都有)           │
│                                               │
│  backgroundApiProxy.serviceHardware.*()       │
└──────────────┬────────────────────────────────┘
               │ JSBridge (postMessage)
               ↓
┌── Background Service Worker ─────────────────┐
│                                               │
│  ┌─ Trezor ──────────────────────────────┐   │
│  │ TrezorAdapter                          │   │
│  │   ├─ DeviceJobQueue                    │   │
│  │   ├─ callLoop (状态机)                 │   │
│  │   ├─ DirectUiBridge (PIN/Button 事件)  │   │
│  │   └─ ProxyTrezorTransport ─────────┐  │   │
│  └────────────────────────────────────┘  │   │
│                                          │   │
│  ┌─ Ledger ──────────────────────────┐   │   │
│  │ LedgerAdapterClient ──────────┐   │   │   │
│  └───────────────────────────────┘   │   │   │
│                                      │   │   │
│  keepAlive (20s interval) ✓          │   │   │
└──────────────────────────────────────┼───┼───┘
               │                       │   │
               │ sendMessage           │   │ sendMessage
               │ (hw-ledger-adapter)   │   │ (hw-transport)
               ↓                       │   ↓
┌── Offscreen Document ────────────────┼───────┐
│                                      │       │
│  ┌─ Ledger ──────────────────────────┘  │   │
│  │ LedgerAdapterHost                    │   │
│  │   └─ LedgerAdapter                   │   │
│  │       ├─ DeviceJobQueue              │   │
│  │       ├─ LedgerDeviceManager         │   │
│  │       ├─ SignerManager → SignerEth   │   │
│  │       └─ DMK ─── WebHID ──→ 🔌 USB  │   │
│  └──────────────────────────────────────┘   │
│                                              │
│  ┌─ Trezor ─────────────────────────────┐   │
│  │ TrezorTransportHost                   │   │
│  │   └─ WebUsbTrezorTransport            │   │
│  │       ├─ Protobuf 编解码              │   │
│  │       ├─ 分块协议                     │   │
│  │       └─ WebUSB ──→ 🔌 USB           │   │
│  └───────────────────────────────────────┘   │
│                                              │
│  reconnect check (5s interval) ✓             │
└──────────────────────────────────────────────┘
```
