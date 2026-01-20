# Ledger 源码参考索引

本文档汇总了实现 Ledger 硬件钱包集成时的关键源码参考位置。

## 一、Ledger Live 官方仓库

**GitHub 仓库**：[LedgerHQ/ledger-live](https://github.com/LedgerHQ/ledger-live)

**本地克隆路径**（假设与本项目平级）：`../ledger-live/`

---

## 二、设备识别与管理

### 2.1 设备名称匹配策略

**功能**：通过设备名称中的 4位HEX 标识符进行辅助匹配，解决 iOS/Web BLE UUID 变化问题。

**源码位置**：
- **文件路径**：`ledger-live/libs/live-dmk-mobile/src/utils/matchDevicesByNameOrId.ts`
- **GitHub 链接**：[查看源码](https://github.com/LedgerHQ/ledger-live/blob/develop/libs/live-dmk-mobile/src/utils/matchDevicesByNameOrId.ts)
- **本地路径**：`../ledger-live/libs/live-dmk-mobile/src/utils/matchDevicesByNameOrId.ts`

**核心函数**：
- `findMatchingNewDevice()` - 主匹配逻辑
- `matchDeviceByDeviceId()` - 通过 deviceId 匹配
- `matchDeviceByName()` - 通过设备名称匹配

**相关类型定义**：
- `DeviceBaseInfo`: `ledger-live/libs/live-dmk-mobile/src/types.ts`
- `ScannedDevice`: `ledger-live/libs/ledger-live-common/src/ble/types.ts`

**文档引用**：
- [device-identity-solution.md 第 1.3 节](./device-identity-solution.md#13-ledger-live-的设备名称辅助匹配策略)
- [ledger-adapter-technical-design-v2.md 第 5.2.1 节](./ledger-adapter-technical-design-v2.md#方案-1-设备名称辅助匹配ledger-live-方案)

---

### 2.2 BLE 设备类型定义

**功能**：BLE 设备的核心类型定义，包括 deviceId、deviceName、rssi 等。

**源码位置**：
- **文件路径**：`ledger-live/libs/ledger-live-common/src/ble/types.ts`
- **GitHub 链接**：[查看源码](https://github.com/LedgerHQ/ledger-live/blob/develop/libs/ledger-live-common/src/ble/types.ts)
- **本地路径**：`../ledger-live/libs/ledger-live-common/src/ble/types.ts`

**核心类型**：
- `TransportBleDevice` - BLE 设备信息
- `ScannedDevice` - 扫描到的设备信息
- `BleError` - BLE 错误类型

**关键发现**：
- Android: `device.id` 是 MAC 地址
- iOS/Web: `device.id` 是临时 UUID（每次配对都会变）

---

### 2.3 设备连接管理

**功能**：设备发现、连接、断开的核心逻辑。

**源码位置**：
- **设备发现**：`ledger-live/libs/ledger-live-common/src/hw/connectManager.ts`
- **GitHub 链接**：[查看 connectManager.ts](https://github.com/LedgerHQ/ledger-live/blob/develop/libs/ledger-live-common/src/hw/connectManager.ts)
- **设备连接**：`ledger-live/libs/ledger-live-common/src/hw/connectApp.ts`
- **GitHub 链接**：[查看 connectApp.ts](https://github.com/LedgerHQ/ledger-live/blob/develop/libs/ledger-live-common/src/hw/connectApp.ts)

---

## 三、硬件交互机制

### 3.1 设备访问队列管理

**功能**：确保对同一设备的操作串行执行，避免 APDU 冲突。

**源码位置**：
- **文件路径**：`ledger-live/libs/ledger-live-common/src/hw/deviceAccess.ts`
- **GitHub 链接**：[查看 deviceAccess.ts](https://github.com/LedgerHQ/ledger-live/blob/develop/libs/ledger-live-common/src/hw/deviceAccess.ts)
- **本地路径**：`../ledger-live/libs/ledger-live-common/src/hw/deviceAccess.ts`

**核心概念**：
- `withDevice()` - 设备访问包装器，自动排队
- 串行执行模式，避免并发冲突

**文档引用**：
- [implementation-plan.md 第 3.1 节](./implementation-plan.md#31-设备访问队列管理)

---

### 3.2 Open App 流程

**功能**：自动打开设备上的指定应用（Ethereum、Bitcoin 等）。

#### 3.2.1 Open App 实现

**源码位置**：
- **文件路径**：`ledger-live/libs/ledger-live-common/src/hw/openApp.ts`
- **GitHub 链接**：[查看 openApp.ts](https://github.com/LedgerHQ/ledger-live/blob/develop/libs/ledger-live-common/src/hw/openApp.ts)
- **本地路径**：`../ledger-live/libs/ledger-live-common/src/hw/openApp.ts`

**APDU 规范**：
- CLA: `0xe0`
- INS: `0xd8`
- P1: `0x00`
- P2: `0x00`
- DATA: 应用名称（ASCII 编码）

**响应状态码**：
- `0x9000` - 成功
- `0x6984` - 应用未找到
- `0x6807` - 应用需要升级

#### 3.2.2 Get App And Version 实现

**源码位置**：
- **文件路径**：`ledger-live/libs/ledger-live-common/src/hw/getAppAndVersion.ts`
- **GitHub 链接**：[查看 getAppAndVersion.ts](https://github.com/LedgerHQ/ledger-live/blob/develop/libs/ledger-live-common/src/hw/getAppAndVersion.ts)
- **本地路径**：`../ledger-live/libs/ledger-live-common/src/hw/getAppAndVersion.ts`

**APDU 规范**：
- CLA: `0xb0`
- INS: `0x01`
- P1: `0x00`
- P2: `0x00`

**响应格式**：
```
[formatID][nameLength][name][versionLength][version][flagLength][flags]
```

**文档引用**：
- [implementation-plan.md 第 3.2 节](./implementation-plan.md#32-open-app-完整流程)

---

### 3.3 GetOsVersion 实现

**功能**：获取设备的 OS 版本和硬件信息（用于设备指纹）。

**源码位置**：
- **文件路径**：`ledger-live/libs/ledger-live-common/src/hw/getVersion.ts`
- **GitHub 链接**：[查看 getVersion.ts](https://github.com/LedgerHQ/ledger-live/blob/develop/libs/ledger-live-common/src/hw/getVersion.ts)
- **本地路径**：`../ledger-live/libs/ledger-live-common/src/hw/getVersion.ts`

**APDU 规范**：
- CLA: `0xe0`
- INS: `0x01`
- P1: `0x00`
- P2: `0x00`

**返回信息**：
- `seTargetId` - 安全元素目标 ID（硬件级唯一标识）
- `hwVersion` - 硬件版本
- `seVersion` - SE 固件版本
- `mcuVersion` - MCU 版本

**文档引用**：
- [ledger-adapter-technical-design-v2.md 第 5.2.2 节](./ledger-adapter-technical-design-v2.md#方案-2-硬件指纹匹配getosversionx)

---

## 四、链特定实现

### 4.1 Ethereum 实现

**源码位置**：
- **旧 SDK**：`ledger-live/libs/ledgerjs/packages/hw-app-eth/`
- **GitHub 链接**：[查看 hw-app-eth](https://github.com/LedgerHQ/ledger-live/tree/develop/libs/ledgerjs/packages/hw-app-eth)
- **新 SDK**：`device-sdk-ts/packages/signer/signer-eth/`
- **本地路径**：`../ledger-live/libs/device-sdk-ts/packages/signer/signer-eth/`

**核心功能**：
- `getAddress()` - 获取地址
- `signTransaction()` - 签名交易
- `signPersonalMessage()` - Personal Sign
- `signEIP712HashedMessage()` - EIP-712 签名

### 4.2 Bitcoin 实现

**源码位置**：
- **旧 SDK**：`ledger-live/libs/ledgerjs/packages/hw-app-btc/`
- **GitHub 链接**：[查看 hw-app-btc](https://github.com/LedgerHQ/ledger-live/tree/develop/libs/ledgerjs/packages/hw-app-btc)
- **新 SDK**：`device-sdk-ts/packages/signer/signer-btc/`

**核心功能**：
- `getWalletPublicKey()` - 获取公钥
- `signPSBT()` - 签名 PSBT
- `signMessage()` - 签名消息

### 4.3 Solana 实现

**源码位置**：
- **旧 SDK**：`ledger-live/libs/ledgerjs/packages/hw-app-solana/`
- **GitHub 链接**：[查看 hw-app-solana](https://github.com/LedgerHQ/ledger-live/tree/develop/libs/ledgerjs/packages/hw-app-solana)
- **新 SDK**：`device-sdk-ts/packages/signer/signer-solana/`

---

## 五、Transport 层实现

### 5.1 WebHID Transport

**源码位置**：
- **文件路径**：`ledger-live/libs/ledgerjs/packages/hw-transport-webhid/`
- **GitHub 链接**：[查看 hw-transport-webhid](https://github.com/LedgerHQ/ledger-live/tree/develop/libs/ledgerjs/packages/hw-transport-webhid)
- **本地路径**：`../ledger-live/libs/ledgerjs/packages/hw-transport-webhid/`

**用途**：浏览器扩展、Web 应用、桌面应用（通过 USB）

### 5.2 React Native BLE Transport

**源码位置**：
- **文件路径**：`ledger-live/libs/ledgerjs/packages/react-native-hw-transport-ble/`
- **GitHub 链接**：[查看 react-native-hw-transport-ble](https://github.com/LedgerHQ/ledger-live/tree/develop/libs/ledgerjs/packages/react-native-hw-transport-ble)
- **本地路径**：`../ledger-live/libs/ledgerjs/packages/react-native-hw-transport-ble/`

**用途**：React Native 移动应用（通过 BLE）

### 5.3 Web BLE Transport

**源码位置**：
- **文件路径**：`ledger-live/libs/ledgerjs/packages/hw-transport-web-ble/`
- **GitHub 链接**：[查看 hw-transport-web-ble](https://github.com/LedgerHQ/ledger-live/tree/develop/libs/ledgerjs/packages/hw-transport-web-ble)
- **本地路径**：`../ledger-live/libs/ledgerjs/packages/hw-transport-web-ble/`

**用途**：Web 应用（通过 Web Bluetooth API）

---

## 六、Device Management Kit (新 SDK)

### 6.1 核心包

**源码位置**：
- **设备管理**：`ledger-live/libs/device-sdk-ts/packages/core/`
- **GitHub 链接**：[查看 device-sdk-ts](https://github.com/LedgerHQ/ledger-live/tree/develop/libs/device-sdk-ts)
- **本地路径**：`../ledger-live/libs/device-sdk-ts/`

**关键模块**：
- `@ledgerhq/device-management-kit` - 核心设备管理
- `@ledgerhq/device-signer-kit-ethereum` - Ethereum Signer
- `@ledgerhq/device-signer-kit-bitcoin` - Bitcoin Signer
- `@ledgerhq/device-signer-kit-solana` - Solana Signer

### 6.2 Transport Factories

**源码位置**：
- **WebHID**：`ledger-live/libs/device-sdk-ts/packages/transport/web-hid/`
- **RN BLE**：`ledger-live/libs/device-sdk-ts/packages/transport/rn-ble/`
- **Web BLE**：`ledger-live/libs/device-sdk-ts/packages/transport/web-ble/`

---

## 七、实际应用参考

### 7.1 Ledger Live Desktop

**源码位置**：
- **主应用**：`ledger-live/apps/ledger-live-desktop/`
- **GitHub 链接**：[查看 ledger-live-desktop](https://github.com/LedgerHQ/ledger-live/tree/develop/apps/ledger-live-desktop)

**关键文件**：
- Ethereum 交互：`src/renderer/families/ethereum/`
- 设备管理：`src/renderer/components/DeviceAction/`

### 7.2 Ledger Live Mobile

**源码位置**：
- **主应用**：`ledger-live/apps/ledger-live-mobile/`
- **GitHub 链接**：[查看 ledger-live-mobile](https://github.com/LedgerHQ/ledger-live/tree/develop/apps/ledger-live-mobile)

**关键文件**：
- BLE 设备管理：`src/components/RequiresBLE/`
- 设备连接：`src/screens/Manager/Device/`

---

## 八、使用建议

### 8.1 如何阅读源码

1. **从高层开始**：
   - 先看 `ledger-live/apps/` 下的实际应用
   - 理解完整的用户流程

2. **深入核心逻辑**：
   - 查看 `ledger-live/libs/ledger-live-common/src/hw/` 下的核心硬件交互
   - 理解 withDevice、openApp、getAddress 等模式

3. **查看 SDK 实现**：
   - 新 SDK：`ledger-live/libs/device-sdk-ts/`
   - 旧 SDK：`ledger-live/libs/ledgerjs/packages/`

### 8.2 关键概念索引

| 概念 | 源码位置 | 文档位置 |
|------|---------|---------|
| 设备名称匹配 | `libs/live-dmk-mobile/src/utils/matchDevicesByNameOrId.ts` | [device-identity-solution.md](./device-identity-solution.md#13-ledger-live-的设备名称辅助匹配策略) |
| 设备访问队列 | `libs/ledger-live-common/src/hw/deviceAccess.ts` | [implementation-plan.md](./implementation-plan.md#31-设备访问队列管理) |
| Open App 流程 | `libs/ledger-live-common/src/hw/openApp.ts` | [implementation-plan.md](./implementation-plan.md#32-open-app-完整流程) |
| BLE 类型定义 | `libs/ledger-live-common/src/ble/types.ts` | [device-identity-solution.md](./device-identity-solution.md#12-ble-uuidmac-地址的局限性) |
| GetOsVersion | `libs/ledger-live-common/src/hw/getVersion.ts` | [ledger-adapter-technical-design-v2.md](./ledger-adapter-technical-design-v2.md#方案-2-硬件指纹匹配getosversionx) |

### 8.3 本地调试

如果你克隆了 `ledger-live` 仓库到与本项目平级的目录：

```bash
# 项目结构
your-workspace/
├── ledger-sdk/          # 本项目
│   └── docs/            # 本文档所在位置
└── ledger-live/         # Ledger Live 源码
    ├── libs/
    │   ├── ledger-live-common/
    │   ├── device-sdk-ts/
    │   └── ledgerjs/
    └── apps/
        ├── ledger-live-desktop/
        └── ledger-live-mobile/
```

所有相对路径均基于此结构：
- `../ledger-live/libs/ledger-live-common/src/hw/openApp.ts`
- `../ledger-live/libs/device-sdk-ts/packages/core/`

---

## 九、更新记录

- **2026-01-19**：初始版本，添加设备名称匹配、队列管理、Open App 等核心功能的源码引用
