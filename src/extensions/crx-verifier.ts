/**
 * CRX3 signature verification — addresses audit #34 High-3.
 *
 * Downloaded CRX files previously only checked magic bytes ("Cr24") and that
 * every host in the redirect chain was under *.google.com. That is not a
 * cryptographic guarantee: a CA compromise, BGP hijack, or CDN compromise
 * could still deliver a tampered extension under a legitimate certificate.
 * This module verifies the CRX3 RSA-SHA256 signature embedded in the file
 * header, and binds the signing public key back to the expected extension ID.
 *
 * CRX3 file layout (see Chromium's crx_file.proto for reference):
 *
 *   [0..4)   magic bytes "Cr24"
 *   [4..8)   version = 3 (uint32 LE)
 *   [8..12)  header_size (uint32 LE) — length of the protobuf header
 *   [12..12+header_size)
 *            CrxFileHeader (protobuf, wire format)
 *              field 2 repeated AsymmetricKeyProof sha256_with_rsa
 *              field 3 repeated AsymmetricKeyProof sha256_with_ecdsa  (not used here)
 *              field 10000 bytes signed_header_data (itself a SignedData
 *                                                    protobuf with field 1 = crx_id)
 *   [rest]   ZIP payload
 *
 * AsymmetricKeyProof { field 1 bytes public_key; field 2 bytes signature }
 * SignedData         { field 1 bytes crx_id (16 bytes) }
 *
 * For each sha256_with_rsa proof, the signed message is:
 *   "CRX3 SignedData\0" || uint32_le(len(signed_header_data)) ||
 *   signed_header_data || zip_payload
 *
 * Verification requirements to pass:
 *   1. At least one RSA proof is present.
 *   2. The first RSA proof's public key (SHA-256, first 16 bytes, a-p alphabet)
 *      equals the expected extension ID — this binds the CRX to the extension
 *      we actually asked for.
 *   3. That same proof's signature verifies over the signed message above.
 *   4. signed_header_data's crx_id equals the expected extension ID bytes —
 *      defends against an attacker swapping signed_header_data to point at
 *      a different extension.
 *
 * ECDSA support is intentionally deferred: Google's Chrome Web Store serves
 * RSA signatures as the primary proof, and adding ECDSA would expand the
 * trusted-crypto surface without clear benefit. A future PR can extend this
 * if needed.
 */

import crypto from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────

export interface AsymmetricKeyProof {
  publicKey: Buffer;
  signature: Buffer;
}

export interface Crx3Header {
  rsaProofs: AsymmetricKeyProof[];
  ecdsaProofs: AsymmetricKeyProof[];
  signedHeaderData: Buffer;
}

export interface Crx3VerificationResult {
  valid: boolean;
  error?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────

const CRX3_MAGIC = Buffer.from('Cr24');
const CRX3_VERSION = 3;
const CRX3_SIGNED_DATA_PREFIX = Buffer.from('CRX3 SignedData\0', 'binary');
const CRX_ID_LENGTH = 16;

const FIELD_SHA256_WITH_RSA = 2;
const FIELD_SHA256_WITH_ECDSA = 3;
const FIELD_SIGNED_HEADER_DATA = 10000;

const KEY_PROOF_FIELD_PUBLIC_KEY = 1;
const KEY_PROOF_FIELD_SIGNATURE = 2;

const SIGNED_DATA_FIELD_CRX_ID = 1;

// ─── Protobuf minimal decoder ────────────────────────────────────────────

function readVarint(buf: Buffer, offset: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let idx = offset;
  // Limit varint length to 10 bytes (max for a 64-bit number). In practice we
  // never need more than 5 bytes here — field 10000 is the largest tag.
  while (idx < buf.length && idx < offset + 10) {
    const byte = buf[idx];
    value += (byte & 0x7f) * Math.pow(2, shift);
    idx++;
    if ((byte & 0x80) === 0) {
      return { value, next: idx };
    }
    shift += 7;
  }
  throw new Error('Truncated or oversized varint');
}

/** Decode a wire-type-2 (length-delimited) field starting at `offset` (after the tag). */
function readLengthDelimited(buf: Buffer, offset: number): { value: Buffer; next: number } {
  const { value: len, next: after } = readVarint(buf, offset);
  if (after + len > buf.length) {
    throw new Error('Length-delimited field exceeds buffer');
  }
  return { value: buf.subarray(after, after + len), next: after + len };
}

/** Iterate top-level fields in a protobuf message. Only handles wire type 2. */
function* iterFields(buf: Buffer): Generator<{ fieldNumber: number; value: Buffer }> {
  let offset = 0;
  while (offset < buf.length) {
    const tagRead = readVarint(buf, offset);
    const tag = tagRead.value;
    const wireType = tag & 0x7;
    const fieldNumber = Math.floor(tag / 8);
    offset = tagRead.next;

    if (wireType !== 2) {
      // We only care about length-delimited fields. Skip other wire types
      // defensively — if a future Chrome release adds a new field with a
      // different wire type, we should not blow up.
      if (wireType === 0) {
        // varint
        offset = readVarint(buf, offset).next;
      } else if (wireType === 1) {
        offset += 8; // 64-bit fixed
      } else if (wireType === 5) {
        offset += 4; // 32-bit fixed
      } else {
        throw new Error(`Unsupported wire type ${wireType}`);
      }
      continue;
    }

    const { value, next } = readLengthDelimited(buf, offset);
    offset = next;
    yield { fieldNumber, value };
  }
}

function parseKeyProof(buf: Buffer): AsymmetricKeyProof {
  let publicKey: Buffer | null = null;
  let signature: Buffer | null = null;
  for (const { fieldNumber, value } of iterFields(buf)) {
    if (fieldNumber === KEY_PROOF_FIELD_PUBLIC_KEY) publicKey = Buffer.from(value);
    else if (fieldNumber === KEY_PROOF_FIELD_SIGNATURE) signature = Buffer.from(value);
  }
  if (!publicKey || !signature) {
    throw new Error('AsymmetricKeyProof missing public_key or signature');
  }
  return { publicKey, signature };
}

function parseCrxId(signedHeaderData: Buffer): Buffer | null {
  for (const { fieldNumber, value } of iterFields(signedHeaderData)) {
    if (fieldNumber === SIGNED_DATA_FIELD_CRX_ID) {
      return Buffer.from(value);
    }
  }
  return null;
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Parse the CRX3 envelope. Returns the decoded header and the offset where
 * the ZIP payload begins. Throws if the buffer is too short, has the wrong
 * magic, or is not a CRX3.
 */
export function parseCrx3Header(buffer: Buffer): { header: Crx3Header; zipStart: number } {
  if (buffer.length < 12) {
    throw new Error('CRX too short to contain a header');
  }
  if (!buffer.subarray(0, 4).equals(CRX3_MAGIC)) {
    throw new Error('Invalid CRX magic bytes');
  }
  const version = buffer.readUInt32LE(4);
  if (version !== CRX3_VERSION) {
    throw new Error(`Unsupported CRX version ${version} — only CRX3 is accepted`);
  }
  const headerSize = buffer.readUInt32LE(8);
  const headerEnd = 12 + headerSize;
  if (headerEnd > buffer.length) {
    throw new Error('CRX header_size exceeds buffer length');
  }
  const headerBytes = buffer.subarray(12, headerEnd);

  const rsaProofs: AsymmetricKeyProof[] = [];
  const ecdsaProofs: AsymmetricKeyProof[] = [];
  let signedHeaderData: Buffer = Buffer.alloc(0);

  for (const { fieldNumber, value } of iterFields(headerBytes)) {
    if (fieldNumber === FIELD_SHA256_WITH_RSA) {
      rsaProofs.push(parseKeyProof(value));
    } else if (fieldNumber === FIELD_SHA256_WITH_ECDSA) {
      ecdsaProofs.push(parseKeyProof(value));
    } else if (fieldNumber === FIELD_SIGNED_HEADER_DATA) {
      signedHeaderData = Buffer.from(value);
    }
    // Any other fields are ignored — forwards-compatible.
  }

  return {
    header: { rsaProofs, ecdsaProofs, signedHeaderData },
    zipStart: headerEnd,
  };
}

/**
 * Derive a Chrome-style extension ID from a SPKI-DER public key.
 * Chrome computes SHA-256 of the public key, takes the first 16 bytes,
 * and maps each nibble (0-15) to a-p. The result is a 32-character
 * string in [a-p].
 */
export function deriveExtensionIdFromPublicKey(publicKeyDer: Buffer): string {
  const digest = crypto.createHash('sha256').update(publicKeyDer).digest();
  const out: string[] = [];
  for (let i = 0; i < CRX_ID_LENGTH; i++) {
    const byte = digest[i];
    out.push(String.fromCharCode(97 + ((byte >> 4) & 0xf)));
    out.push(String.fromCharCode(97 + (byte & 0xf)));
  }
  return out.join('');
}

function extensionIdToCrxIdBytes(extensionId: string): Buffer {
  if (extensionId.length !== 32 || !/^[a-p]{32}$/.test(extensionId)) {
    throw new Error(`Invalid Chrome extension ID: ${extensionId}`);
  }
  const out = Buffer.alloc(CRX_ID_LENGTH);
  for (let i = 0; i < CRX_ID_LENGTH; i++) {
    const hi = extensionId.charCodeAt(i * 2) - 97;
    const lo = extensionId.charCodeAt(i * 2 + 1) - 97;
    out[i] = (hi << 4) | lo;
  }
  return out;
}

function verifyRsaProofSignature(
  proof: AsymmetricKeyProof,
  signedHeaderData: Buffer,
  zipPayload: Buffer,
): boolean {
  let publicKeyObject: crypto.KeyObject;
  try {
    publicKeyObject = crypto.createPublicKey({
      key: proof.publicKey,
      format: 'der',
      type: 'spki',
    });
  } catch {
    return false;
  }

  const verifier = crypto.createVerify('sha256');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(signedHeaderData.length, 0);
  verifier.update(CRX3_SIGNED_DATA_PREFIX);
  verifier.update(lenBuf);
  verifier.update(signedHeaderData);
  verifier.update(zipPayload);
  try {
    return verifier.verify(publicKeyObject, proof.signature);
  } catch {
    return false;
  }
}

/**
 * Verify that `crxBuffer` is a well-formed CRX3 whose RSA signature is
 * valid and whose signing key corresponds to `expectedExtensionId`. Returns
 * `{ valid: true }` on success, or `{ valid: false, error }` with a short
 * diagnostic on any failure.
 *
 * This function never throws — parse errors are surfaced as `valid: false`.
 */
export function verifyCrx3Signature(
  crxBuffer: Buffer,
  expectedExtensionId: string,
): Crx3VerificationResult {
  let parsed: ReturnType<typeof parseCrx3Header>;
  try {
    parsed = parseCrx3Header(crxBuffer);
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) };
  }
  const { header, zipStart } = parsed;

  if (header.rsaProofs.length === 0) {
    return { valid: false, error: 'CRX3 has no sha256_with_rsa proofs' };
  }

  // Use the first RSA proof. Chrome's crx_verifier requires additional
  // proofs (e.g. a Chrome publisher key) for some policies; that hardening
  // is out of scope for this pass.
  const proof = header.rsaProofs[0];

  // 1. Derive ID from key and compare with expected — this is what binds
  //    the download to the extension ID the caller asked for.
  let derivedId: string;
  try {
    derivedId = deriveExtensionIdFromPublicKey(proof.publicKey);
  } catch (err) {
    return { valid: false, error: `Failed to derive extension ID: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (derivedId !== expectedExtensionId) {
    return {
      valid: false,
      error: `Extension ID mismatch: key yields ${derivedId}, expected ${expectedExtensionId}`,
    };
  }

  // 2. Verify the RSA signature over "CRX3 SignedData\0" || len ||
  //    signed_header_data || zip.
  const zipPayload = crxBuffer.subarray(zipStart);
  if (!verifyRsaProofSignature(proof, header.signedHeaderData, zipPayload)) {
    return { valid: false, error: 'CRX3 RSA signature verification failed' };
  }

  // 3. Cross-check crx_id inside signed_header_data. A valid signature over
  //    a SignedData pointing at a different extension ID is still an attack
  //    (attacker reuses a legit signed blob under a different key claim).
  const signedCrxId = parseCrxId(header.signedHeaderData);
  if (!signedCrxId) {
    return { valid: false, error: 'signed_header_data missing crx_id' };
  }
  const expectedCrxIdBytes = extensionIdToCrxIdBytes(expectedExtensionId);
  if (!signedCrxId.equals(expectedCrxIdBytes)) {
    return { valid: false, error: 'signed_header_data crx_id does not match expected extension ID' };
  }

  return { valid: true };
}
