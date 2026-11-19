import { createHash, timingSafeEqual } from "node:crypto";

/** SHA-256 as 64 lowercase hex characters. */
export function sha256Hex(text: string | Uint8Array): string {
  return createHash("sha256").update(text).digest("hex");
}

/** SHA-256 as unpadded base64url, the form of a pet's `deviceKey`. */
export function sha256Base64url(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("base64url");
}

/** Constant-time equality of two strings, false for different lengths. */
export function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** 32 random bytes as a base64url token (43 characters). */
export function newToken(randomBytes: (count: number) => Uint8Array): string {
  return Buffer.from(randomBytes(32)).toString("base64url");
}
