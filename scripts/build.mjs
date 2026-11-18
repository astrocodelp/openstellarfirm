import { build as buildPage } from "vite";
import { bundleMain } from "./bundle.mjs";

await bundleMain();
await buildPage();
