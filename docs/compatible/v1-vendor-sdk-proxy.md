# V1 方案：VendorSDKProxy（Mock CoreApi）

## 概述

在 `ServiceHardware.getSDKInstance()` 注入点返回一个 Proxy 对象，方法签名与 OneKey CoreApi 完全一致。35 个 KeyringHardware 文件零改动。

**核心思路**：第三方 adapter 伪装成 CoreApi，Keyring 无感知。

---

## 架构图

```
┌─ Popup ────────────────────────────────────────────────┐
│  backgroundApiProxy.serviceHardware.xxx()  (RPC)       │
└────────────────────────┬───────────────────────────────┘
                         │ JsBridge
                         ▼
┌─ Background ───────────────────────────────────────────┐
│                                                         │
│  ServiceHardware                                        │
│    getSDKInstance({ connectId })                         │
│      ├─ vendor === 'onekey' → return CoreApi (不改)      │
│      ├─ vendor === 'trezor' → return VendorSDKProxy     │
│      └─ vendor === 'ledger' → return VendorSDKProxy     │
│                                                         │
│  KeyringHardware (35 个，全部不改)                        │
│    const sdk = await this.getHardwareSDKInstance(...)    │
│    sdk.evmSignTransaction(connectId, deviceId, params)  │
│    // sdk 可能是 CoreApi，也可能是 VendorSDKProxy        │
│    // Keyring 不知道区别                                 │
│                                                         │
│  VendorSDKProxy                                         │
│    ├─ 内部持有 TrezorAdapter / LedgerAdapter 引用        │
│    ├─ 实现 CoreApi 的 ~16 个签名方法                     │
│    ├─ 参数转换: OneKey 格式 → adapter 格式               │
│    ├─ 返回值转换: adapter Response → { success, payload }│
│    └─ 不支持的方法 → 抛 Error('Not supported')           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 改动清单

### 1. 新建 VendorSDKProxy（~250 行）

**位置**：`app-monorepo/packages/kit-bg/src/services/ServiceHardware/VendorSDKProxy.ts`

```typescript
import type { IHardwareWallet } from '@bytezhang/hardware-wallet-core';

/**
 * 将 hardware-wallet-kit adapter 包装成 CoreApi 兼容接口。
 * KeyringHardware 调 sdk.evmSignTransaction(connectId, deviceId, params)，
 * Proxy 将其转发到 adapter.evmSignTransaction(connectId, deviceId, params)，
 * 并将返回值从 Response<T> 转换为 { success, payload } 格式。
 */
export class VendorSDKProxy {
  readonly vendor: 'trezor' | 'ledger';

  constructor(private adapter: IHardwareWallet) {
    this.vendor = adapter.vendor as 'trezor' | 'ledger';
  }

  // ── EVM 方法 ──
  async evmGetAddress(connectId: string, deviceId: string, params: any) {
    const resp = await this.adapter.evmGetAddress?.(connectId, deviceId, {
      path: params.path,
      showOnDevice: params.showOnOneKey ?? params.showOnDevice ?? false,
      chainId: params.chainId,
    });
    return this._toCorApiResponse(resp);
  }

  async evmSignTransaction(connectId: string, deviceId: string, params: any) {
    // OneKey 传 { path, transaction: { to, value, ... } }
    // adapter 传 { path, to, value, ... }（扁平）
    const tx = params.transaction ?? params;
    const resp = await this.adapter.evmSignTransaction?.(connectId, deviceId, {
      path: params.path,
      to: tx.to,
      value: tx.value,
      chainId: tx.chainId ?? params.chainId,
      nonce: tx.nonce,
      gasLimit: tx.gasLimit,
      gasPrice: tx.gasPrice,
      maxFeePerGas: tx.maxFeePerGas,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      data: tx.data,
    });
    return this._toCorApiResponse(resp);
  }

  async evmSignMessage(connectId: string, deviceId: string, params: any) {
    const resp = await this.adapter.evmSignMessage?.(connectId, deviceId, {
      path: params.path,
      message: params.messageHex ?? params.message,
    });
    return this._toCorApiResponse(resp);
  }

  async evmSignTypedData(connectId: string, deviceId: string, params: any) {
    // 关键差异：OneKey 传 domainHash + messageHash（预哈希）
    //          但也传了 data（完整 EIP-712 对象）
    //          adapter 只需要 data
    const resp = await this.adapter.evmSignTypedData?.(connectId, deviceId, {
      path: params.path,
      data: params.data,
      // domainHash / messageHash 被忽略 — adapter 自行计算
    });
    return this._toCorApiResponse(resp);
  }

  // ── BTC 方法 ──

  async btcGetPublicKey(connectId: string, deviceId: string, params: any) {
    // 用于 buildHwWalletXfp
    // 需要 adapter 实现 btcGetPublicKey（目前未实现）
    throw new Error('btcGetPublicKey not yet supported for this vendor');
  }

  // ── 设备方法 ──

  async searchDevices() {
    const devices = await this.adapter.searchDevices();
    return { success: true, payload: devices };
  }

  async getFeatures(connectId: string) {
    const resp = await this.adapter.getDeviceInfo(connectId, '');
    if (!resp.success) return { success: false, payload: { error: resp.error } };
    // 伪造 Features 对象（仅包含基础字段）
    return {
      success: true,
      payload: {
        device_id: resp.data.deviceId,
        label: resp.data.label,
        model: resp.data.model,
        major_version: 0,
        minor_version: 0,
        patch_version: 0,
        vendor: resp.data.vendor,
        // Ledger/Trezor 不提供的字段留空
        unlocked: true,
        initialized: true,
      },
    };
  }

  async cancel(connectId: string) {
    // adapter 级别的取消
    return { success: true };
  }

  // ── UI 响应（关键：PIN/Passphrase 回传） ──

  uiResponse(response: any) {
    this.adapter.uiResponse(response);
  }

  // ── 不支持的方法（OneKey 专有） ──
  async deviceUpdateReboot() { return this._notSupported('deviceUpdateReboot'); }
  async firmwareUpdate() { return this._notSupported('firmwareUpdate'); }
  async getOnekeyFeatures() { return this._notSupported('getOnekeyFeatures'); }
  async deviceVerify() { return this._notSupported('deviceVerify'); }
  async deviceChangePin() { return this._notSupported('deviceChangePin'); }
  async deviceApplySettings() { return this._notSupported('deviceApplySettings'); }
  async deviceUploadResource() { return this._notSupported('deviceUploadResource'); }
  async deviceSupportFeatures() { return this._notSupported('deviceSupportFeatures'); }
  async deviceResetToHome() { return this._notSupported('deviceResetToHome'); }
  // ... 其他 OneKey 专有方法

  // ── 事件 ──

  on(event: string, listener: Function) {
    this.adapter.on(event, listener as any);
  }

  off(event: string, listener: Function) {
    this.adapter.off(event, listener as any);
  }

  // ── 内部工具 ──

  private _toCorApiResponse(resp: any) {
    if (!resp) return { success: false, payload: { error: 'Method not implemented' } };
    if (resp.success) return { success: true, payload: resp.data };
    return { success: false, payload: { error: resp.error, code: resp.code } };
  }

  private _notSupported(method: string) {
    return {
      success: false,
      payload: { error: `${method} is not supported by ${this.adapter.vendor}` },
    };
  }
}
```

### 2. 改 ServiceHardware.getSDKInstance()（~30 行）

**位置**：`app-monorepo/packages/kit-bg/src/services/ServiceHardware/ServiceHardware.ts`

```typescript
// 在现有 getSDKInstance 方法中加入 vendor 检查
// ⚠️ 注意：增加 vendor 可选参数，onboarding 场景由 UI 显式传入

async getSDKInstance(options: {
  connectId: string | undefined;
  vendor?: 'onekey' | 'trezor' | 'ledger';  // 新增
}) {
  // ── 新增：vendor 路由 ──
  // 优先用显式传入的 vendor（onboarding 必须），其次查 DB
  const vendor = options.vendor ?? await this._resolveVendor(options.connectId);
  if (vendor === 'trezor') {
    return this._getVendorProxy('trezor');
  }
  if (vendor === 'ledger') {
    return this._getVendorProxy('ledger');
  }

  // ── 以下全部是现有代码，一字不改 ──
  this.checkSdkVersionValid();
  // ...
}

// ── 新增：获取/创建 Proxy ──

private _trezorProxy: VendorSDKProxy | null = null;
private _ledgerProxy: VendorSDKProxy | null = null;

private async _getVendorProxy(vendor: VendorType): Promise<VendorSDKProxy> {
  if (vendor === 'trezor') {
    if (!this._trezorProxy) {
      const adapter = await this._createTrezorAdapter();
      this._trezorProxy = new VendorSDKProxy(adapter);
    }
    return this._trezorProxy;
  }
  if (vendor === 'ledger') {
    if (!this._ledgerProxy) {
      const adapter = await this._createLedgerAdapter();
      this._ledgerProxy = new VendorSDKProxy(adapter);
    }
    return this._ledgerProxy;
  }
  throw new Error(`Unknown vendor: ${vendor}`);
}

// ── 新增：vendor 解析（仅用于已入库设备） ──

private async _resolveVendor(connectId?: string): Promise<VendorType> {
  if (!connectId) return 'onekey';
  try {
    const device = await localDb.getDeviceByQuery({ connectId });
    return (device?.vendor as VendorType) ?? 'onekey';
  } catch {
    return 'onekey';
  }
}
```

### 3. 改 ServiceHardware 的 5 个非 Keyring 方法

这些方法不经过 Keyring，直接调用 SDK，需要加 vendor 分支：

| 方法 | 改动 |
|------|------|
| `searchDevices` | 加 `vendor` 参数，路由到 adapter.search() |
| `connectDevice` / `getFeaturesWithoutCache` | 加 `vendor` 参数，第三方走 adapter.getDeviceInfo() |
| `buildHwWalletXfp` | 加 `vendor` 参数，第三方走 adapter.btcGetPublicKey()（如有）|
| `getEvmAddressByStandardWallet` | 加 `vendor` 参数，第三方走 adapter.evmGetAddress() |
| `cancel` | 加 `vendor` 参数，第三方走 adapter.cancel() |

> ⚠️ **关键**：这 5 个方法全部在 onboarding 流程中被调用，此时设备还未入库，`_resolveVendor(connectId)` 查 DB 必定失败。因此这些方法必须接受显式 `vendor` 参数，由 UI 层传入。

### 4. 改 ServiceHardwareUI.sendUiResponse()（关键修复）

**位置**：`app-monorepo/packages/kit-bg/src/services/ServiceHardwareUI/ServiceHardwareUI.ts`

```typescript
// ── 修改前（BUG：connectId 永远是 undefined，PIN 只能到 OneKey SDK）──

async sendUiResponse(response: UiResponseEvent) {
  return (
    await this.backgroundApi.serviceHardware.getSDKInstance({ connectId: undefined })
  ).uiResponse(response);
}

// ── 修改后 ──

async sendUiResponse(response: UiResponseEvent) {
  // connectId 从 hardwareUiStateAtom 中取，确保路由到正确的 SDK/Proxy
  const uiState = hardwareUiStateAtom.get();
  const connectId = uiState?.connectId;
  // vendor 也从 uiState 中取（_registerAdapterEvents 写入时附带）
  const vendor = uiState?.payload?.vendor;
  return (
    await this.backgroundApi.serviceHardware.getSDKInstance({ connectId, vendor })
  ).uiResponse(response);
}
```

> ⚠️ **致命 BUG 说明**：原代码 `getSDKInstance({ connectId: undefined })` 始终返回 OneKey CoreApi。当 Trezor 请求 PIN 输入时，用户在弹窗中输入 PIN 后，`sendUiResponse` 把 PIN 发给 OneKey SDK 而不是 TrezorAdapter → PIN 永远不会到达 Trezor，操作永久挂起。

### 5. 改 withHardwareProcessing 的 finally 块

**位置**：`ServiceHardwareUI.ts` 的 `withHardwareProcessing()` 方法

```typescript
// ── 修改前 ──
finally {
  // ...
  await this.backgroundApi.serviceHardware.getSDKInstance({ connectId: undefined })
    .then(sdk => sdk.deviceResetToHome?.(connectId));
}

// ── 修改后 ──
finally {
  // ...
  const sdk = await this.backgroundApi.serviceHardware.getSDKInstance({ connectId, vendor });
  // 第三方设备不支持 deviceResetToHome，Proxy 返回 _notSupported 不抛异常
  await sdk.deviceResetToHome?.(connectId).catch(() => {});
}
```

### 6. 改 IDBDevice 加 vendor 字段

**位置**：`app-monorepo/packages/kit-bg/src/dbs/local/types.ts`

```typescript
export type IDBDevice = IDBBaseObjectWithName & {
  // ... 现有字段 ...
  vendor?: 'onekey' | 'ledger' | 'trezor';  // 新增，默认 'onekey'
};
```

### 7. 改 createHWWalletBase 传递 vendor

**位置**：`app-monorepo/packages/kit-bg/src/services/ServiceAccount/ServiceAccount.ts`

在 `createHWWalletBase` 中将 vendor 传递到 `localDb.createHwWallet()`。

### 8. 改 UI 页面（2-3 个文件）

| 文件 | 改动 |
|------|------|
| `PickYourDevice.tsx` | 在设备型号选择前加厂商选择（或合并显示） |
| `ConnectYourDevice.tsx` | 按 vendor 调用不同的 searchDevices，**传 vendor 到后续所有调用** |
| `CheckAndUpdate.tsx` | 第三方跳过 OneKey 固件验证 |

> ⚠️ **关键**：UI 选择了 vendor 后，必须将 vendor 一路透传到 `searchDevices`、`connectDevice`、`buildHwWalletXfp`、`getEvmAddressByStandardWallet`。因为 onboarding 阶段设备还未入库，无法通过 connectId 查 DB 推断 vendor。

### 9. Adapter 初始化（按平台选 transport）

**位置**：ServiceHardware 内部

```typescript
private async _createTrezorAdapter(): Promise<TrezorAdapter> {
  const { TrezorAdapter } = await import('@bytezhang/trezor-adapter');
  const transport = await this._createTrezorTransport();
  const adapter = new TrezorAdapter();
  await adapter.init(transport);
  // 注册事件：adapter 的 UI 事件 → 转发到 hardwareUiStateAtom
  this._registerAdapterEvents(adapter);
  return adapter;
}

private async _createTrezorTransport() {
  if (platformEnv.isExtension) {
    const { ProxyTrezorTransport } = await import('@bytezhang/trezor-transport-ext');
    return new ProxyTrezorTransport();
  }
  if (platformEnv.isDesktop) {
    const { NodeUsbTrezorTransport } = await import('@bytezhang/trezor-transport-node');
    return new NodeUsbTrezorTransport();
  }
  if (platformEnv.isNative) {
    const { RnBleTrezorTransport } = await import('@bytezhang/trezor-transport-native');
    return new RnBleTrezorTransport();
  }
  const { WebUsbTrezorTransport } = await import('@bytezhang/trezor-transport-web');
  return new WebUsbTrezorTransport();
}
```

### 10. 注册 Adapter 事件（完善）

**位置**：ServiceHardware 内部

```typescript
private _registerAdapterEvents(adapter: IHardwareWallet) {
  // ── PIN 请求 ──
  adapter.on('pin-request', (e) => {
    hardwareUiStateAtom.set(() => ({
      action: EHardwareUiStateAction.REQUEST_PIN,
      connectId: e.payload?.device?.connectId,
      payload: {
        ...e.payload,
        uiRequestType: 'pin-request',
        vendor: adapter.vendor,  // ⚠️ 必须附带 vendor，sendUiResponse 依赖此字段路由
      },
    }));
  });

  // ── Passphrase 请求 ──
  adapter.on('passphrase-request', (e) => {
    hardwareUiStateAtom.set(() => ({
      action: EHardwareUiStateAction.REQUEST_PASSPHRASE,
      connectId: e.payload?.device?.connectId,
      payload: {
        ...e.payload,
        uiRequestType: 'passphrase-request',
        vendor: adapter.vendor,
      },
    }));
  });

  // ── 按钮确认 ──
  adapter.on('button-request', (e) => {
    hardwareUiStateAtom.set(() => ({
      action: EHardwareUiStateAction.REQUEST_BUTTON,
      connectId: e.payload?.connectId,
      payload: {
        ...e.payload,
        uiRequestType: 'button-request',
        vendor: adapter.vendor,
      },
    }));
  });

  // ── 设备连接/断开 ──
  adapter.on('device-connect', (e) => {
    // 更新 ServiceHardware 内部设备列表
    this._onThirdPartyDeviceConnect(adapter.vendor, e.payload);
  });

  adapter.on('device-disconnect', (e) => {
    this._onThirdPartyDeviceDisconnect(adapter.vendor, e.payload);
  });
}
```

---

## 流程模拟 & 已知问题

以下是对 9 条核心流程的模拟测试结果：

### 🔴 致命问题（必须修复才能工作）

#### 问题 1：PIN/Passphrase 响应永远发不到第三方 adapter

**流程**：Trezor 请求 PIN → UI 弹窗 → 用户输入 → `sendUiResponse()`

**BUG**：`sendUiResponse()` 调用 `getSDKInstance({ connectId: undefined })`，始终返回 OneKey CoreApi。PIN 发到 OneKey SDK，TrezorAdapter 永远收不到 PIN，操作永久挂起。

**修复**：见改动清单 #4 — `sendUiResponse` 从 `hardwareUiStateAtom` 读取 `connectId` 和 `vendor`。

#### 问题 2：Onboarding 全流程的 vendor 路由失败

**流程**：用户选择 Trezor → 搜索 → 连接 → 建钱包（buildHwWalletXfp + getEvmAddress）

**BUG**：`_resolveVendor(connectId)` 查 DB 获取 vendor。但 onboarding 阶段设备还未写入 DB，查询返回空 → fallback 到 `'onekey'` → 所有方法走 OneKey SDK。

**影响范围**：searchDevices、connectDevice、buildHwWalletXfp、getEvmAddressByStandardWallet —— 整个 onboarding 全部走错。

**修复**：
1. `getSDKInstance` 增加 `vendor` 可选参数
2. 5 个非 Keyring 方法全部增加 `vendor` 可选参数
3. UI 层从 `PickYourDevice` 选择的 vendor 一路透传到所有后续调用

### 🟡 重要问题（不修复会导致部分场景异常）

#### 问题 3：getCompatibleConnectId 对新设备失败

**流程**：首次连接第三方设备 → `getCompatibleConnectId(connectId)` → 查 DB

**BUG**：该方法内部查 `localDb.getDeviceByQuery({ connectId })`，新设备不在 DB 中 → 异常。

**修复**：onboarding 场景绕过 `getCompatibleConnectId`，直接用 `searchDevices` 返回的 connectId。

#### 问题 4：withHardwareProcessing 的 finally 块调用 deviceResetToHome

**流程**：任何硬件操作（签名、获取地址等）完成后 → finally 块

**BUG**：`deviceResetToHome` 是 OneKey 专有方法，第三方设备不支持。虽然 Proxy 会返回 `_notSupported` 而不是抛异常，但 `getSDKInstance({ connectId: undefined })` 仍走 OneKey SDK。

**修复**：见改动清单 #5 — 传入正确的 connectId/vendor，并 catch 异常。

#### 问题 5：Adapter 事件未注册（设备插拔无感知）

**BUG**：Adapter 的 `device-connect`/`device-disconnect` 事件如果不监听，UI 无法感知设备状态变化。

**修复**：见改动清单 #10 — `_registerAdapterEvents` 中注册所有事件。

### 🟢 已确认可行的流程

#### 流程 A：已入库设备的签名

**路径**：Keyring → `getHardwareSDKInstance({ connectId })` → `getSDKInstance({ connectId })` → `_resolveVendor(connectId)` 查 DB → 返回正确 VendorSDKProxy → `evmSignTransaction()` → adapter 签名。

**结论**：✅ 正常工作。设备已入库后 `_resolveVendor` 能正确返回 vendor。

#### 流程 B：UI 取消操作

**路径**：用户点取消 → `cancel(connectId)` → VendorSDKProxy.cancel() → adapter.forceCancel()

**结论**：✅ 需确保 `cancel` 也传 vendor，但逻辑可行。

---

## 改动总结

| 类别 | 文件数 | 说明 |
|------|--------|------|
| 新建 | 1 | VendorSDKProxy.ts (~250 行) |
| ServiceHardware | 1 | getSDKInstance 加 vendor 参数 + 路由 + 5 个方法加 vendor 分支 |
| ServiceHardwareUI | 1 | sendUiResponse 修复 connectId/vendor + withHardwareProcessing finally |
| DB 类型 | 1 | IDBDevice 加 vendor 字段 |
| ServiceAccount | 1 | createHWWalletBase 传 vendor |
| UI 页面 | 2-3 | PickYourDevice + ConnectYourDevice + CheckAndUpdate（vendor 透传） |
| KeyringHardware | **0** | 不改 |
| **总计** | **~8-9** | |

---

## 优势

1. **35 个 KeyringHardware 零改动** — 最大优势，零回归风险
2. **开发速度快** — 只建一个 Proxy 文件 + 改几个方法
3. **OneKey 代码路径完全不受影响** — vendor 检查在最前面，OneKey 走原路

## 劣势

1. **伪造 CoreApi** — 70 个方法只实现 16 个，其余抛异常。如果 OneKey 内部某处意外调了没 mock 的方法 → 运行时崩溃
2. **参数转换不透明** — `transaction` 对象嵌套 vs 扁平、`showOnOneKey` vs `showOnDevice` 等差异在 Proxy 里静默处理，调试困难
3. **TypedData 兼容性脆弱** — 依赖 OneKey 调用方同时传 `data`（完整对象）+ `domainHash/messageHash`（预哈希），如果某天 OneKey 不传 `data` 了，Proxy 会 break
4. **getFeatures 伪造 Features 结构** — 返回的假 Features 对象可能缺少某些字段，导致下游代码 null reference
5. **事件格式转换有隐患** — adapter 事件和 OneKey SDK 事件结构不同，映射可能遗漏字段
6. **Onboarding vendor 透传链路长** — UI 选的 vendor 必须穿透 5+ 个 Service 方法调用，任何一环漏传就 fallback 到 OneKey
7. **sendUiResponse 路由依赖 atom 状态** — 修复后依赖从 `hardwareUiStateAtom` 读取 connectId/vendor，如果 atom 状态被意外清空，PIN 仍然会丢失
