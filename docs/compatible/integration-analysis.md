# Ledger/Trezor 集成方案分析

## 背景

评估在 OneKey app-monorepo 中集成 Ledger 和 Trezor 硬件钱包支持的两种方案：
- **方案 A**：hardware-wallet-kit 作为独立中间层 + app 内轻量 registry
- **方案 B**：直接在 app-monorepo 内集成 adapter 代码

基于对 app-monorepo 三条核心流程（设备搜索、连接保存、导航跳转）的完整代码追踪。

---

## 一、无论哪种方案，app-monorepo 必须改的东西

### 1. 设备搜索

**现状**：用户流程是 **先选 OneKey 型号 → 再扫描**。

```
CreateOrImportWallet → PickYourDevice（硬编码 4 款 OneKey）→ ConnectYourDevice（扫描）
```

`PickYourDevice.tsx` 里写死了：
```typescript
const DEVICES = [
  { name: 'OneKey Pro', deviceType: [EDeviceType.Pro] },
  { name: 'OneKey Classic', deviceType: [EDeviceType.Classic1s, ...] },
  { name: 'OneKey Touch', deviceType: [EDeviceType.Touch] },
  { name: 'OneKey Mini', deviceType: [EDeviceType.Mini] },
]
```

**必须改**：在 `PickYourDevice` 之前或之中加入厂商选择。两种思路：

- **思路 A**：在前面插一个 `PickVendor` 页（OneKey / Ledger / Trezor），然后 `PickYourDevice` 按厂商显示对应型号列表
- **思路 B**：把 `PickYourDevice` 改成混合列表，三个厂商的型号都展示，分组显示

选了厂商后，`searchDevices()` 逻辑要变。现在是直接调 `hardwareSDK.searchDevices()`，返回所有设备。加了 Ledger/Trezor 后：

```
用户选了 Ledger → 只调 Ledger DMK 的 discover
用户选了 Trezor → 只调 Trezor transport 的 enumerate
用户选了 OneKey → 走现有 hd-core SDK
```

不同厂商的搜索结果格式不同，需要统一成 `SearchDevice` 结构返回给 UI。

**关键文件**：
- `packages/kit/src/views/Onboardingv2/pages/PickYourDevice.tsx` — 设备型号选择
- `packages/kit/src/views/Onboardingv2/pages/ConnectYourDevice.tsx` — 扫描与连接
- `packages/shared/src/utils/DeviceScannerUtils.ts` — 轮询扫描逻辑
- `packages/kit-bg/src/services/ServiceHardware/ServiceHardware.ts:660-673` — searchDevices()

### 2. 连接与保存

**现状**：`createHWWalletBase()` 做 5 步：

```
① getCompatibleConnectId（解析连接 ID）
② getRawDeviceId（从 features 拿 device_id）
③ buildHwWalletXfp（调 btcGetPublicKey 生成指纹）
④ getEvmAddressByStandardWallet（拿首个 EVM 地址）
⑤ localDb.createHwWallet（写入 IDBDevice + IDBWallet）
```

**各步骤的厂商差异**：

| 步骤 | OneKey | Trezor | Ledger | 改动 |
|------|--------|--------|--------|------|
| ① connectId | USB serial / BLE MAC | USB path（类似） | DMK sessionId（不稳定） | Ledger 需特殊处理 |
| ② deviceId | `features.device_id` | `features.device_id`（兼容） | **无**，需合成 | Ledger 必须用地址合成 |
| ③ XFP | `btcGetPublicKey` | 可做（proto 有） | 可做（signer-kit-btc） | 三方都要实现 BTC 方法 |
| ④ firstEvmAddress | `evmGetAddress` | `evmGetAddress` | `evmGetAddress` | 三方都能做 |
| ⑤ DB 写入 | 现有逻辑 | 基本兼容 | 需新增 vendor 字段 | schema 加字段 |

**IDBDevice 新增字段**（向后兼容）：
```typescript
vendor?: 'onekey' | 'ledger' | 'trezor'  // 默认 'onekey'
model?: string  // 'nano-x', 'safe-5', 'pro' 等
```

**设备匹配逻辑**（`getExistingDevice`）：现有三层匹配对 Trezor 直接兼容（有 device_id），对 Ledger 走第二层（uuid + firstEvmAddress）。逻辑不需要大改，但 Ledger 首次连接必须先拿地址。

**Ledger 设备身份特殊处理**：
- DMK 无持久设备 ID（隐私设计），`deviceId` 每次连接都变
- 需查 `installedApps`，按优先级选可用 app 派生地址作为身份
- 优先级：ETH > BTC > SOL > 第一个可用 app
- 存储：`{ fingerprintApp: "eth", fingerprintPath: "m/44'/60'/0'/0/0", fingerprintAddress: "0x..." }`
- BLE 名称后缀（4 字符 HEX）在设备生命周期内固定，可辅助匹配

**关键文件**：
- `packages/kit-bg/src/services/ServiceAccount/ServiceAccount.ts:2945-3051` — createHWWallet
- `packages/kit-bg/src/dbs/local/LocalDbBase.ts:3007-3034` — buildHwWalletId
- `packages/kit-bg/src/dbs/local/LocalDbBase.ts:3050-3365` — createHwWallet（DB 事务）
- `packages/kit-bg/src/dbs/local/LocalDbBase.ts:4957-5020` — getExistingDevice（三层匹配）
- `packages/kit-bg/src/dbs/local/LocalDbBase.ts:5078-5120` — getDeviceByQuery
- `packages/kit-bg/src/dbs/local/types.ts:371-393` — IDBDevice 结构
- `packages/kit-bg/src/dbs/local/types.ts:142-178` — IDBWallet 结构
- `packages/shared/src/utils/deviceUtils.ts:555-566` — getRawDeviceId

### 3. 导航与 UI

**必须改的页面**：

| 页面 | 现状 | 改动 |
|------|------|------|
| `PickYourDevice` | 硬编码 OneKey | 加厂商选择 + 型号列表 |
| `ActivateDevice` | OneKey 教程动画 | Ledger/Trezor 各自教程（或跳过） |
| `CheckAndUpdate` | 固件验证 | Ledger/Trezor 不需要 OneKey 固件验证 |
| `DeviceSettings` | OneKey 专属设置 | 按 vendor 隐藏不支持的项 |

**可以复用的页面/组件**：

| 页面/组件 | 原因 |
|----------|------|
| `ConnectYourDevice`（扫描+通道选择） | USB/BLE 通道选择是通用的 |
| `HardwareUiStateContainer`（PIN/确认对话框） | 事件驱动，改事件源即可 |
| `withHardwareProcessing`（签名包装） | 通用的 loading + 错误处理 |
| `FinalizeWalletSetup`（创建钱包） | 调用 createHWWallet 即可 |
| 设备重连逻辑 | getCompatibleConnectId 基本通用 |

**关键文件**：
- `packages/kit/src/views/Onboardingv2/pages/PickYourDevice.tsx` — 设备选择
- `packages/kit/src/views/Onboardingv2/pages/ConnectYourDevice.tsx` — 扫描连接
- `packages/kit/src/views/Onboarding/pages/ConnectHardwareWallet/ActivateDevice.tsx` — 激活教程
- `packages/kit/src/views/Onboardingv2/pages/CheckAndUpdate.tsx` — 固件验证
- `packages/kit/src/provider/Container/HardwareUiStateContainer.tsx` — 硬件 UI 状态机
- `packages/kit-bg/src/services/ServiceHardwareUI/ServiceHardwareUI.ts` — withHardwareProcessing

---

## 二、签名调用链——两种方案的唯一区别

剥掉 UI 改动（两边一样），核心区别在于 **adapter 代码放在哪个仓库**。

### 注入点

所有 35 个 KeyringHardware 文件都通过同一个入口拿 SDK：

```typescript
// KeyringHardwareBase.ts:43-60
const sdk = await this.getHardwareSDKInstance({ connectId });
```

无论哪种方案，都在这个注入点加 vendor 路由：

```typescript
const sdk = await this.getHardwareSDKInstance({ connectId });
// → 判断 vendor
//   → onekey: sdk.evmSignTransaction(connectId, deviceId, params)  // 不变
//   → trezor: trezorAdapter.evmSignTransaction(params)
//   → ledger: ledgerAdapter.evmSignTransaction(params)
```

### 方案 A：独立仓库（hardware-wallet-kit）

adapter 代码在 hardware-wallet-kit 仓库，app-monorepo 作为依赖引入：

```
app-monorepo
  └─ ServiceHardware
      └─ VendorAdapterRegistry
          ├─ onekey → @bytezhang/hd-core（现有 SDK）
          ├─ ledger → @onekeywork/hardware-wallet-kit/ledger-adapter
          └─ trezor → @onekeywork/hardware-wallet-kit/trezor-adapter
```

### 方案 B：直接在 app-monorepo 内

adapter 代码作为 monorepo 内的独立 package：

```
app-monorepo
  └─ ServiceHardware
      └─ VendorAdapterRegistry
          ├─ onekey → @bytezhang/hd-core（现有 SDK）
          ├─ ledger → packages/hardware-ledger-adapter/
          └─ trezor → packages/hardware-trezor-adapter/
```

---

## 三、客观对比

| 维度 | 方案 A（独立仓库） | 方案 B（app-monorepo 内） |
|------|-------------------|--------------------------|
| **app-monorepo UI 改动** | 一样多 | 一样多 |
| **adapter 代码量** | 一样多 | 一样多 |
| **注入点改动** | `getHardwareSDKInstance` + vendor 路由 | 完全相同 |
| **KeyringHardware 改动** | 基本不改（参数转换在 adapter 内） | 基本不改（同理） |
| **开发调试** | 跨仓库联调，需 link/yalc | 单仓库，改了就能跑 |
| **发版节奏** | adapter 独立发版，app 锁版本 | 一起发，无版本矩阵 |
| **CI/CD** | 两套 CI | 一套 CI |
| **代码隔离** | 物理隔离（不同 repo） | 逻辑隔离（不同 package） |
| **复用性** | 可独立发 npm 给其他项目用 | 绑定 OneKey app |
| **Ledger/Trezor SDK 升级** | adapter 包升级，app 不动 | 直接升级，一起回归 |
| **团队协作** | 可以不同人维护不同仓库 | 都在一个仓库权限下 |

**核心差别就两点**：
1. **开发体验**：单仓库方便 vs 跨仓库联调麻烦
2. **发版耦合**：独立发版灵活 vs 一起发版简单

---

## 四、实际需要实现的方法数

Ledger/Trezor 只需支持基础操作（非 70 个方法全量）：

```
EVM:  getAddress, signTransaction, signMessage, signTypedData     (4 个)
BTC:  getPublicKey, getAddress, signTransaction, signPsbt          (4 个)
SOL:  getAddress, signTransaction                                  (2 个)
TRON: getAddress, signTransaction (仅 Trezor)                      (2 个)
通用: searchDevices, connect, getDeviceInfo, getSupportedChains    (4 个)
```

共 **~16 个方法**，不是 70 个。

---

## 五、deviceType 需要细分型号

不能只加 "ledger" 和 "trezor" 两个类型。建议两层结构：

```typescript
// 第一层：厂商（路由用）
type IDeviceVendor = 'onekey' | 'trezor' | 'ledger'

// 第二层：具体型号（UI/能力差异用）
type IDeviceModel =
  // OneKey 维持原样
  | 'onekey-classic' | 'onekey-classic1s' | 'onekey-mini' | 'onekey-touch' | 'onekey-pro'
  // Ledger (DMK DeviceModelId 枚举)
  | 'ledger-nano-s' | 'ledger-nano-sp' | 'ledger-nano-x' | 'ledger-stax' | 'ledger-flex'
  // Trezor (Features.internal_model)
  | 'trezor-model-one' | 'trezor-model-t' | 'trezor-safe-3' | 'trezor-safe-5'
```

Ledger 型号来自 DMK 的 `DeviceModelId` 枚举：`nanoS | nanoSP | nanoX | stax | flex | apexp`。
Trezor 型号来自 Features 的 `internal_model` 字段：`T1B1 | T2T1 | T2B1/T3B1 | T3T1/T3W1`。

---

## 六、设计原则

基于评估得出的核心原则：

1. **不做 "OneKey API 全模拟器"**：只实现 ~16 个基础方法，不追求 70 个方法全量翻译
2. **读/签名 与 写设备状态 分层**：
   - 通用能力（进 registry）：scan / connect / getInfo / getAddress / sign
   - 通用 UI（进 registry）：pin / passphrase / button / cancel
   - 厂商扩展（不进 registry）：firmware / homescreen / deviceSettings / wipe
3. **共享协议层 ≠ 共享 App 层语义**：transport 层可以复用，但 features model、设备设置、固件流程不要强行统一
4. **考虑扩展性**：方法通过 registry/capability 模式注册，新链或新方法只需加注册项
5. **Ledger 身份用 connectionId + logicalDeviceBinding 分层**：平时走缓存绑定，高风险场景触发地址验证

---

## 七、关键代码引用

### app-monorepo 耦合度数据

| 指标 | 数值 |
|------|------|
| KeyringHardware 文件数 | 35 个（34 条链 + 1 模板） |
| 直接调用的 hd-core SDK 方法 | 70 个 |
| ServiceHardware 公开方法 | 59 个 @backgroundMethod |
| 其中通用方法（scan/connect/sign） | ~25 个（40%） |
| OneKey 专属方法（固件/壁纸/设置） | ~34 个（60%） |
| SDK 注入点 | 1 个（KeyringHardwareBase.getHardwareSDKInstance） |

### hardware-wallet-kit 当前成熟度

| 模块 | 完成度 | 说明 |
|------|--------|------|
| Trezor EVM | 85% | 6/6 方法完整，method registry 模式扎实 |
| Ledger EVM | 60% | 4/5 方法，TypedData 有架构债 |
| Trezor Transport | 100% | Web/Node/BLE/Native/Extension 全覆盖 |
| Ledger Transport | 20% | 仅 Extension，web/node/native 需重建 |
| 事件系统 | 50% | 核心事件工作，recovery 仅 Trezor 有 |
| UI Bridge | 60% | Trezor 完整，Ledger 是 no-op |
| 非 EVM 链 | 0% | BTC/SOL/TRON 全部未实现 |
| **整体** | **35-40%** | 可做 demo，不能上生产 |
