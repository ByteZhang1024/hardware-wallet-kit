# Hardware Wallet Kit - Unified Adapter Architecture Proposals

**Date:** 2026-03-04
**Context:** Synthesizing research from existing docs, Ledger/Trezor SDKs, and OneKey integration patterns
**Status:** Three architectural approaches with trade-offs analysis

---

## Executive Summary

Based on comprehensive research of:
1. Existing hardware-wallet-kit documentation (device identity, implementation plan)
2. Ledger/Trezor official SDK patterns
3. OneKey's hardware integration experience

This document proposes **three distinct architectural approaches** for unifying Ledger and Trezor adapters, each with different trade-offs in complexity, performance, and maintainability.

---

## Background: Research Findings

### Established Facts
- **Device Identity:** Ledger lacks per-device serial numbers; requires address-based verification
- **API Patterns:** Both Ledger (new SDK) and Trezor use transport-agnostic core + chain-specific signers
- **Session Management:** Queue-based access prevents concurrent APDU conflicts
- **Cross-Platform:** Must support Web (WebHID, Web BLE), Browser Extension, and React Native

### Current State
- ledger-adapter: Skeleton with RxJS dependency, empty exports
- trezor-adapter: Stub implementation ("not yet implemented")
- Documentation: Comprehensive architecture and phased implementation plan

---

## Architecture Proposal 1: "Separate Adapters with Shared Utilities"

### Overview
Implement each adapter (Ledger, Trezor) independently but extract common patterns into shared utilities.

```
hardware-wallet-kit/
├── packages/
│   ├── ledger-adapter/
│   │   ├── src/
│   │   │   ├── LedgerDeviceManager.ts
│   │   │   ├── LedgerService.ts
│   │   │   ├── signers/
│   │   │   │   ├── EthereumSigner.ts
│   │   │   │   ├── BitcoinSigner.ts
│   │   │   └── ...
│   │   └── index.ts
│   ├── trezor-adapter/
│   │   ├── src/
│   │   │   ├── TrezorDeviceManager.ts
│   │   │   ├── TrezorService.ts
│   │   │   ├── signers/
│   │   │   │   ├── EthereumSigner.ts
│   │   │   └── ...
│   │   └── index.ts
│   └── wallet-common/ (NEW)
│       ├── src/
│       │   ├── DeviceManagerBase.ts
│       │   ├── ServiceBase.ts
│       │   ├── DeviceVerificationCache.ts
│       │   ├── types/
│       │   │   ├── DeviceInfo.ts
│       │   │   ├── TransactionTypes.ts
│       │   │   └── ErrorCodes.ts
│       │   └── utils/
│       │       ├── queueManager.ts
│       │       ├── eventEmitter.ts
│       │       └── errorHandling.ts
│       └── index.ts
```

### Implementation Pattern

**Shared Base Classes:**
```typescript
// packages/wallet-common/src/DeviceManagerBase.ts
export abstract class DeviceManagerBase {
  protected devices = new Map<string, DeviceInfo>();
  protected eventEmitter = new EventEmitter();

  abstract scanDevices(): Promise<DeviceInfo[]>;
  abstract getDeviceFingerprint(deviceId: string): Promise<DeviceFingerprint>;

  onDeviceConnected(callback: (device: DeviceInfo) => void) {
    this.eventEmitter.on('device:connected', callback);
  }
  // ... shared lifecycle methods
}

// packages/ledger-adapter/src/LedgerDeviceManager.ts
export class LedgerDeviceManager extends DeviceManagerBase {
  async scanDevices(): Promise<DeviceInfo[]> {
    // Ledger-specific implementation
  }
}

// packages/trezor-adapter/src/TrezorDeviceManager.ts
export class TrezorDeviceManager extends DeviceManagerBase {
  async scanDevices(): Promise<DeviceInfo[]> {
    // Trezor-specific implementation
  }
}
```

### Advantages
✅ **Clear separation of concerns** - Each adapter is independent and focused
✅ **Lower coupling** - Changes to Ledger don't affect Trezor
✅ **Easier testing** - Isolated unit tests per adapter
✅ **Familiar pattern** - Like current project structure
✅ **Incremental development** - Can complete Ledger, then Trezor independently

### Disadvantages
❌ **Code duplication** - Chain signers, error handling duplicated across adapters
❌ **Maintenance burden** - Same features must be kept in sync
❌ **API inconsistency** - Can drift without careful discipline
❌ **Consumer complexity** - Apps must choose which adapter to use

### Best For
- Organizations with separate Ledger and Trezor teams
- When adapter APIs need device-specific customizations
- Starting point before integration

---

## Architecture Proposal 2: "Unified Adapter with Strategy Pattern"

### Overview
Single unified adapter with hardware-agnostic core + device-specific strategy implementations.

```
hardware-wallet-kit/
├── packages/
│   ├── hardware-adapter/ (RENAMED - was ledger-adapter)
│   │   ├── src/
│   │   │   ├── HardwareAdapter.ts (main entry point)
│   │   │   ├── DeviceManager.ts (device-agnostic)
│   │   │   ├── Service.ts (business logic)
│   │   │   ├── strategies/
│   │   │   │   ├── ledger/
│   │   │   │   │   ├── LedgerStrategy.ts
│   │   │   │   │   ├── LedgerDeviceManager.ts
│   │   │   │   │   ├── signers/ (ETH, BTC, SOL)
│   │   │   │   │   └── apdu/ (APDU commands)
│   │   │   │   └── trezor/
│   │   │   │       ├── TrezorStrategy.ts
│   │   │   │       ├── TrezorDeviceManager.ts
│   │   │   │       ├── signers/ (ETH, BTC, SOL)
│   │   │   │       └── protocol/ (Trezor protocol)
│   │   │   ├── types/
│   │   │   │   ├── IDeviceStrategy.ts
│   │   │   │   ├── TransactionTypes.ts
│   │   │   │   └── CommonTypes.ts
│   │   │   ├── cache/
│   │   │   │   └── DeviceVerificationCache.ts
│   │   │   └── utils/
│   │   │       ├── queueManager.ts
│   │   │       └── eventEmitter.ts
│   │   └── index.ts
│   └── trezor-adapter/ (DEPRECATED - merged into hardware-adapter)
```

### Implementation Pattern

**Device Strategy Interface:**
```typescript
// packages/hardware-adapter/src/types/IDeviceStrategy.ts
export interface IDeviceStrategy {
  // Device operations
  scanDevices(): Promise<DeviceInfo[]>;
  getDeviceFingerprint(deviceId: string): Promise<DeviceFingerprint>;
  openApp(deviceId: string, appName: string): Promise<void>;

  // Signers
  getEthereumSigner(deviceId: string): EthereumSigner;
  getBitcoinSigner(deviceId: string): BitcoinSigner;
  getSolanaSigner(deviceId: string): SolanaSigner;

  // Session
  createSession(deviceId: string): Promise<DeviceSession>;
  releaseSession(sessionId: string): Promise<void>;
}

// packages/hardware-adapter/src/strategies/ledger/LedgerStrategy.ts
export class LedgerStrategy implements IDeviceStrategy {
  constructor(private transport: LedgerTransport) {}

  async scanDevices(): Promise<DeviceInfo[]> {
    // Ledger-specific scanning
  }
  // ... implement all methods
}

// packages/hardware-adapter/src/HardwareAdapter.ts
export class HardwareAdapter {
  constructor(strategy: IDeviceStrategy) {
    this.strategy = strategy;
  }

  async getAddress(deviceId: string, chain: 'eth' | 'btc' | 'sol', path: string) {
    const signer = this.getSignerByChain(chain);
    return signer.getAddress(path);
  }

  private getSignerByChain(chain: string) {
    switch(chain) {
      case 'eth': return this.strategy.getEthereumSigner(this.currentDeviceId);
      case 'btc': return this.strategy.getBitcoinSigner(this.currentDeviceId);
      case 'sol': return this.strategy.getSolanaSigner(this.currentDeviceId);
    }
  }
}
```

### Usage Pattern
```typescript
// Consumer code - same API regardless of device
import { HardwareAdapter } from '@bytezhang/hardware-adapter';
import { LedgerStrategy } from '@bytezhang/hardware-adapter/strategies/ledger';
import { TrezorStrategy } from '@bytezhang/hardware-adapter/strategies/trezor';

// Create adapter with Ledger strategy
const ledgerAdapter = new HardwareAdapter(new LedgerStrategy());
const addr = await ledgerAdapter.getAddress('device-123', 'eth', "m/44'/60'/0'/0/0");

// Switch to Trezor - same API
const trezorAdapter = new HardwareAdapter(new TrezorStrategy());
const addr2 = await trezorAdapter.getAddress('device-456', 'eth', "m/44'/60'/0'/0/0");
```

### Advantages
✅ **Single unified API** - Consumers use same interface for both devices
✅ **DRY principle** - Chain signers and utilities defined once
✅ **Reduced duplication** - Error handling, caching, queuing shared
✅ **Easier integration** - Wallets don't need to know about device type
✅ **Consistent versioning** - One package to update

### Disadvantages
❌ **Higher complexity** - Strategy pattern adds abstraction layers
❌ **Harder to debug** - Device-specific behavior buried in strategies
❌ **Performance overhead** - Indirection through strategy interface
❌ **Ledger-centric design** - Trezor features might not fit the interface
❌ **Trickier to extend** - Adding new device types requires interface changes

### Best For
- Multi-device support with common features
- Wallet apps that support both Ledger and Trezor
- When API consistency is critical
- Mature, stable hardware support

---

## Architecture Proposal 3: "Hybrid: Shared Core + Device-Specific Adapters"

### Overview
Balanced approach: shared core layer provides universal types/utilities, but each adapter remains independent with explicit composition.

```
hardware-wallet-kit/
├── packages/
│   ├── core/ (NEW - universal types & shared logic)
│   │   ├── src/
│   │   │   ├── types/
│   │   │   │   ├── Device.ts
│   │   │   │   ├── Transaction.ts
│   │   │   │   ├── Signer.ts
│   │   │   │   ├── ErrorCode.ts
│   │   │   │   └── Session.ts
│   │   │   ├── base/
│   │   │   │   ├── BaseDeviceManager.ts
│   │   │   │   ├── BaseService.ts
│   │   │   │   └── BaseSigner.ts
│   │   │   ├── utils/
│   │   │   │   ├── DeviceVerificationCache.ts
│   │   │   │   ├── OperationQueue.ts
│   │   │   │   ├── EventBus.ts
│   │   │   │   └── errorHandling.ts
│   │   │   └── index.ts (exports only types + utilities)
│   │   └── package.json
│   ├── ledger-adapter/
│   │   ├── src/
│   │   │   ├── LedgerDeviceManager.ts (extends BaseDeviceManager)
│   │   │   ├── LedgerService.ts (extends BaseService)
│   │   │   ├── signers/
│   │   │   │   ├── EthereumSigner.ts (extends BaseSigner)
│   │   │   │   ├── BitcoinSigner.ts
│   │   │   │   └── SolanaSigner.ts
│   │   │   ├── types.ts (Ledger-specific types/errors)
│   │   │   └── index.ts
│   │   ├── package.json (depends on @bytezhang/core)
│   │   └── tsconfig.json
│   ├── trezor-adapter/
│   │   ├── src/
│   │   │   ├── TrezorDeviceManager.ts (extends BaseDeviceManager)
│   │   │   ├── TrezorService.ts (extends BaseService)
│   │   │   ├── signers/
│   │   │   │   ├── EthereumSigner.ts
│   │   │   │   ├── BitcoinSigner.ts
│   │   │   │   └── SolanaSigner.ts
│   │   │   ├── types.ts (Trezor-specific types/errors)
│   │   │   └── index.ts
│   │   ├── package.json (depends on @bytezhang/core)
│   │   └── tsconfig.json
│   └── adapters-registry/ (NEW - optional, for convenience)
│       ├── src/
│       │   ├── registry.ts (factory to get right adapter)
│       │   ├── AdapterFactory.ts
│       │   └── index.ts
│       └── package.json
```

### Implementation Pattern

**Universal Core Types (no implementation):**
```typescript
// packages/core/src/types/Device.ts
export interface DeviceInfo {
  id: string;
  name: string;
  model: 'nanoX' | 'nanoS' | 'stax' | 'trezorT' | 'trezorOne';
  firmwareVersion: string;
  vendorId: number;
  productId: number;
}

export interface DeviceFingerprint {
  seTargetId?: number;  // Ledger-specific
  hwVersion: string;
  seVersion?: string;   // Ledger-specific
  modelId: string;
}

// packages/core/src/base/BaseService.ts
export abstract class BaseService {
  protected cache = new DeviceVerificationCache();
  protected queue = new OperationQueue();
  protected eventBus = new EventBus();

  abstract listConnectedDevices(): Promise<DeviceInfo[]>;

  // Shared methods
  onDeviceConnected(callback: DeviceEventHandler) {
    this.eventBus.on('device:connected', callback);
  }

  protected async withDeviceAccess<T>(
    deviceId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    return this.queue.enqueue(deviceId, operation);
  }
}
```

**Device-Specific Adapters (inherit from base):**
```typescript
// packages/ledger-adapter/src/LedgerService.ts
import { BaseService } from '@bytezhang/core';

export class LedgerService extends BaseService {
  constructor(private transport: LedgerTransport) {
    super();
  }

  async listConnectedDevices(): Promise<DeviceInfo[]> {
    // Ledger-specific implementation
  }

  async getEthereumAddress(deviceId: string, path: string): Promise<string> {
    return this.withDeviceAccess(deviceId, async () => {
      const signer = new LedgerEthereumSigner(this.transport, deviceId);
      return signer.getAddress(path);
    });
  }
}

// packages/trezor-adapter/src/TrezorService.ts
import { BaseService } from '@bytezhang/core';

export class TrezorService extends BaseService {
  constructor(private client: TrezorClient) {
    super();
  }

  async listConnectedDevices(): Promise<DeviceInfo[]> {
    // Trezor-specific implementation
  }

  async getEthereumAddress(deviceId: string, path: string): Promise<string> {
    return this.withDeviceAccess(deviceId, async () => {
      const signer = new TrezorEthereumSigner(this.client, deviceId);
      return signer.getAddress(path);
    });
  }
}
```

**Optional Adapter Factory:**
```typescript
// packages/adapters-registry/src/AdapterFactory.ts
export class AdapterFactory {
  static async create(
    deviceType: 'ledger' | 'trezor',
    transportConfig?: TransportConfig
  ): Promise<BaseService> {
    if (deviceType === 'ledger') {
      const transport = await LedgerTransport.create(transportConfig);
      return new LedgerService(transport);
    } else if (deviceType === 'trezor') {
      const client = await TrezorClient.create(transportConfig);
      return new TrezorService(client);
    }
    throw new Error(`Unknown device type: ${deviceType}`);
  }
}
```

### Consumer Usage

**Without Factory (explicit control):**
```typescript
import { LedgerService } from '@bytezhang/ledger-adapter';
import { TrezorService } from '@bytezhang/trezor-adapter';

const ledgerService = new LedgerService(ledgerTransport);
const addr = await ledgerService.getEthereumAddress(deviceId, path);
```

**With Factory (convenience):**
```typescript
import { AdapterFactory } from '@bytezhang/adapters-registry';

const service = await AdapterFactory.create('ledger');
const addr = await service.getEthereumAddress(deviceId, path);
```

### Advantages
✅ **Best of both worlds** - Shared utilities + independent adapters
✅ **Clear separation** - Core is stable and tested independently
✅ **Type safety** - Universal types prevent versioning issues
✅ **Reduced duplication** - Utilities, caching, queuing shared
✅ **Flexible consumption** - Explicit or factory-based usage
✅ **Evolutionary** - Can move toward unified API or keep separate
✅ **Easy onboarding** - New adapters just extend BaseService

### Disadvantages
❌ **More packages** - Requires managing 3+ npm packages
❌ **Abstraction overhead** - BaseService might not fit all devices
❌ **Coordination needed** - Core types need multi-device consensus
❌ **Versioning complexity** - Coordinating across 3+ packages

### Best For
- Organizations with parallel Ledger and Trezor development
- Wanting to add more devices (Trezor Safe 3, Onekey, etc.) in future
- Need independent adapter performance/features but shared patterns
- Prefer explicit package dependencies

---

## Comparison Matrix

| Aspect | Proposal 1: Separate | Proposal 2: Strategy | Proposal 3: Hybrid |
|--------|-------------------|------------------|---------|
| **API Consistency** | Low (may drift) | High (enforced) | Medium (guidelines) |
| **Code Duplication** | High | None | Low |
| **Complexity** | Low | High | Medium |
| **Independent Iteration** | High | Low | High |
| **Performance Overhead** | None | Strategy dispatch | Minimal (inheritance) |
| **Testing Ease** | High | Medium (mocking) | High (each adapter isolated) |
| **Package Count** | 2 | 1 | 3+ |
| **Learning Curve** | Low | Medium | Medium |
| **Long-term Maintenance** | Hard (duplication) | Easy (DRY) | Medium (coordination) |
| **Adding New Device** | Simple | Easy (implement strategy) | Easy (extend BaseService) |
| **Per-Device Customization** | Easy | Harder (interface constraint) | Easy (override methods) |

---

## Recommendation

### For OneKey's Context

Given OneKey's:
- Experience with multiple hardware devices
- Need to support future devices beyond Ledger/Trezor
- Cross-platform requirements (web, mobile, extension)
- Large wallet ecosystem integration

**Recommended:** **Proposal 3 (Hybrid)**

### Rationale

1. **Proven Pattern:** Matches successful patterns in web3 (ethers.js has Provider interface + implementations)
2. **Flexibility:** Supports both "strict API" (factory) and "device-specific" (direct instantiation) approaches
3. **Scalability:** Adding Trezor Safe 3, OneKey, etc. doesn't require core changes
4. **Developer Experience:** Clear documentation of what goes in core vs. adapter-specific
5. **Phased Migration:** Can start as Proposal 1, evolve toward Proposal 3 without breaking changes

### Implementation Roadmap (Recommended)

**Phase 1:** Extract universal types into `@bytezhang/core` package
```
- DeviceInfo, DeviceFingerprint types
- Error codes enum
- Common interfaces (no implementations)
```

**Phase 2:** Implement Ledger adapter with inheritance
```
- LedgerService extends BaseService
- Reuse core utilities (OperationQueue, EventBus, DeviceVerificationCache)
```

**Phase 3:** Implement Trezor adapter
```
- TrezorService extends BaseService
- Both adapters follow same patterns from core
```

**Phase 4:** Optional - Add AdapterFactory for convenience
```
- Only if needed by wallet integration pattern
- Keep optional so direct instantiation still works
```

---

## Appendix: Key Design Considerations

### Device Identity Verification
Regardless of chosen architecture, **all** must implement:
- Hardware fingerprint caching (seTargetId, hwVersion)
- Address-based verification for multi-device scenarios
- Session-level verification cache (avoid repeated APDU calls)
- Firmware upgrade detection and auto-update

### Error Handling Strategy
Define common error codes that **all** adapters use:
```typescript
enum HardwareErrorCode {
  DEVICE_NOT_FOUND = 'DEVICE_NOT_FOUND',
  DEVICE_LOCKED = 'DEVICE_LOCKED',
  ADDRESS_MISMATCH = 'ADDRESS_MISMATCH',
  TRANSACTION_REJECTED = 'TRANSACTION_REJECTED',
  FIRMWARE_OUTDATED = 'FIRMWARE_OUTDATED',
  APDU_ERROR = 'APDU_ERROR',
  // ...
}
```

### Transport Layer Abstraction
Each adapter must support multiple transports:
- **Ledger:** WebHID, Web BLE, React Native BLE
- **Trezor:** WebUSB, WebSocket (bridge), React Native

Recommend transport-agnostic interfaces to enable swapping:
```typescript
interface ITransport {
  send(apdu: Uint8Array): Promise<Uint8Array>;
  onConnect(callback: () => void): void;
  onDisconnect(callback: () => void): void;
}
```

### Testing Strategy
- **Unit tests:** Per-adapter, mock transport layer
- **Integration tests:** Real device or emulator
- **Type tests:** Verify common types across adapters
- **E2E tests:** Full signing flow with test vectors

---

**Document End**
