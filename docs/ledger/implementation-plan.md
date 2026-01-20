# Ledger 多链适配器实施方案

## 一、方案总览

### 1.1 核心目标

为多端钱包（浏览器扩展、移动端）提供统一的 Ledger 硬件钱包接入能力：

- ✅ **业务逻辑优先**：先跑通核心流程（连接、获取地址、签名）
- ✅ **Service Layer 纯粹**：不包含平台特定 API，可跨平台复用
- ✅ **链特定方法**：不强制统一接口，保持类型安全
- ⏳ **设备校验**（Phase 4）：后期优化，确保操作正确的设备

### 1.2 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                   App Layer（应用层）                         │
│   • 浏览器扩展：chrome.runtime.sendMessage                   │
│   • React Native：直接调用 Service API                       │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   Service Layer（核心层）                     │
│   • LedgerService：统一业务 API                              │
│   • LedgerDeviceManager：设备管理                            │
│   • ChainSignerFactory：创建链特定 Signer                    │
│   • EventEmitter：设备状态事件                               │
└─────────────────────────────────────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
┌─────────────────────┐         ┌─────────────────────┐
│   New SDK           │         │   Legacy SDK        │
│   • ETH             │         │   • TRX             │
│   • BTC             │         │   • SUI             │
│   • SOL             │         │   • APT             │
└─────────────────────┘         └─────────────────────┘
```

---

## 二、实施阶段（Phases）

### Phase 1: 核心 Service Layer（Week 1-2）

**目标**：搭建 Service Layer 基础架构，跑通单设备场景

#### 1.1 LedgerDeviceManager（设备管理）

**文件**：`packages/ledger-service/src/device/LedgerDeviceManager.ts`

**功能**：
- ✅ 设备连接、断开
- ✅ 设备发现（`listenToAvailableDevices`）
- ✅ 维护设备列表
- ✅ EventEmitter 事件通知

**API**：
```typescript
class LedgerDeviceManager {
  // 设备发现
  startDiscovery(): Observable<DiscoveredDevice[]>
  stopDiscovery(): void

  // 设备连接
  connectDevice(deviceId: string): Promise<DeviceFingerprint>
  disconnectDevice(deviceId: string): Promise<void>

  // 设备查询
  listConnectedDevices(): DeviceFingerprint[]
  getDeviceFingerprint(deviceId: string): DeviceFingerprint | null
  getSessionId(deviceId: string): string | null

  // 事件监听
  on(event: DeviceEvent, listener: Function): void
}
```

**DeviceFingerprint**（简化版）：
```typescript
interface DeviceFingerprint {
  deviceId: string;      // 运行时 ID
  sessionId: string;     // DMK Session ID
  modelId: string;       // 设备型号
  connectedAt: number;   // 连接时间
}
```

#### 1.2 ChainSignerFactory（链 Signer 工厂）

**文件**：`packages/ledger-service/src/signer/ChainSignerFactory.ts`

**功能**：
- ✅ 根据链类型创建对应的 Signer
- ✅ 缓存 Signer 实例

**API**：
```typescript
class ChainSignerFactory {
  // New SDK
  getEthSigner(deviceId: string): SignerEth
  getBtcSigner(deviceId: string): SignerBtc
  getSolSigner(deviceId: string): SignerSol

  // Legacy SDK
  getTrxApp(deviceId: string): Promise<Trx>
  getSuiApp(deviceId: string): Promise<Sui>

  // 缓存管理
  clearCache(deviceId?: string): void
}
```

#### 1.3 LedgerService（统一业务 API）

**文件**：`packages/ledger-service/src/LedgerService.ts`

**功能**：
- ✅ 组合 DeviceManager 和 SignerFactory
- ✅ 提供统一的业务 API
- ✅ 错误处理和日志

**API**：
```typescript
class LedgerService {
  // 设备管理
  startDiscovery(): Observable<DiscoveredDevice[]>
  connectDevice(deviceId: string): Promise<DeviceFingerprint>
  disconnectDevice(deviceId: string): Promise<void>
  listConnectedDevices(): DeviceFingerprint[]
  onDeviceEvent(event: DeviceEvent, listener: Function): void

  // Ethereum
  getEthAddress(deviceId: string, path: string, options?): Promise<AddressResult>
  signEthTransaction(deviceId: string, path: string, tx: any): Promise<Signature>
  signEthMessage(deviceId: string, path: string, message: string): Promise<Signature>
  signEthTypedData(deviceId: string, path: string, typedData: any): Promise<Signature>

  // Bitcoin
  getBtcAddress(deviceId: string, path: string, options?): Promise<AddressResult>
  signBtcPSBT(deviceId: string, psbt: string): Promise<SignedPSBT>

  // Solana
  getSolAddress(deviceId: string, path: string): Promise<AddressResult>
  signSolTransaction(deviceId: string, path: string, tx: any): Promise<Signature>
  signSolAllTransactions(deviceId: string, path: string, txs: any[]): Promise<Signatures>

  // Tron (Legacy)
  getTrxAddress(deviceId: string, path: string, options?): Promise<AddressResult>
  signTrxTransaction(deviceId: string, path: string, rawTx: string): Promise<Signature>
}
```

#### 1.4 错误处理

**文件**：`packages/ledger-service/src/errors/LedgerError.ts`

**错误码**：
```typescript
enum LedgerErrorCode {
  // 连接错误
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  DEVICE_NOT_FOUND = 'DEVICE_NOT_FOUND',
  DEVICE_NOT_CONNECTED = 'DEVICE_NOT_CONNECTED',

  // 设备状态错误
  DEVICE_LOCKED = 'DEVICE_LOCKED',
  APP_NOT_OPEN = 'APP_NOT_OPEN',

  // 用户操作错误
  USER_REJECTED = 'USER_REJECTED',
  TIMEOUT = 'TIMEOUT',

  // SDK 错误
  SDK_ERROR = 'SDK_ERROR',
}
```

**测试**：
- ✅ 单元测试：设备管理、Signer 创建
- ✅ 集成测试：连接真实设备，获取地址

---

### Phase 2: 浏览器扩展集成（Week 3）

**目标**：在浏览器扩展中集成 Service Layer

#### 2.1 Background Worker

**文件**：`demo/browser-extension/src/background.ts`

**功能**：
- ✅ 初始化 LedgerService
- ✅ 监听 Popup 消息
- ✅ 处理设备操作请求
- ✅ 转发设备事件到 Popup

**实现**：
```typescript
import { LedgerService } from '@your-org/ledger-service';
import { webHidTransportFactory } from '@ledgerhq/device-transport-kit-web-hid';

const ledgerService = new LedgerService(webHidTransportFactory);

// 监听设备事件，转发到 Popup
ledgerService.onDeviceEvent('device:connected', (fingerprint) => {
  chrome.runtime.sendMessage({
    type: 'DEVICE_EVENT',
    event: 'device:connected',
    data: fingerprint,
  });
});

// 处理 Popup 消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      switch (request.type) {
        case 'CONNECT_DEVICE':
          const result = await ledgerService.connectDevice(request.deviceId);
          sendResponse({ success: true, data: result });
          break;

        case 'GET_ETH_ADDRESS':
          const address = await ledgerService.getEthAddress(
            request.deviceId,
            request.path,
            request.options
          );
          sendResponse({ success: true, data: address });
          break;

        // ... 其他操作
      }
    } catch (error) {
      sendResponse({
        success: false,
        error: error.toJSON ? error.toJSON() : error.message,
      });
    }
  })();

  return true; // 异步响应
});
```

#### 2.2 Setup Page（设备授权）

**文件**：`demo/browser-extension/src/setup.html`

**功能**：
- ✅ 触发 WebHID 设备授权弹窗
- ✅ 引导用户完成设备授权

#### 2.3 Popup UI

**文件**：`demo/browser-extension/src/popup.tsx`

**功能**：
- ✅ 发现设备列表
- ✅ 连接设备
- ✅ 获取地址
- ✅ 签名交易/消息

**测试**：
- ✅ 手动测试：完整的用户流程
- ✅ 测试 WebHID 权限流程

---

### Phase 3: React Native 集成（Week 4）

**目标**：在 React Native 中集成 Service Layer

#### 3.1 Service 初始化

**文件**：`demo/expo-demo/src/services/ledgerService.ts`

```typescript
import { LedgerService } from '@your-org/ledger-service';
import { RNBleTransportFactory } from '@ledgerhq/device-transport-kit-react-native-ble';

export const ledgerService = new LedgerService(RNBleTransportFactory);
```

#### 3.2 BLE 权限处理

**文件**：`demo/expo-demo/src/utils/permissions.ts`

**功能**：
- ✅ Android BLE 权限请求
- ✅ iOS 权限处理

```typescript
async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS === 'android') {
    const granted = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ]);

    return Object.values(granted).every(
      status => status === PermissionsAndroid.RESULTS.GRANTED
    );
  }

  return true; // iOS 通过 Info.plist 配置
}
```

#### 3.3 UI 组件

**文件**：`demo/expo-demo/src/screens/LedgerScreen.tsx`

**功能**：
- ✅ 设备发现
- ✅ 连接设备
- ✅ 获取地址
- ✅ 签名交易

**关键实现**：
```typescript
function LedgerScreen() {
  const [devices, setDevices] = useState<any[]>([]);
  const [connectedDeviceId, setConnectedDeviceId] = useState<string | null>(null);

  useEffect(() => {
    // 监听设备事件
    ledgerService.onDeviceEvent('device:connected', (fingerprint) => {
      setConnectedDeviceId(fingerprint.deviceId);
    });

    // 开始发现设备
    const subscription = ledgerService.startDiscovery().subscribe({
      next: (deviceList) => setDevices(deviceList),
    });

    return () => {
      subscription.unsubscribe();
      ledgerService.stopDiscovery();
    };
  }, []);

  const handleConnect = async (deviceId: string) => {
    await ledgerService.connectDevice(deviceId);
  };

  const handleGetAddress = async () => {
    const result = await ledgerService.getEthAddress(
      connectedDeviceId,
      "44'/60'/0'/0/0"
    );
    console.log('Address:', result.address);
  };

  // ... UI
}
```

**测试**：
- ✅ 真机测试：BLE 设备发现和连接
- ✅ 测试 Buffer polyfill

---

### Phase 4: 设备校验与多设备支持（Week 5-6）⏳

**目标**：实现设备身份验证，支持多设备场景

#### 4.1 DeviceFingerprint 完整版

**更新**：`packages/ledger-service/src/types/DeviceFingerprint.ts`

```typescript
interface DeviceFingerprint {
  // 运行时标识
  deviceId: string;
  sessionId: string;

  // 硬件标识（辅助筛选）
  seTargetId: number;
  hwVersion: string;
  seVersion: string;

  // 设备信息
  modelId: string;
  connectedAt: number;
}
```

#### 4.2 GetOsVersion 集成

**更新**：`LedgerDeviceManager.connectDevice()`

```typescript
async connectDevice(deviceId: string): Promise<DeviceFingerprint> {
  const sessionId = await this.dmk.connect({ device });

  // 获取硬件信息（不需要打开特定 App）
  const osVersion = await this.getOsVersion(sessionId);

  const fingerprint: DeviceFingerprint = {
    deviceId,
    sessionId,
    seTargetId: osVersion.seTargetId,
    hwVersion: osVersion.hwVersion,
    seVersion: osVersion.seVersion,
    modelId: device.deviceModel.id,
    connectedAt: Date.now(),
  };

  // ...
}
```

#### 4.3 App Layer 地址绑定

**实现**：在 App 层（不在 Service Layer）

```typescript
// App 层数据结构
interface WalletAccount {
  address: string;
  chain: string;
  derivationPath: string;

  // 设备信息（辅助识别）
  deviceInfo: {
    modelId: string;
    seTargetId: number;
    createdAt: number;
  };
}

// 创建地址时
async function createAddress(deviceId: string, path: string) {
  const fingerprint = ledgerService.deviceManager.getDeviceFingerprint(deviceId);
  const addressResult = await ledgerService.getEthAddress(deviceId, path);

  const account: WalletAccount = {
    address: addressResult.address,
    chain: 'ETH',
    derivationPath: path,
    deviceInfo: {
      modelId: fingerprint.modelId,
      seTargetId: fingerprint.seTargetId,
      createdAt: Date.now(),
    },
  };

  await saveToDatabase(account);
}
```

#### 4.4 签名时设备验证

**实现**：在 App 层

```typescript
async function signTransaction(account: WalletAccount, tx: any) {
  const devices = ledgerService.listConnectedDevices();

  // 策略 1: 单设备 + 型号匹配
  if (devices.length === 1) {
    const device = devices[0];

    if (device.modelId !== account.deviceInfo.modelId) {
      throw new Error('Wrong device model');
    }

    // 验证地址
    const addressResult = await ledgerService.getEthAddress(
      device.deviceId,
      account.derivationPath,
      { checkOnDevice: false }
    );

    if (addressResult.address !== account.address) {
      throw new Error('Device verification failed');
    }

    // 执行签名
    return await ledgerService.signEthTransaction(
      device.deviceId,
      account.derivationPath,
      tx
    );
  }

  // 策略 2: 多设备场景
  const candidates = devices.filter(d =>
    d.modelId === account.deviceInfo.modelId &&
    d.seTargetId === account.deviceInfo.seTargetId
  );

  // 验证所有候选设备，自动选择匹配的
  for (const device of candidates) {
    try {
      const addressResult = await ledgerService.getEthAddress(
        device.deviceId,
        account.derivationPath,
        { checkOnDevice: false }
      );

      if (addressResult.address === account.address) {
        // 找到匹配的设备，执行签名
        return await ledgerService.signEthTransaction(
          device.deviceId,
          account.derivationPath,
          tx
        );
      }
    } catch (error) {
      console.warn('Device verification failed:', error);
    }
  }

  throw new Error('No matching device found');
}
```

#### 4.5 会话缓存优化

**实现**：在 App 层

```typescript
class DeviceVerificationCache {
  private cache = new Map<string, Set<string>>(); // deviceId -> addresses

  markVerified(deviceId: string, address: string): void {
    if (!this.cache.has(deviceId)) {
      this.cache.set(deviceId, new Set());
    }
    this.cache.get(deviceId)!.add(address.toLowerCase());
  }

  isVerified(deviceId: string, address: string): boolean {
    return this.cache.get(deviceId)?.has(address.toLowerCase()) || false;
  }

  clearDevice(deviceId: string): void {
    this.cache.delete(deviceId);
  }
}

const verificationCache = new DeviceVerificationCache();

// 签名时检查缓存
if (!verificationCache.isVerified(device.deviceId, account.address)) {
  // 验证地址
  const addressResult = await ledgerService.getEthAddress(...);

  if (addressResult.address === account.address) {
    verificationCache.markVerified(device.deviceId, account.address);
  }
}

// 设备断开时清除缓存
ledgerService.onDeviceEvent('device:disconnected', ({ deviceId }) => {
  verificationCache.clearDevice(deviceId);
});
```

---

## 三、硬件交互机制（基于 Ledger Live 实践）

### 3.1 设备访问队列管理

**问题**：多个操作同时访问同一个 Ledger 设备会导致 APDU 冲突和设备锁定。

**Ledger Live 的解决方案**：为每个设备维护一个串行执行队列。

**源码参考**：
- Ledger Live 实现：`ledger-live/libs/ledger-live-common/src/hw/deviceAccess.ts`
- GitHub 链接：[查看 deviceAccess.ts](https://github.com/LedgerHQ/ledger-live/blob/develop/libs/ledger-live-common/src/hw/deviceAccess.ts)
- 核心概念：`withDevice()` 包装器，确保串行访问设备

#### 3.1.1 DeviceJobQueue 实现

**目标文件路径**：`packages/ledger-service/src/device/DeviceJobQueue.ts`

**参考 Ledger Live 实现**：
- `ledger-live/libs/ledger-live-common/src/hw/deviceAccess.ts` - withDevice 模式
- `ledger-live/apps/ledger-live-desktop/src/renderer/families/ethereum/TransactionConfirmFields.js` - 使用示例

```typescript
import { Observable, defer, from } from 'rxjs';
import { finalize } from 'rxjs/operators';

/**
 * 设备任务队列管理器
 *
 * 核心设计：
 * - 每个设备只有一个执行队列
 * - 任务按顺序执行，不会并发
 * - 任务执行失败不影响队列继续
 */
export class DeviceJobQueue {
  private queuedJobsByDevice: Map<string, QueuedJob> = new Map();
  private jobIdCounter = 0;

  /**
   * 将任务加入设备队列
   *
   * @param deviceId - 设备 ID
   * @param job - 要执行的任务（返回 Observable）
   * @returns 任务执行的 Observable
   */
  enqueue<T>(
    deviceId: string,
    job: () => Observable<T>
  ): Observable<T> {
    return new Observable(subscriber => {
      const jobId = ++this.jobIdCounter;

      // 获取该设备的最后一个任务
      const previousJob = this.queuedJobsByDevice.get(deviceId);

      // 等待前一个任务完成后执行当前任务
      const currentJobPromise = (previousJob?.promise || Promise.resolve())
        .then(() => {
          console.log(`[JobQueue] Starting job ${jobId} for device ${deviceId}`);

          return new Promise<void>((resolve, reject) => {
            job()
              .pipe(
                finalize(() => {
                  console.log(`[JobQueue] Completed job ${jobId} for device ${deviceId}`);
                  resolve();
                })
              )
              .subscribe({
                next: (value) => subscriber.next(value),
                error: (error) => {
                  subscriber.error(error);
                  resolve(); // 即使失败也继续队列
                },
                complete: () => subscriber.complete(),
              });
          });
        })
        .catch(error => {
          console.error(`[JobQueue] Previous job failed for device ${deviceId}:`, error);
          // 前一个任务失败不影响当前任务
        });

      // 更新队列
      this.queuedJobsByDevice.set(deviceId, {
        id: jobId,
        promise: currentJobPromise,
      });

      // 清理：当所有任务完成后清理队列
      currentJobPromise.finally(() => {
        const current = this.queuedJobsByDevice.get(deviceId);
        if (current?.id === jobId) {
          this.queuedJobsByDevice.delete(deviceId);
        }
      });
    });
  }

  /**
   * 清除设备的所有任务
   */
  clear(deviceId: string): void {
    this.queuedJobsByDevice.delete(deviceId);
  }

  /**
   * 清除所有设备的任务
   */
  clearAll(): void {
    this.queuedJobsByDevice.clear();
  }
}

interface QueuedJob {
  id: number;
  promise: Promise<void>;
}
```

#### 3.1.2 withDevice 封装

**文件**：`packages/ledger-service/src/device/withDevice.ts`

```typescript
import { Observable, from } from 'rxjs';
import { mergeMap, finalize } from 'rxjs/operators';
import { DeviceManagementKit } from '@ledgerhq/device-management-kit';
import { DeviceJobQueue } from './DeviceJobQueue';

const jobQueue = new DeviceJobQueue();

/**
 * 在设备上执行任务（自动排队）
 *
 * 使用方式：
 * ```typescript
 * withDevice(deviceId, sessionId)(dmk =>
 *   from(dmk.sendCommand(sessionId, command))
 * ).subscribe({
 *   next: result => console.log(result),
 *   error: error => console.error(error)
 * });
 * ```
 */
export const withDevice = (
  deviceId: string,
  sessionId: string
) => <T>(
  job: (dmk: DeviceManagementKit, sessionId: string) => Observable<T>
): Observable<T> => {
  return jobQueue.enqueue(deviceId, () =>
    job(getDeviceManagementKit(), sessionId)
  );
};

// 单例 DMK 实例
let dmkInstance: DeviceManagementKit | null = null;

function getDeviceManagementKit(): DeviceManagementKit {
  if (!dmkInstance) {
    throw new Error('DeviceManagementKit not initialized');
  }
  return dmkInstance;
}

export function initializeDeviceManagementKit(dmk: DeviceManagementKit): void {
  dmkInstance = dmk;
}
```

#### 3.1.3 在 LedgerService 中使用

**更新**：`packages/ledger-service/src/LedgerService.ts`

```typescript
import { withDevice } from './device/withDevice';
import { from } from 'rxjs';
import { firstValueFrom } from 'rxjs';

export class LedgerService {
  // ...

  /**
   * 获取 Ethereum 地址（使用队列）
   */
  async getEthAddress(
    deviceId: string,
    path: string,
    options?: { checkOnDevice?: boolean }
  ): Promise<AddressResult> {
    const sessionId = this.deviceManager.getSessionId(deviceId);
    if (!sessionId) {
      throw new LedgerError(
        LedgerErrorCode.DEVICE_NOT_CONNECTED,
        `Device ${deviceId} not connected`
      );
    }

    // 使用 withDevice 确保串行执行
    return firstValueFrom(
      withDevice(deviceId, sessionId)((dmk, sid) =>
        from(this.signerFactory.getEthSigner(deviceId).getAddress(path, options))
      )
    );
  }

  /**
   * 签名 Ethereum 交易（使用队列）
   */
  async signEthTransaction(
    deviceId: string,
    path: string,
    tx: any
  ): Promise<Signature> {
    const sessionId = this.deviceManager.getSessionId(deviceId);
    if (!sessionId) {
      throw new LedgerError(
        LedgerErrorCode.DEVICE_NOT_CONNECTED,
        `Device ${deviceId} not connected`
      );
    }

    return firstValueFrom(
      withDevice(deviceId, sessionId)((dmk, sid) =>
        from(this.signerFactory.getEthSigner(deviceId).signTransaction(path, tx))
      )
    );
  }

  // ... 其他方法类似
}
```

**关键特性**：
- ✅ **自动排队**：所有操作自动加入队列
- ✅ **串行执行**：同一设备的操作按顺序执行
- ✅ **错误隔离**：一个任务失败不影响后续任务
- ✅ **自动清理**：任务完成后自动清理队列

---

### 3.2 Open App 完整流程

**问题**：签名前需要确保正确的 App（Ethereum/Bitcoin 等）已打开。

**Ledger Live 的解决方案**：connectApp + openApp 流程。

**源码参考**：
- Open App 实现：`ledger-live/libs/ledger-live-common/src/hw/openApp.ts`
- GitHub 链接：[查看 openApp.ts](https://github.com/LedgerHQ/ledger-live/blob/develop/libs/ledger-live-common/src/hw/openApp.ts)
- Get App 实现：`ledger-live/libs/ledger-live-common/src/hw/getAppAndVersion.ts`
- GitHub 链接：[查看 getAppAndVersion.ts](https://github.com/LedgerHQ/ledger-live/blob/develop/libs/ledger-live-common/src/hw/getAppAndVersion.ts)

#### 3.2.1 OpenAppCommand 实现

**目标文件路径**：`packages/ledger-service/src/commands/OpenAppCommand.ts`

**参考 Ledger Live 实现**：
- `ledger-live/libs/ledger-live-common/src/hw/openApp.ts` - 核心逻辑
- APDU 规范：CLA=0xe0, INS=0xd8

```typescript
import { Command, CommandResult } from '@ledgerhq/device-management-kit';

/**
 * 打开设备上的应用
 *
 * APDU: CLA=0xe0, INS=0xd8, P1=0x00, P2=0x00, DATA=appName
 */
export class OpenAppCommand extends Command<void> {
  constructor(private appName: string) {
    super();
  }

  getApdu(): Buffer {
    const data = Buffer.from(this.appName, 'ascii');
    return Buffer.concat([
      Buffer.from([0xe0, 0xd8, 0x00, 0x00, data.length]),
      data,
    ]);
  }

  parseResponse(response: Buffer): CommandResult<void> {
    // 成功：0x9000
    // 失败：0x6984 (App not found), 0x6807 (App needs upgrade)
    if (response.length >= 2) {
      const statusCode = response.readUInt16BE(response.length - 2);

      if (statusCode === 0x9000) {
        return CommandResult.success(undefined);
      } else if (statusCode === 0x6984) {
        return CommandResult.error(new Error(`App "${this.appName}" not found on device`));
      } else if (statusCode === 0x6807) {
        return CommandResult.error(new Error(`App "${this.appName}" needs upgrade`));
      }
    }

    return CommandResult.error(new Error('Failed to open app'));
  }
}
```

#### 3.2.2 GetAppAndVersionCommand 实现

**目标文件路径**：`packages/ledger-service/src/commands/GetAppAndVersionCommand.ts`

**参考 Ledger Live 实现**：
- `ledger-live/libs/ledger-live-common/src/hw/getAppAndVersion.ts` - 核心实现
- GitHub 链接：[查看源码](https://github.com/LedgerHQ/ledger-live/blob/develop/libs/ledger-live-common/src/hw/getAppAndVersion.ts)
- APDU 规范：CLA=0xb0, INS=0x01

```typescript
import { Command, CommandResult } from '@ledgerhq/device-management-kit';

/**
 * 获取当前打开的应用名称和版本
 *
 * APDU: CLA=0xb0, INS=0x01, P1=0x00, P2=0x00
 */
export class GetAppAndVersionCommand extends Command<AppInfo> {
  getApdu(): Buffer {
    return Buffer.from([0xb0, 0x01, 0x00, 0x00, 0x00]);
  }

  parseResponse(response: Buffer): CommandResult<AppInfo> {
    if (response.length < 2) {
      return CommandResult.error(new Error('Invalid response'));
    }

    const statusCode = response.readUInt16BE(response.length - 2);

    if (statusCode !== 0x9000) {
      return CommandResult.error(new Error(`Status code: 0x${statusCode.toString(16)}`));
    }

    // 解析格式: [formatID][nameLength][name][versionLength][version][flagLength][flags]
    let offset = 0;
    const formatID = response[offset++];

    const nameLength = response[offset++];
    const name = response.slice(offset, offset + nameLength).toString('ascii');
    offset += nameLength;

    const versionLength = response[offset++];
    const version = response.slice(offset, offset + versionLength).toString('ascii');
    offset += versionLength;

    const flagLength = response[offset++];
    const flags = response.slice(offset, offset + flagLength);

    return CommandResult.success({
      name,
      version,
      flags,
    });
  }
}

export interface AppInfo {
  name: string;
  version: string;
  flags: Buffer;
}
```

#### 3.2.3 AppManager 封装

**文件**：`packages/ledger-service/src/app/AppManager.ts`

```typescript
import { DeviceManagementKit } from '@ledgerhq/device-management-kit';
import { OpenAppCommand } from '../commands/OpenAppCommand';
import { GetAppAndVersionCommand } from '../commands/GetAppAndVersionCommand';
import { Observable, from, of, throwError } from 'rxjs';
import { mergeMap, delay, retry, catchError } from 'rxjs/operators';

/**
 * 应用管理器
 *
 * 负责打开、切换、检测应用
 */
export class AppManager {
  constructor(private dmk: DeviceManagementKit) {}

  /**
   * 确保指定应用已打开
   *
   * 流程：
   * 1. 检查当前应用
   * 2. 如果是目标应用，直接返回
   * 3. 如果不是，打开目标应用
   * 4. 等待应用启动
   * 5. 验证应用已打开
   */
  ensureAppOpen(
    sessionId: string,
    targetAppName: string
  ): Observable<void> {
    return from(this.getCurrentApp(sessionId)).pipe(
      mergeMap(currentApp => {
        // 已经是目标应用
        if (currentApp?.name === targetAppName) {
          console.log(`[AppManager] App "${targetAppName}" already open`);
          return of(undefined);
        }

        // 当前在 Dashboard
        if (this.isDashboard(currentApp?.name)) {
          console.log(`[AppManager] Opening app "${targetAppName}" from Dashboard`);
          return this.openApp(sessionId, targetAppName);
        }

        // 当前在其他应用，需要先退出
        console.log(`[AppManager] Closing "${currentApp?.name}" and opening "${targetAppName}"`);
        return this.closeCurrentApp(sessionId).pipe(
          delay(1000), // 等待应用关闭
          mergeMap(() => this.openApp(sessionId, targetAppName))
        );
      }),
      // 验证应用已打开
      mergeMap(() => this.waitForAppOpen(sessionId, targetAppName))
    );
  }

  /**
   * 获取当前打开的应用
   */
  private async getCurrentApp(sessionId: string): Promise<AppInfo | null> {
    try {
      const command = new GetAppAndVersionCommand();
      const result = await this.dmk.sendCommand(sessionId, command);
      return result;
    } catch (error) {
      console.warn('[AppManager] Failed to get current app:', error);
      return null;
    }
  }

  /**
   * 打开应用
   */
  private openApp(sessionId: string, appName: string): Observable<void> {
    return from(
      this.dmk.sendCommand(sessionId, new OpenAppCommand(appName))
    ).pipe(
      catchError(error => {
        if (error.message?.includes('not found')) {
          return throwError(() => new Error(
            `App "${appName}" is not installed on your Ledger device. ` +
            `Please install it using Ledger Live.`
          ));
        }
        if (error.message?.includes('needs upgrade')) {
          return throwError(() => new Error(
            `App "${appName}" needs to be updated. ` +
            `Please update it using Ledger Live.`
          ));
        }
        return throwError(() => error);
      })
    );
  }

  /**
   * 关闭当前应用（返回 Dashboard）
   */
  private closeCurrentApp(sessionId: string): Observable<void> {
    // 通过打开 "BOLOS" 返回 Dashboard
    return from(
      this.dmk.sendCommand(sessionId, new OpenAppCommand('BOLOS'))
    ).pipe(
      catchError(() => of(undefined)) // 忽略错误
    );
  }

  /**
   * 等待应用打开
   */
  private waitForAppOpen(
    sessionId: string,
    targetAppName: string
  ): Observable<void> {
    return from(this.getCurrentApp(sessionId)).pipe(
      mergeMap(currentApp => {
        if (currentApp?.name === targetAppName) {
          return of(undefined);
        }
        return throwError(() => new Error(`App "${targetAppName}" not open`));
      }),
      retry({
        count: 3,
        delay: 1000, // 每秒重试一次
      })
    );
  }

  /**
   * 判断是否在 Dashboard
   */
  private isDashboard(appName?: string): boolean {
    if (!appName) return true;
    return appName === '' || appName === 'BOLOS' || appName.includes('Dashboard');
  }
}

/**
 * 应用名称映射
 */
export const APP_NAME_MAP: Record<string, string> = {
  ETH: 'Ethereum',
  BTC: 'Bitcoin',
  SOL: 'Solana',
  TRX: 'Tron',
  MATIC: 'Polygon',
  BNB: 'Binance Smart Chain',
  AVAX: 'Avalanche',
  // ... 更多链
};
```

#### 3.2.4 在 ChainSigner 中集成

**更新**：`packages/ledger-service/src/signer/SignerEth.ts`

```typescript
import { SignerEth as SDKSignerEth } from '@ledgerhq/device-signer-kit-ethereum';
import { AppManager, APP_NAME_MAP } from '../app/AppManager';
import { withDevice } from '../device/withDevice';
import { firstValueFrom } from 'rxjs';

export class SignerEth {
  constructor(
    private deviceId: string,
    private sessionId: string,
    private appManager: AppManager,
    private sdkSigner: SDKSignerEth
  ) {}

  /**
   * 获取地址（自动打开 Ethereum App）
   */
  async getAddress(
    path: string,
    options?: { checkOnDevice?: boolean }
  ): Promise<AddressResult> {
    return firstValueFrom(
      withDevice(this.deviceId, this.sessionId)((dmk, sid) =>
        // 1. 确保 Ethereum App 打开
        this.appManager.ensureAppOpen(sid, APP_NAME_MAP.ETH).pipe(
          // 2. 获取地址
          mergeMap(() => from(this.sdkSigner.getAddress(path, options)))
        )
      )
    );
  }

  /**
   * 签名交易（自动打开 Ethereum App）
   */
  async signTransaction(path: string, tx: any): Promise<Signature> {
    return firstValueFrom(
      withDevice(this.deviceId, this.sessionId)((dmk, sid) =>
        // 1. 确保 Ethereum App 打开
        this.appManager.ensureAppOpen(sid, APP_NAME_MAP.ETH).pipe(
          // 2. 签名交易
          mergeMap(() => from(this.sdkSigner.signTransaction(path, tx)))
        )
      )
    );
  }

  // ... 其他方法类似
}
```

**关键特性**：
- ✅ **自动打开 App**：所有操作前自动确保正确 App 打开
- ✅ **智能切换**：从 Dashboard 或其他 App 自动切换
- ✅ **错误处理**：App 未安装、需要升级等错误清晰提示
- ✅ **重试机制**：等待 App 启动，自动重试验证

---

### 3.3 完整的签名流程示例

**用户调用**：
```typescript
const service = new LedgerService(webHidTransportFactory);

// 用户只需调用一次 API
const signature = await service.signEthTransaction(
  deviceId,
  "44'/60'/0'/0/0",
  { to: '0x...', value: '1000000000000000000' }
);
```

**内部执行流程**：
```
1. signEthTransaction()
   └─> 加入设备队列（DeviceJobQueue）
       └─> 等待前一个任务完成
           └─> SignerEth.signTransaction()
               └─> withDevice()（确保串行）
                   └─> AppManager.ensureAppOpen("Ethereum")
                       ├─> getCurrentApp() // 检查当前 App
                       ├─> openApp("Ethereum") // 如需要，打开 App
                       └─> waitForAppOpen() // 等待 App 启动
                   └─> sdkSigner.signTransaction() // 执行签名
                       └─> 多个 APDU 交换
                           ├─> 发送交易数据
                           ├─> 用户在设备上确认
                           └─> 接收签名结果
           └─> 返回签名
       └─> 队列继续下一个任务
```

**时序图**：
```
User              LedgerService      JobQueue       AppManager      Device
  |                    |                |               |              |
  |--signEthTx()------>|                |               |              |
  |                    |--enqueue()---->|               |              |
  |                    |                |--wait prev--->|              |
  |                    |                |<--prev done---|              |
  |                    |                |               |              |
  |                    |                |--ensureApp--->|              |
  |                    |                |               |--getApp----->|
  |                    |                |               |<--Dashboard--|
  |                    |                |               |--openApp---->|
  |                    |                |               |              |
  |                    |                |               |<--wait 1s----|
  |                    |                |               |--getApp----->|
  |                    |                |               |<--Ethereum---|
  |                    |                |<--app ready---|              |
  |                    |                |               |              |
  |                    |                |--signTx-------|------------->|
  |                    |                |               |              | (用户确认)
  |                    |                |<--signature---|<-------------|
  |                    |<--result-------|               |              |
  |<--signature--------|                |               |              |
```

---

## 四、技术栈

### 3.1 核心依赖

```json
{
  "dependencies": {
    // New SDK
    "@ledgerhq/device-management-kit": "^0.5.0",
    "@ledgerhq/device-signer-kit-ethereum": "^0.5.0",
    "@ledgerhq/device-signer-kit-bitcoin": "^0.5.0",
    "@ledgerhq/device-signer-kit-solana": "^0.5.0",

    // Legacy SDK
    "@ledgerhq/hw-transport": "^6.31.4",
    "@ledgerhq/hw-app-trx": "^6.28.6",
    "@ledgerhq/hw-app-sui": "^6.28.6",
    "@ledgerhq/hw-app-aptos": "^6.28.6",

    // Transport
    "@ledgerhq/device-transport-kit-web-hid": "^0.5.0",
    "@ledgerhq/device-transport-kit-react-native-ble": "^0.5.0",

    // 工具
    "rxjs": "^7.8.1"
  }
}
```

### 3.2 Monorepo 结构

```
ledger-sdk/
├── packages/
│   ├── ledger-service/           # Service Layer 核心包
│   │   ├── src/
│   │   │   ├── device/
│   │   │   │   └── LedgerDeviceManager.ts
│   │   │   ├── signer/
│   │   │   │   └── ChainSignerFactory.ts
│   │   │   ├── errors/
│   │   │   │   └── LedgerError.ts
│   │   │   ├── types/
│   │   │   │   ├── DeviceFingerprint.ts
│   │   │   │   └── DeviceEvent.ts
│   │   │   └── LedgerService.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── ledger-legacy/            # Legacy SDK 封装（可选）
│       └── src/
│           └── apps/
│               ├── TrxApp.ts
│               └── SuiApp.ts
│
├── demo/
│   ├── browser-extension/        # 浏览器扩展 Demo
│   │   ├── src/
│   │   │   ├── background.ts
│   │   │   ├── popup.tsx
│   │   │   └── setup.html
│   │   └── manifest.json
│   │
│   └── expo-demo/                # React Native Demo
│       ├── src/
│       │   ├── services/
│       │   │   └── ledgerService.ts
│       │   └── screens/
│       │       └── LedgerScreen.tsx
│       └── package.json
│
├── docs/
│   ├── implementation-plan.md    # 本文档
│   ├── device-identity-solution.md
│   └── api-reference.md
│
└── pnpm-workspace.yaml
```

---

## 四、Todo List（渐进式开发）

### 开发原则

1. ✅ **先做好一条链（Ethereum）**：确保核心流程完全跑通
2. ✅ **完善 Demo 自测**：每个功能都要在 Demo 中验证
3. ✅ **设备管理完善**：队列、App 管理、事件通知
4. ✅ **接入真实 App**：在生产环境验证
5. ✅ **渐进式扩展**：其他链按需添加

---

### Phase 1.1: 基础设施 + Ethereum（Week 1，P0）

**目标**：搭建基础架构，实现 Ethereum 完整功能

#### 1.1.1 Monorepo 搭建

- [ ] **初始化项目结构**
  - [ ] 创建 `pnpm-workspace.yaml`
  - [ ] 创建 `packages/ledger-service` 目录
  - [ ] 配置 TypeScript (`tsconfig.json`)
  - [ ] 配置 ESLint + Prettier
  - [ ] 配置 `package.json` 依赖

**验证标准**：`pnpm install` 成功，TypeScript 编译通过

---

#### 1.1.2 核心基础设施

- [ ] **DeviceJobQueue 实现**
  - [ ] 创建 `src/device/DeviceJobQueue.ts`
  - [ ] 实现 `enqueue()` 方法（串行执行）
  - [ ] 实现 `clear()` 和 `clearAll()` 方法
  - [ ] 编写单元测试（模拟队列场景）

- [ ] **withDevice 封装**
  - [ ] 创建 `src/device/withDevice.ts`
  - [ ] 实现队列自动管理
  - [ ] 实现 DMK 单例管理
  - [ ] 编写单元测试

- [ ] **错误处理**
  - [ ] 创建 `src/errors/LedgerError.ts`
  - [ ] 定义 `LedgerErrorCode` 枚举
  - [ ] 实现 `fromSDKError()` 转换方法
  - [ ] 编写单元测试

**验证标准**：所有单元测试通过

---

#### 1.1.3 App 管理器

- [ ] **OpenAppCommand 实现**
  - [ ] 创建 `src/commands/OpenAppCommand.ts`
  - [ ] 实现 APDU 构造（0xe0 0xd8）
  - [ ] 实现响应解析（处理 0x6984, 0x6807 错误）
  - [ ] 编写单元测试

- [ ] **GetAppAndVersionCommand 实现**
  - [ ] 创建 `src/commands/GetAppAndVersionCommand.ts`
  - [ ] 实现 APDU 构造（0xb0 0x01）
  - [ ] 实现响应解析（name, version, flags）
  - [ ] 编写单元测试

- [ ] **AppManager 实现**
  - [ ] 创建 `src/app/AppManager.ts`
  - [ ] 实现 `ensureAppOpen()` 方法
  - [ ] 实现 `getCurrentApp()` 方法
  - [ ] 实现 `openApp()` + `waitForAppOpen()` 流程
  - [ ] 定义 `APP_NAME_MAP` 常量
  - [ ] 编写单元测试（模拟场景）

**验证标准**：单元测试通过，逻辑清晰

---

#### 1.1.4 设备管理器

- [ ] **LedgerDeviceManager 基础**
  - [ ] 创建 `src/device/LedgerDeviceManager.ts`
  - [ ] 实现 `startDiscovery()` / `stopDiscovery()`
  - [ ] 实现 `connectDevice()`（简化版，暂不获取 OS 版本）
  - [ ] 实现 `disconnectDevice()`
  - [ ] 实现 `listConnectedDevices()`
  - [ ] 实现 EventEmitter（`device:connected`, `device:disconnected`）

**验证标准**：可以发现、连接、断开设备

---

#### 1.1.5 Ethereum Signer

- [ ] **SignerEth 实现**
  - [ ] 创建 `src/signer/SignerEth.ts`
  - [ ] 集成 `@ledgerhq/device-signer-kit-ethereum`
  - [ ] 实现 `getAddress()`（集成 AppManager + withDevice）
  - [ ] 实现 `signTransaction()`（集成 AppManager + withDevice）
  - [ ] 实现 `signMessage()`（集成 AppManager + withDevice）
  - [ ] 实现 `signTypedData()`（集成 AppManager + withDevice）

**验证标准**：单元测试通过

---

#### 1.1.6 LedgerService（仅 Ethereum）

- [ ] **LedgerService 实现**
  - [ ] 创建 `src/LedgerService.ts`
  - [ ] 集成 LedgerDeviceManager
  - [ ] 集成 AppManager
  - [ ] 实现 `getEthAddress()` API
  - [ ] 实现 `signEthTransaction()` API
  - [ ] 实现 `signEthMessage()` API
  - [ ] 实现 `signEthTypedData()` API
  - [ ] 实现错误处理和日志

**验证标准**：API 清晰，类型安全

---

### Phase 1.2: Web Demo 自测（Week 1-2，P0）

**目标**：在浏览器环境中完整验证 Ethereum 功能

#### 1.2.1 Web Demo 搭建

- [ ] **创建测试页面**
  - [ ] 创建 `demo/web-test/index.html`
  - [ ] 配置 Vite 开发环境
  - [ ] 引入 `@ledgerhq/device-management-kit` (WebHID)
  - [ ] 初始化 LedgerService

- [ ] **实现测试 UI**
  - [ ] 添加"开始发现"按钮 → 测试 `startDiscovery()`
  - [ ] 显示设备列表 → 测试设备发现
  - [ ] 添加"连接设备"按钮 → 测试 `connectDevice()`
  - [ ] 显示连接状态 → 测试 EventEmitter

**验证标准**：可以发现和连接设备，UI 状态正确

---

#### 1.2.2 Ethereum 功能测试

- [ ] **获取地址测试**
  - [ ] 输入框：derivation path（默认 `44'/60'/0'/0/0`）
  - [ ] 按钮："获取地址"
  - [ ] 显示结果：address, publicKey
  - [ ] ✅ **自测通过**：地址正确显示

- [ ] **签名交易测试**
  - [ ] 输入框：to, value, gasLimit, gasPrice, nonce, chainId
  - [ ] 按钮："签名交易"
  - [ ] 显示结果：signature (r, s, v)
  - [ ] ✅ **自测通过**：设备上显示交易信息，签名成功

- [ ] **签名消息测试**
  - [ ] 输入框：message
  - [ ] 按钮："签名消息"
  - [ ] 显示结果：signature
  - [ ] ✅ **自测通过**：设备上显示消息，签名成功

- [ ] **签名 TypedData 测试**
  - [ ] 输入框：EIP-712 JSON
  - [ ] 按钮："签名 TypedData"
  - [ ] 显示结果：signature
  - [ ] ✅ **自测通过**：设备上显示结构化数据，签名成功

**验证标准**：所有测试用例手动验证通过，无报错

---

#### 1.2.3 设备管理功能测试

- [ ] **App 自动打开测试**
  - [ ] 场景 1：Dashboard → Ethereum App（自动打开）
  - [ ] 场景 2：Bitcoin App → Ethereum App（自动切换）
  - [ ] 场景 3：已在 Ethereum App（跳过打开）
  - [ ] ✅ **自测通过**：App 自动管理正常

- [ ] **队列机制测试**
  - [ ] 快速点击多次"获取地址"按钮
  - [ ] 验证：任务串行执行，不会冲突
  - [ ] 验证：一个失败不影响后续任务
  - [ ] ✅ **自测通过**：队列工作正常

- [ ] **错误处理测试**
  - [ ] 场景 1：设备未连接 → 显示清晰错误
  - [ ] 场景 2：设备锁定 → 提示解锁
  - [ ] 场景 3：App 未安装 → 提示安装
  - [ ] 场景 4：用户拒绝签名 → 显示拒绝错误
  - [ ] ✅ **自测通过**：错误提示友好

**验证标准**：所有场景测试通过，日志清晰

---

### Phase 1.3: React Native Demo 自测（Week 2，P0）

**目标**：在移动端环境中完整验证 Ethereum 功能

#### 1.3.1 RN Demo 搭建

- [ ] **配置 BLE Transport**
  - [ ] 更新 `demo/expo-demo/package.json`
  - [ ] 配置 Buffer polyfill
  - [ ] 初始化 LedgerService (RNBleTransportFactory)

- [ ] **BLE 权限处理**
  - [ ] Android: 请求 BLUETOOTH_SCAN, BLUETOOTH_CONNECT, FINE_LOCATION
  - [ ] iOS: 配置 Info.plist

- [ ] **创建测试界面**
  - [ ] Tab 1: "New SDK (Ledger Service)"
  - [ ] Tab 2: "Old SDK" (保留原有)

**验证标准**：权限请求正常，BLE 可用

---

#### 1.3.2 Ethereum 功能测试（移动端）

- [ ] **设备发现和连接**
  - [ ] 按钮："开始扫描"
  - [ ] 显示设备列表（name, rssi）
  - [ ] 按钮："连接设备"
  - [ ] ✅ **自测通过**：Android 和 iOS 真机测试通过

- [ ] **获取地址测试**
  - [ ] 输入：derivation path
  - [ ] 按钮："获取 ETH 地址"
  - [ ] 显示：address
  - [ ] ✅ **自测通过**：地址正确

- [ ] **签名交易测试**
  - [ ] 预设交易数据
  - [ ] 按钮："签名交易"
  - [ ] 显示：signature
  - [ ] ✅ **自测通过**：签名成功

- [ ] **签名消息测试**
  - [ ] 输入：message
  - [ ] 按钮："签名消息"
  - [ ] 显示：signature
  - [ ] ✅ **自测通过**：签名成功

**验证标准**：Android 和 iOS 真机测试全部通过

---

### Phase 2: 浏览器扩展集成（Week 3，P0）

**目标**：将 LedgerService 集成到浏览器扩展中

- [ ] **Background Worker**
  - [ ] 初始化 LedgerService (WebHID)
  - [ ] 实现消息监听器（`chrome.runtime.onMessage`）
  - [ ] 转发设备事件到 Popup
  - [ ] 处理所有 Ethereum 操作

- [ ] **Setup Page**
  - [ ] 创建设备授权页面
  - [ ] 触发 WebHID 权限弹窗

- [ ] **Popup UI**
  - [ ] 设备列表和连接 UI
  - [ ] Ethereum 功能测试 UI
  - [ ] ✅ **自测通过**：扩展中所有功能正常

**验证标准**：浏览器扩展可用，Ethereum 功能完整

---

### Phase 3: 设备验证（Week 4，P1）

**目标**：实现设备身份验证（Phase 4 功能前置）

- [ ] **GetOsVersion 集成**
  - [ ] 在 `connectDevice()` 中调用 GetOsVersion
  - [ ] 更新 DeviceFingerprint 结构（添加 seTargetId, hwVersion, seVersion）
  - [ ] ✅ **自测通过**：设备指纹正确获取

- [ ] **App Layer 示例**
  - [ ] 在 Web Demo 中实现账户-设备绑定
  - [ ] 签名时验证设备身份
  - [ ] 实现会话缓存优化
  - [ ] ✅ **自测通过**：多设备场景正常

**验证标准**：设备验证准确率 100%

---

### Phase 4: 扩展其他链（Week 5+，P2）

**目标**：渐进式添加其他链支持

#### 4.1 Bitcoin 集成

- [ ] **SignerBtc 实现**
  - [ ] 实现 `getAddress()`
  - [ ] 实现 `signPSBT()`
  - [ ] 集成 AppManager（打开 Bitcoin App）
  - [ ] 集成 withDevice（队列管理）

- [ ] **LedgerService 扩展**
  - [ ] 添加 `getBtcAddress()` API
  - [ ] 添加 `signBtcPSBT()` API

- [ ] **Demo 测试**
  - [ ] Web Demo 添加 Bitcoin Tab
  - [ ] RN Demo 添加 Bitcoin Tab
  - [ ] ✅ **自测通过**

---

#### 4.2 Solana 集成

- [ ] **SignerSol 实现**
  - [ ] 实现 `getAddress()`
  - [ ] 实现 `signTransaction()`
  - [ ] 实现 `signAllTransactions()`
  - [ ] 集成 AppManager（打开 Solana App）

- [ ] **LedgerService 扩展**
  - [ ] 添加 Solana API

- [ ] **Demo 测试**
  - [ ] ✅ **自测通过**

---

#### 4.3 Tron 集成（Legacy SDK）

- [ ] **TrxApp 封装**
  - [ ] 封装 `@ledgerhq/hw-app-trx`
  - [ ] 集成 AppManager
  - [ ] 集成 withDevice

- [ ] **LedgerService 扩展**
  - [ ] 添加 Tron API

- [ ] **Demo 测试**
  - [ ] ✅ **自测通过**

---

### Phase 5: 生产环境接入（Week 6+，P0）

**目标**：将 LedgerService 集成到真实 App

- [ ] **NPM 发布**
  - [ ] 配置 `package.json`（version, exports, types）
  - [ ] 编写 README.md
  - [ ] 发布到 NPM（`@your-org/ledger-service`）

- [ ] **接入真实 App**
  - [ ] 浏览器扩展集成
  - [ ] 移动端 App 集成
  - [ ] ✅ **生产验证**：真实用户场景测试

- [ ] **监控和优化**
  - [ ] 添加错误上报
  - [ ] 性能监控
  - [ ] 用户反馈收集

**验证标准**：生产环境稳定运行

### Phase 2: 浏览器扩展（优先级：P0）

- [ ] **Background Worker**
  - [ ] 初始化 LedgerService（webHidTransportFactory）
  - [ ] 实现消息监听器（`chrome.runtime.onMessage`）
  - [ ] 实现设备事件转发
  - [ ] 处理所有操作类型（连接、获取地址、签名）

- [ ] **Setup Page**
  - [ ] 创建设备授权页面
  - [ ] 触发 WebHID 权限弹窗
  - [ ] 引导用户完成授权

- [ ] **Popup UI**
  - [ ] 实现设备列表 UI
  - [ ] 实现连接设备功能
  - [ ] 实现获取地址功能
  - [ ] 实现签名功能
  - [ ] 实现错误提示

- [ ] **测试**
  - [ ] 手动测试完整流程
  - [ ] 测试 WebHID 权限流程
  - [ ] 测试多种链（ETH, BTC, TRX）

### Phase 3: React Native（优先级：P0）

- [ ] **Service 初始化**
  - [ ] 配置 Buffer polyfill（`react-native-get-random-values`）
  - [ ] 初始化 LedgerService（RNBleTransportFactory）

- [ ] **BLE 权限**
  - [ ] 实现 Android 权限请求
  - [ ] 配置 iOS Info.plist

- [ ] **UI 组件**
  - [ ] 实现设备发现 UI
  - [ ] 实现连接设备功能
  - [ ] 实现获取地址功能
  - [ ] 实现签名功能

- [ ] **测试**
  - [ ] 真机测试 BLE 发现和连接
  - [ ] 测试多种链（ETH, BTC, SOL）

### Phase 4: 设备校验（优先级：P1，后期优化）

- [ ] **GetOsVersion 集成**
  - [ ] 在 `connectDevice` 中调用 GetOsVersion
  - [ ] 更新 DeviceFingerprint 结构

- [ ] **App Layer 地址绑定**
  - [ ] 实现 WalletAccount 数据结构
  - [ ] 创建地址时保存设备信息
  - [ ] 实现数据库存储

- [ ] **设备验证逻辑**
  - [ ] 实现单设备验证策略
  - [ ] 实现多设备筛选策略
  - [ ] 实现地址验证
  - [ ] 实现会话缓存

- [ ] **固件升级处理**
  - [ ] 检测固件升级
  - [ ] 自动更新账户设备信息

---

## 五、关键决策记录

### 5.1 为什么设备校验放在 Phase 4？

**原因**：
1. **业务逻辑优先**：先确保核心流程（连接、签名）能跑通
2. **单设备场景足够**：初期大部分用户只有一个 Ledger
3. **复杂度可控**：设备校验涉及地址验证、多设备筛选，逻辑复杂
4. **迭代灵活**：后期可以根据实际需求调整验证策略

### 5.2 为什么不在 Service Layer 实现设备校验？

**原因**：
1. **职责分离**：Service Layer 专注于 SDK 调用，不管理业务状态
2. **App 层更灵活**：设备绑定、地址验证策略由 App 层决定
3. **数据存储**：账户-设备绑定关系存储在 App 数据库

### 5.3 硬件指纹的作用

**定位**：辅助筛选，不是唯一标识

- ✅ **快速筛选**：通过 `modelId + seTargetId` 过滤候选设备
- ✅ **提升性能**：减少地址验证次数
- ❌ **不可靠**：同型号设备的硬件指纹可能相同
- ✅ **最终验证**：地址验证才是唯一可靠的方式

---

## 六、风险与缓解

### 6.1 风险：Buffer polyfill 问题（React Native）

**影响**：React Native 环境缺少 Buffer，导致 SDK 调用失败

**缓解**：
- ✅ 在 `index.ts` 第一行导入 `react-native-get-random-values`
- ✅ 配置 `global.Buffer = Buffer`
- ✅ 在 Phase 3 早期测试

### 6.2 风险：WebHID 权限问题（浏览器扩展）

**影响**：Popup 无法触发 WebHID 设备授权弹窗

**缓解**：
- ✅ 使用 Setup Page 完成设备授权
- ✅ Background 使用 `listenToAvailableDevices` 获取已授权设备
- ✅ 在 Phase 2 早期测试

### 6.3 风险：多设备场景复杂度

**影响**：多个同型号设备无法通过硬件指纹区分

**缓解**：
- ✅ Phase 1-3 只支持单设备，降低复杂度
- ✅ Phase 4 通过地址验证确认设备身份
- ✅ 提供清晰的错误提示

---

## 七、成功标准

### Phase 1 完成标准

- ✅ Service Layer 所有 API 实现完成
- ✅ 单元测试覆盖率 > 80%
- ✅ 集成测试通过（真实设备）

### Phase 2 完成标准

- ✅ 浏览器扩展可以连接 Ledger
- ✅ 可以获取 ETH、BTC、TRX 地址
- ✅ 可以签名交易和消息
- ✅ WebHID 权限流程顺畅

### Phase 3 完成标准

- ✅ React Native 可以通过 BLE 连接 Ledger
- ✅ 可以获取 ETH、SOL 地址
- ✅ 可以签名交易
- ✅ Android 和 iOS 真机测试通过

### Phase 4 完成标准

- ✅ 支持多设备场景
- ✅ 设备验证准确率 100%
- ✅ 会话缓存正常工作
- ✅ 固件升级自动处理

---

## 八、时间线

| Phase | 任务 | 时间 | 里程碑 |
|-------|------|------|--------|
| Phase 1 | Service Layer | Week 1-2 | 核心 API 完成 |
| Phase 2 | 浏览器扩展 | Week 3 | 扩展 Demo 可用 |
| Phase 3 | React Native | Week 4 | RN Demo 可用 |
| Phase 4 | 设备校验 | Week 5-6 | 多设备支持 |

**总计**：6 周

---

## 九、下一步行动

### 立即开始（Week 1）

1. ✅ **搭建 Monorepo**
   ```bash
   mkdir -p packages/ledger-service/src
   pnpm init
   pnpm add -D typescript @types/node
   ```

2. ✅ **实现 LedgerDeviceManager**
   - 参考 `demo/expo-demo/src/utils/dmk.ts`
   - 添加 EventEmitter

3. ✅ **实现 ChainSignerFactory**
   - 集成 `@ledgerhq/device-signer-kit-ethereum`
   - 添加 Signer 缓存

4. ✅ **编写第一个测试**
   ```typescript
   test('should connect to device', async () => {
     const service = new LedgerService(webHidTransportFactory);
     const fingerprint = await service.connectDevice('test-device-id');
     expect(fingerprint.deviceId).toBe('test-device-id');
   });
   ```
