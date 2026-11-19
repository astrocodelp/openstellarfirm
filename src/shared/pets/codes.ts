/**
 * The 31 characters a setup or confirm code is made of: letters and digits
 * with the look-alikes (I, L, O, 0, 1) left out, so a code read aloud or off
 * a small screen is hard to mistype.
 */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** The owner's setup code, shown `XXXXX-XXXXX`. */
export const SETUP_CODE_LENGTH = 10;

/** The code the pet shows and says, shown `XXXX-XXXX`. */
export const CONFIRM_CODE_LENGTH = 8;

const ALPHABET_SIZE = CODE_ALPHABET.length;

/**
 * A byte is used only below the largest multiple of 31 that fits in a byte
 * (8 x 31 = 248). Taking the remainder of the other bytes would make the
 * first characters likelier than the last.
 */
const BYTE_LIMIT = 248;

/** Rounds of fresh bytes before a broken source is given up on. */
const MAX_ROUNDS = 64;

/**
 * Makes a code of `length` characters from bytes the caller supplies. The
 * package never reads a random source itself: the server hands in
 * `crypto.getRandomValues`, a test hands in a fixed list.
 */
export function makeCode(
  length: number,
  randomBytes: (count: number) => Uint8Array,
): string {
  if (!Number.isInteger(length) || length < 1) {
    throw new RangeError("A code needs a length of at least one character.");
  }
  let code = "";
  for (let round = 0; round < MAX_ROUNDS && code.length < length; round += 1) {
    // Ask for more than is missing, since a few bytes are always turned away.
    const bytes = randomBytes((length - code.length) * 2);
    for (const byte of bytes) {
      if (byte < BYTE_LIMIT) {
        code += CODE_ALPHABET.charAt(byte % ALPHABET_SIZE);
        if (code.length === length) {
          break;
        }
      }
    }
  }
  if (code.length < length) {
    throw new Error("The random source did not give enough usable bytes.");
  }
  return code;
}

/** Uppercases and drops everything that is not a letter or a digit. */
export function normalizeCode(input: string): string {
  // Non-ASCII characters go first: uppercasing the German sharp s gives "SS"
  // and a dotless i gives "I", which would turn text that is not a code into
  // one.
  return input.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function insertDash(code: string, at: number): string {
  return code.length > at ? `${code.slice(0, at)}-${code.slice(at)}` : code;
}

/** `K7QXM2PA9T` as `K7QXM-2PA9T`. Also fine for a code typed so far. */
export function formatSetupCode(input: string): string {
  return insertDash(normalizeCode(input), SETUP_CODE_LENGTH / 2);
}

/** `ABCDEFGH` as `ABCD-EFGH`. Also fine for a code typed so far. */
export function formatConfirmCode(input: string): string {
  return insertDash(normalizeCode(input), CONFIRM_CODE_LENGTH / 2);
}

function isCodeOfLength(input: unknown, length: number): boolean {
  if (typeof input !== "string") {
    return false;
  }
  const code = normalizeCode(input);
  if (code.length !== length) {
    return false;
  }
  for (const char of code) {
    if (!CODE_ALPHABET.includes(char)) {
      return false;
    }
  }
  return true;
}

/** True when the input, normalized, is ten characters of the alphabet. */
export function isSetupCode(input: unknown): boolean {
  return isCodeOfLength(input, SETUP_CODE_LENGTH);
}

/** True when the input, normalized, is eight characters of the alphabet. */
export function isConfirmCode(input: unknown): boolean {
  return isCodeOfLength(input, CONFIRM_CODE_LENGTH);
}

/** A fresh setup code in its shown form. */
export function makeSetupCode(
  randomBytes: (count: number) => Uint8Array,
): string {
  return formatSetupCode(makeCode(SETUP_CODE_LENGTH, randomBytes));
}

/** A fresh confirm code in its shown form. */
export function makeConfirmCode(
  randomBytes: (count: number) => Uint8Array,
): string {
  return formatConfirmCode(makeCode(CONFIRM_CODE_LENGTH, randomBytes));
}
