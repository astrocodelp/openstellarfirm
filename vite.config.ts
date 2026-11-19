import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * The packaged app loads its page from a file, so the page carries its own
 * Content Security Policy. The dev server needs inline scripts for hot reload,
 * so the policy is added only to a build.
 */
function contentSecurityPolicy(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  return {
    name: "openstellar-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}">`,
      );
    },
  };
}

export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react(), contentSecurityPolicy()],
  // The personas folder sits above the page's root, so the dev server may read it.
  server: {
    port: 5199,
    strictPort: true,
    host: "localhost",
    fs: { allow: [fileURLToPath(new URL(".", import.meta.url))] },
  },
  build: { outDir: "../../dist/renderer", emptyOutDir: true },
});
