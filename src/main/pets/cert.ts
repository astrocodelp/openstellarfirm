import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign,
} from "node:crypto";
import { isIP } from "node:net";

/**
 * The desk pet server's certificate: an ECDSA P-256 key and a self-signed
 * X.509 v3 certificate written with a small DER writer of our own (no
 * dependency). The pet does not trust the certificate by name: it trusts the
 * exact certificate whose SHA-256 it learned when it was paired, so the
 * fingerprint is what matters and the names in it are only for the browser
 * and for tools that look.
 */

// -- DER ---------------------------------------------------------------------

function lengthBytes(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  for (let n = length; n > 0; n = Math.floor(n / 256)) bytes.unshift(n & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), lengthBytes(body.length), body]);
}

const sequence = (...parts: Buffer[]) => tlv(0x30, ...parts);
const set = (...parts: Buffer[]) => tlv(0x31, ...parts);

/** A non-negative INTEGER from big-endian bytes, minimal and never negative. */
function integer(bytes: Buffer): Buffer {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
  let body = bytes.subarray(start);
  if (((body[0] ?? 0) & 0x80) !== 0) {
    body = Buffer.concat([Buffer.from([0]), body]);
  }
  return tlv(0x02, body);
}

function oid(dotted: string): Buffer {
  const arcs = dotted.split(".").map(Number);
  const [first = 0, second = 0, ...rest] = arcs;
  const body: number[] = [first * 40 + second];
  for (const arc of rest) {
    const chunk: number[] = [arc & 0x7f];
    for (let n = Math.floor(arc / 128); n > 0; n = Math.floor(n / 128)) {
      chunk.unshift((n & 0x7f) | 0x80);
    }
    body.push(...chunk);
  }
  return tlv(0x06, Buffer.from(body));
}

const utf8String = (text: string) => tlv(0x0c, Buffer.from(text, "utf8"));
const octetString = (body: Buffer) => tlv(0x04, body);
const bitString = (body: Buffer, unused = 0) =>
  tlv(0x03, Buffer.from([unused]), body);
const boolTrue = () => tlv(0x01, Buffer.from([0xff]));

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** UTCTime up to 2049, GeneralizedTime from 2050, as RFC 5280 says. */
function time(date: Date): Buffer {
  const y = date.getUTCFullYear();
  const rest = `${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(
    date.getUTCHours(),
  )}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  if (y < 2050) {
    return tlv(0x17, Buffer.from(`${pad(y % 100)}${rest}`, "ascii"));
  }
  return tlv(0x18, Buffer.from(`${pad(y, 4)}${rest}`, "ascii"));
}

function nameOf(commonName: string): Buffer {
  return sequence(set(sequence(oid("2.5.4.3"), utf8String(commonName))));
}

function ipBytes(address: string): Buffer | null {
  if (isIP(address) === 4) return Buffer.from(address.split(".").map(Number));
  if (isIP(address) !== 6) return null;
  // Expand with the URL parser's own normal form, then read the groups.
  const host = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const [head = "", tail] = host.split("::");
  const groups = (part: string) => (part === "" ? [] : part.split(":"));
  const a = groups(head);
  const b = tail === undefined ? [] : groups(tail);
  const zeros = tail === undefined ? 0 : 8 - a.length - b.length;
  const all = [...a, ...new Array<string>(zeros).fill("0"), ...b];
  if (all.length !== 8) return null;
  const out = Buffer.alloc(16);
  all.forEach((group, i) => {
    out.writeUInt16BE(Number.parseInt(group, 16), i * 2);
  });
  return out;
}

function extension(id: string, value: Buffer, critical = false): Buffer {
  return sequence(
    oid(id),
    ...(critical ? [boolTrue()] : []),
    octetString(value),
  );
}

// -- The certificate ---------------------------------------------------------

/** The names the certificate is made for. */
export interface CertificateNames {
  /** The mDNS name, such as `osf-1a2b3c4d.local`. */
  readonly dnsName: string;
  /** The computer's private addresses when the certificate was made. */
  readonly ips: readonly string[];
}

export interface DeskPetCertificate {
  readonly keyPem: string;
  readonly certPem: string;
  /** The SHA-256 of the DER certificate, 64 lowercase hex characters. */
  readonly fingerprint: string;
}

export const CERTIFICATE_YEARS = 10;
export const CERTIFICATE_COMMON_NAME = "OpenStellarFirm desk pets";

/** The SHA-256 of a DER certificate as 64 lowercase hex characters. */
export function fingerprintOfDer(der: Uint8Array): string {
  return createHash("sha256").update(der).digest("hex");
}

/** The fingerprint of a PEM certificate. */
export function fingerprintOfPem(pem: string): string {
  const body = pem
    .replace(/-----(BEGIN|END) CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
  return fingerprintOfDer(Buffer.from(body, "base64"));
}

function toPem(label: string, der: Buffer): string {
  const lines = der.toString("base64").match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

export interface MakeCertificateInput extends CertificateNames {
  readonly now: Date;
  /** 16 random bytes for the serial number. */
  readonly randomBytes: (count: number) => Uint8Array;
  /** An existing key pair, for tests; a fresh P-256 pair when omitted. */
  readonly keys?: { privateKey: KeyObject; publicKey: KeyObject };
}

/** Writes the DER of a self-signed certificate for `keys`. */
export function buildCertificateDer(
  input: MakeCertificateInput,
  keys: { privateKey: KeyObject; publicKey: KeyObject },
): Buffer {
  const serial = Buffer.from(input.randomBytes(16));
  // Positive, and never starting with a zero byte, so the INTEGER stays 16 bytes.
  serial[0] = ((serial[0] ?? 0) & 0x7f) | 0x40;

  const notBefore = new Date(input.now.getTime() - 60 * 60 * 1000);
  const notAfter = new Date(input.now.getTime());
  notAfter.setUTCFullYear(notAfter.getUTCFullYear() + CERTIFICATE_YEARS);

  const ecdsaSha256 = sequence(oid("1.2.840.10045.4.3.2"));
  const generalNames = [
    tlv(0x82, Buffer.from(input.dnsName, "ascii")),
    ...input.ips.flatMap((ip) => {
      const bytes = ipBytes(ip);
      return bytes ? [tlv(0x87, bytes)] : [];
    }),
  ];

  const spki = keys.publicKey.export({ type: "spki", format: "der" });
  const tbs = sequence(
    tlv(0xa0, integer(Buffer.from([2]))), // version 3
    integer(serial),
    ecdsaSha256,
    nameOf(CERTIFICATE_COMMON_NAME),
    sequence(time(notBefore), time(notAfter)),
    nameOf(CERTIFICATE_COMMON_NAME),
    Buffer.from(spki),
    tlv(
      0xa3,
      sequence(
        // basicConstraints: CA false (the empty sequence is the default).
        extension("2.5.29.19", sequence(), true),
        // keyUsage: digitalSignature only.
        extension("2.5.29.15", bitString(Buffer.from([0x80]), 7), true),
        // extKeyUsage: serverAuth.
        extension("2.5.29.37", sequence(oid("1.3.6.1.5.5.7.3.1"))),
        extension("2.5.29.17", sequence(...generalNames)),
      ),
    ),
  );
  const signature = sign("sha256", tbs, {
    key: keys.privateKey,
    dsaEncoding: "der",
  });
  return sequence(tbs, ecdsaSha256, bitString(signature));
}

/** A fresh P-256 key and a self-signed certificate for it, valid ten years. */
export function makeCertificate(
  input: MakeCertificateInput,
): DeskPetCertificate {
  const keys =
    input.keys ?? generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const der = buildCertificateDer(input, keys);
  return {
    keyPem: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    certPem: toPem("CERTIFICATE", der),
    fingerprint: fingerprintOfDer(der),
  };
}

/** The public key of a PEM private key, for tests that check the signature. */
export function publicKeyOfPrivatePem(keyPem: string): KeyObject {
  return createPublicKey(keyPem);
}
