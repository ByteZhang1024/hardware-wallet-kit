import type { LedgerAdapterContext } from './types';
import type {
  Response,
  ITronMethods,
  TronGetAddressParams,
  TronAddress,
  TronSignTxParams,
  TronSignedTx,
  TronSignMsgParams,
  TronSignature,
  ProgressCallback,
} from '@bytezhang/hardware-wallet-core';
import { success, failure, HardwareErrorCode, batchCall } from '@bytezhang/hardware-wallet-core';

export function createTronMethods(ctx: LedgerAdapterContext): ITronMethods {
  async function tronGetAddress(
    connectId: string,
    deviceId: string,
    params: TronGetAddressParams
  ): Promise<Response<TronAddress>> {
    await ctx.ensureDevicePermission(connectId, deviceId);
    try {
      const result = (await ctx.connectorCall(connectId, 'tronGetAddress', {
        path: params.path,
        showOnDevice: params.showOnDevice,
      })) as { address: string; publicKey: string; path: string };

      return success({
        address: result.address,
        path: params.path,
      });
    } catch (err) {
      return ctx.errorToFailure(err);
    }
  }

  async function tronSignTransaction(
    connectId: string,
    deviceId: string,
    params: TronSignTxParams
  ): Promise<Response<TronSignedTx>> {
    await ctx.ensureDevicePermission(connectId, deviceId);
    try {
      if (!params.rawTxHex) {
        return failure(
          HardwareErrorCode.InvalidParams,
          'TRON signing requires a protobuf-encoded raw transaction hex (rawTxHex).'
        );
      }

      const result = (await ctx.connectorCall(connectId, 'tronSignTransaction', {
        path: params.path,
        rawTxHex: params.rawTxHex,
      })) as { signature: string };

      return success({ signature: result.signature });
    } catch (err) {
      return ctx.errorToFailure(err);
    }
  }

  async function tronSignMessage(
    connectId: string,
    deviceId: string,
    params: TronSignMsgParams
  ): Promise<Response<TronSignature>> {
    await ctx.ensureDevicePermission(connectId, deviceId);
    try {
      const result = (await ctx.connectorCall(connectId, 'tronSignMessage', {
        path: params.path,
        messageHex: params.message,
      })) as { signature: string };

      return success({ signature: result.signature });
    } catch (err) {
      return ctx.errorToFailure(err);
    }
  }

  return {
    tronGetAddress,
    tronGetAddresses: (
      connectId: string,
      deviceId: string,
      params: TronGetAddressParams[],
      onProgress?: ProgressCallback
    ) => batchCall(params, p => tronGetAddress(connectId, deviceId, p), onProgress),
    tronSignTransaction,
    tronSignMessage,
  };
}
