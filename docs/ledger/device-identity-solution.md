# Ledger 设备身份识别方案（正确版本）

## 一、问题分析

### 1.1 Ledger 的隐私设计

**关键发现**：
- ❌ Ledger **故意不提供**跨会话的唯一序列号（隐私特性）
- ❌ `seTargetId` 是**按型号固定的**，不是每个设备唯一的
  - 所有 Nano X: `855638020`
  - 所有 Nano S: `858783748`
  - 所有 Stax: `857735172`
- ❌ `hwVersion` 同批次可能相同
- ❌ `seVersion` 固件升级后会变化

### 1.2 BLE UUID/MAC 地址的局限性

**问题：能否使用蓝牙的 UUID 或 MAC 地址来唯一标识设备?**

根据 Ledger SDK 的源码分析（来自 `ledger-live/libs/ledger-live-common/src/ble/types.ts:7`）：

```typescript
export type TransportBleDevice = {
  // Device identifier: MAC address on Android and UUID on iOS.
  id: string;
  // ...
};
```

**关键发现：BLE device.id 的跨平台差异**

| 平台 | device.id 是什么 | 是否持久化 | 能否跨会话使用 |
|------|-----------------|-----------|--------------|
| **Android** | MAC 地址 | ✅ 是 | ✅ 可以（但有隐私问题） |
| **iOS** | UUID | ❌ 否 | ❌ **每次配对都会变** |
| **Web Bluetooth** | UUID | ❌ 否 | ❌ **每次配对都会变** |

#### iOS/Web 的 UUID 问题

在 iOS 和 Web Bluetooth 中，`device.id` 是系统生成的 **临时 UUID**：

- 每次蓝牙配对后，系统会生成一个新的 UUID
- 用户取消配对再重新配对，UUID 完全不同
- 无法用于跨会话的设备识别

#### Android MAC 地址的问题

虽然 Android 可以获取 MAC 地址，但也有严重问题：

1. **隐私问题**：Android 10+ 开始限制 MAC 地址访问（随机化 MAC）
2. **权限问题**：需要 `ACCESS_FINE_LOCATION` 权限
3. **不可靠**：某些设备可能返回随机化的 MAC 地址

#### 结论：BLE UUID/MAC 不能作为可靠标识符

```typescript
// ❌ 错误做法：使用 BLE device.id 作为设备标识
const deviceId = bleDevice.id;  // iOS: UUID 会变化
                                 // Android: MAC 地址可能被随机化
accountInfo.bleDeviceId = deviceId;  // ❌ 下次配对后无法匹配

// ✅ 正确做法：使用地址验证
const addressResult = await getEthAddress(bleDevice.id, derivationPath);
if (addressResult.address === accountInfo.address) {
  // ✅ 确认是同一个硬件钱包
}
```

**为什么 BLE UUID/MAC 不可靠？**

- iOS/Web：UUID 每次配对都会变化
- Android：MAC 地址可能被随机化（隐私保护）
- Ledger 设计：故意不提供持久化的硬件序列号

**唯一可靠的方法：地址验证**

设备的地址是由 **助记词 + 派生路径** 决定的，这是设备身份的唯一可靠证明。

### 1.3 Ledger Live 的设备名称辅助匹配策略

**关键发现：Ledger Live 也面临 BLE UUID 变化问题！**

Ledger Live 的官方实现使用了**三层设备匹配策略**来解决 iOS/Web 的 UUID 不稳定问题：

#### Ledger Live 的实现（matchDevicesByNameOrId.ts）

**源码位置**：
- 文件路径：`ledger-live/libs/live-dmk-mobile/src/utils/matchDevicesByNameOrId.ts`
- 项目仓库：[ledger-live (Ledger 官方)](https://github.com/LedgerHQ/ledger-live)
- 完整路径：[查看源码](https://github.com/LedgerHQ/ledger-live/blob/develop/libs/live-dmk-mobile/src/utils/matchDevicesByNameOrId.ts)

```typescript
// 来源: ledger-live/libs/live-dmk-mobile/src/utils/matchDevicesByNameOrId.ts
// 本地路径（如果克隆了 ledger-live 仓库）:
// ../ledger-live/libs/live-dmk-mobile/src/utils/matchDevicesByNameOrId.ts

/**
 * 尝试在新设备列表中找到匹配的设备
 *
 * 策略：
 * 1. 优先通过 deviceId 匹配（Android MAC 地址）
 * 2. deviceId 失效时，通过设备名称匹配（iOS/Web UUID 变化场景）
 * 3. 多个候选设备时，让用户手动选择
 */
export function findMatchingNewDevice(
  oldDevice: DeviceBaseInfo,
  newDevices: DeviceBaseInfo[]
): DeviceBaseInfo | null {
  // 1. 尝试通过 deviceId 匹配（最精确）
  const byId = newDevices.find(newDevice =>
    matchDeviceByDeviceId({ deviceA: oldDevice, deviceB: newDevice })
  );

  if (byId) {
    return byId;
  }

  // 2. deviceId 失效，通过设备名称匹配（辅助方案）
  const byName = newDevices.find(newDevice =>
    matchDeviceByName({ oldDevice, newDevice })
  );

  return byName ?? null;
}

/**
 * 通过设备名称匹配
 *
 * Ledger 设备名称包含 4 位 HEX 标识符
 */
function matchDeviceByName({
  oldDevice,
  newDevice,
}: {
  oldDevice: DeviceBaseInfo;
  newDevice: DeviceBaseInfo;
}): boolean {
  const oldName = oldDevice.deviceName || "";
  const newName = newDevice.deviceName || "";

  // 旧格式: "Ledger Nano X 123A"
  // 新格式: "123A" (仅 4 位 HEX 标识符)

  if (oldName.length >= 4 && newName.length >= 4) {
    // 提取设备名称的最后 4 位字符进行匹配
    const oldSuffix = oldName.slice(-4);
    const newSuffix = newName.slice(-4);

    return oldSuffix === newSuffix;
  }

  return false;
}
```

**相关类型定义**：
- `DeviceBaseInfo`: `ledger-live/libs/live-dmk-mobile/src/types.ts`
- `matchDeviceByDeviceId`: `ledger-live/libs/live-dmk-mobile/src/utils/matchDevicesByNameOrId.ts`

#### 设备名称格式

Ledger 设备的蓝牙名称包含一个 **4 位 HEX 标识符**：

| 设备型号 | 设备名称示例 | 说明 |
|---------|-------------|------|
| **Nano X (旧格式)** | `Ledger Nano X 123A` | 包含型号名称 + 4位HEX |
| **Nano X (新格式)** | `123A` | 仅包含 4位HEX |
| **Nano S Plus** | `Ledger S Plus 456B` | 包含型号名称 + 4位HEX |
| **Stax** | `789C` | 仅包含 4位HEX |

**关键特性**：
- ✅ 4位HEX标识符在设备生命周期内**固定不变**
- ✅ 不同设备有不同的4位标识符
- ✅ 可以作为 BLE UUID 失效后的**辅助匹配依据**
- ⚠️ 理论上可能冲突（16^4 = 65536 种组合），但概率极低

#### 使用场景

**场景 1: Android 场景（MAC 地址可用）**
```typescript
// 用户上次连接设备
const savedDevice = {
  deviceId: "AA:BB:CC:DD:EE:FF",  // MAC 地址
  deviceName: "Ledger Nano X 123A"
};

// 重新扫描到设备
const scannedDevice = {
  deviceId: "AA:BB:CC:DD:EE:FF",  // MAC 地址不变
  deviceName: "Ledger Nano X 123A"
};

// ✅ 通过 deviceId 精确匹配
```

**场景 2: iOS/Web 场景（UUID 变化）**
```typescript
// 用户上次连接设备
const savedDevice = {
  deviceId: "ABC123-DEF456",      // iOS UUID（临时）
  deviceName: "Ledger Nano X 123A"
};

// 用户取消配对后重新配对
const scannedDevice = {
  deviceId: "XYZ789-NEW111",      // ❌ UUID 完全不同！
  deviceName: "Ledger Nano X 123A" // ✅ 设备名称包含相同的 "123A"
};

// ❌ deviceId 匹配失败
// ✅ 设备名称匹配成功（通过 "123A" 识别）
```

**场景 3: 多个候选设备**
```typescript
// 扫描到多个 Nano X
const scannedDevices = [
  { deviceId: "NEW-UUID-1", deviceName: "123A" },
  { deviceId: "NEW-UUID-2", deviceName: "456B" },
];

// 通过设备名称 "123A" 识别出正确的设备
const matched = findMatchingNewDevice(savedDevice, scannedDevices);
// => { deviceId: "NEW-UUID-1", deviceName: "123A" }
```

#### 三层匹配策略总结

| 优先级 | 匹配方式 | 可靠性 | 使用场景 | 局限性 |
|-------|---------|-------|---------|-------|
| **1** | deviceId 匹配 | ⭐⭐⭐⭐⭐ | Android MAC 地址 | iOS/Web UUID 会变化 |
| **2** | 设备名称匹配 | ⭐⭐⭐⭐ | iOS/Web UUID 失效时 | 理论上可能冲突（概率极低）|
| **3** | 地址验证 | ⭐⭐⭐⭐⭐ | 最终确认设备身份 | 需要用户交互（打开App）|

#### 为什么需要设备名称匹配？

1. **解决 iOS/Web UUID 变化问题**
   - iOS/Web 的 BLE UUID 每次配对都会变化
   - 设备名称中的 4位HEX 标识符固定不变
   - 作为 deviceId 失效后的辅助匹配手段

2. **改善用户体验**
   - 减少用户手动选择设备的频率
   - 自动识别大部分场景下的设备重连

3. **Ledger Live 的生产实践**
   - 这是 Ledger 官方 App 的真实方案
   - 已在数百万用户中验证有效

### 1.4 真实场景问题

```typescript
用户有 2 个 Nano X：
- Nano X #1: seTargetId=855638020, hwVersion="01", seVersion="2.2.3"
- Nano X #2: seTargetId=855638020, hwVersion="01", seVersion="2.2.3"

硬件指纹哈希完全相同！"855638020-01-2.2.3"
```

**无法通过硬件指纹区分两个同型号的设备。**

---

## 二、正确的解决方案

### 2.1 核心思路

**既然硬件层面无法唯一标识设备，我们在 App 层建立"设备 ↔ 地址"的绑定关系。**

关键点：
1. ✅ 用户创建地址时，**记录该地址来自哪个设备**
2. ✅ 签名时，通过**地址验证**确认当前连接的设备是正确的
3. ✅ 支持多设备场景：让用户手动选择
4. ✅ 智能优化：只在必要时才验证地址

### 2.2 方案详解

#### 阶段 1: 创建地址时建立绑定

```typescript
interface WalletAccount {
  address: string;
  chain: string;
  derivationPath: string;

  // 设备信息（辅助识别）
  deviceInfo: {
    modelId: string;           // "nanoX", "nanoS"
    seTargetId: number;        // 855638020
    hwVersion: string;         // "01"
    seVersion: string;         // "2.2.3" (可能变化)
    createdAt: number;         // 创建时间戳
  };
}

/**
 * 创建地址流程
 */
async function createAddress(deviceId: string, chain: string, path: string) {
  // 1. 获取设备指纹（辅助信息）
  const fingerprint = ledgerService.deviceManager.getDeviceFingerprint(deviceId);

  // 2. 获取地址（这是唯一的绑定依据）
  const addressResult = await ledgerService.getEthAddress(deviceId, path, {
    checkOnDevice: true  // 让用户在设备上确认
  });

  // 3. 存储账户信息
  const account: WalletAccount = {
    address: addressResult.address,
    chain,
    derivationPath: path,
    deviceInfo: {
      modelId: fingerprint.modelId,
      seTargetId: fingerprint.seTargetId,
      hwVersion: fingerprint.hwVersion,
      seVersion: fingerprint.seVersion,
      createdAt: Date.now(),
    },
  };

  await saveAccountToDatabase(account);

  return account;
}
```

#### 阶段 2: 签名时的设备验证策略

```typescript
/**
 * 智能设备验证策略
 */
async function signTransactionWithSmartVerification(
  account: WalletAccount,
  tx: any
): Promise<Signature> {
  const connectedDevices = ledgerService.listConnectedDevices();

  if (connectedDevices.length === 0) {
    throw new Error('No Ledger device connected');
  }

  // 策略 1: 只有一个设备连接 + 型号匹配 → 直接验证地址
  if (connectedDevices.length === 1) {
    const device = connectedDevices[0];

    // 检查型号是否匹配
    if (device.modelId !== account.deviceInfo.modelId) {
      throw new Error(
        `Wrong device model! Expected ${account.deviceInfo.modelId}, ` +
        `but got ${device.modelId}`
      );
    }

    // 验证地址（确保是正确的设备）
    return await verifyAndSign(device, account, tx);
  }

  // 策略 2: 多个设备连接 → 先按硬件指纹筛选候选设备
  const candidates = connectedDevices.filter(device =>
    device.seTargetId === account.deviceInfo.seTargetId &&
    device.modelId === account.deviceInfo.modelId
  );

  if (candidates.length === 0) {
    throw new Error(
      `No matching device found. Expected ${account.deviceInfo.modelId}`
    );
  }

  if (candidates.length === 1) {
    // 只有一个候选设备，验证地址
    return await verifyAndSign(candidates[0], account, tx);
  }

  // 策略 3: 多个候选设备 → 让用户选择
  const selectedDevice = await showDeviceSelectionDialog({
    candidates,
    account,
    message: 'Multiple Ledger devices detected. Please select the correct one:',
  });

  return await verifyAndSign(selectedDevice, account, tx);
}

/**
 * 验证地址并签名
 */
async function verifyAndSign(
  device: DeviceFingerprint,
  account: WalletAccount,
  tx: any
): Promise<Signature> {
  // 1. 验证地址（不在设备上显示，静默验证）
  const addressResult = await ledgerService.getEthAddress(
    device.deviceId,
    account.derivationPath,
    { checkOnDevice: false }  // 静默验证
  );

  if (addressResult.address.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(
      'Device verification failed! The connected device does not own this address.\n' +
      'Please connect the correct Ledger device.'
    );
  }

  // 2. 地址验证通过，执行签名
  return await ledgerService.signEthTransaction(
    device.deviceId,
    account.derivationPath,
    tx
  );
}
```

---

## 三、优化：减少地址验证次数

### 3.1 会话缓存

在同一个 App 会话中，缓存已验证的设备：

```typescript
class DeviceVerificationCache {
  // deviceId -> Set<accountAddress>
  private verifiedDevices = new Map<string, Set<string>>();

  /**
   * 标记设备已验证某个地址
   */
  markVerified(deviceId: string, address: string): void {
    if (!this.verifiedDevices.has(deviceId)) {
      this.verifiedDevices.set(deviceId, new Set());
    }
    this.verifiedDevices.get(deviceId)!.add(address.toLowerCase());
  }

  /**
   * 检查设备是否已验证该地址
   */
  isVerified(deviceId: string, address: string): boolean {
    return this.verifiedDevices.get(deviceId)?.has(address.toLowerCase()) || false;
  }

  /**
   * 清除设备缓存（设备断开时调用）
   */
  clearDevice(deviceId: string): void {
    this.verifiedDevices.delete(deviceId);
  }

  /**
   * 清除所有缓存
   */
  clearAll(): void {
    this.verifiedDevices.clear();
  }
}

const verificationCache = new DeviceVerificationCache();

/**
 * 优化后的验证逻辑
 */
async function verifyAndSignOptimized(
  device: DeviceFingerprint,
  account: WalletAccount,
  tx: any
): Promise<Signature> {
  // 检查缓存：如果本会话中已验证过，跳过验证
  if (verificationCache.isVerified(device.deviceId, account.address)) {
    console.log('[Optimization] Skipping address verification (cached)');
    return await ledgerService.signEthTransaction(
      device.deviceId,
      account.derivationPath,
      tx
    );
  }

  // 首次验证：验证地址
  const addressResult = await ledgerService.getEthAddress(
    device.deviceId,
    account.derivationPath,
    { checkOnDevice: false }
  );

  if (addressResult.address.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error('Device verification failed!');
  }

  // 验证通过，加入缓存
  verificationCache.markVerified(device.deviceId, account.address);

  // 执行签名
  return await ledgerService.signEthTransaction(
    device.deviceId,
    account.derivationPath,
    tx
  );
}

// 监听设备断开事件，清除缓存
ledgerService.onDeviceEvent('device:disconnected', ({ deviceId }) => {
  verificationCache.clearDevice(deviceId);
});
```

### 3.2 固件升级处理

用户升级固件后，`seVersion` 变化，但设备仍然是同一个：

```typescript
/**
 * 检测固件升级并更新账户信息
 */
async function handleFirmwareUpgrade(account: WalletAccount): Promise<boolean> {
  const connectedDevices = ledgerService.listConnectedDevices();

  // 查找相同 seTargetId + modelId，但 seVersion 不同的设备
  const potentialMatch = connectedDevices.find(device =>
    device.seTargetId === account.deviceInfo.seTargetId &&
    device.modelId === account.deviceInfo.modelId &&
    device.seVersion !== account.deviceInfo.seVersion
  );

  if (!potentialMatch) {
    return false;
  }

  // 通过地址验证确认是同一设备
  try {
    const addressResult = await ledgerService.getEthAddress(
      potentialMatch.deviceId,
      account.derivationPath,
      { checkOnDevice: false }
    );

    if (addressResult.address.toLowerCase() === account.address.toLowerCase()) {
      // 确认是同一设备，更新账户的设备信息
      account.deviceInfo = {
        modelId: potentialMatch.modelId,
        seTargetId: potentialMatch.seTargetId,
        hwVersion: potentialMatch.hwVersion,
        seVersion: potentialMatch.seVersion,  // 更新固件版本
        createdAt: account.deviceInfo.createdAt,
      };

      await updateAccountInDatabase(account);
      console.log(`Device firmware upgraded: ${account.deviceInfo.seVersion}`);

      return true;
    }
  } catch (error) {
    console.error('Firmware upgrade detection failed:', error);
  }

  return false;
}
```

---

## 四、完整的签名流程

```typescript
/**
 * 完整的签名流程（含优化）
 */
async function signTransaction(
  account: WalletAccount,
  tx: any
): Promise<Signature> {
  // Step 1: 获取所有已连接设备
  const connectedDevices = ledgerService.listConnectedDevices();

  if (connectedDevices.length === 0) {
    throw new LedgerError(
      LedgerErrorCode.DEVICE_NOT_CONNECTED,
      'Please connect your Ledger device'
    );
  }

  // Step 2: 根据设备数量和型号选择验证策略
  let targetDevice: DeviceFingerprint | null = null;

  if (connectedDevices.length === 1) {
    // 只有一个设备
    const device = connectedDevices[0];

    if (device.modelId !== account.deviceInfo.modelId) {
      throw new LedgerError(
        LedgerErrorCode.WRONG_DEVICE_MODEL,
        `Wrong device! Expected ${account.deviceInfo.modelId}, got ${device.modelId}`
      );
    }

    targetDevice = device;

  } else {
    // 多个设备：先筛选候选
    const candidates = connectedDevices.filter(d =>
      d.modelId === account.deviceInfo.modelId &&
      d.seTargetId === account.deviceInfo.seTargetId
    );

    if (candidates.length === 0) {
      throw new LedgerError(
        LedgerErrorCode.DEVICE_NOT_FOUND,
        `No ${account.deviceInfo.modelId} device found`
      );
    }

    if (candidates.length === 1) {
      targetDevice = candidates[0];
    } else {
      // 多个候选设备，让用户选择
      targetDevice = await showDeviceSelectionDialog(candidates, account);
    }
  }

  // Step 3: 验证地址（带缓存优化）
  if (!verificationCache.isVerified(targetDevice.deviceId, account.address)) {
    // 检查是否固件升级
    if (targetDevice.seVersion !== account.deviceInfo.seVersion) {
      await handleFirmwareUpgrade(account);
    }

    // 验证地址
    const addressResult = await ledgerService.getEthAddress(
      targetDevice.deviceId,
      account.derivationPath,
      { checkOnDevice: false }
    );

    if (addressResult.address.toLowerCase() !== account.address.toLowerCase()) {
      throw new LedgerError(
        LedgerErrorCode.ADDRESS_MISMATCH,
        'Device verification failed! This device does not own this address.'
      );
    }

    // 验证通过，加入缓存
    verificationCache.markVerified(targetDevice.deviceId, account.address);
  }

  // Step 4: 执行签名
  return await ledgerService.signEthTransaction(
    targetDevice.deviceId,
    account.derivationPath,
    tx
  );
}
```

---

## 五、用户体验优化

### 5.1 设备选择对话框

当有多个候选设备时，显示友好的选择界面：

```typescript
async function showDeviceSelectionDialog(
  candidates: DeviceFingerprint[],
  account: WalletAccount
): Promise<DeviceFingerprint> {
  // 对每个候选设备，静默验证地址
  const verificationResults = await Promise.all(
    candidates.map(async (device) => {
      try {
        const result = await ledgerService.getEthAddress(
          device.deviceId,
          account.derivationPath,
          { checkOnDevice: false }
        );

        return {
          device,
          matches: result.address.toLowerCase() === account.address.toLowerCase(),
          error: null,
        };
      } catch (error) {
        return {
          device,
          matches: false,
          error: error.message,
        };
      }
    })
  );

  // 找到匹配的设备
  const matchedDevice = verificationResults.find(r => r.matches);

  if (matchedDevice) {
    // 自动选择匹配的设备
    console.log('[Auto-selected] Found matching device');
    verificationCache.markVerified(matchedDevice.device.deviceId, account.address);
    return matchedDevice.device;
  }

  // 没有匹配的设备，显示错误
  throw new LedgerError(
    LedgerErrorCode.NO_MATCHING_DEVICE,
    'None of the connected devices own this address.\n' +
    'Please connect the correct Ledger device.'
  );
}
```

### 5.2 UX 流程对比

| 场景 | 传统方案 | 优化方案 |
|------|---------|---------|
| **单设备场景** | 连接 → 打开 App → 验证地址 → 签名 | 连接 → 验证地址（首次）→ 签名 |
| **多设备场景** | 用户手动选择 → 验证地址 → 签名 | 自动验证所有设备 → 自动选择匹配的 |
| **重复签名** | 每次都验证地址 | 使用缓存，跳过验证 |
| **固件升级** | 手动更新账户信息 | 自动检测并更新 |

---

## 六、总结

### 6.1 为什么这个方案是正确的？

1. ✅ **承认现实**：Ledger 故意不提供唯一序列号，我们无法绕过这个限制
2. ✅ **地址是唯一的绑定**：派生路径 + 助记词 → 地址，地址是设备身份的唯一证明
3. ✅ **智能优化**：通过缓存减少验证次数，不影响 UX
4. ✅ **支持多设备**：自动验证并选择正确的设备
5. ✅ **处理固件升级**：自动检测并更新账户信息

### 6.2 核心设计原则

```
硬件指纹（辅助筛选）+ 地址验证（最终确认）= 可靠的设备识别
```

- **硬件指纹**（`seTargetId + modelId`）：用于快速筛选候选设备
- **地址验证**：唯一可靠的设备身份确认方式
- **会话缓存**：优化重复签名的性能

### 6.3 关键技术点

1. **创建地址时建立绑定**：记录设备信息
2. **签名时智能验证**：根据设备数量选择策略
3. **会话缓存**：避免重复验证
4. **自动处理固件升级**：检测并更新设备信息
5. **多设备自动选择**：静默验证所有候选设备

### 6.4 最终优势

- ✅ **可靠**：地址验证是唯一可靠的设备识别方式
- ✅ **快速**：会话缓存减少验证次数
- ✅ **智能**：自动处理多设备和固件升级
- ✅ **用户友好**：自动选择正确的设备，无需用户手动判断
