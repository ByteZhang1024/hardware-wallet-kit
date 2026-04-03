import type { Response } from './response';
import type { ProgressCallback } from './chain-evm';

export interface SolGetAddressParams {
  path: string;
  showOnDevice?: boolean;
}

export interface SolAddress {
  /** Base58-encoded Solana address */
  address: string;
  path: string;
}

export interface SolGetPublicKeyParams {
  path: string;
  showOnDevice?: boolean;
}

export interface SolPublicKey {
  /** Base58-encoded Ed25519 public key (same as the Solana address) */
  publicKey: string;
  path: string;
}

export interface SolSignTxParams {
  path: string;
  /** Hex-encoded serialized transaction bytes (no 0x prefix) */
  serializedTx: string;
  additionalInfo?: {
    tokenAccountsInfos?: Array<{
      baseAddress: string;
      tokenProgram: string;
      tokenMint: string;
      tokenAccount: string;
    }>;
  };
}

export interface SolSignedTx {
  /** Hex-encoded Ed25519 signature (no 0x prefix) */
  signature: string;
}

export interface SolSignMsgParams {
  path: string;
  /** Message bytes as hex string (no 0x prefix) */
  message: string;
}

export interface SolSignature {
  /** Hex-encoded Ed25519 signature (no 0x prefix) */
  signature: string;
}

export interface ISolMethods {
  solGetAddress(
    connectId: string,
    deviceId: string,
    params: SolGetAddressParams
  ): Promise<Response<SolAddress>>;

  solGetAddresses(
    connectId: string,
    deviceId: string,
    params: SolGetAddressParams[],
    onProgress?: ProgressCallback
  ): Promise<Response<SolAddress[]>>;

  solGetPublicKey(
    connectId: string,
    deviceId: string,
    params: SolGetPublicKeyParams
  ): Promise<Response<SolPublicKey>>;

  solSignTransaction(
    connectId: string,
    deviceId: string,
    params: SolSignTxParams
  ): Promise<Response<SolSignedTx>>;

  solSignMessage(
    connectId: string,
    deviceId: string,
    params: SolSignMsgParams
  ): Promise<Response<SolSignature>>;
}
