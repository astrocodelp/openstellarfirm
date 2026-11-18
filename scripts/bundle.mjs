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
