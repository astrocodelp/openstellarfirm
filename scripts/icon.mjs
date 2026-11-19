// Draws build/icon.svg to build/icon.png at 1024 by 1024, with Electron itself,
// and the smaller pictures a Linux desktop picks from (build/icons/16x16.png to
// 512x512.png). Run it with `pnpm icon`. electron-builder makes the .icns and
// .ico from the large PNG.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

const SIZE = 1024;
/** The sizes a Linux desktop looks for, in build/icons. */
const LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = readFileSync(join(root, "build/icon.svg"), "utf8");
const page = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent;overflow:hidden">${svg}`;

app.disableHardwareAcceleration();

// Not a top-level await: Electron loads a main file before the app is ready.
async function draw() {
  const window = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true, sandbox: true },
  });
  await window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(page)}`,
  );
  // Offscreen pages paint on their own clock; give the first frame a moment.
  await new Promise((done) => setTimeout(done, 400));

  let image = await window.webContents.capturePage();
  const { width, height } = image.getSize();
  if (width !== SIZE || height !== SIZE)
    image = image.resize({ width: SIZE, height: SIZE, quality: "best" });
  writeFileSync(join(root, "build/icon.png"), image.toPNG());
  console.log(
    `Wrote build/icon.png (${SIZE} by ${SIZE}, from ${width} by ${height}).`,
  );
  mkdirSync(join(root, "build/icons"), { recursive: true });
  for (const size of LINUX_SIZES) {
    const small = image.resize({ width: size, height: size, quality: "best" });
    writeFileSync(join(root, `build/icons/${size}x${size}.png`), small.toPNG());
  }
  console.log(`Wrote build/icons (${LINUX_SIZES.join(", ")}).`);
  app.quit();
}

app
  .whenReady()
  .then(draw)
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
