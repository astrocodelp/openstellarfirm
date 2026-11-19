import { copyFile, cp, mkdir } from "node:fs/promises";
import { build } from "esbuild";

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
  // The files an assistant's computer is built from. Docker is given a copy
  // in the data folder, as it cannot read inside the app's archive.
  await cp("resources/computer", "dist/computer", { recursive: true });
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
}
