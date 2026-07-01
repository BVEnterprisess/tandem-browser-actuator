import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'crypto';
import {
  parseCrx3Header,
  deriveExtensionIdFromPublicKey,
  verifyCrx3Signature,
} from '../crx-verifier';

// ─── Protobuf wire-format encoder (test helper only) ──────────────────────

function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];
  let v = value;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  bytes.push(v & 0x7f);
  return Buffer.from(bytes);
}

function encodeTag(fieldNumber: number, wireType: number): Buffer {
  return encodeVarint((fieldNumber << 3) | wireType);
}

function encodeLengthDelimited(fieldNumber: number, payload: Buffer): Buffer {
  return Buffer.concat([encodeTag(fieldNumber, 2), encodeVarint(payload.length), payload]);
}

// AsymmetricKeyProof { 1: public_key, 2: signature }
function encodeKeyProof(publicKey: Buffer, signature: Buffer): Buffer {
  return Buffer.concat([
    encodeLengthDelimited(1, publicKey),
    encodeLengthDelimited(2, signature),
  ]);
}

// SignedData { 1: crx_id }
function encodeSignedData(crxId: Buffer): Buffer {
  return encodeLengthDelimited(1, crxId);
}

// ─── CRX3 builder (test helper) ──────────────────────────────────────────

interface BuildOpts {
  zipPayload: Buffer;
  crxId: Buffer;              // 16 bytes — derived from first public key
  privateKey: crypto.KeyObject;
  publicKeyDer: Buffer;       // SPKI DER encoding
}

const CRX3_MAGIC = Buffer.from('Cr24');
const CRX3_VERSION = 3;
const CRX3_SIGNED_DATA_PREFIX = Buffer.from('CRX3 SignedData\0', 'binary');

function signOver(privateKey: crypto.KeyObject, signedHeaderData: Buffer, zip: Buffer): Buffer {
  const signer = crypto.createSign('sha256');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(signedHeaderData.length, 0);
  signer.update(CRX3_SIGNED_DATA_PREFIX);
  signer.update(lenBuf);
  signer.update(signedHeaderData);
  signer.update(zip);
  return signer.sign(privateKey);
}

function buildCrx3(opts: BuildOpts): Buffer {
  const signedHeaderData = encodeSignedData(opts.crxId);
  const signature = signOver(opts.privateKey, signedHeaderData, opts.zipPayload);
  const rsaProof = encodeKeyProof(opts.publicKeyDer, signature);
  const header = Buffer.concat([
    encodeLengthDelimited(2, rsaProof),            // field 2: sha256_with_rsa[]
    encodeLengthDelimited(10000, signedHeaderData), // field 10000: signed_header_data
  ]);

  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(header.length, 0);
  const versionBuf = Buffer.alloc(4);
  versionBuf.writeUInt32LE(CRX3_VERSION, 0);

  return Buffer.concat([CRX3_MAGIC, versionBuf, lenBuf, header, opts.zipPayload]);
}

// ─── Fixtures (generated once per file) ──────────────────────────────────

let keyPair: crypto.KeyPairKeyObjectResult;
let publicKeyDer: Buffer;
let expectedExtensionId: string;
const zipPayload = Buffer.from('PK\x03\x04fake-zip-content-for-signing-test', 'binary');

beforeAll(() => {
  keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  publicKeyDer = keyPair.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  // CRX extension ID: sha256 of SPKI public key, take first 16 bytes, map
  // each nibble (0-15) through the a-p alphabet.
  const digest = crypto.createHash('sha256').update(publicKeyDer).digest();
  const first16 = digest.subarray(0, 16);
  expectedExtensionId = Array.from(first16)
    .map((b) => {
      const hi = (b >> 4) & 0xf;
      const lo = b & 0xf;
      return String.fromCharCode(97 + hi) + String.fromCharCode(97 + lo);
    })
    .join('');
});

function crxIdBytesFor(extensionId: string): Buffer {
  // Reverse of the a-p mapping: each character's code - 97 is a nibble.
  const buf = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) {
    const hi = extensionId.charCodeAt(i * 2) - 97;
    const lo = extensionId.charCodeAt(i * 2 + 1) - 97;
    buf[i] = (hi << 4) | lo;
  }
  return buf;
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('deriveExtensionIdFromPublicKey()', () => {
  it('maps a SPKI DER public key to a 32-char a-p extension ID', () => {
    const id = deriveExtensionIdFromPublicKey(publicKeyDer);
    expect(id).toBe(expectedExtensionId);
    expect(id).toMatch(/^[a-p]{32}$/);
  });

  it('is stable for the same input', () => {
    const a = deriveExtensionIdFromPublicKey(publicKeyDer);
    const b = deriveExtensionIdFromPublicKey(publicKeyDer);
    expect(a).toBe(b);
  });

  it('differs for different public keys', () => {
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const otherDer = other.publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    expect(deriveExtensionIdFromPublicKey(publicKeyDer)).not.toBe(deriveExtensionIdFromPublicKey(otherDer));
  });
});

describe('parseCrx3Header()', () => {
  it('extracts RSA proofs and signed_header_data from a well-formed CRX3', () => {
    const crx = buildCrx3({
      zipPayload,
      crxId: crxIdBytesFor(expectedExtensionId),
      privateKey: keyPair.privateKey,
      publicKeyDer,
    });

    const { header, zipStart } = parseCrx3Header(crx);

    expect(header.rsaProofs).toHaveLength(1);
    expect(header.rsaProofs[0].publicKey.equals(publicKeyDer)).toBe(true);
    expect(header.signedHeaderData.length).toBeGreaterThan(0);
    expect(crx.subarray(zipStart).equals(zipPayload)).toBe(true);
  });

  it('throws on truncated buffer', () => {
    expect(() => parseCrx3Header(Buffer.alloc(8))).toThrow();
  });

  it('throws on wrong magic', () => {
    const buf = Buffer.alloc(100);
    Buffer.from('XXXX').copy(buf, 0);
    expect(() => parseCrx3Header(buf)).toThrow(/magic/i);
  });

  it('throws on non-3 version', () => {
    const buf = Buffer.alloc(100);
    CRX3_MAGIC.copy(buf, 0);
    buf.writeUInt32LE(2, 4); // CRX2
    buf.writeUInt32LE(0, 8);
    expect(() => parseCrx3Header(buf)).toThrow(/version/i);
  });
});

describe('verifyCrx3Signature()', () => {
  it('returns valid=true for a correctly-signed CRX that matches the expected ID', () => {
    const crx = buildCrx3({
      zipPayload,
      crxId: crxIdBytesFor(expectedExtensionId),
      privateKey: keyPair.privateKey,
      publicKeyDer,
    });

    const result = verifyCrx3Signature(crx, expectedExtensionId);
    expect(result).toEqual({ valid: true });
  });

  it('returns valid=false if the zip payload is tampered after signing', () => {
    const crx = buildCrx3({
      zipPayload,
      crxId: crxIdBytesFor(expectedExtensionId),
      privateKey: keyPair.privateKey,
      publicKeyDer,
    });
    // Flip one byte deep in the zip region (past the header)
    const tampered = Buffer.from(crx);
    tampered[tampered.length - 5] ^= 0xff;

    const result = verifyCrx3Signature(tampered, expectedExtensionId);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/signature/i);
  });

  it('returns valid=false if the signature bytes are tampered', () => {
    const crx = buildCrx3({
      zipPayload,
      crxId: crxIdBytesFor(expectedExtensionId),
      privateKey: keyPair.privateKey,
      publicKeyDer,
    });
    // Flip a byte somewhere in the header (where the signature lives)
    const tampered = Buffer.from(crx);
    tampered[200] ^= 0xff;

    const result = verifyCrx3Signature(tampered, expectedExtensionId);
    expect(result.valid).toBe(false);
  });

  it('returns valid=false when expectedExtensionId does not match key-derived ID', () => {
    const crx = buildCrx3({
      zipPayload,
      crxId: crxIdBytesFor(expectedExtensionId),
      privateKey: keyPair.privateKey,
      publicKeyDer,
    });

    const wrongId = 'a'.repeat(32);
    const result = verifyCrx3Signature(crx, wrongId);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/extension id/i);
  });

  it('returns valid=false when signed_header_data crx_id does not match expectedExtensionId', () => {
    // Key is correct, but SignedData claims a different crx_id. This catches
    // an attacker substituting the signed header to point at another extension.
    const wrongCrxId = Buffer.alloc(16, 0xaa);
    const crx = buildCrx3({
      zipPayload,
      crxId: wrongCrxId,
      privateKey: keyPair.privateKey,
      publicKeyDer,
    });

    const result = verifyCrx3Signature(crx, expectedExtensionId);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/crx_id|signed header/i);
  });

  it('returns valid=false when no RSA proof is present', () => {
    // Header with only signed_header_data, no sha256_with_rsa list.
    const signedHeaderData = encodeSignedData(crxIdBytesFor(expectedExtensionId));
    const header = encodeLengthDelimited(10000, signedHeaderData);
    const versionBuf = Buffer.alloc(4);
    versionBuf.writeUInt32LE(CRX3_VERSION, 0);
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(header.length, 0);
    const crx = Buffer.concat([CRX3_MAGIC, versionBuf, lenBuf, header, zipPayload]);

    const result = verifyCrx3Signature(crx, expectedExtensionId);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/no sha256_with_rsa|no rsa|no signature/i);
  });

  it('returns valid=false when signed_header_data is missing entirely', () => {
    // Header with an RSA proof but no signed_header_data field. parseCrxId
    // then returns null → verification fails with "missing crx_id".
    const fakeProof = encodeKeyProof(publicKeyDer, Buffer.alloc(256));
    const header = encodeLengthDelimited(2, fakeProof);
    const versionBuf = Buffer.alloc(4);
    versionBuf.writeUInt32LE(CRX3_VERSION, 0);
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(header.length, 0);
    const crx = Buffer.concat([CRX3_MAGIC, versionBuf, lenBuf, header, zipPayload]);

    const result = verifyCrx3Signature(crx, expectedExtensionId);
    expect(result.valid).toBe(false);
    // Fails earlier (at the sig check), but in any case: not valid.
  });

  it('returns valid=false — public key is not a valid SPKI DER', () => {
    // Build a CRX3 whose "public_key" bytes are garbage. createPublicKey
    // throws inside verifyRsaProofSignature, which should be caught and
    // turned into { valid: false }.
    const signedHeaderData = encodeSignedData(crxIdBytesFor(expectedExtensionId));
    const fakeSignature = Buffer.alloc(256, 1);
    // derive the "expected id" from the garbage key so the ID-binding check
    // passes and we actually exercise the signature-verify path
    const garbageKey = Buffer.from('not a DER key');
    const garbageId = deriveExtensionIdFromPublicKey(garbageKey);
    const proof = encodeKeyProof(garbageKey, fakeSignature);
    const header = Buffer.concat([
      encodeLengthDelimited(2, proof),
      encodeLengthDelimited(10000, signedHeaderData),
    ]);
    const versionBuf = Buffer.alloc(4);
    versionBuf.writeUInt32LE(CRX3_VERSION, 0);
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(header.length, 0);
    const crx = Buffer.concat([CRX3_MAGIC, versionBuf, lenBuf, header, zipPayload]);

    const result = verifyCrx3Signature(crx, garbageId);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/signature/i);
  });

  it('handles (skips) ECDSA proofs in field 3 without breaking parsing', () => {
    // A real Chrome publisher key would use ECDSA; we just need to confirm
    // the decoder's ECDSA branch doesn't trip over a field-3 entry.
    const ecdsaProof = encodeKeyProof(Buffer.from('fake-ecdsa-key'), Buffer.from('fake-sig'));
    const signedHeaderData = encodeSignedData(crxIdBytesFor(expectedExtensionId));
    const signature = signOver(keyPair.privateKey, signedHeaderData, zipPayload);
    const rsaProof = encodeKeyProof(publicKeyDer, signature);
    const header = Buffer.concat([
      encodeLengthDelimited(2, rsaProof),
      encodeLengthDelimited(3, ecdsaProof), // field 3 = sha256_with_ecdsa
      encodeLengthDelimited(10000, signedHeaderData),
    ]);
    const versionBuf = Buffer.alloc(4);
    versionBuf.writeUInt32LE(CRX3_VERSION, 0);
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(header.length, 0);
    const crx = Buffer.concat([CRX3_MAGIC, versionBuf, lenBuf, header, zipPayload]);

    const { header: parsed } = parseCrx3Header(crx);
    expect(parsed.rsaProofs).toHaveLength(1);
    expect(parsed.ecdsaProofs).toHaveLength(1);

    // End-to-end verify still passes because we only check RSA.
    const result = verifyCrx3Signature(crx, expectedExtensionId);
    expect(result.valid).toBe(true);
  });

  it('parseCrx3Header skips forwards-compatible fields of other wire types', () => {
    // Add a varint field (wire type 0) and a 32-bit fixed field (wire type 5)
    // with field numbers we don't care about. Parser should skip them.
    const rsaProof = encodeKeyProof(publicKeyDer, Buffer.alloc(256));
    const signedHeaderData = encodeSignedData(crxIdBytesFor(expectedExtensionId));

    // Tag for field 42 wire type 0 (varint) = (42<<3)|0 = 336
    // 336 as varint: 0xd0 0x02
    const varintField = Buffer.from([0xd0, 0x02, 0x2a]); // field 42 varint = 42
    // Tag for field 43 wire type 5 (fixed32) = (43<<3)|5 = 349
    // 349 as varint: 0xdd 0x02
    const fixed32Field = Buffer.from([0xdd, 0x02, 0x01, 0x02, 0x03, 0x04]);

    const header = Buffer.concat([
      varintField,
      encodeLengthDelimited(2, rsaProof),
      fixed32Field,
      encodeLengthDelimited(10000, signedHeaderData),
    ]);
    const versionBuf = Buffer.alloc(4);
    versionBuf.writeUInt32LE(CRX3_VERSION, 0);
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(header.length, 0);
    const crx = Buffer.concat([CRX3_MAGIC, versionBuf, lenBuf, header, zipPayload]);

    const { header: parsed } = parseCrx3Header(crx);
    expect(parsed.rsaProofs).toHaveLength(1);
    expect(parsed.signedHeaderData.length).toBeGreaterThan(0);
  });

  it('throws when CRX header_size claims more bytes than the file contains', () => {
    const versionBuf = Buffer.alloc(4);
    versionBuf.writeUInt32LE(CRX3_VERSION, 0);
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(1_000_000, 0); // absurd header size
    const crx = Buffer.concat([CRX3_MAGIC, versionBuf, lenBuf, Buffer.alloc(10)]);
    expect(() => parseCrx3Header(crx)).toThrow(/header_size/i);
  });

  it('verifyCrx3Signature surfaces a parse error as valid=false (never throws)', () => {
    const tooShort = Buffer.alloc(8);
    const result = verifyCrx3Signature(tooShort, expectedExtensionId);
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
