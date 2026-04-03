# OneKey App-Monorepo 架构分层

## 包分层结构（从底到顶）

```
┌───────────────────────────────────────────────────┐
│  Apps 层: desktop / mobile / ext / web / web-embed │  UI 入口
├───────────────────────────────────────────────────┤
│  @onekeyhq/kit                                     │  UI 逻辑 + 状态（Jotai）
│  @onekeyhq/components                              │  基础组件库（Tamagui）
├───────────────────────────────────────────────────┤
│  @onekeyhq/kit-bg                                  │  后台服务层（核心）
│  ├─ services/ServiceHardware  ← 硬件中央管理       │
│  ├─ vaults/impls/{chain}/KeyringHardware.ts        │  链特定签名（38+ 链）
│  └─ vaults/base/KeyringHardwareBase.ts             │  硬件 Keyring 基类
├───────────────────────────────────────────────────┤
│  @onekeyhq/shared                                  │  跨平台共享
│  ├─ hardware/instance.ts      ← SDK 单例管理       │
│  ├─ hardware/sdk-loader/      ← 平台特定加载器      │
│  └─ hardware/configFetcher.ts                      │
├───────────────────────────────────────────────────┤
│  @onekeyhq/core                                    │  链逻辑（不依赖 UI）
│  └─ chains/{evm,btc,sol,...}                       │
├───────────────────────────────────────────────────┤
│  @bytezhang/hd-*  (外部 SDK)                        │  硬件通信层
└───────────────────────────────────────────────────┘
```

## 平台应用

| 应用 | 框架 | 构建工具 | 传输层 |
|------|------|---------|--------|
| Desktop | React + Tamagui | Electron + Webpack/Rspack | WebUSB / Bridge / Noble BLE |
| Mobile | React Native + Expo | Metro | react-native-ble-plx |
| Extension | React + Tamagui | Webpack/Rspack (MV3) | WebUSB (Offscreen) |
| Web | React + Tamagui | Webpack/Rspack | WebUSB / Bridge |

## 硬件钱包集成关键文件

| 用途 | 文件路径 |
|------|---------|
| SDK 实例管理 | `packages/shared/src/hardware/instance.ts` |
| 平台加载器 (Web/Desktop) | `packages/shared/src/hardware/sdk-loader/index.ts` |
| 平台加载器 (Mobile) | `packages/shared/src/hardware/sdk-loader/index.native.ts` |
| 平台加载器 (Extension MV3) | `packages/shared/src/hardware/sdk-loader/index.ext-bg-v3.ts` |
| 硬件服务主类 | `packages/kit-bg/src/services/ServiceHardware/ServiceHardware.ts` |
| 连接管理 | `packages/kit-bg/src/services/ServiceHardware/HardwareConnectionManager.ts` |
| 硬件 Keyring 基类 | `packages/kit-bg/src/vaults/base/KeyringHardwareBase.ts` |
| EVM 硬件签名 | `packages/kit-bg/src/vaults/impls/evm/KeyringHardware.ts` |
| Offscreen API | `packages/kit-bg/src/offscreens/instance/offscreenApi.ts` |
| 设备扫描 | `packages/shared/src/utils/DeviceScannerUtils.ts` |

## Vault-Keyring 工厂模式

```
VaultFactory.createKeyringInstance(vault)
  ├─ walletId 前缀 "hd-"       → KeyringHd
  ├─ walletId 前缀 "hw-"       → KeyringHardware  ← 硬件钱包
  ├─ walletId 前缀 "imported-"  → KeyringImported
  └─ ...
```

每条链实现各自的 `KeyringHardware`：
```
vaults/impls/{chain}/KeyringHardware.ts
  ├─ prepareAccounts()     // 从硬件获取账户
  ├─ signTransaction()     // 调用 SDK 签署交易
  └─ signMessage()         // 调用 SDK 签署消息
```

## 关键设计模式

1. **SDK 单例 + memoizee** — `getHardwareSDKInstance` 缓存（max:1），生命周期内唯一
2. **传输自动降级** — Desktop: WebUSB → Bridge → WebBle，运行时可 `switchTransport()`
3. **不可序列化** — CoreApi 实例含 WebSocket 等，不能通过 backgroundApiProxy 传递，必须直接访问
4. **事件驱动 UI** — SDK 发 UI_REQUEST → `hardwareUiStateAtom.set()` → 弹 PIN/确认对话框 → uiResponse 回传
5. **Lazy 初始化** — 仅在用户切换到硬件钱包时初始化 SDK
