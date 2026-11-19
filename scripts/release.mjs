// Decides what a desktop tag publishes, and whether that build is signed.
// The release workflow shells out to the commands at the bottom. Secret
// values are only checked for presence: nothing here prints one.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const INSTALLER_PREFIX = "OpenStellarFirm";
export const SIGNED_CONFIG_FILE = "electron-builder.signed.json";
export const SIGNING_ISSUE_URL =
  "https://github.com/astrocodelp/worker-bot-open-source/issues/4";

/** Stable `vX.Y.Z` or release candidate `vX.Y.Z-rc.N`. The workflow's tag filter matches this. */
export const TAG_PATTERN = /^v([0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?)$/;

const STAMPABLE = /^[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+|-dev\.[0-9]+)?$/;

export const TARGETS = [
  {
    target: "mac-x64",
    platform: "mac",
    files: [
      { ext: "dmg", label: "macOS Intel (x64)" },
      { ext: "zip", label: "macOS Intel (x64), zip archive" },
    ],
  },
  {
    target: "mac-arm64",
    platform: "mac",
    files: [
      { ext: "dmg", label: "macOS Apple silicon (arm64)" },
      { ext: "zip", label: "macOS Apple silicon (arm64), zip archive" },
    ],
  },
  {
    target: "win-x64",
    platform: "win",
    files: [{ ext: "exe", label: "Windows (x64)" }],
  },
];

const MAC_CERTIFICATE = ["CSC_LINK", "CSC_KEY_PASSWORD"];
const APPLE_API_KEY = ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"];
const APPLE_ID = ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"];
const AZURE = [
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
  "AZURE_TRUSTED_SIGNING_ENDPOINT",
  "AZURE_TRUSTED_SIGNING_ACCOUNT",
  "AZURE_TRUSTED_SIGNING_PROFILE",
  "AZURE_TRUSTED_SIGNING_PUBLISHER",
];
const WIN_CERTIFICATE = ["WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD"];

const has = (env, name) =>
  typeof env[name] === "string" && env[name].trim() !== "";
const missingOf = (env, names) => names.filter((name) => !has(env, name));
const anyOf = (env, names) => names.some((name) => has(env, name));

export function artifactName(version, target, ext) {
  const splitAt = target.indexOf("-");
  const os = target.slice(0, splitAt);
  const arch = target.slice(splitAt + 1);
  return `${INSTALLER_PREFIX}-${version}-${os}-${arch}.${ext}`;
}

export function statusFileName(target) {
  return `signing-status-${target}.json`;
}

export function parseTagName(tag) {
  const match = TAG_PATTERN.exec(tag ?? "");
  if (!match) {
    return {
      error: `Tag '${tag}' must be vX.Y.Z (stable) or vX.Y.Z-rc.N (release candidate), for example v0.1.0 or v0.1.0-rc.1.`,
    };
  }
  const version = match[1];
  return { version, prerelease: version.includes("-rc.") };
}

/**
 * @param {{ eventName: string, tagName?: string, signInput?: string | boolean, runNumber?: string | number }} input
 */
export function planRun({ eventName, tagName, signInput, runNumber }) {
  if (eventName === "pull_request" || eventName === "pull_request_target") {
    return {
      error:
        "This workflow must not run for a pull request. A self-hosted runner would execute a fork's code.",
    };
  }
  if (eventName === "workflow_dispatch") {
    if (!/^[0-9]+$/.test(String(runNumber ?? ""))) {
      return { error: "Run number must be digits." };
    }
    const sign = signInput === true || signInput === "true";
    return {
      version: `0.0.0-dev.${runNumber}`,
      prerelease: true,
      publish: false,
      signingMode: sign ? "required" : "off",
    };
  }
  if (eventName !== "push") {
    return { error: `Unsupported event '${eventName}'.` };
  }
  const parsed = parseTagName(tagName);
  if (parsed.error) return parsed;
  return {
    version: parsed.version,
    prerelease: parsed.prerelease,
    publish: true,
    signingMode: "optional",
  };
}

function baseConfig() {
  return { extends: "electron-builder.yml", forceCodeSigning: true };
}

function unsigned() {
  return { signed: false, method: "unsigned", config: null };
}

/**
 * `off` never signs. `optional` signs when the set for this platform is
 * complete and stays unsigned when it is entirely absent. A half-filled set
 * is an error in both `optional` and `required`, so a typo cannot publish
 * an unsigned build that was meant to be signed.
 */
export function planSigning(platform, env, signingMode) {
  if (signingMode === "off") return unsigned();
  if (signingMode !== "optional" && signingMode !== "required") {
    return { error: `Unknown signing mode '${signingMode}'.` };
  }
  const required = signingMode === "required";
  if (platform === "mac") return planMac(env, required);
  if (platform === "win") return planWin(env, required);
  return { error: `Unknown platform '${platform}'. Use mac or win.` };
}

function planMac(env, required) {
  const certMissing = missingOf(env, MAC_CERTIFICATE);
  const apiStarted = anyOf(env, APPLE_API_KEY);
  const appleIdStarted = anyOf(env, APPLE_ID);
  const nothing =
    certMissing.length === MAC_CERTIFICATE.length &&
    !apiStarted &&
    !appleIdStarted;
  if (nothing) {
    if (!required) return unsigned();
    return {
      error: `macOS signing and notarisation need: ${MAC_CERTIFICATE.join(", ")}; ${APPLE_API_KEY.join(", ")} (or ${APPLE_ID.join(", ")}).`,
    };
  }
  let notary;
  let notaryMissing = [];
  if (apiStarted) {
    notary = "app-store-connect-api-key";
    notaryMissing = missingOf(env, APPLE_API_KEY);
  } else if (appleIdStarted) {
    notary = "apple-id";
    notaryMissing = missingOf(env, APPLE_ID);
  } else {
    notaryMissing = [`${APPLE_API_KEY.join(", ")} (or ${APPLE_ID.join(", ")})`];
  }
  const missing = [certMissing.join(", "), ...notaryMissing].filter(Boolean);
  if (missing.length > 0) {
    return {
      error: `macOS signing and notarisation need: ${missing.join("; ")}.`,
    };
  }
  return {
    signed: true,
    method: `developer-id+${notary}`,
    config: { ...baseConfig(), mac: { notarize: true } },
  };
}

function planWin(env, required) {
  const azureStarted = anyOf(env, AZURE);
  const pfxStarted = anyOf(env, WIN_CERTIFICATE);
  if (!azureStarted && !pfxStarted) {
    if (!required) return unsigned();
    return {
      error: `Windows signing needs Azure Trusted Signing (${AZURE.join(", ")}) or a .pfx certificate (${WIN_CERTIFICATE.join(" and ")}). None are set.`,
    };
  }
  if (azureStarted) {
    const missing = missingOf(env, AZURE);
    if (missing.length > 0) {
      return {
        error: `Windows signing with Azure Trusted Signing needs: ${missing.join(", ")}. To sign with a .pfx certificate instead, set ${WIN_CERTIFICATE.join(" and ")} and leave the AZURE_* values empty.`,
      };
    }
    return {
      signed: true,
      method: "azure-trusted-signing",
      config: {
        ...baseConfig(),
        win: {
          azureSignOptions: {
            endpoint: env.AZURE_TRUSTED_SIGNING_ENDPOINT.trim(),
            codeSigningAccountName: env.AZURE_TRUSTED_SIGNING_ACCOUNT.trim(),
            certificateProfileName: env.AZURE_TRUSTED_SIGNING_PROFILE.trim(),
            publisherName: env.AZURE_TRUSTED_SIGNING_PUBLISHER.trim(),
          },
        },
      },
    };
  }
  const missing = missingOf(env, WIN_CERTIFICATE);
  if (missing.length > 0) {
    return {
      error: `Windows signing with a .pfx certificate needs: ${missing.join(", ")}.`,
    };
  }
  return { signed: true, method: "pfx-certificate", config: baseConfig() };
}

function writeAppleKey(env, runnerTemp) {
  const value = env.APPLE_API_KEY.trim();
  if (value.includes("PRIVATE KEY")) {
    const dir = runnerTemp || tmpdir();
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "openstellarfirm-apple-api-key.p8");
    writeFileSync(file, value.endsWith("\n") ? value : `${value}\n`, {
      mode: 0o600,
    });
    return { path: file };
  }
  if (existsSync(value)) return { path: value };
  return {
    error:
      "APPLE_API_KEY must be the text of the AuthKey_<id>.p8 file or a path to it.",
  };
}

/**
 * Writes the signing status, and the electron-builder override when signing.
 * `envLines` are appended to GITHUB_ENV by the workflow command. They never
 * contain a secret: the Apple key line is a path to a temp file.
 */
export function prepareSigning({
  platform,
  target,
  env,
  signingMode,
  root,
  runnerTemp,
}) {
  const plan = planSigning(platform, env, signingMode);
  if (plan.error) return plan;
  const signedPath = join(root, SIGNED_CONFIG_FILE);
  if (plan.config) {
    writeFileSync(signedPath, `${JSON.stringify(plan.config, null, 2)}\n`);
  } else if (existsSync(signedPath)) {
    rmSync(signedPath);
  }
  writeFileSync(
    join(root, statusFileName(target)),
    `${JSON.stringify({ target, signed: plan.signed, method: plan.method }, null, 2)}\n`,
  );
  const envLines = [];
  if (!plan.signed) {
    envLines.push("CSC_IDENTITY_AUTO_DISCOVERY=false");
  } else {
    envLines.push("SIGNING_ACTIVE=true");
    if (plan.method.endsWith("app-store-connect-api-key")) {
      const key = writeAppleKey(env, runnerTemp);
      if (key.error) return key;
      envLines.push(`APPLE_API_KEY=${key.path}`);
    }
  }
  return { ...plan, envLines };
}

export function checkVersion(version) {
  if (!STAMPABLE.test(version ?? "")) {
    return { error: `Refusing to stamp version '${version}'.` };
  }
  return { version };
}

function walkFiles(dir, found = []) {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(path, found);
    else found.push(path);
  }
  return found;
}

function findNamed(files, name) {
  return files.find(
    (file) =>
      file === name || file.endsWith(`/${name}`) || file.endsWith(`\\${name}`),
  );
}

export function stageTargetInstallers({
  releaseDir,
  version,
  target,
  statusPath,
  destDir,
}) {
  const spec = TARGETS.find((item) => item.target === target);
  if (!spec) return { error: `Unknown target '${target}'.` };
  if (!existsSync(statusPath)) return { error: `Missing ${statusPath}.` };
  mkdirSync(destDir, { recursive: true });
  const copied = [];
  const listing = existsSync(releaseDir)
    ? readdirSync(releaseDir).join(", ")
    : "(directory missing)";
  for (const file of spec.files) {
    const name = artifactName(version, target, file.ext);
    const source = join(releaseDir, name);
    if (!existsSync(source)) {
      return { error: `Expected ${name} in ${releaseDir}. Found: ${listing}.` };
    }
    copyFileSync(source, join(destDir, name));
    copied.push(name);
  }
  copyFileSync(statusPath, join(destDir, statusFileName(target)));
  return { copied };
}

export function buildReleaseNotes({ version, prerelease, statuses }) {
  const byTarget = new Map(statuses.map((status) => [status.target, status]));
  const rows = [];
  for (const target of TARGETS) {
    const status = byTarget.get(target.target);
    if (!status || typeof status.signed !== "boolean") {
      return { error: `Missing signing status for ${target.target}.` };
    }
    for (const file of target.files) {
      rows.push({
        name: artifactName(version, target.target, file.ext),
        label: file.label,
        signed: status.signed,
      });
    }
  }
  const allUnsigned = rows.every((row) => !row.signed);
  const unsigned = rows.some((row) => !row.signed);
  const kind = prerelease
    ? "This is a **release candidate**. It is published as a prerelease and is not marked as the latest."
    : "This is a **stable** release, and it is marked as the latest.";
  let signing;
  if (!unsigned) {
    signing =
      "The macOS builds are signed with an Apple Developer ID and notarised by Apple. The Windows installer is code signed.";
  } else if (allUnsigned) {
    signing = `These installers are **unsigned**. macOS Gatekeeper and Windows SmartScreen will warn before they open. Signed releases are tracked in ${SIGNING_ISSUE_URL}.`;
  } else {
    signing = `Some of these installers are **unsigned**, so the release title says so. macOS Gatekeeper or Windows SmartScreen will warn on those. Signed releases are tracked in ${SIGNING_ISSUE_URL}.`;
  }
  const table = [
    "| File | Platform | Signing |",
    "| --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| \`${row.name}\` | ${row.label} | ${row.signed ? "Signed" : "Unsigned"} |`,
    ),
  ].join("\n");
  const title = `OpenStellarFirm ${version}${unsigned ? " (unsigned)" : ""}`;
  const body = [
    `Installers for **OpenStellarFirm** ${version}.`,
    "",
    kind,
    "",
    table,
    "",
    signing,
    "",
    "OpenStellarFirm is licensed under the Apache License 2.0 with the Commons Clause: free to use, change and share, not to sell. The source for this tag is this repository. See LICENSE and NOTICE.",
    "",
  ].join("\n");
  return { title, body, unsigned };
}

export function stageRelease({
  assetsDir,
  version,
  prerelease,
  notesPath,
  destDir,
}) {
  const files = walkFiles(assetsDir);
  const statuses = [];
  for (const target of TARGETS) {
    const statusPath = findNamed(files, statusFileName(target.target));
    if (!statusPath)
      return { error: `Missing ${statusFileName(target.target)}.` };
    try {
      statuses.push(JSON.parse(readFileSync(statusPath, "utf8")));
    } catch {
      return { error: `Could not read ${statusFileName(target.target)}.` };
    }
  }
  const notes = buildReleaseNotes({ version, prerelease, statuses });
  if (notes.error) return notes;
  const missing = [];
  mkdirSync(destDir, { recursive: true });
  for (const target of TARGETS) {
    for (const file of target.files) {
      const name = artifactName(version, target.target, file.ext);
      const source = findNamed(files, name);
      if (!source) missing.push(name);
      else copyFileSync(source, join(destDir, name));
    }
  }
  if (missing.length > 0)
    return { error: `Missing installers: ${missing.join(", ")}.` };
  writeFileSync(notesPath, notes.body);
  return notes;
}

function writeOutput(lines) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) {
    console.log(lines.join("\n"));
    return;
  }
  writeFileSync(file, `${readIfExists(file)}${lines.join("\n")}\n`);
}

function readIfExists(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function fail(error) {
  console.error(`::error::${error} See docs/RELEASING.md.`);
  process.exit(1);
}

function main() {
  const command = process.argv[2];
  if (command === "parse") {
    const plan = planRun({
      eventName: process.env.EVENT_NAME,
      tagName: process.env.TAG_NAME,
      signInput: process.env.SIGN_INPUT,
      runNumber: process.env.RUN_NUMBER,
    });
    if (plan.error) fail(plan.error);
    writeOutput([
      `version=${plan.version}`,
      `prerelease=${plan.prerelease}`,
      `publish=${plan.publish}`,
      `signing_mode=${plan.signingMode}`,
    ]);
    console.log(
      `OpenStellarFirm ${plan.version} (prerelease=${plan.prerelease}, publish=${plan.publish}, signing=${plan.signingMode})`,
    );
    return;
  }
  if (command === "check-version") {
    const result = checkVersion(process.env.VERSION);
    if (result.error) fail(result.error);
    return;
  }
  if (command === "prepare") {
    const [platform, target] = process.argv.slice(3);
    const result = prepareSigning({
      platform,
      target,
      env: process.env,
      signingMode: process.env.SIGNING_MODE,
      root: process.cwd(),
      runnerTemp: process.env.RUNNER_TEMP,
    });
    if (result.error) fail(result.error);
    if (process.env.GITHUB_ENV && result.envLines.length > 0) {
      writeFileSync(
        process.env.GITHUB_ENV,
        `${readIfExists(process.env.GITHUB_ENV)}${result.envLines.join("\n")}\n`,
      );
    }
    // Step outputs are the expression context. GITHUB_ENV is only the
    // process environment of later steps, which cannot gate a secret.
    writeOutput([`signing_active=${result.signed}`]);
    console.log(
      `${target}: ${result.signed ? "signed" : "unsigned"} (${result.method}).`,
    );
    return;
  }
  if (command === "stage-target") {
    const result = stageTargetInstallers({
      releaseDir: process.env.RELEASE_DIR || "release",
      version: process.env.VERSION,
      target: process.env.TARGET,
      statusPath: process.env.STATUS_PATH,
      destDir: process.env.DEST_DIR || "upload",
    });
    if (result.error) fail(result.error);
    console.log(result.copied.join("\n"));
    return;
  }
  if (command === "notes") {
    const result = stageRelease({
      assetsDir: process.env.ASSETS_DIR,
      version: process.env.VERSION,
      prerelease: process.env.PRERELEASE === "true",
      notesPath: process.env.NOTES_PATH || "release-notes.md",
      destDir: process.env.DEST_DIR || "publish",
    });
    if (result.error) fail(result.error);
    writeOutput([`title=${result.title}`, `unsigned=${result.unsigned}`]);
    console.log(result.title);
    return;
  }
  fail(`Unknown command '${command ?? ""}'.`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
