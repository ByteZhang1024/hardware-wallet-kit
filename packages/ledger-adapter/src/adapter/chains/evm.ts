import type { LedgerAdapterContext } from './types';
import type {
  IEvmMethods,
  EvmGetAddressParams,
  EvmAddress,
  EvmGetPublicKeyParams,
  EvmPublicKey,
  EvmSignTxParams,
  EvmSignedTx,
  EvmSignMsgParams,
  EvmSignTypedDataParams,
  EvmSignature,
  ProgressCallback,
} from '@bytezhang/hardware-wallet-core';
import {
  success,
  failure,
  HardwareErrorCode,
  ensure0x,
  padHex64,
  batchCall,
} from '@bytezhang/hardware-wallet-core';

export function createEvmMethods(ctx: LedgerAdapterContext): IEvmMethods {
  async function evmGetAddress(
    connectId: string,
    deviceId: string,
    params: EvmGetAddressParams
  ): Promise<import('@bytezhang/hardware-wallet-core').Response<EvmAddress>> {
    console.log('[DMK] adapter.evmGetAddress called:', {
      connectId,
      deviceId,
      path: params.path,
      showOnDevice: params.showOnDevice,
      chainId: params.chainId,
    });
    await ctx.ensureDevicePermission(connectId, deviceId);
    if (!(await ctx.verifyDeviceFingerprint(connectId, deviceId, 'evm'))) {
      return failure(HardwareErrorCode.DeviceMismatch, 'Wrong device connected');
    }
    try {
      const result = (await ctx.connectorCall(connectId, 'evmGetAddress', {
        path: params.path,
        showOnDevice: params.showOnDevice,
        chainId: params.chainId,
      })) as { address: string; publicKey?: string; path?: string };

      return success({
        address: result.address,
        path: params.path,
      });
    } catch (err) {
      return ctx.errorToFailure(err);
    }
  }

  async function evmGetPublicKey(
    connectId: string,
    deviceId: string,
    params: EvmGetPublicKeyParams
  ): Promise<import('@bytezhang/hardware-wallet-core').Response<EvmPublicKey>> {
    await ctx.ensureDevicePermission(connectId, deviceId);
    if (!(await ctx.verifyDeviceFingerprint(connectId, deviceId, 'evm'))) {
      return failure(HardwareErrorCode.DeviceMismatch, 'Wrong device connected');
    }
    try {
      const result = (await ctx.connectorCall(connectId, 'evmGetAddress', {
        path: params.path,
        showOnDevice: params.showOnDevice,
      })) as { address: string; publicKey: string; path?: string };

      return success({
        publicKey: result.publicKey,
        path: params.path,
      });
    } catch (err) {
      return ctx.errorToFailure(err);
    }
  }

  async function evmSignTransaction(
    connectId: string,
    deviceId: string,
    params: EvmSignTxParams
  ): Promise<import('@bytezhang/hardware-wallet-core').Response<EvmSignedTx>> {
    await ctx.ensureDevicePermission(connectId, deviceId);
    if (!(await ctx.verifyDeviceFingerprint(connectId, deviceId, 'evm'))) {
      return failure(HardwareErrorCode.DeviceMismatch, 'Wrong device connected');
    }
    try {
      if (!params.serializedTx) {
        return failure(
          HardwareErrorCode.InvalidParams,
          'Ledger requires a pre-serialized transaction (serializedTx). Provide an RLP-encoded hex string.'
        );
      }

      const result = (await ctx.connectorCall(connectId, 'evmSignTransaction', {
        path: params.path,
        serializedTx: params.serializedTx,
      })) as { v: string; r: string; s: string; serializedTx?: string };

      return success({
        v: ensure0x(result.v),
        r: padHex64(result.r),
        s: padHex64(result.s),
      });
    } catch (err) {
      return ctx.errorToFailure(err);
    }
  }

  async function evmSignMessage(
    connectId: string,
    deviceId: string,
    params: EvmSignMsgParams
  ): Promise<import('@bytezhang/hardware-wallet-core').Response<EvmSignature>> {
    await ctx.ensureDevicePermission(connectId, deviceId);
    if (!(await ctx.verifyDeviceFingerprint(connectId, deviceId, 'evm'))) {
      return failure(HardwareErrorCode.DeviceMismatch, 'Wrong device connected');
    }
    try {
      const result = (await ctx.connectorCall(connectId, 'evmSignMessage', {
        path: params.path,
        message: params.message,
      })) as { signature: string; address?: string };

      return success({
        signature: ensure0x(result.signature),
      });
    } catch (err) {
      return ctx.errorToFailure(err);
    }
  }

  async function evmSignTypedData(
    connectId: string,
    deviceId: string,
    params: EvmSignTypedDataParams
  ): Promise<import('@bytezhang/hardware-wallet-core').Response<EvmSignature>> {
    await ctx.ensureDevicePermission(connectId, deviceId);
    if (!(await ctx.verifyDeviceFingerprint(connectId, deviceId, 'evm'))) {
      return failure(HardwareErrorCode.DeviceMismatch, 'Wrong device connected');
    }
    // Ledger requires full EIP-712 structure — hash mode is not supported.
    if (params.mode === 'hash') {
      return failure(
        HardwareErrorCode.MethodNotSupported,
        'Ledger does not support hash-only EIP-712 signing. Use mode "full" with the complete typed data structure.'
      );
    }

    try {
      const result = (await ctx.connectorCall(connectId, 'evmSignTypedData', {
        path: params.path,
        data: params.data,
      })) as { signature: string; address?: string };

      return success({
        signature: ensure0x(result.signature),
      });
    } catch (err) {
      return ctx.errorToFailure(err);
    }
  }

  return {
    evmGetAddress,
    evmGetAddresses: (
      connectId: string,
      deviceId: string,
      params: EvmGetAddressParams[],
      onProgress?: ProgressCallback
    ) => batchCall(params, p => evmGetAddress(connectId, deviceId, p), onProgress),
    evmGetPublicKey,
    evmSignTransaction,
    evmSignMessage,
    evmSignTypedData,
  };
}
