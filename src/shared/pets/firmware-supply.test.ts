import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const platformio = readFileSync(
  join(import.meta.dirname, "../../../firmware/pet/platformio.ini"),
  "utf8",
);

/** The `lib_deps` lines of every section, as written. */
function libDeps(ini: string): string[] {
  const lines = ini.split("\n");
  const deps: string[] = [];
  let inDeps = false;
  for (const line of lines) {
    if (/^lib_deps\s*=/.test(line)) {
      inDeps = true;
      continue;
    }
    // A dependency is an indented line; anything else ends the list.
    if (inDeps && /^\s+\S/.test(line)) {
      deps.push(line.trim());
    } else {
      inDeps = false;
    }
  }
  return deps;
}

/**
 * The firmware's libraries are linked into the image that holds the pet's
 * device token. PlatformIO has no lock file, so only an exact version in
 * `platformio.ini` keeps a new upstream release out of the next build.
 */
describe("the firmware's supply chain is pinned", () => {
  it("names every library at one exact version, never a range", () => {
    const deps = libDeps(platformio);
    expect(deps.length).toBeGreaterThanOrEqual(2);
    for (const dep of deps) {
      expect(dep, dep).toMatch(/^[\w.-]+\/[\w .-]+@\d+\.\d+\.\d+$/);
    }
  });

  it("names the platform as a release zip with a version", () => {
    const platform = /^platform\s*=\s*(\S+)$/m.exec(platformio)?.[1] ?? "";
    expect(platform).toMatch(
      /^https:\/\/github\.com\/pioarduino\/platform-espressif32\/releases\/download\/\d+\.\d+\.\d+\/platform-espressif32\.zip$/,
    );
  });
});
