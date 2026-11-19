import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  artifactName,
  buildReleaseNotes,
  checkVersion,
  planRun,
  planSigning,
  prepareSigning,
  stageRelease,
  stageTargetInstallers,
  TAG_PATTERN,
} from "./release.mjs";

const secret = "SUPER-SECRET-VALUE";
const pem = `-----BEGIN PRIVATE KEY-----\n${secret}\n-----END PRIVATE KEY-----\n`;

const macEnv = {
  CSC_LINK: secret,
  CSC_KEY_PASSWORD: "pw",
  APPLE_API_KEY: pem,
  APPLE_API_KEY_ID: "KEYID12345",
  APPLE_API_ISSUER: "issuer-uuid",
};

const azureEnv = {
  AZURE_TENANT_ID: "tenant",
  AZURE_CLIENT_ID: "client",
  AZURE_CLIENT_SECRET: secret,
  AZURE_TRUSTED_SIGNING_ENDPOINT: "https://weu.codesigning.azure.net/",
  AZURE_TRUSTED_SIGNING_ACCOUNT: "account",
  AZURE_TRUSTED_SIGNING_PROFILE: "profile",
  AZURE_TRUSTED_SIGNING_PUBLISHER: "Astro Code L.P.",
};

let dirs = [];

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function temp() {
  const dir = mkdtempSync(join(tmpdir(), "openstellarfirm-release-"));
  dirs.push(dir);
  return dir;
}

describe("parse a release tag", () => {
  it("accepts a stable tag and a release candidate", () => {
    expect(planRun({ eventName: "push", tagName: "v0.1.0" })).toEqual({
      version: "0.1.0",
      prerelease: false,
      publish: true,
      signingMode: "optional",
    });
    expect(
      planRun({ eventName: "push", tagName: "v0.1.0-rc.2" }),
    ).toMatchObject({
      version: "0.1.0-rc.2",
      prerelease: true,
      publish: true,
      signingMode: "optional",
    });
  });

  it("rejects tags that are not vX.Y.Z or vX.Y.Z-rc.N", () => {
    for (const tag of [
      "desktop-v0.1.0",
      "v0.1",
      "v0.1.0-rc",
      "v0.1.0-beta.1",
      "V0.1.0",
      "",
    ]) {
      expect(planRun({ eventName: "push", tagName: tag }).error).toMatch(
        /vX\.Y\.Z/,
      );
    }
  });

  it("keeps a manual run unpublished, and signs only when asked", () => {
    expect(
      planRun({
        eventName: "workflow_dispatch",
        signInput: "false",
        runNumber: "7",
      }),
    ).toEqual({
      version: "0.0.0-dev.7",
      prerelease: true,
      publish: false,
      signingMode: "off",
    });
    expect(
      planRun({
        eventName: "workflow_dispatch",
        signInput: "true",
        runNumber: "8",
      }).signingMode,
    ).toBe("required");
  });

  it("refuses a pull request, which would put fork code on the self-hosted runner", () => {
    expect(
      planRun({ eventName: "pull_request", tagName: "v0.1.0" }).error,
    ).toMatch(/fork/);
    expect(planRun({ eventName: "pull_request_target" }).error).toMatch(/fork/);
  });
});

describe("signing", () => {
  it("stays unsigned when a tag has no signing secrets", () => {
    expect(planSigning("mac", {}, "optional")).toMatchObject({
      signed: false,
      config: null,
    });
    expect(planSigning("win", {}, "optional")).toMatchObject({ signed: false });
  });

  it("stays unsigned on a manual run even when the secrets are set", () => {
    expect(planSigning("mac", macEnv, "off")).toMatchObject({
      signed: false,
      method: "unsigned",
    });
    expect(planSigning("win", azureEnv, "off").config).toBeNull();
  });

  it("fails a manual sign request that has no secrets, and names them", () => {
    expect(planSigning("mac", {}, "required").error).toMatch(/CSC_LINK/);
    expect(planSigning("win", {}, "required").error).toMatch(/AZURE_TENANT_ID/);
    expect(planSigning("win", {}, "required").error).not.toMatch(
      /SUPER-SECRET/,
    );
  });

  it("fails a half-filled macOS set instead of shipping it unsigned", () => {
    const error = planSigning(
      "mac",
      { CSC_LINK: secret, CSC_KEY_PASSWORD: "pw" },
      "optional",
    ).error;
    expect(error).toMatch(/APPLE_API_KEY/);
    expect(error).not.toContain(secret);
  });

  it("signs macOS when the certificate and one full notarisation set are present", () => {
    const plan = planSigning("mac", macEnv, "optional");
    expect(plan.method).toBe("developer-id+app-store-connect-api-key");
    expect(plan.config).toEqual({
      extends: "electron-builder.yml",
      forceCodeSigning: true,
      mac: { notarize: true },
    });
    expect(JSON.stringify(plan.config)).not.toContain(secret);
  });

  it("prefers the App Store Connect key when that set is the one started", () => {
    const error = planSigning(
      "mac",
      { ...macEnv, APPLE_API_ISSUER: "  ", APPLE_ID: "dev@example.com" },
      "optional",
    ).error;
    expect(error).toMatch(/APPLE_API_ISSUER/);
  });

  it("signs Windows with Azure, or with a pfx when Azure is unset", () => {
    const azure = planSigning("win", azureEnv, "optional");
    expect(azure.method).toBe("azure-trusted-signing");
    expect(azure.config.win.azureSignOptions.publisherName).toBe(
      "Astro Code L.P.",
    );
    expect(JSON.stringify(azure.config)).not.toContain(secret);

    const pfx = planSigning(
      "win",
      { WIN_CSC_LINK: secret, WIN_CSC_KEY_PASSWORD: "pw" },
      "optional",
    );
    expect(pfx.method).toBe("pfx-certificate");
    expect(pfx.config.win).toBeUndefined();
  });

  it("names a missing Azure value and does not fall through to an unsigned build", () => {
    const error = planSigning(
      "win",
      { AZURE_TENANT_ID: "tenant" },
      "optional",
    ).error;
    expect(error).toMatch(/AZURE_CLIENT_ID/);
    expect(error).toMatch(/pfx/i);
  });

  it("writes an unsigned status without a signed config, and keeps the secret out of the files", () => {
    const root = temp();
    const runnerTemp = temp();
    writeFileSync(join(root, "electron-builder.signed.json"), "{}\n");
    const result = prepareSigning({
      platform: "mac",
      target: "mac-arm64",
      env: macEnv,
      signingMode: "off",
      root,
      runnerTemp,
    });
    expect(result.envLines).toEqual(["CSC_IDENTITY_AUTO_DISCOVERY=false"]);
    expect(
      readFileSync(join(root, "signing-status-mac-arm64.json"), "utf8"),
    ).toMatch(/"signed": false/);
    expect(() =>
      readFileSync(join(root, "electron-builder.signed.json")),
    ).toThrow();
  });

  it("writes the Apple key to a temp file and not into the electron-builder config", () => {
    const root = temp();
    const runnerTemp = temp();
    const result = prepareSigning({
      platform: "mac",
      target: "mac-x64",
      env: macEnv,
      signingMode: "required",
      root,
      runnerTemp,
    });
    expect(result.envLines[0]).toBe("SIGNING_ACTIVE=true");
    const keyLine = result.envLines[1];
    expect(keyLine.startsWith("APPLE_API_KEY=")).toBe(true);
    const keyPath = keyLine.slice("APPLE_API_KEY=".length);
    expect(keyPath.startsWith(runnerTemp)).toBe(true);
    expect(readFileSync(keyPath, "utf8")).toContain("BEGIN PRIVATE KEY");
    expect(statSync(keyPath).mode & 0o777).toBe(0o600);
    const config = readFileSync(
      join(root, "electron-builder.signed.json"),
      "utf8",
    );
    expect(config).not.toContain(secret);
    expect(config).not.toContain("BEGIN PRIVATE KEY");
  });
});

describe("release notes", () => {
  it("labels an unsigned stable release in the title and the body", () => {
    const notes = buildReleaseNotes({
      version: "0.1.0",
      prerelease: false,
      statuses: [
        { target: "mac-x64", signed: false },
        { target: "mac-arm64", signed: false },
        { target: "win-x64", signed: false },
      ],
    });
    expect(notes.title).toBe("OpenStellarFirm 0.1.0 (unsigned)");
    expect(notes.body).toMatch(/stable/);
    expect(notes.body).toMatch(/unsigned/);
    expect(notes.body).toContain(artifactName("0.1.0", "mac-arm64", "dmg"));
    expect(notes.body).toContain("issues/4");
    expect(notes.body).toContain("Apache License 2.0 with the Commons Clause");
    expect(notes.body).not.toContain("MIT");
    expect(notes.unsigned).toBe(true);
  });

  it("marks a fully signed release candidate as a prerelease without the unsigned label", () => {
    const notes = buildReleaseNotes({
      version: "0.1.0-rc.1",
      prerelease: true,
      statuses: [
        { target: "mac-x64", signed: true },
        { target: "mac-arm64", signed: true },
        { target: "win-x64", signed: true },
      ],
    });
    expect(notes.title).toBe("OpenStellarFirm 0.1.0-rc.1");
    expect(notes.body).toMatch(/release candidate/);
    expect(notes.body).toMatch(/notarised/);
    expect(notes.body).not.toMatch(/\(unsigned\)/);
    expect(notes.unsigned).toBe(false);
  });

  it("says which platform was unsigned when the set is mixed", () => {
    const notes = buildReleaseNotes({
      version: "0.2.0",
      prerelease: false,
      statuses: [
        { target: "mac-x64", signed: true },
        { target: "mac-arm64", signed: true },
        { target: "win-x64", signed: false },
      ],
    });
    expect(notes.title).toMatch(/\(unsigned\)$/);
    expect(notes.body).toMatch(/Some of these installers are \*\*unsigned\*\*/);
    expect(notes.body).toContain(
      "| `OpenStellarFirm-0.2.0-win-x64.exe` | Windows (x64) | Unsigned |",
    );
    expect(notes.body).toContain(
      "| `OpenStellarFirm-0.2.0-mac-x64.dmg` | macOS Intel (x64) | Signed |",
    );
  });
});

describe("staging installers", () => {
  it("copies one target's files and refuses a missing name", () => {
    const root = temp();
    const releaseDir = join(root, "release");
    mkdirSync(releaseDir);
    writeFileSync(
      join(releaseDir, artifactName("0.1.0", "win-x64", "exe")),
      "exe",
    );
    writeFileSync(join(root, "signing-status-win-x64.json"), "{}\n");
    const dest = join(root, "upload");
    expect(
      stageTargetInstallers({
        releaseDir,
        version: "0.1.0",
        target: "win-x64",
        statusPath: join(root, "signing-status-win-x64.json"),
        destDir: dest,
      }).copied,
    ).toEqual([artifactName("0.1.0", "win-x64", "exe")]);

    const missing = stageTargetInstallers({
      releaseDir,
      version: "0.1.0",
      target: "mac-x64",
      statusPath: join(root, "signing-status-win-x64.json"),
      destDir: dest,
    });
    expect(missing.error).toMatch(/mac-x64\.dmg/);
  });

  it("builds notes from artifacts that arrived in nested folders", () => {
    const root = temp();
    const nest = join(root, "assets", "mac");
    mkdirSync(nest, { recursive: true });
    const write = (dir, name, body) => writeFileSync(join(dir, name), body);
    write(nest, artifactName("0.1.0", "mac-x64", "dmg"), "d");
    write(nest, artifactName("0.1.0", "mac-x64", "zip"), "z");
    write(
      nest,
      "signing-status-mac-x64.json",
      JSON.stringify({ target: "mac-x64", signed: false }),
    );
    const arm = join(root, "assets", "arm");
    mkdirSync(arm);
    write(arm, artifactName("0.1.0", "mac-arm64", "dmg"), "d");
    write(arm, artifactName("0.1.0", "mac-arm64", "zip"), "z");
    write(
      arm,
      "signing-status-mac-arm64.json",
      JSON.stringify({ target: "mac-arm64", signed: true }),
    );
    const win = join(root, "assets", "win");
    mkdirSync(win);
    write(win, artifactName("0.1.0", "win-x64", "exe"), "e");
    write(
      win,
      "signing-status-win-x64.json",
      JSON.stringify({ target: "win-x64", signed: false }),
    );

    const result = stageRelease({
      assetsDir: join(root, "assets"),
      version: "0.1.0",
      prerelease: false,
      notesPath: join(root, "release-notes.md"),
      destDir: join(root, "publish"),
    });
    expect(result.unsigned).toBe(true);
    expect(
      readFileSync(
        join(root, "publish", artifactName("0.1.0", "win-x64", "exe")),
        "utf8",
      ),
    ).toBe("e");
    expect(readFileSync(join(root, "release-notes.md"), "utf8")).toMatch(
      /unsigned/,
    );
  });

  it("refuses a version that is not a tag or a manual dev build", () => {
    expect(checkVersion("0.1.0-rc.1").version).toBe("0.1.0-rc.1");
    expect(checkVersion("0.0.0-dev.3").version).toBe("0.0.0-dev.3");
    expect(checkVersion("0.1.0;touch /tmp/x").error).toMatch(/Refusing/);
  });
});

describe("workflow contract", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const workflow = readFileSync(
    join(root, ".github/workflows/release.yml"),
    "utf8",
  );

  it("publishes to this repository on a tag only, with the Fly runners on parse and publish", () => {
    expect(TAG_PATTERN.test("v1.2.3")).toBe(true);
    expect(workflow).not.toContain("pull_request");
    expect(workflow).not.toContain("stellarfirm-releases");
    expect(workflow).not.toContain("DESKTOP_RELEASES_TOKEN");
    expect(workflow).toContain("github.token");
    expect(workflow.match(/contents: write/g)).toHaveLength(1);
    expect(
      workflow.match(/runs-on: \[self-hosted, fly, linux, x64\]/g),
    ).toHaveLength(2);
    expect(workflow).toContain(`runs-on: \${{ matrix.os }}`);
    expect(workflow).toContain("macos-15-intel");
    expect(workflow).toContain("macos-15");
    expect(workflow).toContain("windows-latest");
    expect(workflow).toContain(
      "softprops/action-gh-release@8a0cd651e5b2365bd640854a3fa5dfc70e4875f3",
    );
  });

  it("uses the installer names electron-builder is configured to write", () => {
    const builder = readFileSync(join(root, "electron-builder.yml"), "utf8");
    expect(builder).toContain(
      `artifactName: OpenStellarFirm-\${version}-\${os}-\${arch}.\${ext}`,
    );
    expect(artifactName("0.1.0", "mac-x64", "dmg")).toBe(
      "OpenStellarFirm-0.1.0-mac-x64.dmg",
    );
  });
});
