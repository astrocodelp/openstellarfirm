import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { OcrLanguage } from "../shared/types";

/**
 * The languages the reader on this computer can read pictures in.
 *
 * English comes with the app. Every other language is a file the person
 * downloads on their own click, from one pinned address, and keeps only when
 * its SHA-256 matches the one written here. Nothing else is ever fetched.
 *
 * Source: the Tesseract project's `tessdata_fast` trained data (Apache-2.0),
 * https://github.com/tesseract-ocr/tessdata_fast, as mirrored on Hugging Face
 * by lm-kit at https://huggingface.co/lm-kit/tessdata-fast, pinned to commit
 * bc1f3580293f86fabee4b57cdff0c96a7d15bef0. Every file below was downloaded
 * from that commit and from the official repository at commit
 * 87416418657359cb625c412a48b6e1d6d41c29bd, and the two were byte for byte
 * the same; the hashes are of those files.
 */

const MIRROR =
  "https://huggingface.co/lm-kit/tessdata-fast/resolve/bc1f3580293f86fabee4b57cdff0c96a7d15bef0";

interface LanguageFile {
  code: string;
  name: string;
  size: number;
  sha256: string;
}

/** English, which ships inside the app. */
export const BUILT_IN: LanguageFile = {
  code: "eng",
  name: "English",
  size: 4_113_088,
  sha256: "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2",
};

/** The languages that can be downloaded. The list is code; nothing adds to it. */
export const DOWNLOADABLE: readonly LanguageFile[] = [
  {
    code: "ara",
    name: "Arabic",
    size: 1_432_056,
    sha256: "e3206d3dc87fd50c24a0fb9f01838615911d25168f4e64415244b67d2bb3e729",
  },
  {
    code: "hye",
    name: "Armenian",
    size: 3_463_717,
    sha256: "b701d0d95799a716143dedb0197504e56f27a1bb133d6607ff5778c6988cb67c",
  },
  {
    code: "bul",
    name: "Bulgarian",
    size: 1_675_212,
    sha256: "aebc9b0fcc8cfaf8a9f38a02bb7b85052bd850744696a2c11cf0081820e5b21e",
  },
  {
    code: "chi_sim",
    name: "Chinese (simplified)",
    size: 2_469_156,
    sha256: "a5fcb6f0db1e1d6d8522f39db4e848f05984669172e584e8d76b6b3141e1f730",
  },
  {
    code: "chi_tra",
    name: "Chinese (traditional)",
    size: 2_366_642,
    sha256: "529c5b5797d64b126065cd55f2bb4c7fd7b15790798091b1ff259941a829330b",
  },
  {
    code: "hrv",
    name: "Croatian",
    size: 4_103_348,
    sha256: "9e515d9832ce259dbab550b1cc6b998f8b929faf2edacaaca981b05adb130571",
  },
  {
    code: "ces",
    name: "Czech",
    size: 3_795_684,
    sha256: "934bcaf97ef3348413263331131c9fa7f55f30db333c711929c124fb635f7e1b",
  },
  {
    code: "dan",
    name: "Danish",
    size: 2_580_059,
    sha256: "acb1fd074487a31d1294fcdfd7d7c673467ffd8aeacb2ccd61ebcbf04eb4e2fa",
  },
  {
    code: "nld",
    name: "Dutch",
    size: 6_050_296,
    sha256: "ced0e5e046a84c908a6aa7accbef9a232c4a5d9a8276691b81c6ee64d02963f6",
  },
  {
    code: "fin",
    name: "Finnish",
    size: 7_865_732,
    sha256: "61a04cd62b507c3d9ae0e1cda399e6715ebf49dea9df47897c8acdcd3bd3e13c",
  },
  {
    code: "fra",
    name: "French",
    size: 1_130_365,
    sha256: "ced037562e8c80c13122dece28dd477d399af80911a28791a66a63ac1e3445ca",
  },
  {
    code: "deu",
    name: "German",
    size: 1_525_436,
    sha256: "19d219bbb6672c869d20a9636c6816a81eb9a71796cb93ebe0cb1530e2cdb22d",
  },
  {
    code: "ell",
    name: "Greek",
    size: 1_419_514,
    sha256: "4fba8a0b461038d51f1c20d043d4f2ac38c4e778f1b90830847f7bd8fa3ba726",
  },
  {
    code: "heb",
    name: "Hebrew",
    size: 961_404,
    sha256: "11f9e43ab227f786352a50f75c94c2e9906f1baba86d93276da19da7ce0904db",
  },
  {
    code: "hin",
    name: "Hindi",
    size: 1_122_751,
    sha256: "4c73ffc59d497c186b19d1e90f5d721d678ea6b2e277b719bee4e2af12271825",
  },
  {
    code: "hun",
    name: "Hungarian",
    size: 5_296_273,
    sha256: "35067e7cfe102dcdc953f9a758fdfaa6296b17a1ee6d874ee780fa306430b9fb",
  },
  {
    code: "ind",
    name: "Indonesian",
    size: 1_122_661,
    sha256: "69786901da87ab8766c1ea7fbb10b28f2110c14da3f6c8f2735df131fba95d88",
  },
  {
    code: "ita",
    name: "Italian",
    size: 2_701_314,
    sha256: "b8f89e1e785118dac4d51ae042c029a64edb5c3ee42ef73027a6d412748d8827",
  },
  {
    code: "jpn",
    name: "Japanese",
    size: 2_471_260,
    sha256: "1f5de9236d2e85f5fdf4b3c500f2d4926f8d9449f28f5394472d9e8d83b91b4d",
  },
  {
    code: "kor",
    name: "Korean",
    size: 1_677_415,
    sha256: "6b85e11d9bbf07863b97b3523b1b112844c43e713df8b66418a081fd1060b3b2",
  },
  {
    code: "nor",
    name: "Norwegian",
    size: 3_610_079,
    sha256: "0451eb4f8049ae78196806bf878a389a2f40f1386fe038568cf4441226ba6ef2",
  },
  {
    code: "fas",
    name: "Persian",
    size: 431_500,
    sha256: "db1c0a91208aff00d3cf1ed2c1d23f76419afd5f024688b4f71adc3f2ce4a505",
  },
  {
    code: "pol",
    name: "Polish",
    size: 4_765_518,
    sha256: "c4476cdbc0e33d898d32345122b7be1cbf85ace15f920f06c7714756e1ef79b2",
  },
  {
    code: "por",
    name: "Portuguese",
    size: 1_982_756,
    sha256: "c4932b937207a9514b7514d518b931a99938c02a28a5a5a553f8599ed58b7deb",
  },
  {
    code: "ron",
    name: "Romanian",
    size: 2_376_323,
    sha256: "9adfde6b51ba4b97efd10ea37c3070fd3fc2bad7815e81f5c3c198cd96216cc9",
  },
  {
    code: "rus",
    name: "Russian",
    size: 3_861_738,
    sha256: "e16e5e036cce1d9ec2b00063cf8b54472625b9e14d893a169e2b0dedeb4df225",
  },
  {
    code: "srp",
    name: "Serbian",
    size: 2_149_931,
    sha256: "aa41ae3d9cc705e60d398ab38a5c3cc8b772c0d420c7d4f0859beb13d0e321b6",
  },
  {
    code: "slk",
    name: "Slovak",
    size: 4_427_661,
    sha256: "fbcc400a9c74c6a13d922fcb1211b655d1b165387b675ed75cd2dbd756b974a5",
  },
  {
    code: "spa",
    name: "Spanish",
    size: 2_294_433,
    sha256: "6f2e04d02774a18f01bed44b1111f2cd7f3ba7ac9dc4373cd3f898a40ea6b464",
  },
  {
    code: "swe",
    name: "Swedish",
    size: 4_167_034,
    sha256: "f7304988d41f833efebcc2d529df54b1903ecebbc3da1faabd19a0fddd4fe586",
  },
  {
    code: "tha",
    name: "Thai",
    size: 1_072_600,
    sha256: "294227cc2d1292b0acb28d61d4115c88252b96d466ca90b417cf4cf0c67bf07c",
  },
  {
    code: "tur",
    name: "Turkish",
    size: 4_550_554,
    sha256: "7393381111e1152420fc4092cb44eef4237580d21b92bf30d7d221aad192c6b7",
  },
  {
    code: "ukr",
    name: "Ukrainian",
    size: 3_825_102,
    sha256: "d59e53e2bded32f4445f124b4b00240fcac7e8044c003ab822ccb94f0b3db59b",
  },
  {
    code: "vie",
    name: "Vietnamese",
    size: 531_275,
    sha256: "79df64caf7bcfb2a27df5042ecb6121e196eada34da774956995747636d5bfa1",
  },
];

/** The address one language is fetched from, built from fixed parts. */
export function languageUrl(code: string): string {
  const file = DOWNLOADABLE.find((l) => l.code === code);
  if (!file) throw new Error("That language is not in the list.");
  return `${MIRROR}/${file.code}.traineddata`;
}

/**
 * Hugging Face answers the pinned address with a redirect to its own file
 * store. Only https to its own names is followed; any other is an error.
 */
export function isMirrorHost(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return (
    url.protocol === "https:" &&
    (url.port === "" || url.port === "443") &&
    url.username === "" &&
    url.password === "" &&
    (host === "huggingface.co" ||
      host.endsWith(".huggingface.co") ||
      host.endsWith(".hf.co"))
  );
}

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 120_000;

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface LanguageDeps {
  dataDir: string;
  /** The folder the built-in English file is in. */
  builtInDir: string;
  fetch: typeof fetch;
}

/** The languages the reader knows, downloaded ones checked against their hash. */
export class OcrLanguages {
  /** Files already checked, by path, with the size and time they had then. */
  private readonly checked = new Map<string, string>();

  constructor(private readonly deps: LanguageDeps) {}

  private get folder(): string {
    return join(this.deps.dataDir, "ocr-languages");
  }

  private fileOf(code: string): string {
    if (!DOWNLOADABLE.some((l) => l.code === code))
      throw new Error("That language is not in the list.");
    return join(this.folder, `${code}.traineddata`);
  }

  /** True when the file is there and its bytes have the hash in the list. */
  private isGood(code: string): boolean {
    const file = this.fileOf(code);
    if (!existsSync(file)) return false;
    const info = statSync(file);
    const stamp = `${info.size}:${info.mtimeMs}`;
    if (this.checked.get(file) === stamp) return true;
    const expected = DOWNLOADABLE.find((l) => l.code === code);
    if (!expected || info.size !== expected.size) return false;
    const good = sha256(readFileSync(file)) === expected.sha256;
    if (good) this.checked.set(file, stamp);
    return good;
  }

  list(): OcrLanguage[] {
    return [
      { ...pick(BUILT_IN), builtIn: true, installed: true },
      ...DOWNLOADABLE.map((l) => ({
        ...pick(l),
        builtIn: false,
        installed: this.isGood(l.code),
      })),
    ];
  }

  /** The codes the reader should load: English first, then the downloaded ones. */
  installed(): string[] {
    return [
      BUILT_IN.code,
      ...DOWNLOADABLE.filter((l) => this.isGood(l.code)).map((l) => l.code),
    ];
  }

  /**
   * The bytes of one language for the reader, checked again here, or
   * undefined when it is not installed or no longer matches.
   */
  bytesOf(code: string): Uint8Array | undefined {
    if (code === BUILT_IN.code) {
      const file = join(this.deps.builtInDir, `${BUILT_IN.code}.traineddata`);
      if (!existsSync(file)) return undefined;
      const bytes = new Uint8Array(readFileSync(file));
      return sha256(bytes) === BUILT_IN.sha256 ? bytes : undefined;
    }
    if (!DOWNLOADABLE.some((l) => l.code === code)) return undefined;
    if (!this.isGood(code)) return undefined;
    const bytes = new Uint8Array(readFileSync(this.fileOf(code)));
    const expected = DOWNLOADABLE.find((l) => l.code === code);
    return expected && sha256(bytes) === expected.sha256 ? bytes : undefined;
  }

  /** Fetches one language on the person's click. A wrong file is deleted and refused. */
  async download(code: unknown): Promise<OcrLanguage[]> {
    if (typeof code !== "string")
      throw new Error("That language is not in the list.");
    const expected = DOWNLOADABLE.find((l) => l.code === code);
    if (!expected) throw new Error("That language is not in the list.");
    const file = this.fileOf(code);
    const bytes = await this.fetchPinned(languageUrl(code), expected.size);
    mkdirSync(this.folder, { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, bytes, { mode: 0o600 });
    if (sha256(new Uint8Array(readFileSync(temp))) !== expected.sha256) {
      rmSync(temp, { force: true });
      rmSync(file, { force: true });
      throw new Error(
        "The downloaded file did not match the one the app expects, so it was deleted. Nothing was kept.",
      );
    }
    renameSync(temp, file);
    return this.list();
  }

  remove(code: unknown): OcrLanguage[] {
    if (typeof code !== "string" || code === BUILT_IN.code)
      throw new Error("That language cannot be removed.");
    rmSync(this.fileOf(code), { force: true });
    return this.list();
  }

  private async fetchPinned(start: string, size: number): Promise<Uint8Array> {
    let url = new URL(start);
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!isMirrorHost(url))
        throw new Error(
          "The download went somewhere it should not. Nothing was kept.",
        );
      let response: Response;
      try {
        response = await this.deps.fetch(url.href, {
          redirect: "manual",
          signal,
          credentials: "omit",
        });
      } catch {
        throw new Error(
          "The language could not be downloaded. Check your connection and try again.",
        );
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) break;
        url = new URL(location, url);
        continue;
      }
      if (!response.ok || !response.body) break;
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (declared > size) break;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > size) {
          await reader.cancel();
          throw new Error(
            "The downloaded file was larger than expected, so it was deleted. Nothing was kept.",
          );
        }
        chunks.push(value);
      }
      const out = new Uint8Array(total);
      let at = 0;
      for (const chunk of chunks) {
        out.set(chunk, at);
        at += chunk.length;
      }
      return out;
    }
    throw new Error("The language could not be downloaded. Try again later.");
  }
}

function pick(l: LanguageFile): Pick<OcrLanguage, "code" | "name" | "size"> {
  return { code: l.code, name: l.name, size: l.size };
}
