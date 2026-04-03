# V2 方案：Keyring 路由（新建 KeyringHardwareTP）

## 概述

利用 app-monorepo 已有的 VaultFactory keyringMap 机制，按设备 vendor 路由到不同的 Keyring 实现。第三方 Keyring 直接调用 hardware-wallet-kit adapter，不伪装成 CoreApi。

**核心思路**：不做 Proxy，不伪造接口。在 Vault 层分流，第三方 Keyring 直接用 adapter。

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
│    ├─ getSDKInstance()       → OneKey CoreApi (不改)     │
│    ├─ getVendorAdapter(v)   → 新增，返回 adapter 引用   │
│    ├─ searchDevices(vendor?) → 路由                     │
│    ├─ connectDevice(vendor?) → 路由                     │
│    ├─ buildHwWalletXfp       → 加 vendor 分支           │
│    ├─ getEvmAddressByStdWallet → 加 vendor 分支         │
│    └─ 53 个 OneKey 专有方法  → 不改                     │
│                                                         │
│  VaultFactory.createKeyringInstance()                    │
│    hw- 前缀 → 查 vendor                                 │
│      ├─ 'onekey' → keyringMap.hw (现有 KeyringHardware) │
│      └─ 其他    → keyringMap.hwThirdParty (新 Keyring)  │
│                                                         │
│  KeyringHardware (OneKey, 35 个, 全部不改)               │
│    sdk = getHardwareSDKInstance()  → CoreApi             │
│    sdk.evmSignTransaction(connectId, deviceId, params)   │
│                                                         │
│  KeyringHardwareTP (第三方, 新建 per-chain)               │
│    adapter = serviceHardware.getVendorAdapter(vendor)    │
│    adapter.evmSignTransaction(connectId, deviceId, p)    │
│    // 直接调 adapter，不经过 CoreApi，不做 mock           │
│                                                         │
│  Adapter 实例 (ServiceHardware 管理生命周期)              │
│    ├─ TrezorAdapter (singleton, 懒加载)                  │
│    └─ LedgerAdapter (singleton, 懒加载)                  │
│                                                         │
└──────────────────────┬──────────────────────────────────┘
                       │ Transport (按平台)
                       ▼
  Extension: ProxyTransport ↔ Offscreen (实际 USB/WebHID)
  Desktop:   NodeUsb / NodeBle (同进程)
  Mobile:    RnBle (同进程)
  Web:       WebUsb / WebHid (同进程)
```

---

## 改动清单

### 1. 改 VaultFactory — 加 vendor 路由（~15 行）

**位置**：`app-monorepo/packages/kit-bg/src/vaults/factory.ts`

```typescript
// createKeyringInstance 函数内，修改 hw- 分支

if (walletId.startsWith('hw-')) {
  // 新增：查 vendor
  const vendor = await resolveVendorByWalletId(walletId, vault);

  if (vendor !== 'onekey' && keyringMap.hwThirdParty) {
    checkKeyringClassExists(keyringMap.hwThirdParty);
    keyring = new keyringMap.hwThirdParty(vault);
  } else {
    checkKeyringClassExists(keyringMap.hw);
    keyring = new keyringMap.hw(vault);
  }
}

// 新增：vendor 解析辅助函数
async function resolveVendorByWalletId(
  walletId: string,
  vault: VaultBase,
): Promise<string> {
  try {
    const wallet = await vault.backgroundApi.localDb.getWallet({ walletId });
    if (!wallet?.associatedDevice) return 'onekey';
    const device = await vault.backgroundApi.localDb.getDevice(wallet.associatedDevice);
    return device?.vendor ?? 'onekey';
  } catch {
    return 'onekey';
  }
}
```

### 2. 改 EVM Vault — keyringMap 加条目（1 行）

**位置**：`app-monorepo/packages/kit-bg/src/vaults/impls/evm/Vault.ts`

```typescript
override keyringMap: Record<IDBWalletType, typeof KeyringBase | undefined> = {
  hd: KeyringHd,
  qr: KeyringQr,
  hw: KeyringHardware,
  hwThirdParty: KeyringHardwareTP,  // ← 新增
  imported: KeyringImported,
  watching: KeyringWatching,
  external: KeyringExternal,
};
```

### 3. 新建 EVM KeyringHardwareTP（~120 行）

**位置**：`app-monorepo/packages/kit-bg/src/vaults/impls/evm/KeyringHardwareTP.ts`

```typescript
import { KeyringHardwareBase } from '../../base/KeyringHardwareBase';
import type { IHardwareWallet } from '@bytezhang/hardware-wallet-core';
import type {
  ISignTransactionParams,
  ISignMessageParams,
  ISignedTxPro,
  IPrepareHardwareAccountsParams,
} from '../../types';

export class KeyringHardwareTP extends KeyringHardwareBase {

  // ── 获取 adapter（同进程直接引用，不走 RPC） ──
  // ⚠️ 必须使用 appGlobals 绕过模式，与 getHardwareSDKInstance 一致
  //    adapter 对象不可序列化，不能通过 backgroundApiProxy 的序列化检查

  private async _getAdapter(): Promise<IHardwareWallet> {
    const wallet = await this.vault.getWallet();
    const device = await appGlobals?.$backgroundApiProxy?.backgroundApi?.localDb?.getDevice(
      wallet.associatedDevice!,
    );
    // getVendorAdapter 返回真实 adapter 对象引用（同进程）
    return appGlobals?.$backgroundApiProxy?.backgroundApi?.serviceHardware?.getVendorAdapter(
      device!.vendor ?? 'trezor',
    );
  }

  private _getDeviceParams(params: { deviceParams?: any }) {
    const { dbDevice, deviceCommonParams } = params.deviceParams ?? {};
    return {
      connectId: dbDevice?.connectId ?? '',
      deviceId: dbDevice?.deviceId ?? '',
    };
  }

  // ── 签名交易 ──

  override async signTransaction(
    params: ISignTransactionParams,
  ): Promise<ISignedTxPro> {
    const adapter = await this._getAdapter();
    const { connectId, deviceId } = this._getDeviceParams(params);
    const path = await this.vault.getAccountPath();
    const chainId = await this.getNetworkChainId();
    const { unsignedTx } = params;

    const evmSign = adapter.evmSignTransaction;
    if (!evmSign) throw new Error('evmSignTransaction not supported');

    const result = await evmSign.call(adapter, connectId, deviceId, {
      path,
      to: unsignedTx.to ?? '',
      value: unsignedTx.value ?? '0x0',
      chainId: Number(chainId),
      nonce: unsignedTx.nonce ?? '0x0',
      gasLimit: unsignedTx.gasLimit ?? '0x0',
      gasPrice: unsignedTx.gasPrice,
      maxFeePerGas: unsignedTx.maxFeePerGas,
      maxPriorityFeePerGas: unsignedTx.maxPriorityFeePerGas,
      data: unsignedTx.data,
    });

    if (!result.success) {
      throw new Error(result.error ?? 'Sign transaction failed');
    }

    // 用 v, r, s 构造已签名交易
    const { v, r, s } = result.data;
    return this._buildSignedTx(unsignedTx, { v, r, s });
  }

  // ── 签名消息 ──

  override async signMessage(params: ISignMessageParams): Promise<string[]> {
    const adapter = await this._getAdapter();
    const { connectId, deviceId } = this._getDeviceParams(params);
    const path = await this.vault.getAccountPath();
    const { messages } = params.unsignedMsg;

    const results: string[] = [];
    for (const msg of messages) {
      const evmSign = adapter.evmSignMessage;
      if (!evmSign) throw new Error('evmSignMessage not supported');

      const result = await evmSign.call(adapter, connectId, deviceId, {
        path,
        message: msg.message,
      });

      if (!result.success) throw new Error(result.error ?? 'Sign message failed');
      results.push(result.data.signature);
    }
    return results;
  }

  // ── 签名 TypedData ──
  // 关键优势：不需要处理 domainHash/messageHash 的差异
  // 直接传完整 EIP-712 对象给 adapter

  override async signTypedData(params: any): Promise<string> {
    const adapter = await this._getAdapter();
    const { connectId, deviceId } = this._getDeviceParams(params);
    const path = await this.vault.getAccountPath();

    const evmSign = adapter.evmSignTypedData;
    if (!evmSign) throw new Error('evmSignTypedData not supported');

    const result = await evmSign.call(adapter, connectId, deviceId, {
      path,
      data: params.unsignedMsg.typedData, // 完整 EIP-712 对象
    });

    if (!result.success) throw new Error(result.error ?? 'Sign typed data failed');
    return result.data.signature;
  }

  // ── 准备账户（获取地址） ──

  override async prepareAccounts(
    params: IPrepareHardwareAccountsParams,
  ): Promise<any[]> {
    const adapter = await this._getAdapter();
    const { connectId, deviceId } = this._getDeviceParams(params);

    return this.basePrepareHdNormalAccounts(params, {
      buildAddressesInfo: async ({ usedIndexes }) => {
        const template = params.deriveInfo?.template ?? "m/44'/60'/0'/0/$$INDEX$$";
        const addresses = [];

        for (const index of usedIndexes) {
          const path = template.replace('$$INDEX$$', String(index));
          const evmGet = adapter.evmGetAddress;
          if (!evmGet) throw new Error('evmGetAddress not supported');

          const result = await evmGet.call(adapter, connectId, deviceId, {
            path,
            showOnDevice: false,
          });

          if (!result.success) throw new Error(result.error ?? 'Get address failed');
          addresses.push({
            address: result.data.address,
            path,
          });
        }
        return { addresses };
      },
    });
  }

  // ── 辅助方法 ──

  private _buildSignedTx(unsignedTx: any, sig: { v: string; r: string; s: string }) {
    // 用 ethers.js Transaction 构造已签名交易 rawTx
    // 具体实现参考现有 KeyringHardware 的 buildSignedTx 逻辑
    return {
      txid: '',
      rawTx: '', // TODO: 用 sig 拼装 serialized tx
      ...sig,
    };
  }
}
```

### 4. 改 BTC Vault + 新建 BTC KeyringHardwareTP（如需 BTC 支持）

**位置**：
- `app-monorepo/packages/kit-bg/src/vaults/impls/btc/Vault.ts` — keyringMap 加条目
- `app-monorepo/packages/kit-bg/src/vaults/impls/btc/KeyringHardwareTP.ts` — 新建

BTC 的 KeyringHardwareTP 结构与 EVM 类似，但签名参数完全不同（PSBT vs protobuf inputs/outputs），需要单独实现。

### 5. 改 ServiceHardware — 加 adapter 管理 + 5 个方法加分支

**位置**：`app-monorepo/packages/kit-bg/src/services/ServiceHardware/ServiceHardware.ts`

```typescript
// ── 新增：Adapter 实例管理（懒加载） ──
// ⚠️ 注意：getVendorAdapter 不加 @backgroundMethod()，
//    因为返回的 adapter 对象不可序列化，不能通过 RPC 暴露给 popup。
//    只允许 background 进程内部调用（Keyring、其他 Service）。

private _trezorAdapter: TrezorAdapter | null = null;
private _ledgerAdapter: LedgerAdapter | null = null;

async getVendorAdapter(vendor: string): Promise<IHardwareWallet> {
  if (vendor === 'trezor') {
    if (!this._trezorAdapter) {
      const { TrezorAdapter } = await import('@bytezhang/trezor-adapter');
      const transport = await this._createTrezorTransport();
      this._trezorAdapter = new TrezorAdapter();
      await this._trezorAdapter.init(transport);
      this._registerAdapterEvents(this._trezorAdapter);
    }
    return this._trezorAdapter;
  }
  if (vendor === 'ledger') {
    if (!this._ledgerAdapter) {
      const { LedgerAdapter } = await import('@bytezhang/ledger-adapter');
      const dmk = await this._createLedgerDmk();
      this._ledgerAdapter = new LedgerAdapter();
      await this._ledgerAdapter.init(dmk);
      this._registerAdapterEvents(this._ledgerAdapter);
    }
    return this._ledgerAdapter;
  }
  throw new Error(`Unknown vendor: ${vendor}`);
}

// ── 按平台创建 Transport ──

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

private async _createLedgerDmk() {
  // 按平台选择 Ledger transport provider
  if (platformEnv.isExtension) {
    // Extension: DMK 在 offscreen 通过 LedgerAdapterHost 运行
    // Background 使用 LedgerAdapterClient
    const { LedgerAdapterClient } = await import('@bytezhang/ledger-transport-ext');
    return new LedgerAdapterClient(); // 实际上返回的是 DMK proxy
  }
  // Web/Desktop/Native: 直接创建 DMK
  const { LedgerAdapter } = await import('@bytezhang/ledger-adapter');
  // transport provider 通过 entry point 自动注册
  // ledger-adapter/web, ledger-adapter/node, ledger-adapter/react-native
  return null; // LedgerAdapter.init(dmk) 接收 DMK 实例
}

// ── Adapter 事件 → OneKey UI 事件 ──
// ⚠️ 关键：每个事件的 payload 中必须包含 vendor 字段，
//    sendUiResponse 依赖此字段将 PIN/Passphrase 路由到正确的 adapter。

private _registerAdapterEvents(adapter: IHardwareWallet) {
  const { UI_REQUEST, DEVICE } = require('@bytezhang/hardware-wallet-core');

  // ── PIN 请求 ──
  adapter.on(UI_REQUEST.REQUEST_PIN, async (e: any) => {
    await hardwareUiStateAtom.set(() => ({
      action: EHardwareUiStateAction.REQUEST_PIN,
      connectId: e.payload?.device?.connectId,
      payload: {
        uiRequestType: 'ui-request_pin',
        deviceType: e.payload?.device?.model,
        deviceId: e.payload?.device?.deviceId,
        connectId: e.payload?.device?.connectId,
        vendor: adapter.vendor,  // ⚠️ 必须附带
      },
    }));
  });

  // ── 按钮确认 ──
  adapter.on(UI_REQUEST.REQUEST_BUTTON, async (e: any) => {
    await hardwareUiStateAtom.set(() => ({
      action: EHardwareUiStateAction.REQUEST_BUTTON,
      connectId: e.payload?.connectId,
      payload: {
        uiRequestType: 'ui-request_button',
        code: e.payload?.code,
        vendor: adapter.vendor,
      },
    }));
  });

  // ── Passphrase 请求 ──
  adapter.on(UI_REQUEST.REQUEST_PASSPHRASE, async (e: any) => {
    await hardwareUiStateAtom.set(() => ({
      action: EHardwareUiStateAction.REQUEST_PASSPHRASE,
      connectId: e.payload?.device?.connectId,
      payload: {
        uiRequestType: 'ui-request_passphrase',
        deviceType: e.payload?.device?.model,
        deviceId: e.payload?.device?.deviceId,
        connectId: e.payload?.device?.connectId,
        vendor: adapter.vendor,
      },
    }));
  });

  // ── 设备连接/断开 ──
  adapter.on(DEVICE.CONNECT, (e: any) => {
    this._onThirdPartyDeviceConnect(adapter.vendor, e.payload);
  });

  adapter.on(DEVICE.DISCONNECT, (e: any) => {
    this._onThirdPartyDeviceDisconnect(adapter.vendor, e.payload);
  });
}
```

**5 个方法加 vendor 分支**（与 V1 相同）：

```typescript
// searchDevices — 加 vendor 参数
@backgroundMethod()
async searchDevices(options?: { vendor?: string }) {
  const { vendor } = options ?? {};
  if (vendor && vendor !== 'onekey') {
    const adapter = await this.getVendorAdapter(vendor);
    const devices = await adapter.searchDevices();
    // 转换为 SearchDevice[] 格式
    return { success: true, payload: devices.map(d => ({
      connectId: d.connectId,
      uuid: d.deviceId ?? '',
      deviceId: d.deviceId,
      deviceType: d.model ?? 'unknown',
      name: d.label ?? d.model ?? 'Unknown Device',
    })) };
  }
  // OneKey: 现有逻辑不动
  const hardwareSDK = await this.getSDKInstance({ connectId: undefined });
  return hardwareSDK?.searchDevices();
}

// connectDevice — 加 vendor 分支
// buildHwWalletXfp — 加 vendor 分支
// getEvmAddressByStandardWallet — 加 vendor 分支
// cancel — 加 vendor 分支
// （结构与 V1 相同，此处省略重复代码）
```

### 6. 改 ServiceHardwareUI.sendUiResponse()（关键修复）

**位置**：`app-monorepo/packages/kit-bg/src/services/ServiceHardwareUI/ServiceHardwareUI.ts`

```typescript
// ── 修改前（BUG：connectId 永远是 undefined，PIN 只能到 OneKey SDK）──

async sendUiResponse(response: UiResponseEvent) {
  return (
    await this.backgroundApi.serviceHardware.getSDKInstance({ connectId: undefined })
  ).uiResponse(response);
}

// ── 修改后（V2: 直接路由到 adapter.uiResponse()）──

async sendUiResponse(response: UiResponseEvent) {
  const uiState = hardwareUiStateAtom.get();
  const vendor = uiState?.payload?.vendor;
  if (vendor && vendor !== 'onekey') {
    // V2 不走 VendorSDKProxy，直接调 adapter
    const adapter = await this.backgroundApi.serviceHardware.getVendorAdapter(vendor);
    adapter.uiResponse(response);
    return;
  }
  // OneKey 原路
  return (
    await this.backgroundApi.serviceHardware.getSDKInstance({ connectId: undefined })
  ).uiResponse(response);
}
```

> ⚠️ **致命 BUG 说明**：与 V1 完全相同的 bug。原代码 `getSDKInstance({ connectId: undefined })` 始终返回 OneKey CoreApi。PIN/Passphrase 永远到不了第三方 adapter，操作永久挂起。
>
> V2 的修复与 V1 的区别：V1 通过 VendorSDKProxy.uiResponse() 间接调 adapter；V2 直接调 adapter.uiResponse()。

### 7. 改 withHardwareProcessing 的 finally 块

**位置**：`ServiceHardwareUI.ts` 的 `withHardwareProcessing()` 方法

```typescript
// ── 修改前 ──
finally {
  await this.backgroundApi.serviceHardware.getSDKInstance({ connectId: undefined })
    .then(sdk => sdk.deviceResetToHome?.(connectId));
}

// ── 修改后 ──
finally {
  const uiState = hardwareUiStateAtom.get();
  const vendor = uiState?.payload?.vendor;
  if (!vendor || vendor === 'onekey') {
    // 只对 OneKey 设备执行 deviceResetToHome
    await this.backgroundApi.serviceHardware.getSDKInstance({ connectId })
      .then(sdk => sdk.deviceResetToHome?.(connectId))
      .catch(() => {});
  }
  // 第三方设备不执行 deviceResetToHome（adapter 没有此方法）
}
```

### 8. 改 IDBDevice 加 vendor 字段

与 V1 相同。

### 9. 改 createHWWalletBase 传递 vendor

与 V1 相同。

### 10. 改 UI 页面

与 V1 相同。vendor 必须从 PickYourDevice 透传到后续所有 Service 调用。

### 11. 扩展 IDBWalletType 类型

**位置**：`app-monorepo/packages/kit-bg/src/dbs/local/types.ts`

```typescript
// keyringMap 的类型是 Record<IDBWalletType, typeof KeyringBase | undefined>
// IDBWalletType 是严格联合类型，必须加 'hwThirdParty'

type IDBWalletType = 'hd' | 'qr' | 'hw' | 'hwThirdParty' | 'imported' | 'watching' | 'external';
//                                         ^^^^^^^^^^^^^^^ 新增
```

> ⚠️ 注意：这不只是加一个字符串。需要排查所有使用 `IDBWalletType` 的地方，包括 DB migration、类型守卫、switch 语句等。

---

## 流程模拟 & 已知问题

以下是对 9 条核心流程的模拟测试结果：

### 🔴 致命问题（必须修复才能工作）

#### 问题 1：PIN/Passphrase 响应永远发不到第三方 adapter

**与 V1 完全相同的 BUG。**

**流程**：adapter 请求 PIN → `_registerAdapterEvents` 写入 atom → UI 弹窗 → 用户输入 → `sendUiResponse()`

**BUG**：`sendUiResponse()` 调用 `getSDKInstance({ connectId: undefined })`，始终返回 OneKey CoreApi。PIN 发到 OneKey SDK，adapter 永远收不到。

**修复**：见改动清单 #6 — `sendUiResponse` 从 atom 读取 vendor，直接调 `adapter.uiResponse()`。同时 `_registerAdapterEvents` 写入 atom 时必须附带 `vendor` 字段（见改动清单 #5）。

#### 问题 2：Onboarding 全流程的 vendor 路由失败

**与 V1 完全相同的 BUG。**

**BUG**：`_resolveVendor(connectId)` 查 DB，但 onboarding 阶段设备未入库 → fallback 到 OneKey → 所有 Service 方法走错。

**修复**：5 个非 Keyring 方法全部增加 `vendor` 参数，UI 层从 PickYourDevice 一路透传。

### 🟡 重要问题（不修复会导致部分场景异常）

#### 问题 3：KeyringHardwareTP._getAdapter() 访问模式

**V2 独有问题。**

现有 `KeyringHardwareBase.getHardwareSDKInstance()` 使用特殊绕过模式获取不可序列化的 SDK 对象：
```typescript
// 绕过 backgroundApiProxy 的序列化检查
const sdk = await appGlobals?.$backgroundApiProxy?.backgroundApi?.serviceHardware?.getSDKInstance?.({ connectId });
```

TP Keyring 的 `_getAdapter()` 必须使用同样的模式，不能直接用 `this.vault.backgroundApi`，否则 adapter 对象过不了序列化校验。

**修复**：已在改动清单 #3 中更新 `_getAdapter()` 代码。

#### 问题 4：getVendorAdapter 不应加 @backgroundMethod()

**V2 独有问题。**

adapter 对象包含 WebSocket/USB 句柄，不可序列化。如果 `@backgroundMethod()` 将其暴露为 RPC 方法，任何 popup 代码调用 → 序列化失败 → 崩溃。

**修复**：已在改动清单 #5 中去掉 `@backgroundMethod()`。

#### 问题 5：_buildSignedTx 是 TODO stub

**V2 独有问题。**

```typescript
private _buildSignedTx(unsignedTx, sig) {
  return { txid: '', rawTx: '', ...sig }; // TODO
}
```

返回空 `rawTx`，交易无法广播。需用 ethers.js 从 `unsignedTx` + `v,r,s` 构造 serialized tx。

**修复**：参考现有 EVM `KeyringHardware` 的 `buildSignedTx` 实现。

#### 问题 6：IDBWalletType 需要扩展

**V2 独有问题。**

`keyringMap` 类型是 `Record<IDBWalletType, ...>`，`IDBWalletType` 是严格联合类型。加 `'hwThirdParty'` 需要排查所有使用此类型的地方。

#### 问题 7：withHardwareProcessing finally 块

**与 V1 完全相同。**

`deviceResetToHome` 用 `getSDKInstance({ connectId: undefined })` → 走 OneKey SDK。第三方设备应跳过。

**修复**：见改动清单 #7。

#### 问题 8：设备插拔事件未注册

**与 V1 相同。** 原版 `_registerAdapterEvents` 只注册了 PIN/button/passphrase，未注册 device-connect/disconnect。

**修复**：已在改动清单 #5 中补全事件注册。

#### 问题 9：getCompatibleConnectId 对新设备失败

**与 V1 相同。** onboarding 场景需绕过此方法。

### 🟢 已确认可行的流程

#### 流程 A：已入库设备的签名（V2 独有路径）

**路径**：VaultFactory → `resolveVendorByWalletId(walletId)` 查 DB → vendor='trezor' → `keyringMap.hwThirdParty` → `KeyringHardwareTP` → `_getAdapter()` → `adapter.evmSignTransaction()`

**结论**：✅ 正常工作。`resolveVendorByWalletId` 在签名时设备已入库，能正确返回 vendor。Factory 的 keyringMap 机制天然支持多态路由。

#### 流程 B：搜索设备

**路径**：UI 传 vendor → `searchDevices({ vendor: 'trezor' })` → `getVendorAdapter('trezor')` → `adapter.searchDevices()`

**结论**：✅ 正常（vendor 由 UI 传入）。

#### 流程 C：已入库设备的取消操作

**路径**：`cancel(connectId)` → 查 DB 获取 vendor → `adapter.forceCancel(connectId)`

**结论**：✅ 正常（设备已入库时 vendor 可从 DB 查到）。

### V1 与 V2 共享问题对照

| 问题 | V1 | V2 | 说明 |
|------|----|----|------|
| sendUiResponse 路由 | 🔴 相同 | 🔴 相同 | 都要改 ServiceHardwareUI |
| Onboarding vendor 透传 | 🔴 相同 | 🔴 相同 | 都要改 5 个 Service 方法 |
| withHardwareProcessing finally | 🟡 相同 | 🟡 相同 | 都要改 |
| 事件注册 | 🟡 相同 | 🟡 相同 | 都要补全 |
| getCompatibleConnectId | 🟡 相同 | 🟡 相同 | 都要绕过 |
| adapter 访问模式 | ✅ 不涉及 | 🟡 需绕过模式 | V2 独有 |
| @backgroundMethod 风险 | ✅ getSDKInstance 已有先例 | 🟡 需去掉 | V2 独有 |
| IDBWalletType 扩展 | ✅ 不需要 | 🟡 需加 hwThirdParty | V2 独有 |
| _buildSignedTx | ✅ 由原 Keyring 构建 | 🟡 stub 需实现 | V2 独有 |

---

## 各平台 Transport 对应关系

| 平台 | Trezor Transport | Ledger Transport |
|------|-------------------|------------------|
| **Web** | `trezor-transport-web` (WebUSB) | `ledger-adapter/web` (WebHID + DMK) |
| **Desktop** | `trezor-transport-node` (USB) + `trezor-transport-node-ble` (BLE) | `ledger-adapter/node` (HID + DMK) |
| **Extension** | `trezor-transport-ext` (Proxy ↔ Host) | `ledger-transport-ext` (Client ↔ Host) |
| **Mobile** | `trezor-transport-native` (RN BLE) | `ledger-adapter/react-native` (RN BLE + DMK) |

---

## 改动总结

| 类别 | 文件数 | 说明 |
|------|--------|------|
| VaultFactory | 1 | createKeyringInstance 加 vendor 路由 |
| Vault (EVM) | 1 | keyringMap 加 hwThirdParty |
| KeyringHardwareTP (EVM) | 1 | 新建 (~120 行) |
| Vault (BTC，如需) | 1 | keyringMap 加 hwThirdParty |
| KeyringHardwareTP (BTC，如需) | 1 | 新建 (~120 行) |
| ServiceHardware | 1 | getVendorAdapter + _registerAdapterEvents + 5 个方法加 vendor 分支 |
| ServiceHardwareUI | 1 | sendUiResponse 修复 vendor 路由 + withHardwareProcessing finally |
| DB 类型 | 1-2 | IDBDevice 加 vendor + IDBWalletType 加 hwThirdParty |
| ServiceAccount | 1 | createHWWalletBase 传 vendor |
| UI 页面 | 2-3 | PickYourDevice + ConnectYourDevice + CheckAndUpdate（vendor 透传）|
| KeyringHardware (OneKey) | **0** | 不改 |
| **总计** | **~12-15** | |

---

## 优势

1. **不伪造 CoreApi** — 没有 Proxy 层，不需要 mock 70 个方法，没有运行时 "method not supported" 风险
2. **参数转换显式** — 每条链的 TP Keyring 里显式处理参数映射，代码可读性强
3. **TypedData 差异自然解决** — EVM TP Keyring 直接传完整 EIP-712 对象，不依赖 OneKey 是否传 `data` 字段
4. **利用已有工厂机制** — VaultFactory 的 keyringMap 就是为多态设计的，不是 hack
5. **每条链独立演进** — EVM TP Keyring 和 BTC TP Keyring 各自处理链特有逻辑，互不影响
6. **35 个 OneKey KeyringHardware 不改** — 与 V1 同样的零回归优势
7. **调试直观** — 调用栈：KeyringHardwareTP → adapter.method()，没有中间 Proxy 层吃堆栈

## 劣势

1. **需要 per-chain 创建 TP Keyring** — 每条链要新建一个 ~120 行的文件（但只需要支持的链：EVM、BTC、SOL）
2. **改 VaultFactory** — factory.ts 是核心文件，改动需要谨慎
3. **IDBWalletType 类型扩展** — 必须加 `'hwThirdParty'`，需排查所有使用此类型的地方（DB migration、类型守卫、switch 语句等）
4. **ServiceHardware + ServiceHardwareUI 改动量比 V1 多** — 除了 5 个非 Keyring 方法，还需改 sendUiResponse、withHardwareProcessing
5. **adapter 访问需要 appGlobals 绕过模式** — TP Keyring 不能直接用 `this.vault.backgroundApi`，需与 KeyringHardwareBase 一致使用 `appGlobals.$backgroundApiProxy.backgroundApi`
6. **_buildSignedTx 实现缺口** — V1 由原 Keyring 构建签名交易，V2 需要在 TP Keyring 中自行实现

---

## V1 vs V2 对比

| 维度 | V1 (VendorSDKProxy) | V2 (Keyring 路由) |
|------|---------------------|-------------------|
| **核心思路** | Adapter 伪装 CoreApi | Vault 层分流，各走各路 |
| **KeyringHardware 改动** | 0 | 0 |
| **app-monorepo 文件改动** | ~8-9 | ~12-15 |
| **新建文件** | 1 (Proxy ~250行) | 2-3 (per-chain TP Keyring ~120行) |
| **有没有 Mock 层** | 有 | 无 |
| **参数转换** | 在 Proxy 里隐式 | 在 TP Keyring 里显式 |
| **TypedData 处理** | 依赖 OneKey 传 data 字段 | 直接用完整 EIP-712 |
| **getFeatures 兼容** | 需伪造 Features 对象 | 不需要（TP Keyring 不调 getFeatures）|
| **未实现方法** | 运行时抛异常 | 编译时就不存在（TP Keyring 不调） |
| **调试** | Proxy 层吃堆栈 | 直接调用，堆栈清晰 |
| **PIN/Passphrase 路由** | 通过 VendorSDKProxy.uiResponse() | 直接调 adapter.uiResponse() |
| **签名交易构建** | 由原 Keyring 构建（已有逻辑） | TP Keyring 需自行实现 _buildSignedTx |
| **类型系统影响** | 无（Proxy 动态类型） | 需扩展 IDBWalletType |
| **开发速度** | 快（~2-3天） | 中（~4-6天） |
| **长期维护** | 需维护 Proxy 方法映射 | per-chain Keyring 独立维护 |
| **推荐度** | 适合快速验证 / MVP | 适合生产级集成 |
| **共享的致命 BUG** | sendUiResponse、onboarding vendor | 完全相同 |

---

## 推荐

**如果时间紧、先做 demo → V1**
**如果要上生产、长期维护 → V2**

两者可以渐进：先用 V1 快速跑通，验证 adapter 可用性，然后重构为 V2 的 Keyring 路由。V1 → V2 的迁移成本不高（删 Proxy，加 TP Keyring，改 factory）。
