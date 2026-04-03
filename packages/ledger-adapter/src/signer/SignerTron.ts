/**
 * TRON Ledger signer — sends raw APDUs to the TRON app on the Ledger device.
 *
 * Unlike EVM/BTC/SOL which have dedicated DMK signer kits,
 * TRON requires direct APDU communication. This class builds and sends
 * the APDU packets according to the TRON Ledger app protocol.
 *
 * APDU Protocol Reference (Ledger hw-app-trx / PR #1284):
 *   CLA = 0xE0
 *   INS_ADDRESS      = 0x02
 *   INS_SIGN         = 0x04
 *   INS_VERSION      = 0x06
 *   INS_SIGN_MESSAGE = 0x08
 *   CHUNK_SIZE       = 250
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLA = 0xe0;
const INS_ADDRESS = 0x02;
const INS_SIGN = 0x04;
const INS_SIGN_MESSAGE = 0x08;
const CHUNK_SIZE = 250;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Function to send a raw APDU to the Ledger device and receive the response.
 *
 * The raw APDU is `[CLA, INS, P1, P2, Lc, ...data]`.
 * The response is `{ statusCode: Uint8Array (2 bytes), data: Uint8Array }`.
 */
export type SendApduFn = (
  rawApdu: Uint8Array
) => Promise<{ statusCode: Uint8Array; data: Uint8Array }>;

export interface TronAddressResult {
  publicKey: string;
  address: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert hex string (with or without 0x) to Uint8Array. */
function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Convert Uint8Array to hex string (no 0x prefix). */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Split a BIP-44 derivation path string into an array of 4-byte big-endian integers.
 * e.g. "m/44'/195'/0'/0/0" → [0x8000002C, 0x800000C3, 0x80000000, 0, 0]
 */
function splitPath(path: string): number[] {
  const p = path.startsWith('m/') ? path.slice(2) : path;
  return p.split('/').map(component => {
    const hardened = component.endsWith("'");
    const index = parseInt(hardened ? component.slice(0, -1) : component, 10);
    return hardened ? index + 0x80000000 : index;
  });
}

/**
 * Serialize derivation path components into bytes:
 * pathCount (1 byte) + each component (4 bytes big-endian)
 */
function serializePath(path: string): Uint8Array {
  const components = splitPath(path);
  const buf = new Uint8Array(1 + components.length * 4);
  buf[0] = components.length;
  for (let i = 0; i < components.length; i++) {
    const val = components[i];
    const offset = 1 + i * 4;
    buf[offset] = (val >>> 24) & 0xff;
    buf[offset + 1] = (val >>> 16) & 0xff;
    buf[offset + 2] = (val >>> 8) & 0xff;
    buf[offset + 3] = val & 0xff;
  }
  return buf;
}

/**
 * Build a raw APDU packet: [CLA, INS, P1, P2, Lc, ...data]
 */
function buildApdu(
  cla: number,
  ins: number,
  p1: number,
  p2: number,
  data?: Uint8Array
): Uint8Array {
  const dataLen = data?.length ?? 0;
  const apdu = new Uint8Array(5 + dataLen);
  apdu[0] = cla;
  apdu[1] = ins;
  apdu[2] = p1;
  apdu[3] = p2;
  apdu[4] = dataLen;
  if (data && dataLen > 0) {
    apdu.set(data, 5);
  }
  return apdu;
}

/**
 * Check that the APDU response has a success status (0x9000).
 * Throws an error with the status code if not.
 */
function checkStatusCode(statusCode: Uint8Array, context: string): void {
  if (statusCode.length < 2) {
    throw new Error(`${context}: invalid status code length`);
  }
  const sw = (statusCode[0] << 8) | statusCode[1];
  if (sw !== 0x9000) {
    throw Object.assign(
      new Error(`${context}: device returned error status 0x${sw.toString(16).padStart(4, '0')}`),
      { statusCode: sw.toString(16), errorCode: sw.toString() }
    );
  }
}

// ---------------------------------------------------------------------------
// SignerTron
// ---------------------------------------------------------------------------

/**
 * TRON signer that communicates with the Ledger TRON app via raw APDUs.
 *
 * Implements getAddress, signTransaction, and signMessage using the
 * APDU protocol described in the Ledger TRON app documentation.
 */
export class SignerTron {
  constructor(private readonly _sendApdu: SendApduFn) {}

  /**
   * Get the TRON address at the given derivation path.
   *
   * APDU: CLA=0xE0, INS=0x02, P1=(showOnDevice?0x01:0x00), P2=0x00
   * Data: pathCount(1) + paths(4 bytes each, big-endian, hardened bit)
   * Response: pubKeyLen(1) + pubKey(pubKeyLen) + addrLen(1) + addr(addrLen, ASCII base58)
   */
  async getAddress(
    path: string,
    options?: { checkOnDevice?: boolean }
  ): Promise<TronAddressResult> {
    const showOnDevice = options?.checkOnDevice ?? false;
    const pathData = serializePath(path);

    const apdu = buildApdu(CLA, INS_ADDRESS, showOnDevice ? 0x01 : 0x00, 0x00, pathData);

    const response = await this._sendApdu(apdu);
    checkStatusCode(response.statusCode, 'tronGetAddress');

    const data = response.data;
    let offset = 0;

    // Parse public key
    const pubKeyLen = data[offset];
    offset += 1;
    const publicKey = bytesToHex(data.slice(offset, offset + pubKeyLen));
    offset += pubKeyLen;

    // Parse address (ASCII base58)
    const addrLen = data[offset];
    offset += 1;
    const addressBytes = data.slice(offset, offset + addrLen);
    const address = new TextDecoder().decode(addressBytes);

    return { publicKey, address };
  }

  /**
   * Sign a TRON transaction (protobuf-encoded raw transaction).
   *
   * The transaction bytes are split into 250-byte chunks and sent sequentially.
   * First chunk includes the serialized derivation path prefix.
   *
   * P1 flags:
   *   0x10 = single chunk (entire tx fits in one APDU)
   *   0x00 = first chunk of multi-chunk
   *   0x80 = middle chunk (continuation)
   *   0x90 = last chunk (final continuation)
   *
   * Returns: 65-byte signature as hex string (no 0x prefix).
   */
  async signTransaction(path: string, rawTxHex: string): Promise<string> {
    const pathData = serializePath(path);
    const txBytes = hexToBytes(rawTxHex);

    // First chunk payload: path data + as many tx bytes as fit
    const firstChunkMaxTx = CHUNK_SIZE - pathData.length;
    const txForFirst = txBytes.slice(0, firstChunkMaxTx);
    const firstPayload = new Uint8Array(pathData.length + txForFirst.length);
    firstPayload.set(pathData, 0);
    firstPayload.set(txForFirst, pathData.length);

    const remaining = txBytes.slice(firstChunkMaxTx);

    // Build continuation chunks from remaining bytes
    const chunks: Uint8Array[] = [];
    let pos = 0;
    while (pos < remaining.length) {
      chunks.push(remaining.slice(pos, pos + CHUNK_SIZE));
      pos += CHUNK_SIZE;
    }

    const totalChunks = 1 + chunks.length;
    let response: { statusCode: Uint8Array; data: Uint8Array };

    if (totalChunks === 1) {
      // Single chunk: P1 = 0x10
      const apdu = buildApdu(CLA, INS_SIGN, 0x10, 0x00, firstPayload);
      response = await this._sendApdu(apdu);
      checkStatusCode(response.statusCode, 'tronSignTransaction');
    } else {
      // First chunk: P1 = 0x00
      const firstApdu = buildApdu(CLA, INS_SIGN, 0x00, 0x00, firstPayload);
      response = await this._sendApdu(firstApdu);
      checkStatusCode(response.statusCode, 'tronSignTransaction (first)');

      // Middle/last chunks
      for (let i = 0; i < chunks.length; i++) {
        const isLast = i === chunks.length - 1;
        const p1 = isLast ? 0x90 : 0x80;
        const apdu = buildApdu(CLA, INS_SIGN, p1, 0x00, chunks[i]);
        response = await this._sendApdu(apdu);
        checkStatusCode(response.statusCode, `tronSignTransaction (chunk ${i + 1})`);
      }
    }

    // Response from the last APDU: 65-byte signature
    return bytesToHex(response.data.slice(0, 65));
  }

  /**
   * Sign a personal message with the TRON app.
   *
   * First chunk: pathCount(1) + paths(4 bytes BE) + messageLength(4 bytes BE) + message bytes
   * Subsequent: continuation bytes
   * P1: 0x00 = first, 0x80 = continuation
   *
   * Returns: 65-byte signature as hex string (no 0x prefix).
   */
  async signMessage(path: string, messageHex: string): Promise<string> {
    const pathData = serializePath(path);
    const messageBytes = hexToBytes(messageHex);

    // Message length as 4 bytes big-endian
    const msgLenBuf = new Uint8Array(4);
    const msgLen = messageBytes.length;
    msgLenBuf[0] = (msgLen >>> 24) & 0xff;
    msgLenBuf[1] = (msgLen >>> 16) & 0xff;
    msgLenBuf[2] = (msgLen >>> 8) & 0xff;
    msgLenBuf[3] = msgLen & 0xff;

    // First chunk header: path + message length
    const header = new Uint8Array(pathData.length + 4);
    header.set(pathData, 0);
    header.set(msgLenBuf, pathData.length);

    // First chunk payload: header + as many message bytes as fit
    const firstChunkMaxMsg = CHUNK_SIZE - header.length;
    const msgForFirst = messageBytes.slice(0, firstChunkMaxMsg);
    const firstPayload = new Uint8Array(header.length + msgForFirst.length);
    firstPayload.set(header, 0);
    firstPayload.set(msgForFirst, header.length);

    const remaining = messageBytes.slice(firstChunkMaxMsg);

    // Build continuation chunks
    const chunks: Uint8Array[] = [];
    let pos = 0;
    while (pos < remaining.length) {
      chunks.push(remaining.slice(pos, pos + CHUNK_SIZE));
      pos += CHUNK_SIZE;
    }

    let response: { statusCode: Uint8Array; data: Uint8Array };

    // First chunk: P1 = 0x00
    const firstApdu = buildApdu(CLA, INS_SIGN_MESSAGE, 0x00, 0x00, firstPayload);
    response = await this._sendApdu(firstApdu);
    checkStatusCode(response.statusCode, 'tronSignMessage (first)');

    // Continuation chunks: P1 = 0x80
    for (let i = 0; i < chunks.length; i++) {
      const apdu = buildApdu(CLA, INS_SIGN_MESSAGE, 0x80, 0x00, chunks[i]);
      response = await this._sendApdu(apdu);
      checkStatusCode(response.statusCode, `tronSignMessage (chunk ${i + 1})`);
    }

    // Response from the last APDU: 65-byte signature
    return bytesToHex(response.data.slice(0, 65));
  }
}
