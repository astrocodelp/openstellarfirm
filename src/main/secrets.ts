import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

/**
 * Model keys, sealed with the operating system's keychain (Electron's
 * safeStorage) before they touch the disk. A key is read back only in the main
 * process, for the one call that needs it. It is never sent to the page.
 */
export interface SecretBox {
  available(): Promise<boolean>;
  seal(plain: string): Promise<Buffer>;
  /** `stale` means the keychain's own key changed, so the text is sealed again. */
  open(sealed: Buffer): Promise<{ plain: string; stale: boolean }>;
}

/**
 * The mark Chromium puts on a value sealed with its fixed fallback key. On
 * Linux, with no keyring running (GNOME Keyring, KWallet, KeePassXC or any
 * other Secret Service), it seals with a key written in its own source, so
 * anyone who copies the file can read what is in it. Electron still calls that
 * "available", and with the async API its backend name reads "basic_text"
 * even when a keyring is used, so the app looks at what sealing gives back.
 * A keyring's key gives "v11".
 */
const FIXED_KEY_MARK = "v10";
const CHECK_TEXT = "OpenStellarFirm keychain check";

/**
 * Whether sealing with safeStorage keeps a key private. On macOS and Windows
 * the system's own store does; on Linux only a real keyring does, so a value
 * is sealed once to see which key was used.
 */
export async function keychainUsable(
  platform: string,
  available: () => Promise<boolean>,
  seal: (plain: string) => Promise<Buffer>,
): Promise<boolean> {
  try {
    if (!(await available())) return false;
    if (platform !== "linux") return true;
    const sealed = await seal(CHECK_TEXT);
    return (
      sealed.length > FIXED_KEY_MARK.length &&
      sealed.subarray(0, 3).toString("latin1") !== FIXED_KEY_MARK &&
      !sealed.toString("latin1").includes(CHECK_TEXT)
    );
  } catch {
    return false;
  }
}

export class Secrets {
  constructor(
    private readonly file: string,
    private readonly box: SecretBox,
  ) {}

  available(): Promise<boolean> {
    return this.box.available();
  }

  private read(): Record<string, string> {
    if (!existsSync(this.file)) return {};
    return JSON.parse(readFileSync(this.file, "utf8")) as Record<
      string,
      string
    >;
  }

  private write(all: Record<string, string>): void {
    const temp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(all), { mode: 0o600 });
    renameSync(temp, this.file);
  }

  /** Only the app's own ids name a key; anything else names nothing. */
  private own(all: Record<string, string>, id: string): string | undefined {
    const value = Object.hasOwn(all, id) ? all[id] : undefined;
    return typeof value === "string" ? value : undefined;
  }

  has(id: string): boolean {
    return this.own(this.read(), id) !== undefined;
  }

  async get(id: string): Promise<string | undefined> {
    const sealed = this.own(this.read(), id);
    if (!sealed) return undefined;
    const { plain, stale } = await this.box.open(Buffer.from(sealed, "base64"));
    if (stale) await this.set(id, plain);
    return plain;
  }

  async set(id: string, key: string): Promise<void> {
    // Without a keychain a key would sit on disk in the clear, so it is refused.
    if (!(await this.box.available())) {
      throw new Error(
        "This computer has no keychain to keep a key in, so the key was not saved.",
      );
    }
    const sealed = await this.box.seal(key);
    const all = this.read();
    all[id] = sealed.toString("base64");
    this.write(all);
  }

  remove(id: string): void {
    const all = this.read();
    if (!Object.hasOwn(all, id)) return;
    delete all[id];
    this.write(all);
  }
}
