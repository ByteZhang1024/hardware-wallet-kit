import type { LedgerAdapterContext } from './types';
import type {
  Response,
  ISolMethods,
  SolGetAddressParams,
  SolAddress,
  SolGetPublicKeyParams,
  SolPublicKey,
  SolSignTxParams,
  SolSignedTx,
  SolSignMsgParams,
  SolSignature,
  ProgressCallback,
} from '@bytezhang/hardware-wallet-core';
import { success, failure, HardwareErrorCode, batchCall } from '@bytezhang/hardware-wallet-core';

export function createSolMethods(ctx: LedgerAdapterContext): ISolMethods {
  async function solGetAddress(
    connectId: string,
    deviceId: string,
    params: SolGetAddressParams
  ): Promise<Response<SolAddress>> {
    await ctx.ensureDevicePermission(connectId, deviceId);
    if (!(await ctx.verifyDeviceFingerprint(connectId, deviceId, 'sol'))) {
      return failure(HardwareErrorCode.DeviceMismatch, 'Wrong device connected');
    }
    try {
      const result = (await ctx.connectorCall(connectId, 'solGetAddress', {
        path: params.path,
        showOnDevice: params.showOnDevice,
      })) as { address: string; path: string };

      return success({
        address: result.address,
        path: params.path,
      });
    } catch (err) {
      return ctx.errorToFailure(err);
    }
  }

  async function solGetPublicKey(
    connectId: string,
    deviceId: string,
    params: SolGetPublicKeyParams
  ): Promise<Response<SolPublicKey>> {
    await ctx.ensureDevicePermission(connectId, deviceId);
    if (!(await ctx.verifyDeviceFingerprint(connectId, deviceId, 'sol'))) {
      return failure(HardwareErrorCode.DeviceMismatch, 'Wrong device connected');
    }
    try {
      // Solana uses Ed25519 — the public key IS the address (base58 encoded)
      const result = (await ctx.connectorCall(connectId, 'solGetAddress', {
        path: params.path,
        showOnDevice: params.showOnDevice,
      })) as { address: string; path: string };

      return success({
        publicKey: result.address,
        path: params.path,
      });
    } catch (err) {
      return ctx.errorToFailure(err);
    }
  }

  async function solSignTransaction(
    connectId: string,
    deviceId: string,
    params: SolSignTxParams
  ): Promise<Response<SolSignedTx>> {
    await ctx.ensureDevicePermission(connectId, deviceId);
    if (!(await ctx.verifyDeviceFingerprint(connectId, deviceId, 'sol'))) {
      return failure(HardwareErrorCode.DeviceMismatch, 'Wrong device connected');
    }
    try {
      const result = (await ctx.connectorCall(connectId, 'solSignTransaction', {
        path: params.path,
        serializedTx: params.serializedTx,
      })) as { signature: string };

      return success({ signature: result.signature });
    } catch (err) {
      return ctx.errorToFailure(err);
    }
  }

  async function solSignMessage(
    connectId: string,
    deviceId: string,
    params: SolSignMsgParams
  ): Promise<Response<SolSignature>> {
    await ctx.ensureDevicePermission(connectId, deviceId);
    if (!(await ctx.verifyDeviceFingerprint(connectId, deviceId, 'sol'))) {
      return failure(HardwareErrorCode.DeviceMismatch, 'Wrong device connected');
    }
    try {
      const result = (await ctx.connectorCall(connectId, 'solSignMessage', {
        path: params.path,
        message: params.message,
      })) as { signature: string };

      return success({ signature: result.signature });
    } catch (err) {
      return ctx.errorToFailure(err);
    }
  }

  return {
    solGetAddress,
    solGetAddresses: (
      connectId: string,
      deviceId: string,
      params: SolGetAddressParams[],
      onProgress?: ProgressCallback
    ) => batchCall(params, p => solGetAddress(connectId, deviceId, p), onProgress),
    solGetPublicKey,
    solSignTransaction,
    solSignMessage,
  };
}
