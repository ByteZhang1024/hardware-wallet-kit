import type { LedgerAdapterContext } from './types';
import type {
  Response,
  IBtcMethods,
  BtcGetAddressParams,
  BtcAddress,
  BtcGetPublicKeyParams,
  BtcPublicKey,
  BtcSignTxParams,
  BtcSignedTx,
  BtcSignMsgParams,
  BtcSignature,
  ProgressCallback,
} from '@bytezhang/hardware-wallet-core';
import { success, failure, HardwareErrorCode, batchCall } from '@bytezhang/hardware-wallet-core';

export function createBtcMethods(ctx: LedgerAdapterContext): IBtcMethods {
  async function btcGetAddress(
    connectId: string,
    deviceId: string,
    params: BtcGetAddressParams
  ): Promise<Response<BtcAddress>> {
    await ctx.ensureDevicePermission(connectId, deviceId);
    if (!(await ctx.verifyDeviceFingerprint(connectId, deviceId, 'btc'))) {
      return failure(HardwareErrorCode.DeviceMismatch, 'Wrong device connected');
    }
    try {
      const result = (await ctx.connectorCall(connectId, 'btcGetAddress', {
        path: params.path,
        coin: params.coin,
        showOnDevice: params.showOnDevice,
        scriptType: params.scriptType,
        addressIndex: params.addressIndex,
        change: params.change,
      })) as { address: string; path: string };

      return success({
        address: result.address,
        path: params.path,
      });
    } catch (err) {
      return ctx.errorToFailure(err);
    }
  }

  async function btcGetPublicKey(
    connectId: string,
    deviceId: string,
    params: BtcGetPublicKeyParams
  ): Promise<Response<BtcPublicKey>> {
    await ctx.ensureDevicePermission(connectId, deviceId);
    if (!(await ctx.verifyDeviceFingerprint(connectId, deviceId, 'btc'))) {
      return failure(HardwareErrorCode.DeviceMismatch, 'Wrong device connected');
    }
    try {
      const result = (await ctx.connectorCall(connectId, 'btcGetPublicKey', {
        path: params.path,
        coin: params.coin,
        showOnDevice: params.showOnDevice,
      })) as {
        xpub: string;
        publicKey: string;
        fingerprint: number;
        chainCode: string;
        path: string;
        depth: number;
      };

      return success({
        xpub: result.xpub,
        publicKey: result.publicKey ?? '',
        fingerprint: result.fingerprint ?? 0,
        chainCode: result.chainCode ?? '',
        path: params.path,
        depth: result.depth ?? 0,
      });
    } catch (err) {
      return ctx.errorToFailure(err);
    }
  }

  async function btcSignTransaction(
    connectId: string,
    deviceId: string,
    params: BtcSignTxParams
  ): Promise<Response<BtcSignedTx>> {
    await ctx.ensureDevicePermission(connectId, deviceId);
    if (!(await ctx.verifyDeviceFingerprint(connectId, deviceId, 'btc'))) {
      return failure(HardwareErrorCode.DeviceMismatch, 'Wrong device connected');
    }
    if (!params.psbt) {
      return failure(
        HardwareErrorCode.InvalidParams,
        'Ledger requires PSBT format for BTC transaction signing. Provide params.psbt.'
      );
    }
    try {
      // Extract account-level path (m/purpose'/coin'/account') from the first input
      const accountPath = params.inputs?.[0]?.path
        ? params.inputs[0].path.split('/').slice(0, 4).join('/')
        : undefined;

      const result = (await ctx.connectorCall(connectId, 'btcSignTransaction', {
        psbt: params.psbt,
        coin: params.coin,
        path: accountPath,
        inputDerivations: params.inputs?.map(i => ({ path: i.path })),
      })) as { signedPsbt: string };

      return success({
        signatures: [],
        serializedTx: result.signedPsbt,
        signedPsbt: result.signedPsbt,
      });
    } catch (err) {
      return ctx.errorToFailure(err);
    }
  }

  async function btcSignMessage(
    connectId: string,
    deviceId: string,
    params: BtcSignMsgParams
  ): Promise<Response<BtcSignature>> {
    await ctx.ensureDevicePermission(connectId, deviceId);
    if (!(await ctx.verifyDeviceFingerprint(connectId, deviceId, 'btc'))) {
      return failure(HardwareErrorCode.DeviceMismatch, 'Wrong device connected');
    }
    try {
      const result = (await ctx.connectorCall(connectId, 'btcSignMessage', {
        path: params.path,
        message: params.message,
        coin: params.coin,
      })) as { signature: string; address: string };

      return success({
        signature: result.signature,
        address: result.address || '',
      });
    } catch (err) {
      return ctx.errorToFailure(err);
    }
  }

  async function btcGetMasterFingerprint(
    connectId: string,
    deviceId: string
  ): Promise<Response<{ masterFingerprint: string }>> {
    await ctx.ensureDevicePermission(connectId, deviceId);
    if (!(await ctx.verifyDeviceFingerprint(connectId, deviceId, 'btc'))) {
      return failure(HardwareErrorCode.DeviceMismatch, 'Wrong device connected');
    }
    try {
      const result = (await ctx.connectorCall(connectId, 'btcGetMasterFingerprint', {})) as {
        masterFingerprint: string;
      };

      return success({ masterFingerprint: result.masterFingerprint });
    } catch (err) {
      return ctx.errorToFailure(err);
    }
  }

  return {
    btcGetAddress,
    btcGetAddresses: (
      connectId: string,
      deviceId: string,
      params: BtcGetAddressParams[],
      onProgress?: ProgressCallback
    ) => batchCall(params, p => btcGetAddress(connectId, deviceId, p), onProgress),
    btcGetPublicKey,
    btcSignTransaction,
    btcSignMessage,
    btcGetMasterFingerprint,
  };
}
