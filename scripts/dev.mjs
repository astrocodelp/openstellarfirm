import { spawn } from "node:child_process";
import electron from "electron";
import { createServer } from "vite";
import { bundleMain } from "./bundle.mjs";

// Runs the page on Vite's dev server (hot reload) inside the real app window.
await bundleMain();
const server = await createServer();
await server.listen();
const url = server.resolvedUrls?.local[0] ?? "http://localhost:5199/";

const app = spawn(electron, ["."], {
  stdio: "inherit",
  env: { ...process.env, STELLARFIRM_OPEN_DEV_URL: url },
});
app.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
