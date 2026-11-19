import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { build } from "esbuild";

const require = createRequire(import.meta.url);

// The main process and the preload are bundled to CommonJS: a sandboxed
// preload cannot be an ES module, and one format keeps both simple.
const common = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
};

export async function bundleMain() {
  // The window's icon is read from beside the bundle, inside the packaged app.
  await mkdir("dist", { recursive: true });
  await copyFile("build/icon.png", "dist/icon.png");
  await build({
    ...common,
    entryPoints: ["src/main/index.ts"],
    outfile: "dist/main/index.cjs",
  });
  await build({
    ...common,
    entryPoints: ["src/preload/index.ts"],
    outfile: "dist/preload/index.cjs",
  });
  await bundleReader();
}

async function copyAll(from, to, keep) {
  await mkdir(to, { recursive: true });
  for (const name of await readdir(from)) {
    if (keep(name)) await copyFile(join(from, name), join(to, name));
  }
}

/**
 * The reader: the hidden window that opens PDFs and reads pictures on this
 * computer. Everything it loads is copied here, into the app's own files, so
 * it never fetches anything from the internet.
 */
async function bundleReader() {
  const out = "dist/reader";
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, "lang"), { recursive: true });
  await build({
    ...common,
    entryPoints: ["src/reader/preload.ts"],
    outfile: "dist/reader-preload/index.cjs",
  });
  await build({
    bundle: true,
    platform: "browser",
    target: "chrome140",
    format: "esm",
    sourcemap: false,
    logLevel: "info",
    entryPoints: ["src/reader/reader.ts"],
    outfile: join(out, "reader.js"),
  });
  await copyFile("src/reader/index.html", join(out, "index.html"));

  const pdfjs = dirname(require.resolve("pdfjs-dist/package.json"));
  await copyFile(
    join(pdfjs, "build/pdf.worker.min.mjs"),
    join(out, "pdf.worker.mjs"),
  );
  await copyAll(
    join(pdfjs, "cmaps"),
    join(out, "cmaps"),
    (name) => name.endsWith(".bcmap") || name === "LICENSE",
  );
  // The decoders scanned pages often need (JBIG2, JPEG 2000) and colour profiles.
  const wasm = ["jbig2.wasm", "openjpeg.wasm", "qcms_bg.wasm"];
  await copyAll(
    join(pdfjs, "wasm"),
    join(out, "wasm"),
    (name) =>
      wasm.includes(name) ||
      (name.startsWith("LICENSE_") && !name.includes("QUICKJS")),
  );

  const tesseract = dirname(require.resolve("tesseract.js/package.json"));
  await copyFile(
    join(tesseract, "dist/worker.min.js"),
    join(out, "tesseract-worker.js"),
  );
  const core = dirname(
    createRequire(join(tesseract, "package.json")).resolve(
      "tesseract.js-core/package.json",
    ),
  );
  await copyFile(
    join(core, "tesseract-core-simd-lstm.wasm.js"),
    join(out, "tesseract-core-simd-lstm.wasm.js"),
  );
  await copyFile(
    "assets/ocr/eng.traineddata",
    join(out, "lang/eng.traineddata"),
  );
}
