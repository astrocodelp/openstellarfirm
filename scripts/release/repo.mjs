// Prints the GitHub repository ("owner/name") from package.json's
// "repository", the one place the release scripts take it from.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const url = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
const match = /^(?:git\+)?https:\/\/github\.com\/([0-9A-Za-z._-]+\/[0-9A-Za-z._-]+?)(?:\.git)?$/.exec(
  url ?? "",
);
if (!match) {
  console.error("package.json has no GitHub repository address");
  process.exit(1);
}
console.log(match[1]);
