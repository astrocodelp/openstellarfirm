// Writes the three C++ headers the desk pet firmware shares with the app:
// protocol.h, adpcm_vectors.h and usb_vectors.h in firmware/pet/include/generated.
// Run it with `pnpm pets:header` after a change in src/shared/pets. A test
// (src/shared/pets/header.test.ts) fails when the committed headers differ from
// what this writes, so they are never edited by hand.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "firmware/pet/include/generated");

// header.ts is TypeScript with extensionless imports, so it is bundled in
// memory and loaded from there. Nothing is written but the three headers.
const bundled = await build({
  entryPoints: [join(root, "src/shared/pets/header.ts")],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  target: "node22",
  logLevel: "silent",
});
const source = bundled.outputFiles[0].text;
const {
  renderAdpcmVectorsHeader,
  renderProtocolHeader,
  renderUsbVectorsHeader,
} = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

mkdirSync(target, { recursive: true });
writeFileSync(join(target, "protocol.h"), renderProtocolHeader());
writeFileSync(join(target, "adpcm_vectors.h"), renderAdpcmVectorsHeader());
writeFileSync(join(target, "usb_vectors.h"), renderUsbVectorsHeader());
console.log(`Wrote protocol.h, adpcm_vectors.h and usb_vectors.h to ${target}`);
